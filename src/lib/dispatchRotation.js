import { supabase } from './supabase'

// Contacts tagged as dispatchers, each flagged with whether they're
// currently "in rotation" for auto-assignment (dispatcher_rotation is a
// simple marker table -- present = in rotation, absent = not). Not every
// dispatcher-segment contact is automatically eligible; Shawn picks who's in.
export async function fetchDispatchRotationCandidates() {
  const [{ data: dispatchers, error: dErr }, { data: rotation, error: rErr }] = await Promise.all([
    supabase.from('contacts').select('id, full_name, company, email').eq('segment', 'dispatcher').order('full_name', { ascending: true }),
    supabase.from('dispatcher_rotation').select('contact_id'),
  ])
  if (dErr) throw dErr
  if (rErr) throw rErr
  const inRotation = new Set((rotation || []).map((r) => r.contact_id))
  return (dispatchers || []).map((d) => ({ ...d, inRotation: inRotation.has(d.id) }))
}

export async function addToDispatchRotation(orgId, contactId) {
  const { error } = await supabase.from('dispatcher_rotation').insert({ org_id: orgId, contact_id: contactId })
  if (error && error.code !== '23505') throw error // 23505 = already in rotation, fine
}

export async function removeFromDispatchRotation(contactId) {
  const { error } = await supabase.from('dispatcher_rotation').delete().eq('contact_id', contactId)
  if (error) throw error
}

export async function saveAutoAssignLeads(orgId, enabled) {
  const { error } = await supabase.from('organizations').update({ auto_assign_leads: !!enabled }).eq('id', orgId)
  if (error) throw error
}
