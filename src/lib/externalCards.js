import { supabase, fetchMyOrgId } from './supabase'

// Tracking wrapper for digital business cards that are already built and
// hosted elsewhere (e.g. a separate Netlify site) -- entirely separate from
// the in-app Business Card builder. A card here is just a name + its real
// URL; the trackable link (/go/:slug) counts a click, then bounces straight
// to target_url. Nothing about the external site itself is touched.

export async function fetchMyExternalCards() {
  const orgId = await fetchMyOrgId()
  const { data, error } = await supabase
    .from('external_card_links').select('*').eq('org_id', orgId).order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export const slugifyCardName = (s) =>
  String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

export async function createExternalCard({ orgId, name, target_url }) {
  const { data, error } = await supabase
    .from('external_card_links')
    .insert({ org_id: orgId, slug: slugifyCardName(name) || `card-${Date.now().toString(36)}`, name, target_url })
    .select('*').single()
  if (error) {
    if (error.code === '23505') throw new Error('That link name is already taken — try another.')
    throw error
  }
  return data
}

export async function updateExternalCard(id, patch) {
  const { data, error } = await supabase
    .from('external_card_links').update(patch).eq('id', id).select('*').single()
  if (error) {
    if (error.code === '23505') throw new Error('That link name is already taken — try another.')
    throw error
  }
  return data
}

export async function deleteExternalCard(id) {
  const { error } = await supabase.from('external_card_links').delete().eq('id', id)
  if (error) throw error
}
