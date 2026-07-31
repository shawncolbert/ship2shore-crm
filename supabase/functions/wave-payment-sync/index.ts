import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Scheduled reconciliation (same cron pattern as gmail-sync): for every open
// opportunity with a Wave invoice attached, re-checks the invoice's real
// status with Wave and marks it paid if it is. This is the fallback for orgs
// not on Wave's Pro plan (webhook delivery requires Pro) and a safety net for
// any webhook delivery wave-webhook missed. Both share the same idempotent
// reconcile logic -- running both is safe, never double-processes.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WAVE_API_TOKEN = Deno.env.get("WAVE_API_TOKEN") || "";
const WAVE_BUSINESS_ID = Deno.env.get("WAVE_BUSINESS_ID") || "";
const WAVE_GRAPHQL_URL = "https://gql.waveapps.com/graphql/public";
const PAID_STAGE_ID = "0fa6b8e7-4dfa-4dba-9086-fd6a57c6e987";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function waveFetch(query: string, variables: Record<string, unknown>) {
  const res = await fetch(WAVE_GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${WAVE_API_TOKEN}` },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors?.length) {
    throw new Error("Wave GraphQL error: " + body.errors.map((e: any) => e.message).join("; "));
  }
  return body.data;
}

async function fetchWaveInvoiceStatus(invoiceId: string): Promise<string | null> {
  const data = await waveFetch(
    `query InvoiceStatus($businessId: ID!, $invoiceId: ID!) {
      business(id: $businessId) { invoice(id: $invoiceId) { id status } }
    }`,
    { businessId: WAVE_BUSINESS_ID, invoiceId },
  );
  return data?.business?.invoice?.status || null;
}

async function reconcileWaveInvoice(supabase: any, opportunityId: string, waveInvoiceId: string) {
  const status = await fetchWaveInvoiceStatus(waveInvoiceId);
  const isPaid = String(status || "").toUpperCase() === "PAID";
  if (!isPaid) return { paid: false, waveStatus: status };

  const { data: updated, error } = await supabase
    .from("opportunities")
    .update({ payment_status: "paid", stage_id: PAID_STAGE_ID })
    .eq("id", opportunityId)
    .eq("wave_invoice_id", waveInvoiceId)
    .neq("payment_status", "paid")
    .select("id, org_id, contact_id");
  if (error) throw error;

  if (updated && updated.length > 0) {
    await supabase.from("activities").insert({
      org_id: updated[0].org_id, contact_id: updated[0].contact_id, opportunity_id: opportunityId,
      type: "payment", body: "Wave invoice paid — moved to Paid stage.",
    });
  }
  return { paid: true, waveStatus: status, justUpdated: (updated || []).length > 0 };
}

Deno.serve(async (_req: Request) => {
  if (!WAVE_API_TOKEN || !WAVE_BUSINESS_ID) {
    return json({ skipped: true, reason: "WAVE_API_TOKEN / WAVE_BUSINESS_ID not set" });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: pending, error } = await supabase
    .from("opportunities")
    .select("id, wave_invoice_id")
    .not("wave_invoice_id", "is", null)
    .neq("payment_status", "paid")
    .neq("status", "cancelled");
  if (error) return json({ error: error.message }, 500);

  const results: any[] = [];
  for (const opp of pending || []) {
    try {
      const r = await reconcileWaveInvoice(supabase, opp.id, opp.wave_invoice_id as string);
      results.push({ opportunity_id: opp.id, ...r });
    } catch (e) {
      results.push({ opportunity_id: opp.id, error: String((e as Error)?.message || e) });
    }
  }
  return json({ checked: results.length, paid: results.filter((r) => r.justUpdated).length, results });
});
