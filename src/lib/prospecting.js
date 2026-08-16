import { supabase, fetchMyOrgId } from './supabase'

/* ------------------------------------------------------------------ */
/* Known Connections -- link two contacts together with an optional    */
/* note (referred by, coworker, spouse, etc). Storage is directional   */
/* (contact_id, connected_contact_id) but conceptually symmetric, so    */
/* fetchConnections queries both sides and returns "the other contact"  */
/* regardless of which side the row was created from.                  */
/* ------------------------------------------------------------------ */

export async function fetchConnections(contactId) {
  const { data, error } = await supabase
    .from('contact_connections')
    .select(`
      id, note, created_at, contact_id, connected_contact_id,
      contact:contact_id ( id, full_name, company ),
      connected_contact:connected_contact_id ( id, full_name, company )
    `)
    .or(`contact_id.eq.${contactId},connected_contact_id.eq.${contactId}`)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map((row) => ({
    id: row.id,
    note: row.note,
    createdAt: row.created_at,
    contact: row.contact_id === contactId ? row.connected_contact : row.contact,
  }))
}

export async function addConnection({ contactId, connectedContactId, note }) {
  if (!connectedContactId) throw new Error('Pick a contact to connect.')
  if (connectedContactId === contactId) throw new Error('A contact can’t be connected to itself.')
  const { error } = await supabase
    .from('contact_connections')
    .insert({ contact_id: contactId, connected_contact_id: connectedContactId, note: note?.trim() || null })
  if (error) {
    if (error.code === '23505') throw new Error('These two contacts are already connected.')
    throw error
  }
}

export async function deleteConnection(id) {
  const { error } = await supabase.from('contact_connections').delete().eq('id', id)
  if (error) throw error
}

/* ------------------------------------------------------------------ */
/* Prospecting -- check a batch of prospects (name/phone/email) against */
/* existing contacts before outreach, so a direct match can be flagged  */
/* "warm" instead of cold-calling someone who's already a known client. */
/* ------------------------------------------------------------------ */

// The find_warm_lead_matches() DB function takes one prospect's worth of
// scalar args at a time, so a batch runs as one RPC call per prospect (in
// parallel) rather than a single array-in query.
export async function checkWarmLeads(prospects) {
  const orgId = await fetchMyOrgId()
  return Promise.all(
    prospects.map(async (p) => {
      const { data, error } = await supabase.rpc('find_warm_lead_matches', {
        p_org_id: orgId,
        p_name: p.name || null,
        p_phone: p.phone || null,
        p_email: p.email || null,
      })
      if (error) throw error
      return { prospect: p, matches: data || [] }
    })
  )
}
