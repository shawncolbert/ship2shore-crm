import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Fired by the `trg_notify_stage_change` trigger on public.opportunities:
// on any stage_id change the trigger POSTs { opportunity_id, contact_id, org_id,
// old_stage_id, new_stage_id } here. This function resolves stage names,
// enriches with the opportunity + contact, maps the transition to an automation
// action, and forwards the event to the n8n webhook.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const N8N_WEBHOOK_URL = Deno.env.get("N8N_STAGE_CHANGE_WEBHOOK_URL") || "";

// Normalize a stage display name to a stable token: "In Progress" -> "in_progress".
const norm = (s: string) => (s || "").toLowerCase().trim().replace(/\s+/g, "_");

// Map the NEW stage to an automation action. Anything not listed is ignored.
function resolveAction(newStage: string): string | null {
  switch (newStage) {
    case "scheduled":
      return "send_confirmation";        // email the contact their scheduled_at time
    case "completed":
      return "notify_completed";         // tell Shawn the job is done
    case "paid":
      return "log_paid";                 // no action yet -- just logged
    case "canceled":
    case "cancelled":
      return "notify_canceled";          // tell Shawn, with contact + last stage
    default:
      return null;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  try {
    const { opportunity_id, contact_id, org_id, old_stage_id, new_stage_id } = await req.json();

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Resolve stage names from the real `stages` table.
    const ids = [old_stage_id, new_stage_id].filter(Boolean);
    const { data: stages } = await supabase.from("stages").select("id, name").in("id", ids);
    const nameById: Record<string, string> = {};
    (stages || []).forEach((s: any) => { nameById[s.id] = norm(s.name); });

    const old_stage = nameById[old_stage_id] || "";
    const new_stage = nameById[new_stage_id] || "";

    const action = resolveAction(new_stage);
    if (!action) {
      return json({ skipped: true, old_stage, new_stage });
    }

    // Opportunity details (scheduled_at is what the confirmation email needs).
    const { data: opp } = await supabase
      .from("opportunities")
      .select("id, title, value, scheduled_at, service_code, port")
      .eq("id", opportunity_id)
      .maybeSingle();

    // The customer confirmation email is only meaningful with a real pickup
    // time. If the job moved to Scheduled without a scheduled_at, don't send —
    // otherwise the customer gets a "time to be confirmed" email. Set the time
    // on the card and it'll go out on the next move into Scheduled.
    if (action === "send_confirmation" && !opp?.scheduled_at) {
      return json({ skipped: true, reason: "no scheduled_at", action, new_stage });
    }

    // Contact info for the automations.
    const { data: contact } = await supabase
      .from("contacts")
      .select("id, full_name, email, phone")
      .eq("id", contact_id)
      .maybeSingle();

    const eventPayload = {
      action,
      opportunity_id,
      org_id,
      old_stage,
      new_stage,
      scheduled_at: opp?.scheduled_at ?? null,
      title: opp?.title ?? null,
      value: opp?.value ?? null,
      service_code: opp?.service_code ?? null,
      port: opp?.port ?? null,
      contact: contact ?? { id: contact_id },
      changed_at: new Date().toISOString(),
    };

    if (!N8N_WEBHOOK_URL) {
      return json({ note: "N8N_STAGE_CHANGE_WEBHOOK_URL not set; event not forwarded", eventPayload });
    }

    const res = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(eventPayload),
    });

    return json({ forwarded: true, n8n_status: res.status, action, eventPayload });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
