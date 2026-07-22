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

export async function fetchServices() {
  const { data, error } = await supabase
    .from('services')
    .select('code, name, default_rate')
    .eq('active', true)
    .order('name', { ascending: true })
  if (error) throw error
  return data || []
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
    email: contact.email?.trim() || null,
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
    // Drop the card into the default pipeline's first stage ("New Booking").
    const { data: pipeline, error: pErr } = await supabase
      .from('pipelines')
      .select('id')
      .eq('org_id', orgId)
      .eq('is_default', true)
      .limit(1)
      .single()
    if (pErr) throw pErr

    const { data: stage, error: sErr } = await supabase
      .from('stages')
      .select('id')
      .eq('pipeline_id', pipeline.id)
      .order('position', { ascending: true })
      .limit(1)
      .single()
    if (sErr) throw sErr

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
      .select('id, title, port, service_code, start_at, status')
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
    .select('id, title, service_code, port, value, stage_id, contact_id, status, contacts(full_name, company)')
    .eq('pipeline_id', pipeline.id)
  if (oErr) throw oErr

  return { pipeline, stages, opportunities: (opps || []).filter((o) => o.status !== 'cancelled') }
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
}

export async function fetchDashboardStats() {
  const { data: stages } = await supabase
    .from('stages').select('id, name, is_won').order('position')
  const { data: opps } = await supabase
    .from('opportunities').select('id, value, stage_id, status')

  const byStage = (stages || []).map((s) => ({
    name: s.name,
    count: (opps || []).filter((o) => o.stage_id === s.id).length,
  }))
  const openValue = (opps || [])
    .filter((o) => o.status === 'open')
    .reduce((sum, o) => sum + Number(o.value || 0), 0)
  const wonValue = (opps || [])
    .filter((o) => o.status === 'won')
    .reduce((sum, o) => sum + Number(o.value || 0), 0)

  return { byStage, openValue, wonValue, totalJobs: (opps || []).length }
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
    .select('id, direction, channel, body, from_addr, to_addr, ai_generated, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
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
export async function sendEmail({ conversationId, contactId, to, subject, body }) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch('/.netlify/functions/send-email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token || ''}`,
    },
    body: JSON.stringify({ conversationId, contactId, to, subject, body }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Send failed')
  return res.json()
}
