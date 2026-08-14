import { createClient } from '@supabase/supabase-js'
import { PAYMENT_METHODS, buildPaymentRequestEmail } from './paymentRequest'

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

// The org the signed-in user belongs to. Inserts must carry this org_id
// so they satisfy the row-level-security policy (with check org_id in my orgs).
export async function fetchMyOrgId() {
  const { data, error } = await supabase
    .from('memberships')
    .select('org_id')
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('No organization found for this user.')
  return data.org_id
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
/* Org branding — used by Layout and the public booking widget so each */
/* white-label org shows its own name/logo instead of "Ship2Shore".    */
/* ------------------------------------------------------------------ */

export async function fetchMyOrg() {
  const orgId = await fetchMyOrgId()
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name, slug, logo_url, primary_color, enabled_features, theme_mode, theme_preset')
    .eq('id', orgId)
    .single()
  if (error) throw error
  return data
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

  const { data: newContact, error: cErr } = await supabase
    .from('contacts')
    .insert(payload)
    .select('id, full_name, company, phone, email, segment')
    .single()
  if (cErr) throw cErr

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

export async function fetchDefaultPipeline() {
  const { data: pipeline, error: pErr } = await supabase
    .from('pipelines').select('id, name').eq('is_default', true).limit(1).single()
  if (pErr) throw pErr

  const { data: stages, error: sErr } = await supabase
    .from('stages')
    .select('id, name, position, is_won, is_lost')
    .eq('pipeline_id', pipeline.id)
    .order('position', { ascending: true })
  if (sErr) throw sErr

  const { data: opps, error: oErr } = await supabase
    .from('opportunities')
    .select('id, title, service_code, port, vehicle, value, scheduled_at, stage_id, contact_id, status, billing_number, cleared, paid, payment_status, wave_invoice_id, payment_requested_at, payment_method_requested, pickup_address, dropoff_address, vehicle_make, vehicle_model, vehicle_year, vehicle_vin, contacts(full_name, company, email, phone)')
    .eq('pipeline_id', pipeline.id)
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

// Count of jobs sitting in the "New Booking" stage -- bookings that came in
// (from the public booking widget, a funnel, or the sidebar) and haven't
// been triaged into Scheduled/In Progress yet. Drives the sidebar nav badge.
export async function fetchNewBookingCount() {
  const { data: pipeline, error: pErr } = await supabase
    .from('pipelines').select('id').eq('is_default', true).limit(1).maybeSingle()
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

// Ship billing number that rides along with a job. Capped at 16 chars;
// blank clears it. Stays on the opportunity through every stage.
export async function setOpportunityBilling(id, billingNumber) {
  const value = billingNumber?.trim() ? billingNumber.trim().slice(0, 16) : null
  const { error } = await supabase
    .from('opportunities').update({ billing_number: value }).eq('id', id)
  if (error) throw error
  return value
}

// Toggle per-job flags (cleared, paid). Pass only the fields you're changing.
export async function patchOpportunity(id, patch) {
  const allowed = {}
  if ('cleared' in patch) allowed.cleared = !!patch.cleared
  if ('paid' in patch) allowed.paid = !!patch.paid
  const { error } = await supabase.from('opportunities').update(allowed).eq('id', id)
  if (error) throw error
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
  if ('scheduled_at' in patch) allowed.scheduled_at = patch.scheduled_at || null
  if ('billing_number' in patch)
    allowed.billing_number = patch.billing_number?.trim() ? patch.billing_number.trim().slice(0, 16) : null
  if ('value' in patch) {
    const n = Number(patch.value)
    allowed.value = Number.isFinite(n) && n >= 0 ? n : null
  }
  const { data, error } = await supabase
    .from('opportunities').update(allowed).eq('id', id).select('*').single()
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
/* Manual payment requests (Zelle / Venmo / Cash App / Apple Pay)      */
/* ------------------------------------------------------------------ */

export async function fetchPaymentSettings() {
  const orgId = await fetchMyOrgId()
  const { data, error } = await supabase
    .from('payment_settings').select('*').eq('org_id', orgId).maybeSingle()
  if (error) throw error
  return data || {
    org_id: orgId, zelle_handle: '', venmo_handle: '', cashapp_handle: '', apple_pay_handle: '', default_method: null,
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

// Sends the payment request immediately — no draft/review step. Builds the
// message from payment_settings + the opportunity's value, emails it via the
// existing send-email function (Gmail), then stamps payment_requested_at /
// payment_method_requested on the opportunity.
export async function sendPaymentRequest(opportunityId, method) {
  const { data: opp, error: oppErr } = await supabase
    .from('opportunities')
    .select('id, title, value, billing_number, contact_id, contacts(id, full_name, email)')
    .eq('id', opportunityId)
    .maybeSingle()
  if (oppErr || !opp) throw new Error('Opportunity not found.')
  const contact = opp.contacts
  if (!contact?.email) throw new Error('This contact has no email on file — add one before sending a payment request.')

  const settings = await fetchPaymentSettings()
  const meta = PAYMENT_METHODS.find((m) => m.value === method)
  if (!meta) throw new Error('Unknown payment method.')
  const handle = settings[meta.handleField]
  if (!handle) throw new Error(`Set your ${meta.label} handle in Payment Settings before sending.`)

  const firstName = (contact.full_name || '').split(/\s+/)[0] || 'there'
  const { subject, body, html } = buildPaymentRequestEmail({
    method, handle, amount: opp.value, contactFirstName: firstName,
    jobTitle: opp.title, jobRef: opp.billing_number || opp.title || '',
  })

  await sendEmail({ contactId: contact.id, to: contact.email, subject, body, html })

  const { error: updErr } = await supabase
    .from('opportunities')
    .update({ payment_requested_at: new Date().toISOString(), payment_method_requested: method })
    .eq('id', opportunityId)
  if (updErr) throw updErr

  return { ok: true, method, sent_to: contact.email }
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
    // Exact "moved into Completed/Paid" events from the stage-change history.
    supabase.from('opportunity_stage_changes')
      .select('opportunity_id, to_stage, changed_at')
      .in('to_stage', ['Completed', 'Paid'])
      .gte('changed_at', monthAgo),
  ])
  const stages = stagesRes.data || []
  const opps = oppsRes.data || []
  const newLeadsWeek = leadsRes.count || 0
  const closes = closesRes.data || []

  const stageById = Object.fromEntries(stages.map((s) => [s.id, s]))
  const nameOf = (o) => stageById[o.stage_id]?.name || ''
  const isClosed = (n) => ['Completed', 'Paid', 'Canceled', 'Cancelled'].includes(n)

  // Only the main workflow stages (position >= 0: New Booking … Paid, Canceled).
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

const CLOSED_STAGE_NAMES = ['Completed', 'Paid', 'Canceled', 'Cancelled']

export async function fetchOpenPipelineJobs() {
  const { data: stages, error: sErr } = await supabase.from('stages').select('id, name')
  if (sErr) throw sErr
  const closedIds = new Set((stages || []).filter((s) => CLOSED_STAGE_NAMES.includes(s.name)).map((s) => s.id))
  const nameById = Object.fromEntries((stages || []).map((s) => [s.id, s.name]))

  const { data, error } = await supabase
    .from('opportunities')
    .select('id, title, value, stage_id, status, scheduled_at, contact_id, contacts(full_name)')
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

// Jobs that moved into Completed/Paid within the last `days` days, from the
// exact stage-change history (matches fetchDashboardStats' closedThisWeek/Month).
export async function fetchClosedJobs(days) {
  const since = new Date(Date.now() - days * 864e5).toISOString()
  const { data, error } = await supabase
    .from('opportunity_stage_changes')
    .select('opportunity_id, to_stage, changed_at, opportunities(id, title, value, contact_id, contacts(full_name))')
    .in('to_stage', ['Completed', 'Paid'])
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
    .select('id, title, value, scheduled_at, contact_id, contacts(full_name)')
    .eq('stage_id', stageId)
    .neq('status', 'cancelled')
    .order('scheduled_at', { ascending: true, nullsFirst: false })
  if (error) throw error
  return (data || []).map((o) => ({
    id: o.id, contactId: o.contact_id, contactName: o.contacts?.full_name || 'Unnamed contact',
    jobTitle: o.title, stageName, date: o.scheduled_at, value: o.value,
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
    .select('id, file_name, file_path, size_bytes, opportunity_id, created_at, opportunities(title)')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// Files a customer sent us themselves (via the /u/:token upload link --
// uploaded_by is null, unlike a staff upload) that nobody on staff has
// opened yet. Shaped for DrillDownModal.
export async function fetchNewCustomerFiles() {
  const { data, error } = await supabase
    .from('attachments')
    .select('id, file_name, created_at, contact_id, contacts(full_name)')
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
    .select('id, file_name, file_path, kind, bl_number, size_bytes, created_at, contact_id, contacts(full_name)')
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
    .select('id, title, billing_number, bl_number, contact_id, contacts(full_name)')
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
    .select('id, slug, title, published, theme, updated_at')
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

export async function createLandingPage({ slug, title, published, theme, blocks }) {
  const orgId = await fetchMyOrgId()
  const { data, error } = await supabase
    .from('landing_pages')
    .insert({ org_id: orgId, slug, title, published: !!published, theme: theme || 'classic', blocks: blocks || [] })
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
