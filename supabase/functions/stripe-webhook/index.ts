import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");

// Manual Stripe webhook signature verification (no Stripe SDK dependency,
// matching this project's plain-fetch pattern for external APIs elsewhere).
// Header shape: "t=<timestamp>,v1=<hex hmac>[,v0=...]". The signed payload is
// "<timestamp>.<raw body>" -- must use the untouched raw body text, not a
// re-serialized JSON.parse of it, or the signature never matches.
async function verifyStripeSignature(rawBody: string, sigHeader: string | null, secret: string): Promise<boolean> {
  if (!sigHeader) return false;
  const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.split("=")));
  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) return false;

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signed = `${timestamp}.${rawBody}`;
  const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signed));
  const expected = Array.from(new Uint8Array(sigBytes)).map((b) => b.toString(16).padStart(2, "0")).join("");

  if (expected.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

// Marks the matching invoice paid. Looks up by the invoice_id we set as
// Payment Link metadata (copied onto the resulting Checkout Session) first --
// falls back to matching the Payment Link id itself in case metadata is ever
// missing from an older link.
async function markInvoicePaid(supabase: any, session: any) {
  const invoiceId = session.metadata?.invoice_id;
  const paymentLinkId = session.payment_link;
  const paymentMethod = session.payment_method_types?.[0]
    ? session.payment_method_types[0].replace(/_/g, " ")
    : "Card";

  let query = supabase.from("invoices").update({
    status: "paid",
    amount_due: 0,
    paid_at: new Date().toISOString(),
    payment_method: paymentMethod,
    stripe_checkout_session_id: session.id,
    updated_at: new Date().toISOString(),
  });

  query = invoiceId ? query.eq("id", invoiceId) : query.eq("stripe_payment_link_id", paymentLinkId);
  const { error } = await query;
  if (error) throw error;
}

Deno.serve(async (req: Request) => {
  // Safe no-op until Stripe is actually connected for this deployment --
  // deployed and ready to go, but never errors out just because the secret
  // isn't set yet.
  if (!STRIPE_WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "Stripe webhook not configured yet." }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const rawBody = await req.text();
  const sigHeader = req.headers.get("stripe-signature");
  const valid = await verifyStripeSignature(rawBody, sigHeader, STRIPE_WEBHOOK_SECRET);
  if (!valid) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "Bad JSON" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  if (event.type === "checkout.session.completed") {
    try {
      await markInvoicePaid(supabase, event.data.object);
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
