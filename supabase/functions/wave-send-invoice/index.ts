import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// "Send invoice" action from an opportunity card. Creates (or reuses) a Wave
// customer for the contact, creates a Wave invoice for the opportunity's
// value, emails it via Wave, and stores the returned invoice id.
//
// NOTE ON SCHEMA CERTAINTY: Wave's own docs (developer.waveapps.com) could
// not be reached from this build environment (blocked upstream), so the
// GraphQL shapes below are the best-known-accurate Wave API, kept
// deliberately minimal (few selected fields) to reduce the chance of a
// field-name mismatch. If Wave's live schema differs on any field, the
// GraphQL error returned here will name the exact field -- check these logs
// after the first real "Send invoice" click and tell me; it's a one-line fix.
//
// This file intentionally duplicates the Wave client helpers also present in
// wave-webhook and wave-payment-sync, matching this project's existing
// convention of one self-contained index.ts per Edge Function (see
// stage-change-webhook, gmail-sync, calendly-webhook). Keep the three in
// sync if you change the Wave client logic.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WAVE_API_TOKEN = Deno.env.get("WAVE_API_TOKEN") || "";
const WAVE_BUSINESS_ID = Deno.env.get("WAVE_BUSINESS_ID") || "";
const WAVE_GRAPHQL_URL = "https://gql.waveapps.com/graphql/public";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

class WaveError extends Error {}

async function waveFetch(query: string, variables: Record<string, unknown>) {
  const res = await fetch(WAVE_GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${WAVE_API_TOKEN}` },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors?.length) {
    throw new WaveError("Wave GraphQL error: " + body.errors.map((e: any) => e.message).join("; "));
  }
  return body.data;
}

const money2 = (n: number | string) => (Number(n) || 0).toFixed(2);

async function findOrCreateWaveCustomer(
  supabase: any,
  contact: { id: string; full_name: string | null; email: string; wave_customer_id: string | null },
) {
  if (contact.wave_customer_id) return contact.wave_customer_id;

  const data = await waveFetch(
    `mutation CustomerCreate($input: CustomerCreateInput!) {
      customerCreate(input: $input) {
        didSucceed
        inputErrors { path message code }
        customer { id }
      }
    }`,
    { input: { businessId: WAVE_BUSINESS_ID, name: contact.full_name || contact.email, email: contact.email } },
  );
  const payload = data.customerCreate;
  if (!payload.didSucceed || !payload.customer) {
    throw new WaveError(
      "Could not create Wave customer: " + (payload.inputErrors || []).map((e: any) => e.message).join("; "),
    );
  }
  const customerId = payload.customer.id;
  await supabase.from("contacts").update({ wave_customer_id: customerId }).eq("id", contact.id);
  return customerId;
}

async function createAndSendWaveInvoice(opts: { customerId: string; description: string; amount: number | string; toEmail: string }) {
  const created = await waveFetch(
    `mutation InvoiceCreate($input: InvoiceCreateInput!) {
      invoiceCreate(input: $input) {
        didSucceed
        inputErrors { path message code }
        invoice { id status }
      }
    }`,
    {
      input: {
        businessId: WAVE_BUSINESS_ID,
        customerId: opts.customerId,
        items: [{ description: opts.description, quantity: 1, unitPrice: money2(opts.amount) }],
      },
    },
  );
  const createPayload = created.invoiceCreate;
  if (!createPayload.didSucceed || !createPayload.invoice) {
    throw new WaveError(
      "Could not create Wave invoice: " + (createPayload.inputErrors || []).map((e: any) => e.message).join("; "),
    );
  }
  const invoiceId = createPayload.invoice.id;

  const sent = await waveFetch(
    `mutation InvoiceSend($input: InvoiceSendInput!) {
      invoiceSend(input: $input) {
        didSucceed
        inputErrors { path message code }
      }
    }`,
    { input: { invoiceId, to: [opts.toEmail] } },
  );
  const sendPayload = sent.invoiceSend;
  if (!sendPayload.didSucceed) {
    // The invoice exists in Wave even though the email failed -- say so
    // explicitly rather than implying nothing happened.
    throw new WaveError(
      `Invoice was created in Wave (id ${invoiceId}) but sending the email failed: ` +
        (sendPayload.inputErrors || []).map((e: any) => e.message).join("; "),
    );
  }
  return invoiceId;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!WAVE_API_TOKEN || !WAVE_BUSINESS_ID) {
    return json(
      { error: "Wave isn't connected yet. Set WAVE_API_TOKEN and WAVE_BUSINESS_ID as Supabase Edge Function secrets, then try again." },
      500,
    );
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const opportunityId = body?.opportunity_id;
  if (!opportunityId) return json({ error: "Missing opportunity_id" }, 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: opp, error: oppErr } = await supabase
    .from("opportunities")
    .select("id, org_id, title, service_code, value, contact_id, contacts(id, full_name, email, wave_customer_id)")
    .eq("id", opportunityId)
    .maybeSingle();
  if (oppErr || !opp) return json({ error: "Opportunity not found." }, 404);

  const contact = (opp as any).contacts;
  if (!contact?.email) return json({ error: "This contact has no email on file — add one before sending an invoice." }, 400);

  try {
    const customerId = await findOrCreateWaveCustomer(supabase, contact);
    const description = opp.title || (opp.service_code ? String(opp.service_code).replace(/_/g, " ") : "Ship2Shore service");
    const invoiceId = await createAndSendWaveInvoice({ customerId, description, amount: opp.value, toEmail: contact.email });

    await supabase.from("opportunities")
      .update({ wave_invoice_id: invoiceId, payment_status: "sent" })
      .eq("id", opportunityId);

    await supabase.from("activities").insert({
      org_id: opp.org_id, contact_id: contact.id, opportunity_id: opportunityId,
      type: "invoice", body: `Wave invoice sent to ${contact.email}.`,
    });

    return json({ ok: true, wave_invoice_id: invoiceId, payment_status: "sent" });
  } catch (e) {
    const message = e instanceof WaveError ? e.message : String((e as Error)?.message || e);
    return json({ error: message }, 502);
  }
});
