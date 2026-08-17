import { admin, userFromToken, orgForUser } from './_shared/supabaseAdmin.js'
import { sendCustomerEmail } from './_shared/email.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// Hands a Pipeline job off to a dispatcher contact and, in the same request,
// emails that dispatcher the lead details -- manual for now (Shawn picks who
// gets each lead), same "send_customer_email" mechanism the stage-change
// automations use underneath, just aimed at a teammate instead of a
// customer. sendCustomerEmail also logs the email into the dispatcher
// contact's own Inbox conversation, so the handoff has a visible paper trail.
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
      .select('id, title, value, vehicle, vehicle_year, vehicle_make, vehicle_model, vehicle_vin, pickup_address, dropoff_address, contact_id, contacts(full_name, phone, email)')
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
      if (!dispatcher.email) {
        emailError = `${dispatcher.full_name || dispatcher.company || 'This dispatcher'} has no email on file — the job was assigned, but no notification was sent.`
      } else {
        const { data: org } = await admin.from('organizations').select('name').eq('id', orgId).maybeSingle()
        const orgName = org?.name || 'Dispatch'
        const customerName = opp.contacts?.full_name || 'Customer'
        const vehicleDesc = [opp.vehicle_year, opp.vehicle_make, opp.vehicle_model].filter(Boolean).join(' ') || opp.vehicle || null

        const lines = [
          `Hi ${dispatcher.full_name || dispatcher.company || 'there'},`,
          '',
          `${orgName} just assigned you a new lead:`,
          '',
          `Customer: ${customerName}`,
          `Phone: ${opp.contacts?.phone || '—'}`,
          `Email: ${opp.contacts?.email || '—'}`,
        ]
        if (vehicleDesc) lines.push(`Vehicle: ${vehicleDesc}`)
        if (opp.vehicle_vin) lines.push(`VIN: ${opp.vehicle_vin}`)
        if (opp.pickup_address) lines.push(`Pickup: ${opp.pickup_address}`)
        if (opp.dropoff_address) lines.push(`Drop-off: ${opp.dropoff_address}`)
        if (opp.value) lines.push(`Estimated value: $${opp.value}`)
        lines.push('', 'Please reach out and take it from here.', '', 'Thanks,', orgName)

        const subject = `New lead assigned: ${customerName}${opp.title ? ` — ${opp.title}` : ''}`
        try {
          await sendCustomerEmail({ orgId, to: dispatcher.email, subject, body: lines.join('\n'), contactId: dispatcher.id })
          emailSent = true
        } catch (e) {
          emailError = `Job was assigned, but the notification email failed: ${e.message}`
        }
      }
    }

    return json(200, { success: true, emailSent, emailError })
  } catch (e) {
    return json(500, { error: e.message })
  }
}
