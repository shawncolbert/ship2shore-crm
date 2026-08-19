import { admin } from './supabaseAdmin.js'
import { getDefaultPipeline, getIntakeStage } from './pipeline.js'
import { autoAssignDispatcher } from './dispatchAssignment.js'

// Finds a contact by email (preferred) or phone, or creates one. Shared by
// any public intake surface (currently the digital business card's
// send-your-info form; public-landing-page.js has its own near-identical
// version that predates this and hasn't been switched over, to avoid
// touching an already-working lead flow) so a repeat visitor doesn't pile up
// duplicate contact rows.
export async function findOrCreateContact({ orgId, fullName, email, phone, source, notes, tags }) {
  const cleanEmail = email ? String(email).trim().toLowerCase() : null
  const cleanPhone = phone ? String(phone).trim() : null

  let existing = null
  if (cleanEmail) {
    const { data } = await admin.from('contacts').select('id, phone').eq('org_id', orgId).eq('email', cleanEmail).maybeSingle()
    existing = data
  } else if (cleanPhone) {
    const { data } = await admin.from('contacts').select('id, email').eq('org_id', orgId).eq('phone', cleanPhone).maybeSingle()
    existing = data
  }

  if (existing) {
    if (cleanPhone && !existing.phone) await admin.from('contacts').update({ phone: cleanPhone }).eq('id', existing.id)
    return existing.id
  }

  const { data: created, error } = await admin
    .from('contacts')
    .insert({
      org_id: orgId,
      full_name: fullName ? String(fullName).trim() : null,
      email: cleanEmail,
      phone: cleanPhone,
      segment: 'private',
      source: source || null,
      notes: notes || null,
      tags: tags || null,
    })
    .select('id').single()
  if (error) throw error
  return created.id
}

// Drops a card onto the org's default pipeline, in whichever stage is
// configured to receive new leads (see getIntakeStage). Auto-assignment
// failure is logged, not thrown -- an unassigned card still needs to exist.
export async function createLeadOpportunity({ orgId, contactId, title, pickupAddress, dropoffAddress, vehicle }) {
  const pipeline = await getDefaultPipeline(orgId)
  if (!pipeline) throw new Error('This org has no default pipeline configured.')
  const stage = await getIntakeStage(orgId)
  if (!stage) throw new Error("This org's pipeline has no stages configured.")

  const { data: opp, error } = await admin
    .from('opportunities')
    .insert({
      org_id: orgId, contact_id: contactId, pipeline_id: pipeline.id, stage_id: stage.id,
      title, status: 'open',
      pickup_address: pickupAddress ? String(pickupAddress).trim() : null,
      dropoff_address: dropoffAddress ? String(dropoffAddress).trim() : null,
      vehicle: vehicle ? String(vehicle).trim() : null,
    })
    .select('id').single()
  if (error) throw error

  try {
    await autoAssignDispatcher({ orgId, opportunityId: opp.id })
  } catch (e) {
    console.error('❌ autoAssignDispatcher failed:', e)
  }
  return opp.id
}
