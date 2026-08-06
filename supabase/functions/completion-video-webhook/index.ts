import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Fired by trg_notify_completion_video (AFTER INSERT on public.attachments,
// kind='completion_video' AND gate_status='outside_gate' only -- inside_gate
// and untagged videos never reach this function at all). Builds the exact
// payload the completion-video-posting n8n workflow expects and forwards it.
//
// N8N_COMPLETION_VIDEO_WEBHOOK_URL is deliberately separate from
// N8N_STAGE_CHANGE_WEBHOOK_URL (see 0001_drop_redundant_n8n_trigger.sql --
// one trigger, one destination, no shared/ambiguous paths).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const N8N_URL = Deno.env.get("N8N_COMPLETION_VIDEO_WEBHOOK_URL") || "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// contacts.segment -> the caption tone bucket from the workflow spec.
// military -> Military/PCS, transporter -> Trucking, dispatcher -> Dispatcher,
// everything else (broker/private/other/null) -> Private.
function clientType(segment: string | null): string {
  switch (segment) {
    case "military": return "Military/PCS";
    case "transporter": return "Trucking";
    case "dispatcher": return "Dispatcher";
    default: return "Private";
  }
}

Deno.serve(async (req: Request) => {
  try {
    const { attachment_id, opportunity_id, contact_id, org_id } = await req.json();
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Re-check gate_status here too, not just trust the trigger's WHEN clause
    // -- this is the one thing in the whole pipeline that must never be wrong.
    const { data: attachment } = await supabase
      .from("attachments")
      .select("id, file_path, kind, gate_status")
      .eq("id", attachment_id).eq("org_id", org_id).maybeSingle();
    if (!attachment || attachment.kind !== "completion_video" || attachment.gate_status !== "outside_gate") {
      return json({ skipped: true, reason: "not an outside_gate completion video" });
    }

    const { data: opp } = await supabase
      .from("opportunities")
      .select("id, title, port, vehicle, billing_number, bl_number")
      .eq("id", opportunity_id).eq("org_id", org_id).maybeSingle();
    const { data: contact } = await supabase
      .from("contacts").select("segment").eq("id", contact_id).eq("org_id", org_id).maybeSingle();

    const { data: signed, error: signErr } = await supabase.storage
      .from("job-videos")
      .createSignedUrl(attachment.file_path, 60 * 60 * 24); // 24h -- plenty for n8n/Metricool to pick it up
    if (signErr || !signed?.signedUrl) {
      return json({ error: "could not sign video url: " + String(signErr) }, 500);
    }

    const payload = {
      client_type: clientType(contact?.segment ?? null),
      port: opp?.port || "",
      vehicle: opp?.vehicle || "",
      job_ref: opp?.billing_number || opp?.bl_number || opp?.title || attachment_id,
      date: new Date().toISOString().slice(0, 10),
      video_url: signed.signedUrl,
      video_tag: "outside-gate",
      opportunity_id,
      org_id,
    };

    if (!N8N_URL) {
      return json({ note: "N8N_COMPLETION_VIDEO_WEBHOOK_URL not set; event not forwarded", payload });
    }

    const res = await fetch(N8N_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return json({ ok: res.ok, forwarded: payload, n8n_status: res.status });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
