// Ship2Shore CRM — Calendly webhook receiver
// Handles invitee.created (new bookings) and invitee.canceled (cancellations).
//
// NOTE: signature verification is temporarily disabled — Calendly's
// webhook creation response did not return a signing key. Re-enable
// once a signing key is obtained by restoring the verifySignature() check below.

import { createClient } from 'npm:@supabase/supabase-js@2';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const PIPELINE_ID = '22222222-2222-2222-2222-222222222222';
const NEW_BOOKING_STAGE_ID = '19770400-dade-4ea2-8339-5587c249a059';
const CANCELED_STAGE_ID = 'cce9f1a5-6757-4056-adc0-e650f362983a';
const DEFAULT_SERVICE_CODE = 'twic_escort';
const DEFAULT_RATE = 85.0;

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(supabaseUrl, serviceKey);

function derivePort(locationText: string | null | undefined): string | null {
  if (!locationText) return null;
  const t = locationText.toLowerCase();
  if (t.includes('wilmington')) return 'wilmington';
  if (t.includes('long beach')) return 'long_beach';
  if (t.includes('matson')) return 'matson';
  return null;
}

// Pull the invitee's phone number from wherever Calendly actually put it.
// Previously we only checked questions_and_answers for a question literally
// containing "phone", so numbers entered as the SMS-reminder number (the most
// common case) were missed and ended up unused (or only in the event
// description). Check, in priority order:
//   1. text_reminder_number — the number the invitee gives for SMS reminders
//   2. a Q&A whose question mentions phone / mobile / cell / number / contact
//   3. any Q&A answer that looks like a phone number
//   4. a "phone call" location whose value is the number to dial
function extractPhone(p: any): string | null {
  const clean = (v: unknown): string | null => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s || null;
  };

  // 1. SMS reminder number (set when the invitee opts into text reminders)
  const reminder = clean(p?.text_reminder_number);
  if (reminder) return reminder;

  const qa: Array<{ question?: string; answer?: string }> = Array.isArray(p?.questions_and_answers)
    ? p.questions_and_answers
    : [];

  // 2. A labelled phone question
  const labelled = qa.find((x) => /phone|mobile|cell|number|contact/i.test(x?.question || ''));
  const labelledAnswer = clean(labelled?.answer);
  if (labelledAnswer) return labelledAnswer;

  // 3. Any answer that looks like a phone number
  const phoneRe = /(\+?\d[\d\s().-]{6,}\d)/;
  for (const x of qa) {
    const m = (x?.answer || '').match(phoneRe);
    if (m) return m[1].trim();
  }

  // 4. Phone-call location — the invitee supplies the number to be called
  const loc = p?.scheduled_event?.location;
  if (loc && /phone/i.test(loc?.type || '')) {
    const num = clean(loc?.location);
    if (num) return num;
  }

  return null;
}

async function handleInviteeCreated(body: any) {
  const p = body.payload;
  const email: string | null = p?.email || null;
  const fullName: string = p?.name || 'Unknown';
  const phone = extractPhone(p);
  const eventUri: string | null = p?.event || p?.scheduled_event?.uri || null;
  const startAt: string | null = p?.scheduled_event?.start_time || null;
  const endAt: string | null = p?.scheduled_event?.end_time || null;
  const locationText: string | null =
    p?.scheduled_event?.location?.location || p?.scheduled_event?.location?.additional_info || null;
  const port = derivePort(locationText);

  if (!email || !eventUri) {
    return new Response(JSON.stringify({ error: 'missing email or event uri' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data: existingAppt } = await supabase
    .from('appointments')
    .select('id')
    .eq('org_id', ORG_ID)
    .eq('source', 'calendly')
    .eq('external_id', eventUri)
    .maybeSingle();

  if (existingAppt) {
    return new Response(JSON.stringify({ ok: true, duplicate: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data: existingContact } = await supabase
    .from('contacts')
    .select('id, phone')
    .eq('org_id', ORG_ID)
    .eq('email', email)
    .maybeSingle();

  let contactId: string;
  if (existingContact) {
    contactId = existingContact.id;
    // Backfill the phone if this booking supplied one and we didn't have it.
    if (phone && !existingContact.phone) {
      await supabase.from('contacts').update({ phone }).eq('id', contactId);
    }
  } else {
    const { data: newContact, error: contactErr } = await supabase
      .from('contacts')
      .insert({
        org_id: ORG_ID,
        full_name: fullName,
        email,
        phone,
        segment: 'private',
        source: 'calendly',
      })
      .select('id')
      .single();
    if (contactErr || !newContact) {
      return new Response(JSON.stringify({ error: 'contact insert failed', detail: contactErr }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    contactId = newContact.id;
  }

  const { data: opp, error: oppErr } = await supabase
    .from('opportunities')
    .insert({
      org_id: ORG_ID,
      contact_id: contactId,
      pipeline_id: PIPELINE_ID,
      stage_id: NEW_BOOKING_STAGE_ID,
      title: p?.scheduled_event?.name || 'TWIC Vehicle Escort',
      service_code: DEFAULT_SERVICE_CODE,
      port,
      value: DEFAULT_RATE,
      status: 'open',
      scheduled_at: startAt,
    })
    .select('id')
    .single();

  if (oppErr || !opp) {
    return new Response(JSON.stringify({ error: 'opportunity insert failed', detail: oppErr }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { error: apptErr } = await supabase.from('appointments').insert({
    org_id: ORG_ID,
    contact_id: contactId,
    opportunity_id: opp.id,
    source: 'calendly',
    external_id: eventUri,
    title: p?.scheduled_event?.name || 'TWIC Vehicle Escort',
    port,
    service_code: DEFAULT_SERVICE_CODE,
    start_at: startAt,
    end_at: endAt,
    status: 'scheduled',
  });

  if (apptErr) {
    return new Response(JSON.stringify({ error: 'appointment insert failed', detail: apptErr }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, contact_id: contactId, opportunity_id: opp.id, phone_captured: !!phone }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleInviteeCanceled(body: any) {
  const p = body.payload;
  // For cancellations, Calendly nests the event under payload.event (an object with .uri) in newer payloads,
  // but keep compatibility with the same shape used for invitee.created.
  const eventUri: string | null =
    (typeof p?.event === 'string' ? p.event : p?.event?.uri) || p?.scheduled_event?.uri || null;

  if (!eventUri) {
    return new Response(JSON.stringify({ error: 'missing event uri on cancellation' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data: appt, error: findErr } = await supabase
    .from('appointments')
    .select('id, opportunity_id, status')
    .eq('org_id', ORG_ID)
    .eq('source', 'calendly')
    .eq('external_id', eventUri)
    .maybeSingle();

  if (findErr) {
    return new Response(JSON.stringify({ error: 'lookup failed', detail: findErr }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!appt) {
    // Nothing on our side to cancel (e.g. booking predates the webhook). Not an error.
    return new Response(JSON.stringify({ ok: true, not_found: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (appt.status === 'canceled') {
    return new Response(JSON.stringify({ ok: true, already_canceled: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { error: apptUpdateErr } = await supabase
    .from('appointments')
    .update({ status: 'canceled' })
    .eq('id', appt.id);

  if (apptUpdateErr) {
    return new Response(JSON.stringify({ error: 'appointment update failed', detail: apptUpdateErr }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (appt.opportunity_id) {
    const { error: oppUpdateErr } = await supabase
      .from('opportunities')
      .update({ stage_id: CANCELED_STAGE_ID, status: 'canceled' })
      .eq('id', appt.opportunity_id);

    if (oppUpdateErr) {
      return new Response(JSON.stringify({ error: 'opportunity update failed', detail: oppUpdateErr }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  return new Response(JSON.stringify({ ok: true, appointment_id: appt.id, opportunity_id: appt.opportunity_id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const rawBody = await req.text();

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: 'bad json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (body.event === 'invitee.created') {
    return await handleInviteeCreated(body);
  }

  if (body.event === 'invitee.canceled') {
    return await handleInviteeCanceled(body);
  }

  return new Response(JSON.stringify({ ok: true, ignored: body.event }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
