import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// "Send invoice" action from an opportunity card. Creates (or reuses) a Wave
// customer for the contact, creates a Wave invoice for the opportunity's
// value (minus any deposit already collected, plus a separate line for the
// port escort fee when one's on the job), emails it via Wave, and stores
// the returned invoice id.
//
// 2026-09-02: every InvoiceCreateItemInput needs a real productId (confirmed
// via live schema introspection -- see wave-payment-sync/wave-webhook for
// the shared Wave client conventions). This reuses one cached generic
// product (organizations.wave_default_product_id, created lazily against
// that org's own income account) for both the transport and escort line
// items -- Wave only needs a product for chart-of-accounts categorization,
// and a small operation doesn't need two.
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

// This is called from the browser (Pipeline card "Send invoice" button) with
// an Authorization header, so it gets a CORS preflight (OPTIONS) first --
// without these headers on every response the browser blocks the request
// before it reaches this function, surfacing as a generic
// "Failed to send a request to the Edge Function" client error.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
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

// Picks this business's own "Sales" income account (falls back to the first
// INCOME account if there's no literal "Sales") to post the default product
// to -- required by ProductCreateInput, and has to be a real account id from
// THIS business's chart of accounts, not a fixed/shared value.
async function findIncomeAccountId() {
  const data = await waveFetch(
    `query Accounts($businessId: ID!) {
      business(id: $businessId) { accounts(types: [INCOME], page: 1, pageSize: 25) { edges { node { id name } } } }
    }`,
    { businessId: WAVE_BUSINESS_ID },
  );
  const accounts = (data.business?.accounts?.edges || []).map((e: any) => e.node);
  const sales = accounts.find((a: any) => a.name === "Sales") || accounts[0];
  if (!sales) throw new WaveError("This Wave business has no income account to post to -- add one in Wave's Chart of Accounts first.");
  return sales.id;
}

// One generic product covers every line item -- Wave requires each item to
// reference a real Product, but this CRM prices each job (and its escort
// fee) individually via the item's own unitPrice, so the product itself
// doesn't need to represent a specific price or service variant.
async function findOrCreateWaveProduct(supabase: any, org: { id: string; wave_default_product_id: string | null }) {
  if (org.wave_default_product_id) return org.wave_default_product_id;

  const incomeAccountId = await findIncomeAccountId();
  const data = await waveFetch(
    `mutation ProductCreate($input: ProductCreateInput!) {
      productCreate(input: $input) {
        didSucceed
        inputErrors { path message code }
        product { id }
      }
    }`,
    { input: { businessId: WAVE_BUSINESS_ID, name: "Vehicle Transport Service", unitPrice: "0.00", incomeAccountId } },
  );
  const payload = data.productCreate;
  if (!payload.didSucceed || !payload.product) {
    throw new WaveError(
      "Could not create Wave product: " + (payload.inputErrors || []).map((e: any) => e.message).join("; "),
    );
  }
  const productId = payload.product.id;
  await supabase.from("organizations").update({ wave_default_product_id: productId }).eq("id", org.id);
  return productId;
}

async function createAndSendWaveInvoice(opts: { customerId: string; productId: string; items: { description: string; amount: number }[]; toEmail: string }) {
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
        status: "SAVED",
        items: opts.items.map((it) => ({ productId: opts.productId, description: it.description, quantity: 1, unitPrice: money2(it.amount) })),
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
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
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
    .select(
      "id, org_id, title, service_code, value, escort_fee, deposit_amount, deposit_paid, paid_on_site, " +
        "vehicle, vehicle_year, vehicle_make, vehicle_model, contact_id, contacts!contact_id(id, full_name, email, wave_customer_id)",
    )
    .eq("id", opportunityId)
    .maybeSingle();
  if (oppErr || !opp) return json({ error: "Opportunity not found." }, 404);

  const contact = (opp as any).contacts;
  if (!contact?.email) return json({ error: "This contact has no email on file — add one before sending an invoice." }, 400);
  if (opp.paid_on_site) return json({ error: "This job is marked Paid on-site / COD — no invoice needed." }, 400);

  const { data: org, error: orgErr } = await supabase
    .from("organizations").select("id, wave_default_product_id").eq("id", opp.org_id).maybeSingle();
  if (orgErr || !org) return json({ error: "Organization not found." }, 404);

  // Bill only what's actually still owed -- if a deposit's already been
  // marked collected, it comes off the transport total so Wave never
  // double-bills a customer who paid a deposit through another channel.
  const vehicleDesc = [opp.vehicle_year, opp.vehicle_make, opp.vehicle_model].filter(Boolean).join(" ") || opp.vehicle || null;
  const baseDescription = vehicleDesc || opp.title || (opp.service_code ? String(opp.service_code).replace(/_/g, " ") : "Service");
  const depositCollected = opp.deposit_paid ? Number(opp.deposit_amount || 0) : 0;
  const transportDue = Math.max(Number(opp.value || 0) - depositCollected, 0);
  const escortFee = Number(opp.escort_fee || 0);

  const items: { description: string; amount: number }[] = [];
  if (transportDue > 0) {
    items.push({
      description: depositCollected > 0 ? `${baseDescription} — balance after $${depositCollected.toFixed(2)} deposit` : baseDescription,
      amount: transportDue,
    });
  }
  if (escortFee > 0) {
    items.push({ description: "Port escort fee (T.W.I.C.)", amount: escortFee });
  }
  if (items.length === 0) {
    return json({ error: "Nothing left to invoice — the deposit already on file covers the full amount." }, 400);
  }

  try {
    const customerId = await findOrCreateWaveCustomer(supabase, contact);
    const productId = await findOrCreateWaveProduct(supabase, org);
    const invoiceId = await createAndSendWaveInvoice({ customerId, productId, items, toEmail: contact.email });

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
