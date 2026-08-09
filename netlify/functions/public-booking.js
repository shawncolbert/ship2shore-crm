import { admin } from './_shared/supabaseAdmin.js'
import { getDefaultPipeline, getIntakeStage } from './_shared/pipeline.js'
import { googleAccessToken, buildRaw, gmailSend } from './_shared/google.js'

// Public, unauthenticated native booking widget — an in-app alternative to the
// Calendly link. A customer picks a service + time slot and this writes the
// SAME shape of records the Calendly webhook produces (contacts +
// opportunities + appointments), so the rest of the pipeline (dashboard,
// automations, documents) needs no changes to handle either source.
//
// This is additive: the Calendly webhook and integration are untouched and
// keep working exactly as before, in parallel.

// Ship2Shore's own org — the default when no org_slug is given, so the
// existing /book link (with no slug) keeps working exactly as before for
// every integration that already points at it.
const DEFAULT_ORG_ID = '11111111-1111-1111-1111-111111111111'

// Resolves which org this request is for. White-label orgs are addressed by
// their own slug (/book/:orgSlug); omitting it falls back to Ship2Shore so
// nothing that already links to plain /book breaks.
async function resolveOrgId(orgSlug) {
  if (!orgSlug) return DEFAULT_ORG_ID
  const { data } = await admin.from('organizations').select('id').eq('slug', orgSlug).maybeSingle()
  return data?.id || null
}

// --- Basic availability rules (deliberately simple for v1) ---------------
// Up to CAPACITY jobs can run in the same slot (multiple crews/vehicles).
// Business hours Mon–Fri, 8am–5pm Pacific, fixed 1-hour slots — no Saturday
// or Sunday work. Bookable up to 21 days out; a slot must start at least
// 2 hours from now.
const TIMEZONE = 'America/Los_Angeles'
const BUSINESS_START_HOUR = 8
const BUSINESS_END_HOUR = 17
const SLOT_MINUTES = 60
const MIN_LEAD_HOURS = 2
const MAX_DAYS_OUT = 21
const CAPACITY = 3

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json', ...cors }, body: JSON.stringify(body),
})

// Convert a Pacific wall-clock time (Y/M/D H:M) to a real UTC Date, handling
// PST/PDT automatically. Self-contained (Intl-only) so it doesn't depend on
// the server process's own timezone.
function offsetMinutesAt(utcMs, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const parts = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]))
  const hour = parts.hour === '24' ? 0 : Number(parts.hour)
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second))
  return (asUtc - utcMs) / 60000
}
function zonedWallTimeToUtc(y, m, d, hh, mm, timeZone) {
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0)
  const offset = offsetMinutesAt(guess, timeZone)
  return new Date(guess - offset * 60000)
}
// Y/M/D of a UTC instant, as seen in the given timezone.
function zonedYmd(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]))
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) }
}

function parseDateParam(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''))
  if (!m) return null
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
}

// List candidate hourly slots for one Pacific calendar day, minus already
// booked (non-canceled) appointments and past/too-soon times. `roundTheClock`
// (true for bookings referred through a driver card set up for 24/7
// availability) skips the Mon–Fri/8–5 restriction entirely -- every hour of
// every day within the booking window is a candidate slot.
async function availableSlots(orgId, dateStr, roundTheClock = false) {
  const ymd = parseDateParam(dateStr)
  if (!ymd) return { error: 'Bad date' }

  const now = new Date()
  const today = zonedYmd(now, TIMEZONE)
  const dayIndexToday = Math.round(
    (Date.UTC(ymd.y, ymd.m - 1, ymd.d) - Date.UTC(today.y, today.m - 1, today.d)) / 864e5
  )
  if (dayIndexToday < 0 || dayIndexToday > MAX_DAYS_OUT) return { slots: [] }

  if (!roundTheClock) {
    // No Saturday or Sunday work (0=Sunday, 6=Saturday).
    const dow = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d)).getUTCDay()
    if (dow === 0 || dow === 6) return { slots: [] }
  }

  const dayStartUtc = zonedWallTimeToUtc(ymd.y, ymd.m, ymd.d, 0, 0, TIMEZONE)
  const dayEndUtc = zonedWallTimeToUtc(ymd.y, ymd.m, ymd.d, 23, 59, TIMEZONE)

  const { data: busy, error } = await admin
    .from('appointments')
    .select('start_at, end_at, status')
    .eq('org_id', orgId)
    .neq('status', 'cancelled')
    .lte('start_at', dayEndUtc.toISOString())
    .gte('end_at', dayStartUtc.toISOString())
  if (error) return { error: error.message }

  const earliest = new Date(now.getTime() + MIN_LEAD_HOURS * 3600 * 1000)
  const startHour = roundTheClock ? 0 : BUSINESS_START_HOUR
  const endHour = roundTheClock ? 24 : BUSINESS_END_HOUR
  const slots = []
  for (let hour = startHour; hour < endHour; hour++) {
    const slotStart = zonedWallTimeToUtc(ymd.y, ymd.m, ymd.d, hour, 0, TIMEZONE)
    const slotEnd = new Date(slotStart.getTime() + SLOT_MINUTES * 60 * 1000)
    if (slotStart < earliest) continue
    const overlapping = (busy || []).filter((a) => {
      const aStart = new Date(a.start_at).getTime()
      const aEnd = a.end_at ? new Date(a.end_at).getTime() : aStart + 3600 * 1000
      return aStart < slotEnd.getTime() && aEnd > slotStart.getTime()
    }).length
    if (overlapping < CAPACITY) slots.push(slotStart.toISOString())
  }
  return { slots }
}

// A booking link can carry ?ref=<external_card_links.slug> so a driver's
// own card (Tilly's, Eloy's, ...) can send its leads through this same
// booking flow while still (a) branding the page with that driver's name
// and (b) telling us who to notify once the lead comes in.
async function resolveReferrer(orgId, ref) {
  if (!ref) return null
  const { data } = await admin
    .from('external_card_links')
    .select('slug, name, notify_email, round_the_clock, booking_label, service_codes')
    .eq('org_id', orgId).eq('slug', ref).maybeSingle()
  return data || null
}

async function listServices(orgId, ref) {
  const { data: org } = await admin.from('organizations').select('name').eq('id', orgId).maybeSingle()
  const { data, error } = await admin
    .from('services').select('code, name, default_rate').eq('org_id', orgId).eq('active', true).order('name')
  if (error) return { error: error.message }
  const referrer = await resolveReferrer(orgId, ref)

  // A driver's card only offers the service(s) that driver actually does
  // (e.g. Eloy's card shouldn't offer Tilly's vehicle-transport service).
  // An empty/unset service_codes means "no restriction" -- used by
  // Ship2Shore's own card, which offers everything.
  let services = data || []
  if (referrer?.service_codes?.length) {
    const allowed = new Set(referrer.service_codes)
    services = services.filter((s) => allowed.has(s.code))
  }
  // Referred bookings never see internal pricing -- strip it from the
  // payload itself (not just hidden in the UI) so it never reaches the
  // customer's browser at all.
  if (referrer) services = services.map(({ code, name }) => ({ code, name }))

  // booking_label is customer-facing page branding ("Tilly's Dispatch") --
  // deliberately separate from `name` (the card's own display name, "Tilly's
  // Classics", used for click-tracking and the "Lead source" activity note)
  // so a customer never sees "Ship2Shore Dispatch" on what should read as
  // that driver's own booking page.
  return {
    services,
    orgName: referrer?.booking_label || referrer?.name || org?.name || 'us',
    roundTheClock: !!referrer?.round_the_clock,
  }
}

// Best-effort "you've got a lead" ping to the driver whose card sent this
// booking. Deliberately not logged into the CRM's conversations/messages --
// it's an internal heads-up to the driver, not a message to the customer.
async function notifyReferrer(referrer, { fullName, email, phone, serviceName, startAt, port, notes, photoUrl }) {
  if (!referrer?.notify_email) return
  try {
    const from = process.env.GMAIL_ADDRESS
    const at = await googleAccessToken()
    const when = new Date(startAt).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' })
    const subject = `New lead from your card: ${fullName}`
    const body =
      `You've got a new booking through your Ship2Shore card (${referrer.name}).\n\n` +
      `Name: ${fullName}\n` +
      `Email: ${email}\n` +
      `Phone: ${phone || '—'}\n` +
      `Service: ${serviceName}\n` +
      `Requested time: ${when} Pacific\n` +
      `${port ? `Port: ${port}\n` : ''}` +
      `${notes ? `Vehicle details: ${notes}\n` : ''}` +
      `${photoUrl ? `Vehicle photo: ${photoUrl}\n` : ''}` +
      `\nThis is already logged in Ship2Shore Dispatch.`
    await gmailSend(at, buildRaw({ from, to: referrer.notify_email, subject, body }))
  } catch {
    // Lead is already saved in the CRM regardless -- a notification-email
    // hiccup shouldn't fail or roll back the booking itself.
  }
}

// A Netlify function's request body caps around 6MB, and the client already
// compresses+resizes before sending -- this is a backstop against a request
// that skipped the client-side compression somehow, not the primary guard.
const MAX_PHOTO_BYTES = 4 * 1024 * 1024

// Best-effort vehicle-photo upload attached to the booking's contact/job --
// mirrors the storage + attachments-row pattern public-upload.js already
// uses for customer document uploads. Never blocks or fails the booking
// itself; a bad/oversized photo just means no photo gets attached. Returns
// the storage path (so a signed link can be emailed to a driver who has no
// CRM login) on success, or null.
async function savePhoto(orgId, contactId, opportunityId, photo) {
  if (!photo?.dataBase64) return null
  try {
    const buf = Buffer.from(photo.dataBase64, 'base64')
    if (buf.length === 0 || buf.length > MAX_PHOTO_BYTES) return null
    const safe = String(photo.filename || 'vehicle-photo.jpg').replace(/[^\w.\-]+/g, '_').slice(0, 120)
    const path = `${orgId}/${contactId}/${Date.now()}-${safe}`
    const up = await admin.storage.from('delivery-orders')
      .upload(path, buf, { contentType: photo.contentType || 'application/octet-stream', upsert: false })
    if (up.error) return null
    const { error } = await admin.from('attachments').insert({
      org_id: orgId, contact_id: contactId, opportunity_id: opportunityId,
      file_name: photo.filename || 'vehicle-photo.jpg', file_path: path,
      mime_type: photo.contentType || null, size_bytes: buf.length, kind: 'vehicle_photo',
    })
    return error ? null : path
  } catch {
    return null
  }
}

// A signed link a driver with no CRM login can open directly from the
// notification email. 30 days is generous lead time for a job to actually
// get picked up and photographed/compared against.
async function signedPhotoUrl(path) {
  if (!path) return null
  try {
    const { data } = await admin.storage.from('delivery-orders').createSignedUrl(path, 60 * 60 * 24 * 30)
    return data?.signedUrl || null
  } catch {
    return null
  }
}

async function bookSlot(orgId, payload) {
  const { service_code, port, start_at, full_name, email, phone, notes, ref, photo } = payload
  if (!service_code || !start_at || !full_name || !email) {
    return { status: 400, body: { error: 'Missing required fields.' } }
  }

  const { data: service } = await admin
    .from('services').select('code, name, default_rate').eq('org_id', orgId).eq('code', service_code).eq('active', true).maybeSingle()
  if (!service) return { status: 400, body: { error: 'Unknown service.' } }

  const referrer = await resolveReferrer(orgId, ref)
  if (referrer?.service_codes?.length && !referrer.service_codes.includes(service_code)) {
    return { status: 400, body: { error: 'That service is not offered through this booking link.' } }
  }

  const startAt = new Date(start_at)
  if (Number.isNaN(startAt.getTime())) return { status: 400, body: { error: 'Bad start time.' } }
  const earliest = new Date(Date.now() + MIN_LEAD_HOURS * 3600 * 1000)
  if (startAt < earliest) return { status: 409, body: { error: 'That time is no longer available. Please pick another.' } }
  const endAt = new Date(startAt.getTime() + SLOT_MINUTES * 60 * 1000)

  // Re-check the slot still has room (race-safe enough for this volume).
  const { data: conflicts } = await admin
    .from('appointments')
    .select('id')
    .eq('org_id', orgId)
    .neq('status', 'cancelled')
    .lt('start_at', endAt.toISOString())
    .gt('end_at', startAt.toISOString())
  if (conflicts && conflicts.length >= CAPACITY) {
    return { status: 409, body: { error: 'That time just filled up. Please pick another slot.' } }
  }

  const cleanEmail = String(email).trim().toLowerCase()
  const cleanPhone = phone ? String(phone).trim() : null

  const { data: existingContact } = await admin
    .from('contacts').select('id, phone').eq('org_id', orgId).eq('email', cleanEmail).maybeSingle()

  let contactId
  if (existingContact) {
    contactId = existingContact.id
    if (cleanPhone && !existingContact.phone) {
      await admin.from('contacts').update({ phone: cleanPhone }).eq('id', contactId)
    }
  } else {
    const { data: newContact, error: contactErr } = await admin
      .from('contacts')
      .insert({
        org_id: orgId, full_name: String(full_name).trim(), email: cleanEmail, phone: cleanPhone,
        segment: 'private', source: 'in_app',
      })
      .select('id').single()
    if (contactErr || !newContact) return { status: 500, body: { error: 'Could not create contact.', detail: contactErr?.message } }
    contactId = newContact.id
  }

  const pipeline = await getDefaultPipeline(orgId)
  if (!pipeline) return { status: 500, body: { error: 'This business has no pipeline configured yet.' } }
  const stage = await getIntakeStage(orgId)
  if (!stage) return { status: 500, body: { error: 'This pipeline has no stages configured yet.' } }

  const title = service.name
  const { data: opp, error: oppErr } = await admin
    .from('opportunities')
    .insert({
      org_id: orgId, contact_id: contactId, pipeline_id: pipeline.id, stage_id: stage.id,
      title, service_code: service.code, port: port || null, value: service.default_rate,
      status: 'open', scheduled_at: startAt.toISOString(),
    })
    .select('id').single()
  if (oppErr || !opp) return { status: 500, body: { error: 'Could not create booking.', detail: oppErr?.message } }

  const { error: apptErr } = await admin.from('appointments').insert({
    org_id: orgId, contact_id: contactId, opportunity_id: opp.id,
    source: 'in_app', external_id: null, title, port: port || null, service_code: service.code,
    start_at: startAt.toISOString(), end_at: endAt.toISOString(), status: 'scheduled',
  })
  if (apptErr) return { status: 500, body: { error: 'Could not create appointment.', detail: apptErr.message } }

  if (notes) {
    await admin.from('activities').insert({
      org_id: orgId, contact_id: contactId, type: 'note', body: `Booking note: ${String(notes).slice(0, 1000)}`,
    })
  }

  const photoPath = await savePhoto(orgId, contactId, opp.id, photo)

  if (referrer) {
    await admin.from('activities').insert({
      org_id: orgId, contact_id: contactId, type: 'note', body: `Lead source: ${referrer.name}'s card`,
    })
    const photoUrl = await signedPhotoUrl(photoPath)
    await notifyReferrer(referrer, {
      fullName: String(full_name).trim(), email: cleanEmail, phone: cleanPhone,
      serviceName: service.name, startAt: startAt.toISOString(), port, notes, photoUrl,
    })
  }

  return { status: 200, body: { ok: true, contact_id: contactId, opportunity_id: opp.id, start_at: startAt.toISOString(), photoSaved: !!photoPath } }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors }
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { action, org_slug, ref } = payload

  const orgId = await resolveOrgId(org_slug)
  if (!orgId) return json(404, { error: 'Unknown booking page.' })

  try {
    if (action === 'services') {
      const r = await listServices(orgId, ref)
      return r.error ? json(500, { error: r.error }) : json(200, r)
    }
    if (action === 'availability') {
      const referrer = await resolveReferrer(orgId, ref)
      const r = await availableSlots(orgId, payload.date, !!referrer?.round_the_clock)
      return r.error ? json(500, { error: r.error }) : json(200, r)
    }
    if (action === 'book') {
      const r = await bookSlot(orgId, payload)
      return json(r.status, r.body)
    }
    return json(400, { error: 'Unknown action' })
  } catch (e) {
    return json(500, { error: String(e.message || e) })
  }
}
