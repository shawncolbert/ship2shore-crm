import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isConfigured = Boolean(url && anonKey && !url.includes('YOUR-PROJECT'))

export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anonKey || 'placeholder-key'
)

/* ------------------------------------------------------------------ */
/* Data helpers — thin wrappers over the schema tables.                */
/* ------------------------------------------------------------------ */

export async function fetchContacts({ segment = null, search = '' } = {}) {
  let q = supabase
    .from('contacts')
    .select('id, full_name, company, phone, email, segment, tags')
    .order('full_name', { ascending: true })

  if (segment) q = q.eq('segment', segment)
  if (search) {
    const term = `%${search}%`
    q = q.or(`full_name.ilike.${term},company.ilike.${term},phone.ilike.${term},email.ilike.${term}`)
  }
  const { data, error } = await q
  if (error) throw error
  return data
}

// The org the signed-in user is currently working in. Inserts must carry
// this org_id so they satisfy the row-level-security policy (with check
// org_id in my orgs). Same active_org_id preference as orgForUser() on the
// server (_shared/supabaseAdmin.js) -- keep the two in sync if this logic
// changes.
export async function fetchMyOrgId() {
  const { data: memberships, error } = await supabase
    .from('memberships')
    .select('org_id')
  if (error) throw error
  if (!memberships?.length) throw new Error('No organization found for this user.')
  if (memberships.length === 1) return memberships[0].org_id

  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('profiles').select('active_org_id').eq('id', user.id).maybeSingle()
  const active = profile?.active_org_id
  if (active && memberships.some((m) => m.org_id === active)) return active

  return memberships[0].org_id
}

// All orgs the signed-in user belongs to, with names -- for the org
// switcher. Only meaningful when there's more than one.
export async function fetchMyMemberships() {
  const { data, error } = await supabase
    .from('memberships')
    .select('org_id, role, organizations(id, name)')
  if (error) throw error
  return (data || []).map((m) => ({ id: m.organizations.id, name: m.organizations.name, role: m.role }))
}

// Switches which org fetchMyOrgId()/orgForUser() resolve to for this user.
// Not itself a security boundary -- RLS on every org-scoped table still
// checks real membership rows independently, so this can't grant access to
// an org the user isn't actually a member of.
export async function switchActiveOrg(orgId) {
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase
    .from('profiles')
    .update({ active_org_id: orgId })
    .eq('id', user.id)
  if (error) throw error
}

// The signed-in user's own profile, incl. whether they're a platform admin
// (gates the cross-org admin tools in the UI). Relies on RLS (id = auth.uid()).
export async function fetchMyProfile() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, platform_admin')
    .eq('id', (await supabase.auth.getUser()).data.user?.id)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function fetchServices() {
  const { data, error } = await supabase
    .from('services')
    .select('code, name, default_rate')
    .eq('active', true)
    .order('name', { ascending: true })
  if (error) throw error
  return data || []
}

/* ------------------------------------------------------------------ */
/* Service catalog (Settings > Services) — each org defines its own,   */
/* so the booking sidebar and public booking widget show only the      */
/* services that business actually sells.                              */
/* ------------------------------------------------------------------ */

export async function fetchAllServices() {
  const { data, error } = await supabase
    .from('services')
    .select('id, code, name, default_rate, active')
    .order('name', { ascending: true })
  if (error) throw error
  return data || []
}

export async function createService({ code, name, default_rate }) {
  const orgId = await fetchMyOrgId()
  const { data, error } = await supabase
    .from('services')
    .insert({ org_id: orgId, code: code.trim(), name: name.trim(), default_rate: Number(default_rate) || 0 })
    .select('*').single()
  if (error) {
    if (error.code === '23505') throw new Error('A service with that code already exists.')
    throw error
  }
  return data
}

export async function updateService(id, patch) {
  const allowed = {}
  if ('code' in patch) allowed.code = patch.code.trim()
  if ('name' in patch) allowed.name = patch.name.trim()
  if ('default_rate' in patch) allowed.default_rate = Number(patch.default_rate) || 0
  if ('active' in patch) allowed.active = !!patch.active
  const { data, error } = await supabase
    .from('services').update(allowed).eq('id', id).select('*').single()
  if (error) {
    if (error.code === '23505') throw new Error('A service with that code already exists.')
    throw error
  }
  if (!data) throw new Error('Could not save this service — permission denied.')
  return data
}

export async function deleteService(id) {
  const { error } = await supabase.from('services').delete().eq('id', id)
  if (error) throw error
}

/* ------------------------------------------------------------------ */
/* Pricing zones / surcharges — the staff-only rate catalog behind the  */
/* pipeline card's price estimator (Pipeline.jsx). Never fetched by any */
/* public page; the landing page/funnel forms only ever collect a plain */
/* pickup/dropoff address, and staff pick the matching zone by hand.    */
/* ------------------------------------------------------------------ */

export async function fetchPricingZones() {
  const { data, error } = await supabase
    .from('pricing_zones')
    .select('id, name, rate_min, rate_max, note')
    .eq('active', true)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data || []
}

export async function fetchPricingSurcharges() {
  const { data, error } = await supabase
    .from('pricing_surcharges')
    .select('id, name, amount_min, amount_max')
    .eq('active', true)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data || []
}

/* ------------------------------------------------------------------ */
/* Org branding — used by Layout and the public booking widget so each */
/* white-label org shows its own name/logo instead of "Ship2Shore".    */
/* ------------------------------------------------------------------ */

export async function fetchMyOrg() {
  const orgId = await fetchMyOrgId()
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name, slug, logo_url, tagline, primary_color, enabled_features, theme_mode, theme_preset, calendly_url, idle_timeout_enabled, idle_timeout_minutes, auto_assign_leads, telegram_bot_username, telegram_bot_token, telegram_group_chat_id, google_review_link')
    .eq('id', orgId)
    .single()
  if (error) throw error
  return data
}

// Editable outbound-from-California pricing adjustment (Settings >
// Pricing) -- see PriceEstimator.jsx for where it's applied. `orgId` is
// passed explicitly (not resolved via fetchMyOrgId) since PriceEstimator
// is also used by a platform admin pricing a job on behalf of another org.
export async function fetchOrgPricingAdjustment(orgId) {
  const { data, error } = await supabase
    .from('organizations').select('pricing_outbound_ca_adjustment').eq('id', orgId).maybeSingle()
  if (error) throw error
  return data?.pricing_outbound_ca_adjustment ?? 0
}

export async function saveOrgPricingAdjustment(amount) {
  const orgId = await fetchMyOrgId()
  const { error } = await supabase
    .from('organizations').update({ pricing_outbound_ca_adjustment: Number(amount) || 0 }).eq('id', orgId)
  if (error) throw error
}

export async function saveOrgCalendlyUrl(url) {
  const orgId = await fetchMyOrgId()
  const { error } = await supabase.from('organizations').update({ calendly_url: url?.trim() || null }).eq('id', orgId)
  if (error) throw error
}

// One tracking link per job -- reuses the existing token if a driver was
// already sent one (re-texting the route shouldn't invalidate a link
// they've already opened), otherwise creates the row. The driver-facing
// page itself never talks to Supabase directly; it's public, so it goes
// through the tracking-* Netlify functions instead (see DriverTracking.jsx).
export async function fetchOrCreateTrackingLink(opportunityId) {
  const { data: existing, error: selectError } = await supabase
    .from('job_tracking').select('token').eq('opportunity_id', opportunityId).maybeSingle()
  if (selectError) throw selectError
  if (existing?.token) return `${window.location.origin}/track/${existing.token}`

  const orgId = await fetchMyOrgId()
  const { data, error } = await supabase
    .from('job_tracking').insert({ opportunity_id: opportunityId, org_id: orgId }).select('token').single()
  if (error) throw error
  return `${window.location.origin}/track/${data.token}`
}

// Settings > Appearance -- any org member can change their own org's
// dashboard theme (the "p_org_members" RLS policy already covers this
// update). Separate from primary_color/logo_url branding, which stay
// untouched here.
export async function updateMyOrgTheme({ theme_mode, theme_preset }) {
  const orgId = await fetchMyOrgId()
  const { data, error } = await supabase
    .from('organizations')
    .update({ theme_mode, theme_preset })
    .eq('id', orgId)
    .select('id, theme_mode, theme_preset')
    .single()
  if (error) throw error
  return data
}

// Optional "kiosk mode" -- after this many idle minutes with no mouse/
// keyboard/touch activity, IdleTimeout.jsx sends the browser back to the
// branded front door. Off by default; see the Appearance page.
export async function saveIdleTimeout({ enabled, minutes }) {
  const orgId = await fetchMyOrgId()
  const { error } = await supabase
    .from('organizations')
    .update({ idle_timeout_enabled: !!enabled, idle_timeout_minutes: Math.max(1, Number(minutes) || 60) })
    .eq('id', orgId)
  if (error) throw error
}

// The link send-review-requests.js drops into the automated "how did we
// do" email once a job hits Delivered -- blank until Google Business
// Profile is live, at which point this is that listing's review link.
export async function saveGoogleReviewLink(url) {
  const orgId = await fetchMyOrgId()
  const { error } = await supabase
    .from('organizations')
    .update({ google_review_link: url ? String(url).trim() : null })
    .eq('id', orgId)
  if (error) throw error
}

// Create a contact and, optionally, a "New Booking" opportunity for it.
// `booking` is null to skip the pipeline card, or an object with
// { title, service_code, port, value } to also drop a card in the first stage.
export async function createContactWithBooking({ contact, booking = null }) {
  const orgId = await fetchMyOrgId()

  const payload = {
    org_id: orgId,
    full_name: contact.full_name?.trim() || null,
    company: contact.company?.trim() || null,
    phone: contact.phone?.trim() || null,
    // Lowercased to match every other write path -- uq_contacts_org_email_lower
    // makes mixed-case duplicates impossible, so normalise before insert.
    email: contact.email?.trim().toLowerCase() || null,
    segment: contact.segment || null,
    source: 'manual',
  }

  // A repeat customer -- or a dispatcher re-testing Quick Quote with the
  // same phone/email -- would otherwise hit uq_contacts_org_phone /
  // uq_contacts_org_email_lower and blow up with a raw Postgres "duplicate
  // key value violates unique constraint" error. Look up a match first and
  // reuse/update it instead of blind-inserting.
  let existing = null
  if (payload.phone) {
    const { data, error } = await supabase
      .from('contacts').select('id, full_name, company, phone, email, segment')
      .eq('org_id', orgId).eq('phone', payload.phone).maybeSingle()
    if (error) throw error
    existing = data
  }
  if (!existing && payload.email) {
    const { data, error } = await supabase
      .from('contacts').select('id, full_name, company, phone, email, segment')
      .eq('org_id', orgId).ilike('email', payload.email).maybeSingle()
    if (error) throw error
    existing = data
  }

  let newContact
  if (existing) {
    const { data, error: uErr } = await supabase
      .from('contacts')
      .update({
        full_name: payload.full_name || existing.full_name,
        company: payload.company || existing.company,
        phone: payload.phone || existing.phone,
        email: payload.email || existing.email,
        segment: payload.segment || existing.segment,
      })
      .eq('id', existing.id)
      .select('id, full_name, company, phone, email, segment')
      .single()
    if (uErr) throw uErr
    newContact = data
  } else {
    const { data, error: cErr } = await supabase
      .from('contacts')
      .insert(payload)
      .select('id, full_name, company, phone, email, segment')
      .single()
    if (cErr) throw cErr
    newContact = data
  }

  let opportunity = null
  if (booking) {
    // Drop the card into the default pipeline's intake stage. Not "first by
    // position" -- some orgs have earlier-position stages (e.g. Ship2Shore's
    // "Not Customs Cleared" at -2) that aren't the intake stage. The
    // is_intake flag (set via the pipeline stages admin screen) is what
    // actually marks it, regardless of what that stage is named for this org.
    const { data: pipeline, error: pErr } = await supabase
      .from('pipelines')
      .select('id')
      .eq('org_id', orgId)
      .eq('is_default', true)
      .limit(1)
      .single()
    if (pErr) throw pErr

    const { data: stages, error: sErr } = await supabase
      .from('stages')
      .select('id, name, is_intake')
      .eq('pipeline_id', pipeline.id)
    if (sErr) throw sErr
    const stage = stages.find((s) => s.is_intake) || stages.find((s) => s.name.toLowerCase() === 'new booking') || stages[0]
    if (!stage) throw new Error('This pipeline has no stages configured.')

    const { data: newOpp, error: oErr } = await supabase
      .from('opportunities')
      .insert({
        org_id: orgId,
        contact_id: newContact.id,
        pipeline_id: pipeline.id,
        stage_id: stage.id,
        title: booking.title?.trim() || null,
        service_code: booking.service_code || null,
        port: booking.port || null,
        value: Number(booking.value) || 0,
        pickup_address: booking.pickup_address?.trim() || null,
        dropoff_address: booking.dropoff_address?.trim() || null,
        vehicle: booking.vehicle?.trim() || null,
        source_board: booking.source_board || null,
        status: 'open',
      })
      .select('id')
      .single()
    if (oErr) throw oErr
    opportunity = newOpp
  }

  return { contact: newContact, opportunity }
}

export async function fetchContact(id) {
  const [contact, jobs, appts, activities] = await Promise.all([
    supabase.from('contacts').select('*').eq('id', id).single(),
    supabase.from('opportunities')
      .select('id, title, service_code, port, value, status, scheduled_at, stage_id, stages(name)')
      .eq('contact_id', id).order('created_at', { ascending: false }),
    supabase.from('appointments')
      .select('id, title, port, service_code, start_at, status, pickup_address, dropoff_address, distance_miles')
      .eq('contact_id', id).order('start_at', { ascending: false }),
    supabase.from('activities')
      .select('id, type, body, created_at')
      .eq('contact_id', id).order('created_at', { ascending: false }),
  ])
  if (contact.error) throw contact.error
  return {
    contact: contact.data,
    jobs: jobs.data || [],
    appointments: appts.data || [],
    activities: activities.data || [],
  }
}

// Cascades: their conversations/messages, Timeline (activities), and
// uploaded documents/photos go with them. Jobs, appointments, and invoices
// are kept but orphaned (contact_id set to null) rather than deleted --
// billing history and the pipeline board shouldn't vanish just because a
// contact record was cleaned up.
export async function deleteContact(id) {
  const { error } = await supabase.from('contacts').delete().eq('id', id)
  if (error) throw error
}

export async function fetchDefaultPipeline() {
  // Scoped by org_id explicitly, not just RLS -- RLS alone allows every org
  // a user belongs to, so a platform admin who's a member of more than one
  // org (each with its own is_default pipeline) got a "multiple rows
  // returned" 406 here the moment they picked up a second membership.
  const orgId = await fetchMyOrgId()
  const { data: pipeline, error: pErr } = await supabase
    .from('pipelines').select('id, name').eq('org_id', orgId).eq('is_default', true).limit(1).single()
  if (pErr) throw pErr

  const { data: stages, error: sErr } = await supabase
    .from('stages')
    .select('id, name, position, is_won, is_lost')
    .eq('pipeline_id', pipeline.id)
    .order('position', { ascending: true })
  if (sErr) throw sErr

  const { data: opps, error: oErr } = await supabase
    .from('opportunities')
    .select('id, org_id, title, service_code, port, vehicle, value, deposit_amount, escort_fee, scheduled_at, stage_id, contact_id, status, billing_number, booking_number, cleared, paid, deposit_paid, paid_on_site, pickup_address, dropoff_address, vehicle_make, vehicle_model, vehicle_year, vehicle_vin, vehicle_type, vehicle_modification, vehicle_extended, vehicle_body_class, vehicle_gvwr, suggested_price, confirmed_price, source_board, board_order_number, assigned_dispatcher_id, assigned_driver_card_id, project_type, gallery_link, custom_fields, wave_invoice_id, payment_status, contacts!opportunities_contact_id_fkey(full_name, company, email, phone), assigned_dispatcher:contacts!opportunities_assigned_dispatcher_id_fkey(id, full_name, company), invoices(id, status, invoice_number, total, amount_due, created_at, kind)')
    .eq('pipeline_id', pipeline.id)
    .order('created_at', { ascending: false, foreignTable: 'invoices' })
  if (oErr) throw oErr

  return { pipeline, stages, opportunities: (opps || []).filter((o) => o.status !== 'cancelled') }
}

// Most recent note left on this specific job -- used by the "Share Booking"
// text-message summary and the job editor's read-only details block. Not
// every job has one, so this is a separate lightweight query rather than
// widening the board's own bulk fetch above with a per-row join.
export async function fetchLatestJobNote(opportunityId) {
  const { data, error } = await supabase
    .from('activities')
    .select('body')
    .eq('opportunity_id', opportunityId)
    .eq('type', 'note')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data?.body || null
}

// Vehicle-transport bookings can carry a customer-uploaded photo of the
// vehicle (captured at booking time, same as the pickup/drop-off addresses).
// Used by the "Share Booking" text so a driver gets the same photo link the
// lead-notification email already sends -- long-lived (30 days, matching
// that email's own signed URL) since a driver has no CRM login to re-fetch
// it and may not open the text right away.
export async function fetchVehiclePhotoUrl(opportunityId) {
  const { data: photo, error } = await supabase
    .from('attachments')
    .select('file_path')
    .eq('opportunity_id', opportunityId)
    .eq('kind', 'vehicle_photo')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!photo) return null

  const { data, error: signErr } = await supabase.storage
    .from('delivery-orders').createSignedUrl(photo.file_path, 60 * 60 * 24 * 30)
  if (signErr) throw signErr
  return data.signedUrl
}

// Count of jobs sitting in the "New Booking" stage -- bookings that came in
// (from the public booking widget, a funnel, or the sidebar) and haven't
// been triaged into Scheduled/In Progress yet. Drives the sidebar nav badge.
export async function fetchNewBookingCount() {
  const orgId = await fetchMyOrgId()
  const { data: pipeline, error: pErr } = await supabase
    .from('pipelines').select('id').eq('org_id', orgId).eq('is_default', true).limit(1).maybeSingle()
  if (pErr) throw pErr
  if (!pipeline) return 0

  const { data: stages, error: sErr } = await supabase
    .from('stages').select('id, name, is_intake').eq('pipeline_id', pipeline.id)
  if (sErr) throw sErr
  const stage = stages?.find((s) => s.is_intake) || stages?.find((s) => s.name.toLowerCase() === 'new booking')
  if (!stage) return 0

  const { count, error } = await supabase
    .from('opportunities')
    .select('id', { count: 'exact', head: true })
    .eq('stage_id', stage.id)
    .neq('status', 'cancelled')
  if (error) throw error
  return count || 0
}

export async function moveOpportunity(id, stageId) {
  const { error } = await supabase
    .from('opportunities').update({ stage_id: stageId }).eq('id', id)
  if (error) throw error
}

export async function cancelOpportunity(id) {
  const { error } = await supabase
    .from('opportunities').update({ status: 'cancelled' }).eq('id', id)
  if (error) throw error
  // Also cancel the linked appointment(s) -- otherwise they stay 'scheduled'
  // forever and keep occupying a booking-widget slot for a job that's dead.
  const { error: apptErr } = await supabase
    .from('appointments').update({ status: 'cancelled' }).eq('opportunity_id', id).eq('status', 'scheduled')
  if (apptErr) throw apptErr
}

// Permanently removes an appointment record from a contact's history --
// e.g. clearing out old/stale entries. Does not touch the linked job
// (opportunity), only the calendar/appointment row itself.
export async function deleteAppointment(id) {
  const { error } = await supabase.from('appointments').delete().eq('id', id)
  if (error) throw error
}

// Hard delete, distinct from cancelOpportunity's soft status change -- for
// removing a job entirely (a duplicate, a test booking) rather than just
// taking it off the active board. Any linked invoice/appointment/attachment
// is kept, just unlinked (opportunity_id set to null).
export async function deleteOpportunity(id) {
  const { error } = await supabase.from('opportunities').delete().eq('id', id)
  if (error) throw error
}

// Per-2026-09-01 audit -- a lightweight "who changed what" trail for the
// actions that cause disputes: price/deposit/escort fee edits, stage moves,
// driver/dispatcher (re)assignment, job deletion. Best-effort and
// fire-and-forget on purpose: a logging failure should never block the
// actual save it's trying to record, so callers don't await/throw on this.
// user_id/org_id are stamped server-side (auth.uid(), RLS), not passed in,
// so this can't be spoofed to attribute a change to someone else.
export async function logAudit({ orgId, entityType, entityId, action, field, oldValue, newValue }) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('audit_logs').insert({
      org_id: orgId, entity_type: entityType, entity_id: entityId, action, field,
      old_value: oldValue == null ? null : String(oldValue),
      new_value: newValue == null ? null : String(newValue),
      user_email: user?.email || null,
    })
  } catch (e) {
    console.error('logAudit failed (non-fatal):', e)
  }
}

// Recent activity for one job's detail view -- newest first, capped since
// this is a quick "what happened here" glance, not a full export.
export async function fetchAuditLogsForEntity(entityType, entityId, limit = 15) {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('id, action, field, old_value, new_value, user_email, source, created_at')
    .eq('entity_type', entityType).eq('entity_id', entityId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

// Ship billing number that rides along with a job. Capped at 16 chars;
// blank clears it. Stays on the opportunity through every stage.
export async function setOpportunityBilling(id, billingNumber) {
  const value = billingNumber?.trim() ? billingNumber.trim().slice(0, 16) : null
  const { error } = await supabase
    .from('opportunities').update({ billing_number: value }).eq('id', id)
  if (error) throw error
  return value
}

// Toggle per-job flags (cleared, paid, deposit_paid). Pass only the fields
// you're changing.
// Drop-off access notes -- matched by rounded coordinates (~11m) rather
// than exact address text, so "123 Main St" and "123 Main Street, Anytown"
// still find the same reports.
const NOTE_TOLERANCE = 0.001
export async function fetchDropoffNotes(orgId, lat, lng) {
  const { data, error } = await supabase
    .from('dropoff_notes')
    .select('id, note, kind, created_by_name, created_at')
    .eq('org_id', orgId)
    .gte('lat', lat - NOTE_TOLERANCE).lte('lat', lat + NOTE_TOLERANCE)
    .gte('lng', lng - NOTE_TOLERANCE).lte('lng', lng + NOTE_TOLERANCE)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function addDropoffNote({ orgId, opportunityId, address, lat, lng, note, kind, createdByName }) {
  const { data, error } = await supabase
    .from('dropoff_notes')
    .insert({
      org_id: orgId, opportunity_id: opportunityId || null, address, lat, lng,
      note: note.trim(), kind: kind || 'warn', created_by_name: createdByName || null,
    })
    .select('id, note, kind, created_by_name, created_at')
    .single()
  if (error) throw error
  return data
}

// Reference log of a confirmed price quote -- see PriceEstimator's confirm().
export async function logQuote(fields) {
  const { error } = await supabase.from('quote_history').insert(fields)
  if (error) throw error
}

// Invoice Tracking (Agent 4): jobs paid in person, with no invoice ever
// generated -- still needs to count as revenue collected, just outside the
// normal invoice table entirely.
export async function fetchPaidOnSiteJobs() {
  const { data, error } = await supabase
    .from('opportunities')
    .select('id, title, value, contacts!contact_id(full_name)')
    .eq('paid_on_site', true)
  if (error) throw error
  return data || []
}

export async function patchOpportunity(id, patch) {
  const allowed = {}
  if ('cleared' in patch) allowed.cleared = !!patch.cleared
  if ('paid' in patch) allowed.paid = !!patch.paid
  if ('deposit_paid' in patch) allowed.deposit_paid = !!patch.deposit_paid
  if ('paid_on_site' in patch) allowed.paid_on_site = !!patch.paid_on_site
  if ('assigned_driver_card_id' in patch) allowed.assigned_driver_card_id = patch.assigned_driver_card_id || null
  const { error } = await supabase.from('opportunities').update(allowed).eq('id', id)
  if (error) throw error
}

// Agent 2 (in-house dispatch assignment): drivers are whichever digital
// business cards Shawn has marked "offers vehicle transport" -- opting in
// per card instead of a hardcoded name list, so it stays correct as drivers
// come and go. openJobCount lets the picker surface whoever's least loaded
// right now as a plain, honest signal -- not a fabricated "best match"
// score, since there's no route/proximity data behind this yet.
export async function fetchTransportDrivers() {
  const [{ data: cards, error: cErr }, { data: jobs, error: jErr }] = await Promise.all([
    supabase.from('business_cards').select('id, full_name, phone, sms_number').eq('offers_vehicle_transport', true),
    supabase.from('opportunities').select('assigned_driver_card_id, status').not('assigned_driver_card_id', 'is', null).neq('status', 'cancelled'),
  ])
  if (cErr) throw cErr
  if (jErr) throw jErr
  const loadByCard = {}
  for (const j of jobs || []) loadByCard[j.assigned_driver_card_id] = (loadByCard[j.assigned_driver_card_id] || 0) + 1
  return (cards || [])
    .map((c) => ({ ...c, openJobCount: loadByCard[c.id] || 0 }))
    .sort((a, b) => a.openJobCount - b.openJobCount)
}

// Edit the core contact fields from the contact detail view. Only the fields
// passed are written; empty strings are stored as null (except full_name, which
// the caller validates as required). Returns the updated row.
export async function updateContact(id, patch) {
  const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const allowed = {}
  if ('full_name' in patch) allowed.full_name = patch.full_name?.trim() || null
  if ('company' in patch) allowed.company = clean(patch.company)
  if ('phone' in patch) allowed.phone = clean(patch.phone)
  if ('email' in patch) allowed.email = clean(patch.email)
  if ('notes' in patch) allowed.notes = clean(patch.notes)
  const { data, error } = await supabase
    .from('contacts').update(allowed).eq('id', id).select('*').single()
  if (error) throw error
  return data
}

// Edit editable opportunity fields (title, port, scheduled_at, billing_number)
// from the pipeline card. Only the passed fields are written. scheduled_at
// expects an ISO string or null; billing_number is capped at 16 chars.
export async function updateOpportunity(id, patch) {
  const allowed = {}
  if ('title' in patch) allowed.title = patch.title?.trim() || null
  if ('port' in patch) allowed.port = patch.port?.trim() || null
  if ('vehicle' in patch) allowed.vehicle = patch.vehicle?.trim() || null
  if ('pickup_address' in patch) allowed.pickup_address = patch.pickup_address?.trim() || null
  if ('dropoff_address' in patch) allowed.dropoff_address = patch.dropoff_address?.trim() || null
  if ('scheduled_at' in patch) allowed.scheduled_at = patch.scheduled_at || null
  if ('billing_number' in patch)
    allowed.billing_number = patch.billing_number?.trim() ? patch.billing_number.trim().slice(0, 16) : null
  if ('value' in patch) {
    const n = Number(patch.value)
    allowed.value = Number.isFinite(n) && n >= 0 ? n : null
  }
  if ('deposit_amount' in patch) {
    const n = Number(patch.deposit_amount)
    allowed.deposit_amount = Number.isFinite(n) && n >= 0 ? n : 0
  }
  if ('escort_fee' in patch) {
    const n = Number(patch.escort_fee)
    allowed.escort_fee = Number.isFinite(n) && n >= 0 ? n : null
  }
  if ('source_board' in patch) allowed.source_board = patch.source_board || null
  if ('board_order_number' in patch)
    allowed.board_order_number = patch.board_order_number?.trim() || null
  if ('vehicle_vin' in patch) allowed.vehicle_vin = patch.vehicle_vin?.trim().toUpperCase() || null
  if ('vehicle_year' in patch) allowed.vehicle_year = patch.vehicle_year?.trim() || null
  if ('vehicle_make' in patch) allowed.vehicle_make = patch.vehicle_make?.trim() || null
  if ('vehicle_model' in patch) allowed.vehicle_model = patch.vehicle_model?.trim() || null
  if ('vehicle_type' in patch) allowed.vehicle_type = patch.vehicle_type || null
  if ('vehicle_modification' in patch) allowed.vehicle_modification = patch.vehicle_modification || 'stock'
  if ('vehicle_extended' in patch) allowed.vehicle_extended = !!patch.vehicle_extended
  if ('confirmed_price' in patch) {
    const n = Number(patch.confirmed_price)
    allowed.confirmed_price = Number.isFinite(n) && n >= 0 ? n : null
  }
  if ('project_type' in patch) allowed.project_type = patch.project_type || null
  if ('gallery_link' in patch) allowed.gallery_link = patch.gallery_link?.trim() || null
  if ('custom_fields' in patch) allowed.custom_fields = patch.custom_fields || {}
  const { data, error } = await supabase
    .from('opportunities').update(allowed).eq('id', id).select('*').single()
  if (error) throw error
  return data
}

// Vehicle classification for the auto-pricing feature (Supabase Edge
// Function "vin-decode"). Two shapes in, matching the function's two modes:
// { vin } decodes via NHTSA and caches the result; { year, make, model }
// only checks vehicle_type_cache (no external call) for the manual-entry
// fallback. Never throws on a bad/undecodable VIN -- the function itself
// always returns 200 with manual_required: true in that case.
export async function classifyVehicle(params) {
  const { data, error } = await supabase.functions.invoke('vin-decode', { body: params })
  if (error) {
    let message = error.message
    try { message = (await error.context.json())?.error || message } catch { /* keep default */ }
    throw new Error(message)
  }
  return data
}

// Live "what would this cost" preview as the dispatcher edits vehicle type/
// condition, before anything is saved. Mirrors the calculate_suggested_price
// trigger exactly (same SQL function) so the number shown here always
// matches what gets persisted on save.
export async function previewSuggestedPrice({ orgId, serviceCode, value, vehicleType, vehicleModification, vehicleExtended }) {
  const { data, error } = await supabase.rpc('preview_suggested_price', {
    p_org_id: orgId,
    p_service_code: serviceCode || null,
    p_value: value === '' || value == null ? 0 : Number(value),
    p_vehicle_type: vehicleType || null,
    p_vehicle_modification: vehicleModification || 'stock',
    p_vehicle_extended: !!vehicleExtended,
  })
  if (error) throw error
  return data
}

// A customer email claiming they already paid -- informational only, never
// auto-marks an invoice paid (only a bank Zelle notification does that, see
// zelle_payments). Surfaced as a bottom-of-screen popup while a dispatcher
// is in the app (see PaymentClaimToast in Layout.jsx) and an internal alert
// email for when they're not.
export async function fetchPendingPaymentClaims() {
  const { data, error } = await supabase
    .from('payment_claims')
    .select('id, sender_name, message_snippet, invoice_id, opportunity_id, created_at, contacts:contact_id(full_name), invoices:invoice_id(invoice_number)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

// Dismisses the popup once a dispatcher has seen it and checked the bank --
// never touches the invoice itself.
export async function acknowledgePaymentClaim(id) {
  const { error } = await supabase
    .from('payment_claims')
    .update({ status: 'acknowledged', resolved_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// Leads that have sat assigned for 20+ minutes with no reply from the
// assigned dispatcher's own inbox and no movement on the card (see the
// unfollowed_lead_alerts view and markAssigned in dispatchAssignment.js).
// There's deliberately no "dismiss" for this one, unlike payment claims --
// it clears itself once the dispatcher actually replies or the card moves,
// not on a click, per Shawn 2026-08-29 ("keep coming up until they responded").
export async function fetchUnfollowedLeadAlerts() {
  const { data, error } = await supabase
    .from('unfollowed_lead_alerts')
    .select('opportunity_id, title, assigned_at, dispatcher_id, dispatcher_name, dispatcher_company, customer_name, vehicle, vehicle_year, vehicle_make, vehicle_model')
    .order('assigned_at', { ascending: true })
  if (error) throw error
  return data || []
}

// Contacts tagged as dispatchers (e.g. Warrior Auto Transport, Team Auto
// Transport/Dispatch) -- the pool a Pipeline job can be handed off to. RLS
// already scopes contacts to the caller's org, same as every other contacts
// query in this file.
export async function fetchDispatcherContacts() {
  const { data, error } = await supabase
    .from('contacts')
    .select('id, full_name, company, email')
    .eq('segment', 'dispatcher')
    .order('full_name', { ascending: true })
  if (error) throw error
  return data || []
}

// Hands a job off to a dispatcher contact (or clears the assignment when
// dispatcherContactId is null) and emails that dispatcher the lead details --
// routed through a Netlify function since sending the notification needs the
// org's Gmail token, which never reaches the client.
export async function assignDispatcher(opportunityId, dispatcherContactId) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch('/.netlify/functions/assign-dispatcher', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: JSON.stringify({ opportunityId, dispatcherContactId: dispatcherContactId || null }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to assign dispatcher')
  return data
}

// "Ask driver for quote" (Pipeline.jsx) -- generates a one-time public link
// for a job's route that any driver can open, see the pickup/drop-off and
// mileage, and quote a price on. Routed through a Netlify function since
// the mileage estimate needs the server-side Mapbox token.
export async function requestCarrierQuote(opportunityId) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch('/.netlify/functions/create-carrier-quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: JSON.stringify({ opportunityId }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to create quote request')
  return data
}

// A driver's quote history -- every carrier_quote_requests row that came
// back matched to this contact (see carrier-quote.js's phone match on
// submit). Only ever the ones that actually got a price back; a link
// that's still sitting unanswered isn't part of anyone's rate history yet.
// "Has a driver already quoted a route like this one before?" -- Pipeline's
// job-edit panel calls this once mileage is known, so a driver who ran a
// similar lane before (same rough mileage -- pickup/dropoff addresses
// rarely match exactly even on a repeat lane, so mileage is the only
// reliable numeric signal) surfaces automatically instead of Shawn having
// to remember who quoted what. Tolerance: whichever is bigger, 20% of the
// distance or 20 miles flat -- tight enough that a 400-mile and a 40-mile
// run never get treated as "similar."
export async function fetchSimilarRouteQuotes(miles, { excludeOpportunityId } = {}) {
  if (!miles || miles <= 0) return []
  const tolerance = Math.max(miles * 0.2, 20)
  let query = supabase
    .from('carrier_quote_requests')
    .select('id, opportunity_id, contact_id, pickup_address, dropoff_address, miles, quoted_amount, quoted_at, driver_name, contacts(full_name)')
    .eq('status', 'quoted')
    .gte('miles', miles - tolerance)
    .lte('miles', miles + tolerance)
    .order('quoted_at', { ascending: false })
    .limit(5)
  if (excludeOpportunityId) query = query.neq('opportunity_id', excludeOpportunityId)
  const { data, error } = await query
  if (error) throw error
  return (data || []).map((q) => ({ ...q, driverLabel: q.contacts?.full_name || q.driver_name || 'Unknown driver' }))
}

export async function fetchCarrierQuotesForContact(contactId) {
  const { data, error } = await supabase
    .from('carrier_quote_requests')
    .select('id, pickup_address, dropoff_address, miles, system_estimate, quoted_amount, quoted_at')
    .eq('contact_id', contactId)
    .eq('status', 'quoted')
    .order('quoted_at', { ascending: false })
  if (error) throw error
  return data || []
}

// Audio Brief: turns a dispatcher's spoken job description (already
// transcribed to text client-side) into structured job fields via Claude.
// Never saves anything -- the caller fills the form with whatever comes
// back and still has to hit Save.
export async function parseJobBrief(transcript) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch('/.netlify/functions/parse-job-brief', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: JSON.stringify({ transcript }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Could not process that brief.')
  return data
}

// AI Studio: one chat turn. Sends the conversation plus whatever's been
// drafted so far and gets back a reply plus (once there's enough to work
// with) an updated draft -- the caller previews it and still has to hit
// Save, same "AI suggests, human confirms" rule as everything else.
export async function chatAiStudio({ kind, orgId, messages, currentContent }) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch('/.netlify/functions/ai-studio-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: JSON.stringify({ kind, orgId, messages, currentContent: currentContent || null }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'AI Studio could not respond just now.')
  return data
}

// "Send contract" action on a pipeline card. Renders and emails the
// customer a booking agreement to review and sign (contract-send.js); the
// deposit invoice is created and sent automatically once they sign, not
// here -- see ContractSign.jsx.
export async function sendContract(opportunityId) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch('/.netlify/functions/contract-send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: JSON.stringify({ opportunityId }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Could not send that contract.')
  return data
}

// Latest contract sent for a job, if any -- shown as a status badge on the
// pipeline card the same way invoice status is.
export async function fetchLatestContract(opportunityId) {
  const { data, error } = await supabase
    .from('contracts')
    .select('id, status, signer_name, signed_at, deposit_invoice_id, sent_at')
    .eq('opportunity_id', opportunityId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

// "Send invoice" action on a pipeline card. Calls the wave-send-invoice Edge
// Function (creates/reuses a Wave customer, creates + emails the invoice, and
// stores wave_invoice_id + payment_status='sent' on the opportunity server-side).
export async function sendWaveInvoice(opportunityId) {
  const { data, error } = await supabase.functions.invoke('wave-send-invoice', {
    body: { opportunity_id: opportunityId },
  })
  if (error) {
    // FunctionsHttpError carries the JSON error body on error.context; surface
    // Wave's actual message (e.g. "no email on file") instead of a generic one.
    let message = error.message
    try { message = (await error.context.json())?.error || message } catch { /* keep default */ }
    throw new Error(message)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

/* ------------------------------------------------------------------ */
/* Payment settings (Zelle / Venmo / Cash App / Apple Pay handles) --   */
/* still used by the "send payment request" stage-change automation   */
/* and by the Invoices payment-options picker, just not from a         */
/* standalone pipeline-card button anymore.                            */
/* ------------------------------------------------------------------ */

export async function fetchPaymentSettings() {
  const orgId = await fetchMyOrgId()
  const { data, error } = await supabase
    .from('payment_settings').select('*').eq('org_id', orgId).maybeSingle()
  if (error) throw error
  return data || {
    org_id: orgId, zelle_handle: '', venmo_handle: '', cashapp_handle: '', apple_pay_handle: '', default_method: null, wave_dashboard_url: '',
  }
}

export async function savePaymentSettings(patch) {
  const orgId = await fetchMyOrgId()
  const { data, error } = await supabase
    .from('payment_settings')
    .upsert({ org_id: orgId, ...patch }, { onConflict: 'org_id' })
    .select('*').single()
  if (error) throw error
  return data
}

/* ------------------------------------------------------------------ */
/* Wave Checkout links -- reusable saved payment links (Wave has no    */
/* API for these, so they're generated by hand in Wave and saved here */
/* once), picked from a dropdown when building an invoice.             */
/* ------------------------------------------------------------------ */

export async function fetchWaveCheckoutLinks() {
  const orgId = await fetchMyOrgId()
  const { data, error } = await supabase
    .from('wave_checkout_links')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function createWaveCheckoutLink({ label, amount, url }) {
  const orgId = await fetchMyOrgId()
  const { data, error } = await supabase
    .from('wave_checkout_links')
    .insert({
      org_id: orgId,
      label: label.trim(),
      amount: amount === '' || amount == null ? null : Number(amount),
      url: url.trim(),
    })
    .select('*').single()
  if (error) throw error
  return data
}

export async function deleteWaveCheckoutLink(id) {
  const { error } = await supabase.from('wave_checkout_links').delete().eq('id', id)
  if (error) throw error
}

// Live reporting metrics for the dashboard. Queried on page load; small enough
// data that we aggregate client-side rather than with a backend function.
export async function fetchDashboardStats() {
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString()
  const monthAgo = new Date(Date.now() - 30 * 864e5).toISOString()

  const [stagesRes, oppsRes, leadsRes, closesRes] = await Promise.all([
    supabase.from('stages').select('id, name, position, is_won, is_lost').order('position'),
    supabase.from('opportunities').select('id, value, stage_id, status, updated_at'),
    supabase.from('contacts').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
    // Exact "moved into a closed/won stage" events from the stage-change
    // history. 'Completed' stays in this list even after the rename to
    // Delivered/Invoiced -- it's a snapshot of the stage name *at the time
    // of the change*, so old history rows still say 'Completed'.
    supabase.from('opportunity_stage_changes')
      .select('opportunity_id, to_stage, changed_at')
      .in('to_stage', ['Delivered', 'Invoiced', 'Paid', 'Completed'])
      .gte('changed_at', monthAgo),
  ])
  const stages = stagesRes.data || []
  const opps = oppsRes.data || []
  const newLeadsWeek = leadsRes.count || 0
  const closes = closesRes.data || []

  const stageById = Object.fromEntries(stages.map((s) => [s.id, s]))
  const nameOf = (o) => stageById[o.stage_id]?.name || ''
  const isClosed = (n) => ['Delivered', 'Invoiced', 'Paid', 'Canceled', 'Cancelled', 'Completed'].includes(n)

  // Only the main workflow stages (position >= 0: New Lead … Paid, Canceled).
  // id is kept so the dashboard can drill into "jobs in this stage" precisely.
  const byStage = stages
    .filter((s) => s.position >= 0)
    .map((s) => ({ id: s.id, name: s.name, count: opps.filter((o) => o.stage_id === s.id).length }))

  // Open pipeline value: everything not in a closed/canceled stage (and not a
  // canceled record).
  const openValue = opps
    .filter((o) => o.status !== 'cancelled' && !isClosed(nameOf(o)))
    .reduce((sum, o) => sum + Number(o.value || 0), 0)

  // Jobs that actually moved into Completed/Paid in each window, from the
  // stage-change history. Distinct opportunity_id so a job that went
  // Completed → Paid within the window is still counted once.
  const closedIn = (since) =>
    new Set(closes.filter((c) => c.changed_at >= since).map((c) => c.opportunity_id)).size
  const closedThisWeek = closedIn(weekAgo)
  const closedThisMonth = closedIn(monthAgo)

  return { byStage, openValue, totalJobs: opps.length, closedThisWeek, closedThisMonth, newLeadsWeek }
}

/* ------------------------------------------------------------------ */
/* Dashboard drill-downs — fetched lazily, only when a stat card opens  */
/* a list. Rows share one shape so DrillDownModal can render any of     */
/* them: { id, contactId, contactName, jobTitle, stageName, date, value }. */
/* ------------------------------------------------------------------ */

const CLOSED_STAGE_NAMES = ['Delivered', 'Invoiced', 'Paid', 'Canceled', 'Cancelled', 'Completed']

export async function fetchOpenPipelineJobs() {
  const { data: stages, error: sErr } = await supabase.from('stages').select('id, name')
  if (sErr) throw sErr
  const closedIds = new Set((stages || []).filter((s) => CLOSED_STAGE_NAMES.includes(s.name)).map((s) => s.id))
  const nameById = Object.fromEntries((stages || []).map((s) => [s.id, s.name]))

  const { data, error } = await supabase
    .from('opportunities')
    .select('id, title, value, stage_id, status, scheduled_at, contact_id, contacts!contact_id(full_name)')
    .neq('status', 'cancelled')
    .order('scheduled_at', { ascending: true, nullsFirst: false })
  if (error) throw error

  return (data || [])
    .filter((o) => !closedIds.has(o.stage_id))
    .map((o) => ({
      id: o.id, contactId: o.contact_id, contactName: o.contacts?.full_name || 'Unnamed contact',
      jobTitle: o.title, stageName: nameById[o.stage_id] || '', date: o.scheduled_at, value: o.value,
    }))
}

// Jobs that moved into a closed/won stage within the last `days` days, from
// the exact stage-change history (matches fetchDashboardStats' closedThisWeek/Month).
export async function fetchClosedJobs(days) {
  const since = new Date(Date.now() - days * 864e5).toISOString()
  const { data, error } = await supabase
    .from('opportunity_stage_changes')
    .select('opportunity_id, to_stage, changed_at, opportunities(id, title, value, contact_id, contacts!contact_id(full_name))')
    .in('to_stage', ['Delivered', 'Invoiced', 'Paid', 'Completed'])
    .gte('changed_at', since)
    .order('changed_at', { ascending: false })
  if (error) throw error

  // A job that went Completed -> Paid within the window has two rows; keep
  // only the most recent (rows already come back newest-first).
  const seen = new Set()
  const rows = []
  for (const row of data || []) {
    if (seen.has(row.opportunity_id)) continue
    seen.add(row.opportunity_id)
    const opp = row.opportunities
    rows.push({
      id: row.opportunity_id, contactId: opp?.contact_id, contactName: opp?.contacts?.full_name || 'Unnamed contact',
      jobTitle: opp?.title, stageName: row.to_stage, date: row.changed_at, value: opp?.value,
    })
  }
  return rows
}

export async function fetchNewLeadsList(days) {
  const since = new Date(Date.now() - days * 864e5).toISOString()
  const { data, error } = await supabase
    .from('contacts')
    .select('id, full_name, company, segment, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map((c) => ({
    id: c.id, contactId: c.id, contactName: c.full_name || 'Unnamed contact',
    jobTitle: c.company || null, stageName: c.segment || null, date: c.created_at, value: null,
  }))
}

export async function fetchJobsByStage(stageId, stageName) {
  const { data, error } = await supabase
    .from('opportunities')
    .select('id, title, value, scheduled_at, contact_id, contacts!contact_id(full_name)')
    .eq('stage_id', stageId)
    .neq('status', 'cancelled')
    .order('scheduled_at', { ascending: true, nullsFirst: false })
  if (error) throw error
  return (data || []).map((o) => ({
    id: o.id, contactId: o.contact_id, contactName: o.contacts?.full_name || 'Unnamed contact',
    jobTitle: o.title, stageName, date: o.scheduled_at, value: o.value,
  }))
}

// New-lead volume per dispatcher over the window -- lets Shawn see how many
// leads are actually flowing to Val/Paul/himself even though their Telegram
// alerts now go to separate private chats he can't see into directly (see
// dispatchAssignment.js). "Unassigned" catches anything auto-assign hasn't
// picked up yet. Counts leads by CREATION date, not assignment date -- a
// lead reassigned later still counts under whoever has it now.
export async function fetchLeadsByDispatcher(days) {
  const since = new Date(Date.now() - days * 864e5).toISOString()
  const [{ data: opps, error: oErr }, { data: dispatchers, error: dErr }] = await Promise.all([
    supabase.from('opportunities').select('assigned_dispatcher_id').gte('created_at', since).neq('status', 'cancelled'),
    supabase.from('contacts').select('id, full_name, company').eq('segment', 'dispatcher'),
  ])
  if (oErr) throw oErr
  if (dErr) throw dErr

  const nameById = Object.fromEntries((dispatchers || []).map((d) => [d.id, d.full_name || d.company || 'Unnamed']))
  const counts = new Map()
  for (const o of opps || []) {
    const key = o.assigned_dispatcher_id || null
    counts.set(key, (counts.get(key) || 0) + 1)
  }

  const rows = Array.from(counts.entries()).map(([id, count]) => ({
    id, name: id ? (nameById[id] || 'Former dispatcher') : 'Unassigned', count,
  }))
  rows.sort((a, b) => b.count - a.count)
  return rows
}

export async function fetchLeadsForDispatcher(dispatcherId, days) {
  const since = new Date(Date.now() - days * 864e5).toISOString()
  let query = supabase
    .from('opportunities')
    .select('id, title, value, created_at, contact_id, contacts!opportunities_contact_id_fkey(full_name)')
    .gte('created_at', since)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
  query = dispatcherId ? query.eq('assigned_dispatcher_id', dispatcherId) : query.is('assigned_dispatcher_id', null)
  const { data, error } = await query
  if (error) throw error
  return (data || []).map((o) => ({
    id: o.id, contactId: o.contact_id, contactName: o.contacts?.full_name || 'Unnamed contact',
    jobTitle: o.title, stageName: null, date: o.created_at, value: o.value,
  }))
}

/* ------------------------------------------------------------------ */
/* Inbox helpers                                                       */
/* ------------------------------------------------------------------ */

export async function fetchConversations() {
  const { data, error } = await supabase
    .from('conversations')
    .select('id, channel, last_message_at, unread, contact_id, contacts(full_name, company, email)')
    .order('last_message_at', { ascending: false, nullsFirst: false })
  if (error) throw error
  return data
}

export async function fetchMessages(conversationId) {
  const { data, error } = await supabase
    .from('messages')
    .select('id, direction, channel, body, from_addr, to_addr, ai_generated, status, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

// Removes an AI-drafted reply that was sent (superseded by the real sent
// message) or discarded by the dispatcher without ever going out.
export async function deleteMessage(id) {
  const { error } = await supabase.from('messages').delete().eq('id', id)
  if (error) throw error
}

// Removes a whole thread -- e.g. an ad/spam email that created a
// conversation. messages.conversation_id cascades, so this takes the
// thread's messages with it in one delete.
export async function deleteConversation(id) {
  const { error } = await supabase.from('conversations').delete().eq('id', id)
  if (error) throw error
}

// Live-updates: fire the callback whenever a message row changes.
export function subscribeMessages(onChange) {
  const channel = supabase
    .channel('messages-stream')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, onChange)
    .subscribe()
  return () => supabase.removeChannel(channel)
}

// Send an email reply through the Netlify function (server holds Gmail creds).
export async function sendEmail({ conversationId, contactId, to, subject, body, html }) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch('/.netlify/functions/send-email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token || ''}`,
    },
    body: JSON.stringify({ conversationId, contactId, to, subject, body, html }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Send failed')
  return res.json()
}

/* ------------------------------------------------------------------ */
/* Delivery orders / attachments + customer upload links               */
/* ------------------------------------------------------------------ */

export async function fetchAttachments(contactId) {
  const { data, error } = await supabase
    .from('attachments')
    .select('id, file_name, file_path, mime_type, size_bytes, opportunity_id, created_at, opportunities(title)')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// Batch-signs URLs for a set of private-bucket files at once (one round
// trip instead of one per thumbnail) -- used to render the photo grid on a
// contact's file list. A longer expiry than the plain single-file download
// link (signedAttachmentUrl, 120s) since these sit in <img> tags for as
// long as the page stays open, not just a single click-through.
export async function fetchSignedUrls(filePaths, expiresIn = 3600) {
  if (!filePaths?.length) return {}
  const { data, error } = await supabase.storage.from('delivery-orders').createSignedUrls(filePaths, expiresIn)
  if (error) throw error
  const map = {}
  for (const row of data || []) if (row.signedUrl && row.path) map[row.path] = row.signedUrl
  return map
}

// Files a customer sent us themselves (via the /u/:token upload link --
// uploaded_by is null, unlike a staff upload) that nobody on staff has
// opened yet. Shaped for DrillDownModal.
export async function fetchNewCustomerFiles() {
  const { data, error } = await supabase
    .from('attachments')
    .select('id, file_name, created_at, contact_id, contacts!contact_id(full_name)')
    .is('uploaded_by', null)
    .is('viewed_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map((a) => ({
    id: a.id, contactId: a.contact_id, contactName: a.contacts?.full_name || 'Unnamed contact',
    jobTitle: a.file_name, stageName: null, date: a.created_at, value: null,
  }))
}

export async function markAttachmentViewed(id) {
  const { error } = await supabase
    .from('attachments').update({ viewed_at: new Date().toISOString() }).eq('id', id).is('viewed_at', null)
  if (error) throw error
}

export async function uploadDeliveryOrder({ orgId, contactId, opportunityId = null, file, kind }) {
  const safe = file.name.replace(/[^\w.\-]+/g, '_')
  const path = `${orgId}/${contactId}/${Date.now()}-${safe}`
  const up = await supabase.storage.from('delivery-orders').upload(path, file, { upsert: false })
  if (up.error) throw up.error
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase.from('attachments').insert({
    org_id: orgId, contact_id: contactId, opportunity_id: opportunityId || null,
    file_name: file.name, file_path: path, mime_type: file.type || null,
    size_bytes: file.size || null, uploaded_by: user?.id || null,
    ...(kind ? { kind } : {}),
  })
  if (error) throw error
}

export async function signedAttachmentUrl(filePath) {
  const { data, error } = await supabase.storage.from('delivery-orders').createSignedUrl(filePath, 120)
  if (error) throw error
  return data.signedUrl
}

export async function deleteAttachment({ id, filePath }) {
  await supabase.storage.from('delivery-orders').remove([filePath])
  const { error } = await supabase.from('attachments').delete().eq('id', id)
  if (error) throw error
}

// Renames a stored file's display name only -- file_path (the actual
// storage location) is untouched, so this can't break a download link.
// Not Ship2Shore-specific: any org (a photographer's portfolio, a real
// estate agent's contracts) uses this same attachments list per contact.
export async function renameAttachment(id, fileName) {
  const clean = String(fileName || '').trim()
  if (!clean) throw new Error('File name can’t be empty.')
  const { error } = await supabase.from('attachments').update({ file_name: clean }).eq('id', id)
  if (error) throw error
}

// gateStatus must be 'outside_gate' or 'inside_gate' -- picked explicitly by
// a human uploading, never defaulted. Inserting the row with gate_status
// already set is what fires (or doesn't fire) the auto-post webhook --
// see trg_notify_completion_video / completion-video-webhook.
export async function uploadCompletionVideo({ orgId, contactId, opportunityId, file, gateStatus }) {
  const safe = file.name.replace(/[^\w.\-]+/g, '_')
  const path = `${orgId}/${opportunityId}/${Date.now()}-${safe}`
  const up = await supabase.storage.from('job-videos').upload(path, file, { upsert: false })
  if (up.error) throw up.error
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase.from('attachments').insert({
    org_id: orgId, contact_id: contactId, opportunity_id: opportunityId,
    file_name: file.name, file_path: path, mime_type: file.type || null,
    size_bytes: file.size || null, uploaded_by: user?.id || null,
    kind: 'completion_video', gate_status: gateStatus,
  })
  if (error) throw error
}

export async function fetchCompletionVideo(opportunityId) {
  const { data, error } = await supabase
    .from('attachments')
    .select('id, file_name, gate_status, created_at')
    .eq('opportunity_id', opportunityId)
    .eq('kind', 'completion_video')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

// --- Auto-ingested document review queue (gmail-sync) --------------------

// Delivery Orders / gate passes that gmail-sync pulled from email but couldn't
// match to a job. The dispatcher links or dismisses each one.
export async function fetchReviewDocuments() {
  const { data, error } = await supabase
    .from('attachments')
    .select('id, file_name, file_path, kind, bl_number, size_bytes, created_at, contact_id, contacts!contact_id(full_name)')
    .eq('source', 'gmail_auto')
    .eq('needs_review', true)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// Open jobs the dispatcher can attach a reviewed document to.
export async function fetchLinkableJobs() {
  const { data, error } = await supabase
    .from('opportunities')
    .select('id, title, billing_number, bl_number, contact_id, contacts!contact_id(full_name)')
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// Attach a reviewed document to a job (and its contact), clearing the flag.
// Selects the row back so a 0-row update (e.g. blocked by RLS) surfaces as an
// error instead of silently doing nothing.
export async function linkDocumentToJob({ attachmentId, opportunityId, contactId }) {
  const patch = { opportunity_id: opportunityId, needs_review: false }
  if (contactId) patch.contact_id = contactId
  const { data, error } = await supabase
    .from('attachments').update(patch).eq('id', attachmentId).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('Could not update this document — permission denied.')
}

// Create a shareable upload link (/u/<token>) for a contact/job the customer
// can use to send their delivery order. Returns the full URL.
export async function createUploadLink({ orgId, contactId, opportunityId = null, label = null }) {
  const token = (crypto?.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/-/g, '')
  const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase.from('upload_links').insert({
    token, org_id: orgId, contact_id: contactId, opportunity_id: opportunityId || null,
    created_by: user?.id || null, expires_at: expires, label,
  })
  if (error) throw error
  return `${window.location.origin}/u/${token}`
}

/* ------------------------------------------------------------------ */
/* Automation rules (stage-change automations, configured in-app)      */
/* ------------------------------------------------------------------ */

// Workflow stage names (New Booking … Paid, Canceled) for the rule dropdowns.
export async function fetchStageNames() {
  const { data, error } = await supabase
    .from('stages').select('name, position').gte('position', 0).order('position')
  if (error) throw error
  return (data || []).map((s) => s.name)
}

/* ------------------------------------------------------------------ */
/* Pipeline stages admin (Settings > Pipeline Stages)                  */
/* ------------------------------------------------------------------ */

// A handful of starter sets offered when an org has zero stages -- picking
// one just inserts normal rows into the org's own pipeline; nothing about
// this is special beyond that first insert, so it's exactly as editable
// afterward as anything built by hand.
export const STAGE_TEMPLATES = {
  simple: {
    label: 'Simple 4-stage',
    description: 'New Lead → Scheduled → Completed → Canceled',
    stages: [
      { name: 'New Lead', color: '#e8a317', is_intake: true },
      { name: 'Scheduled', color: '#22d3ee' },
      { name: 'Completed', color: '#1fa97a' },
      { name: 'Canceled', color: '#d9534f' },
    ],
  },
  booking: {
    label: 'Booking flow',
    description: 'New Booking → Scheduled → In Progress → Completed → Paid → Canceled',
    stages: [
      { name: 'New Booking', color: '#e8a317', is_intake: true },
      { name: 'Scheduled', color: '#22d3ee' },
      { name: 'In Progress', color: '#3a5567' },
      { name: 'Completed', color: '#1fa97a' },
      { name: 'Paid', color: '#1fa97a' },
      { name: 'Canceled', color: '#d9534f' },
    ],
  },
}

export async function fetchMyPipeline() {
  const orgId = await fetchMyOrgId()
  const { data: pipeline, error: pErr } = await supabase
    .from('pipelines').select('id, name').eq('org_id', orgId).eq('is_default', true).maybeSingle()
  if (pErr) throw pErr
  if (!pipeline) return { pipeline: null, stages: [] }

  const { data: stages, error: sErr } = await supabase
    .from('stages')
    .select('id, name, position, color, is_intake, is_won, is_lost')
    .eq('pipeline_id', pipeline.id)
    .order('position', { ascending: true })
  if (sErr) throw sErr

  return { pipeline, stages: stages || [] }
}

// Seeds a fresh pipeline (or the org's first one) from a template. Only
// meaningful when the org has none yet -- the admin screen only offers
// this in that empty state.
export async function applyStageTemplate(templateKey) {
  const orgId = await fetchMyOrgId()
  const template = STAGE_TEMPLATES[templateKey]
  if (!template) throw new Error('Unknown template')

  const { data: pipeline, error: pErr } = await supabase
    .from('pipelines')
    .insert({ org_id: orgId, name: 'Main Pipeline', is_default: true })
    .select('id').single()
  if (pErr) throw pErr

  const rows = template.stages.map((s, i) => ({
    org_id: orgId, pipeline_id: pipeline.id, name: s.name, position: i, color: s.color, is_intake: !!s.is_intake,
  }))
  const { error: sErr } = await supabase.from('stages').insert(rows)
  if (sErr) throw sErr

  return pipeline
}

export async function createStage({ pipelineId, name, color }) {
  const orgId = await fetchMyOrgId()
  const { data: existing } = await supabase.from('stages').select('position').eq('pipeline_id', pipelineId)
  const nextPosition = (existing || []).reduce((max, s) => Math.max(max, s.position), -1) + 1
  const { data, error } = await supabase
    .from('stages')
    .insert({ org_id: orgId, pipeline_id: pipelineId, name: name.trim(), color: color || null, position: nextPosition })
    .select('*').single()
  if (error) throw error
  return data
}

export async function updateStage(id, patch) {
  const allowed = {}
  if ('name' in patch) allowed.name = patch.name.trim()
  if ('color' in patch) allowed.color = patch.color || null
  const { data, error } = await supabase.from('stages').update(allowed).eq('id', id).select('*').single()
  if (error) throw error
  if (!data) throw new Error('Could not save this stage — permission denied.')
  return data
}

// Exactly one stage per pipeline may be the intake stage (DB-enforced by a
// partial unique index) -- clear the old one first so setting a new one
// never trips it.
export async function setIntakeStage(pipelineId, stageId) {
  const { error: clearErr } = await supabase.from('stages').update({ is_intake: false }).eq('pipeline_id', pipelineId)
  if (clearErr) throw clearErr
  const { error } = await supabase.from('stages').update({ is_intake: true }).eq('id', stageId)
  if (error) throw error
}

export async function reorderStages(stages) {
  // Supabase JS has no bulk-update-by-differing-values, so each row goes
  // one at a time; the list is always small (a handful of pipeline stages).
  await Promise.all(stages.map((s, i) => supabase.from('stages').update({ position: i }).eq('id', s.id)))
}

// Blocked if any job is currently sitting in this stage -- silently
// deleting it would leave those opportunities pointing at a stage_id that
// no longer exists.
export async function deleteStage(id) {
  const { count, error: cErr } = await supabase
    .from('opportunities').select('id', { count: 'exact', head: true }).eq('stage_id', id).neq('status', 'cancelled')
  if (cErr) throw cErr
  if (count > 0) throw new Error(`${count} job${count === 1 ? ' is' : 's are'} still in this stage — move ${count === 1 ? 'it' : 'them'} first.`)
  const { error } = await supabase.from('stages').delete().eq('id', id)
  if (error) throw error
}

export async function fetchAutomationRules() {
  const { data, error } = await supabase
    .from('automation_rules')
    .select('id, from_stage, to_stage, action, email_subject, email_body, enabled, position')
    .order('position', { ascending: true })
  if (error) throw error
  return data || []
}

export async function createAutomationRule(rule) {
  const orgId = await fetchMyOrgId()
  const { data, error } = await supabase
    .from('automation_rules')
    .insert({ org_id: orgId, ...rule })
    .select('*').single()
  if (error) throw error
  return data
}

export async function updateAutomationRule(id, patch) {
  const { data, error } = await supabase
    .from('automation_rules').update(patch).eq('id', id).select('*').single()
  if (error) throw error
  if (!data) throw new Error('Could not save this rule — permission denied.')
  return data
}

export async function deleteAutomationRule(id) {
  const { error } = await supabase.from('automation_rules').delete().eq('id', id)
  if (error) throw error
}

/* ------------------------------------------------------------------ */
/* Landing pages                                                       */
/* ------------------------------------------------------------------ */

export async function fetchLandingPages() {
  const { data, error } = await supabase
    .from('landing_pages')
    .select('id, slug, title, published, theme, updated_at, default_dispatcher_id')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchLandingPage(id) {
  const { data, error } = await supabase
    .from('landing_pages').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Landing page not found.')
  return data
}

export async function createLandingPage({ slug, title, published, theme, blocks, meta_description, schema_json }) {
  const orgId = await fetchMyOrgId()
  const { data, error } = await supabase
    .from('landing_pages')
    .insert({
      org_id: orgId, slug, title, published: !!published, theme: theme || 'classic', blocks: blocks || [],
      meta_description: meta_description || null, schema_json: schema_json || null,
    })
    .select('*').single()
  if (error) {
    if (error.code === '23505') throw new Error('That slug is already taken — pick another.')
    throw error
  }
  return data
}

export async function updateLandingPage(id, patch) {
  const { data, error } = await supabase
    .from('landing_pages').update(patch).eq('id', id).select('*').single()
  if (error) {
    if (error.code === '23505') throw new Error('That slug is already taken — pick another.')
    throw error
  }
  if (!data) throw new Error('Could not save this page — permission denied.')
  return data
}

export async function deleteLandingPage(id) {
  const { error } = await supabase.from('landing_pages').delete().eq('id', id)
  if (error) throw error
}
