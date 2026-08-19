import { admin, userFromToken, orgForUser } from './_shared/supabaseAdmin.js'
import { notifyDispatcherOfLead } from './_shared/dispatchAssignment.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// Hands a Pipeline job off to a dispatcher contact and, in the same request,
// emails that dispatcher the lead details -- manual, Shawn picks who gets
// each lead. See _shared/dispatchAssignment.js for the notification (shared
// with auto-assignment) and autoAssignDispatcher (the automated version of
// this same handoff, run from funnel-submit.js when an org has it enabled).
export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

    const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
    const user = await userFromToken(token)
    if (!user) return json(401, { error: 'Unauthorized' })

    const orgId = await orgForUser(user.id)
    if (!orgId) return json(403, { error: 'No organization' })

    let body
    try {
      body = JSON.parse(event.body || '{}')
    } catch (parseErr) {
      return json(400, { error: `Invalid JSON: ${parseErr.message}` })
    }
    const { opportunityId, dispatcherContactId } = body
    if (!opportunityId) return json(400, { error: 'opportunityId is required' })

    const { data: opp, error: oppErr } = await admin
      .from('opportunities')
      .select('id, title, value, vehicle, vehicle_year, vehicle_make, vehicle_model, vehicle_vin, pickup_address, dropoff_address, contact_id, contacts!contact_id(full_name, phone, email)')
      .eq('id', opportunityId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (oppErr || !opp) return json(404, { error: 'Job not found' })

    let dispatcher = null
    if (dispatcherContactId) {
      const { data, error } = await admin
        .from('contacts')
        .select('id, full_name, company, email')
        .eq('id', dispatcherContactId)
        .eq('org_id', orgId)
        .maybeSingle()
      if (error || !data) return json(404, { error: 'Dispatcher not found' })
      dispatcher = data
    }

    const { error: updErr } = await admin
      .from('opportunities')
      .update({ assigned_dispatcher_id: dispatcherContactId || null })
      .eq('id', opportunityId)
      .eq('org_id', orgId)
    if (updErr) return json(500, { error: updErr.message })

    let emailSent = false
    let emailError = null
    if (dispatcher) {
      ({ emailSent, emailError } = await notifyDispatcherOfLead({ orgId, dispatcher, opportunity: opp }))
    }

    return json(200, { success: true, emailSent, emailError })
  } catch (e) {
    return json(500, { error: e.message })
  }
}
