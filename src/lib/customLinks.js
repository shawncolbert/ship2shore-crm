import { supabase, fetchMyOrgId } from './supabase'

// Self-serve external "quick links" -- a photographer's video-editing tool,
// a real estate agent's listings site, or anything else an org wants one
// tap away from the CRM sidebar without it being a real page in this app.
export async function fetchCustomLinks() {
  const { data, error } = await supabase
    .from('org_custom_links')
    .select('id, label, url')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

function normalizeUrl(url) {
  const trimmed = String(url || '').trim()
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

export async function createCustomLink({ label, url }) {
  const orgId = await fetchMyOrgId()
  const clean = { label: label?.trim(), url: normalizeUrl(url) }
  if (!clean.label || !clean.url) throw new Error('A name and a URL are both required.')
  const { data, error } = await supabase
    .from('org_custom_links').insert({ org_id: orgId, ...clean }).select('id, label, url').single()
  if (error) throw error
  return data
}

export async function updateCustomLink(id, { label, url }) {
  const clean = { label: label?.trim(), url: normalizeUrl(url) }
  if (!clean.label || !clean.url) throw new Error('A name and a URL are both required.')
  const { error } = await supabase.from('org_custom_links').update(clean).eq('id', id)
  if (error) throw error
}

export async function deleteCustomLink(id) {
  const { error } = await supabase.from('org_custom_links').delete().eq('id', id)
  if (error) throw error
}
