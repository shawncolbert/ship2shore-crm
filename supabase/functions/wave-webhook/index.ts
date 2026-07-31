import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Receives Wave's webhook delivery for invoice/payment events. Wave webhooks
// require a Pro subscription (Standard/Starter plans don't get webhook
// delivery) -- if this org isn't on Pro, this function simply never gets
// called and wave-payment-sync (the scheduled poller) is what marks invoices
// paid instead. Both call the same idempotent reconcile logic below.
//
// NOTE ON PAYLOAD SHAPE: Wave's exact webhook payload/event-name format
// couldn't be confirmed from this build environment (their docs were
// unreachable). Rather than assume one shape, this extracts an invoice id
// from several plausible paths and then re-fetches that invoice's REAL
// status from Wave's API -- the webhook body is only ever treated as a
// "something changed, go check" signal, never as the source of truth for
// whether it's actually paid. Once real webhook deliveries start arriving,
// check these logs; if the id isn't being found, share one real payload and
// it's a one-line fix to extractInvoiceId().
//
// verify_jwt is OFF -- Wave calls this directly, unauthenticated, same as
// calendly-webhook and stage-change-webhook.

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

// Idempotent -- a second call after the first succeeds is a no-op (the
// .neq("payment_status","paid") guard means the UPDATE matches zero rows).
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

function extractInvoiceId(body: any): string | null {
  return (
    body?.data?.invoiceId || body?.data?.entityId || body?.data?.id ||
    body?.invoiceId || body?.entity?.id || body?.id || null
  );
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!WAVE_API_TOKEN || !WAVE_BUSINESS_ID) {
    return json({ skipped: true, reason: "WAVE_API_TOKEN / WAVE_BUSINESS_ID not set" });
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }

  const invoiceId = extractInvoiceId(body);
  if (!invoiceId) return json({ ok: true, ignored: true, reason: "no invoice id found in payload" });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: opp } = await supabase
    .from("opportunities").select("id").eq("wave_invoice_id", invoiceId).maybeSingle();
  if (!opp) return json({ ok: true, ignored: true, reason: "no opportunity with this wave_invoice_id" });

  try {
    const result = await reconcileWaveInvoice(supabase, opp.id, invoiceId);
    return json({ ok: true, opportunity_id: opp.id, ...result });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
