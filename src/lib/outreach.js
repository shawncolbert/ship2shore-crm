import { supabase, fetchMyOrgId } from './supabase'
import { parseCsvFile } from './contactImport'

/* ------------------------------------------------------------------ */
/* Prospects                                                           */
/* ------------------------------------------------------------------ */

export async function fetchProspects({ status } = {}) {
  let q = supabase.from('prospects').select('*').order('created_at', { ascending: false })
  if (status) q = q.eq('status', status)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function createProspect(fields) {
  const orgId = await fetchMyOrgId()
  const { data, error } = await supabase
    .from('prospects')
    .insert({
      org_id: orgId,
      business_name: fields.business_name?.trim(),
      industry: fields.industry?.trim() || null,
      website: fields.website?.trim() || null,
      phone: fields.phone?.trim() || null,
      email: fields.email?.trim().toLowerCase() || null,
      city: fields.city?.trim() || null,
      state: fields.state?.trim() || null,
      source: fields.source || 'manual',
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// Phase 2: real business search via Google Places, gated by the
// GOOGLE_PLACES_API_KEY env var (see prospect-search.js). Returns raw
// search results -- addProspectsFromSearch below is the separate step
// that actually saves the ones a human picks.
export async function searchBusinesses({ industry, location }) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch('/.netlify/functions/prospect-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: JSON.stringify({ industry, location }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Search failed')
  return data.results || []
}

// Saves selected Places search results as prospects -- same dedupe-by-email
// rule as importProspects, but most Places results have no email at all
// (Places never exposes one), so those just get added without a dedupe key.
export async function addProspectsFromSearch(results) {
  const orgId = await fetchMyOrgId()
  const emails = results.map((r) => r.email).filter(Boolean).map((e) => e.toLowerCase())
  let seen = new Set()
  if (emails.length) {
    const { data: existing } = await supabase.from('prospects').select('email').eq('org_id', orgId).in('email', emails)
    seen = new Set((existing || []).map((r) => r.email?.toLowerCase()))
  }
  const toInsert = results
    .filter((r) => !r.email || !seen.has(r.email.toLowerCase()))
    .map((r) => ({
      org_id: orgId,
      business_name: r.business_name,
      website: r.website || null,
      phone: r.phone || null,
      email: r.email?.toLowerCase() || null,
      city: r.city || null,
      state: r.state || null,
      audit_score: r.audit_score || {},
      source: 'places_search',
    }))
  if (!toInsert.length) return { added: 0 }
  const { error } = await supabase.from('prospects').insert(toInsert)
  if (error) throw error
  return { added: toInsert.length }
}

// Fills in the one thing Places search can never provide -- a prospect
// found that way starts with no email and can't be enrolled in a sequence
// until someone adds one by hand.
export async function updateProspectEmail(id, email) {
  const { error } = await supabase
    .from('prospects')
    .update({ email: email.trim().toLowerCase() || null, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function updateProspectStatus(id, status) {
  const { error } = await supabase.from('prospects').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function deleteProspect(id) {
  const { error } = await supabase.from('prospects').delete().eq('id', id)
  if (error) throw error
}

// CSV import -- reuses the same client-side parser as contacts, but the
// mapping is fixed to prospect columns rather than the full guess/mapping
// flow, since a prospect list is usually pre-formatted for this purpose
// (business_name, industry, website, phone, email, city, state).
export { parseCsvFile }

export async function importProspects(rows) {
  const orgId = await fetchMyOrgId()
  const { data: existing } = await supabase.from('prospects').select('email').eq('org_id', orgId).not('email', 'is', null)
  const seen = new Set((existing || []).map((r) => r.email?.toLowerCase()))

  const toInsert = []
  let skipped = 0
  for (const row of rows) {
    const name = (row.business_name || row.name || '').trim()
    const email = (row.email || '').trim().toLowerCase() || null
    if (!name) { skipped++; continue }
    if (email && seen.has(email)) { skipped++; continue }
    if (email) seen.add(email)
    toInsert.push({
      org_id: orgId,
      business_name: name,
      industry: row.industry?.trim() || null,
      website: row.website?.trim() || null,
      phone: row.phone?.trim() || null,
      email,
      city: row.city?.trim() || null,
      state: row.state?.trim() || null,
      source: 'import',
    })
  }

  let imported = 0
  const failed = []
  const CHUNK = 200
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK)
    const { error } = await supabase.from('prospects').insert(chunk)
    if (!error) { imported += chunk.length; continue }
    for (const row of chunk) {
      const { error: rowErr } = await supabase.from('prospects').insert(row)
      if (rowErr) failed.push({ row, error: rowErr.message })
      else imported++
    }
  }
  return { imported, skipped, failed }
}

/* ------------------------------------------------------------------ */
/* Sequences                                                            */
/* ------------------------------------------------------------------ */

export async function fetchSequences() {
  const { data, error } = await supabase.from('outreach_sequences').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function saveSequence({ id, name, steps, active }) {
  const orgId = await fetchMyOrgId()
  const row = { org_id: orgId, name, steps, active: active !== false, updated_at: new Date().toISOString() }
  const q = id
    ? supabase.from('outreach_sequences').update(row).eq('id', id)
    : supabase.from('outreach_sequences').insert(row)
  const { data, error } = await q.select().single()
  if (error) throw error
  return data
}

export async function deleteSequence(id) {
  const { error } = await supabase.from('outreach_sequences').delete().eq('id', id)
  if (error) throw error
}

/* ------------------------------------------------------------------ */
/* Enrollments                                                          */
/* ------------------------------------------------------------------ */

// Enrolls each prospect not already on this sequence. Duplicate
// (prospect_id, sequence_id) pairs are silently skipped -- re-enrolling
// someone already on a sequence would otherwise blow up on the unique
// constraint for no useful reason.
export async function enrollProspects({ prospectIds, sequenceId }) {
  const orgId = await fetchMyOrgId()
  const { data: existing } = await supabase
    .from('outreach_enrollments').select('prospect_id').eq('sequence_id', sequenceId).in('prospect_id', prospectIds)
  const already = new Set((existing || []).map((r) => r.prospect_id))
  const toInsert = prospectIds.filter((id) => !already.has(id)).map((prospect_id) => ({
    org_id: orgId, prospect_id, sequence_id: sequenceId,
  }))
  if (!toInsert.length) return { enrolled: 0, skipped: prospectIds.length }
  const { error } = await supabase.from('outreach_enrollments').insert(toInsert)
  if (error) throw error
  return { enrolled: toInsert.length, skipped: prospectIds.length - toInsert.length }
}

export async function fetchEnrollments() {
  const { data, error } = await supabase
    .from('outreach_enrollments')
    .select('*, prospects(business_name, email, status), outreach_sequences(name)')
    .order('enrolled_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function stopEnrollment(id) {
  const { error } = await supabase.from('outreach_enrollments').update({ status: 'stopped' }).eq('id', id)
  if (error) throw error
}

/* ------------------------------------------------------------------ */
/* Twilio (SMS channel)                                                 */
/* ------------------------------------------------------------------ */

// Same per-org isolation as the Telegram bot credentials -- each org owns
// its own Twilio account, blank means SMS steps just don't send for that
// org, never silently borrow another org's number.
export async function saveTwilioCredentials(orgId, { accountSid, authToken, phoneNumber }) {
  const { error } = await supabase.from('organizations').update({
    twilio_account_sid: String(accountSid || '').trim() || null,
    twilio_auth_token: String(authToken || '').trim() || null,
    twilio_phone_number: String(phoneNumber || '').trim() || null,
  }).eq('id', orgId)
  if (error) throw error
}

/* ------------------------------------------------------------------ */
/* Suppression list                                                     */
/* ------------------------------------------------------------------ */

export async function fetchDoNotContact() {
  const { data, error } = await supabase.from('do_not_contact').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function addDoNotContact(email, reason = 'manual') {
  const orgId = await fetchMyOrgId()
  const { error } = await supabase.from('do_not_contact').insert({ org_id: orgId, email: email.trim().toLowerCase(), reason })
  if (error && error.code !== '23505') throw error // already suppressed -- fine
}

export async function removeDoNotContact(id) {
  const { error } = await supabase.from('do_not_contact').delete().eq('id', id)
  if (error) throw error
}
