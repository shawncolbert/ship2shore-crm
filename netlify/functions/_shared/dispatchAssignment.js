import { admin } from './supabaseAdmin.js'
import { sendCustomerEmail } from './email.js'

// Emails a dispatcher contact the lead details and logs it into their own
// Inbox conversation as a record of the handoff. Shared by the manual
// "assign to dispatcher" action and auto-assignment below, so both paths
// send the exact same notification instead of two copies drifting apart.
export async function notifyDispatcherOfLead({ orgId, dispatcher, opportunity }) {
  if (!dispatcher.email) {
    return { emailSent: false, emailError: `${dispatcher.full_name || dispatcher.company || 'This dispatcher'} has no email on file — the job was assigned, but no notification was sent.` }
  }

  const { data: org } = await admin.from('organizations').select('name').eq('id', orgId).maybeSingle()
  const orgName = org?.name || 'Dispatch'
  const customerName = opportunity.contacts?.full_name || 'Customer'
  const vehicleDesc = [opportunity.vehicle_year, opportunity.vehicle_make, opportunity.vehicle_model].filter(Boolean).join(' ') || opportunity.vehicle || null

  const lines = [
    `Hi ${dispatcher.full_name || dispatcher.company || 'there'},`,
    '',
    `${orgName} just assigned you a new lead:`,
    '',
    `Customer: ${customerName}`,
    `Phone: ${opportunity.contacts?.phone || '—'}`,
    `Email: ${opportunity.contacts?.email || '—'}`,
  ]
  if (vehicleDesc) lines.push(`Vehicle: ${vehicleDesc}`)
  if (opportunity.vehicle_vin) lines.push(`VIN: ${opportunity.vehicle_vin}`)
  if (opportunity.pickup_address) lines.push(`Pickup: ${opportunity.pickup_address}`)
  if (opportunity.dropoff_address) lines.push(`Drop-off: ${opportunity.dropoff_address}`)
  if (opportunity.value) lines.push(`Estimated value: $${opportunity.value}`)
  lines.push('', 'Please reach out and take it from here.', '', 'Thanks,', orgName)

  const subject = `New lead assigned: ${customerName}${opportunity.title ? ` — ${opportunity.title}` : ''}`
  try {
    await sendCustomerEmail({ orgId, to: dispatcher.email, subject, body: lines.join('\n'), contactId: dispatcher.id })
    return { emailSent: true, emailError: null }
  } catch (e) {
    return { emailSent: false, emailError: `Job was assigned, but the notification email failed: ${e.message}` }
  }
}

// Round-robins a fresh lead across whichever dispatcher contacts are marked
// "in rotation" (dispatcher_rotation), when the org has auto-assign turned
// on. auto_assign_last_contact_id is the cursor -- whoever got the last
// lead -- so the rotation picks up after them rather than always starting
// from the top. No-ops (returns null) when auto-assign is off or nobody's
// in the rotation, leaving the job unassigned for manual pick, same as
// before this existed.
export async function autoAssignDispatcher({ orgId, opportunityId }) {
  const { data: org } = await admin
    .from('organizations')
    .select('auto_assign_leads, auto_assign_last_contact_id')
    .eq('id', orgId)
    .maybeSingle()
  if (!org?.auto_assign_leads) return null

  const { data: rotation } = await admin
    .from('dispatcher_rotation')
    .select('contact_id, contacts(id, full_name, company, email)')
    .eq('org_id', orgId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (!rotation?.length) return null

  const lastIdx = rotation.findIndex((r) => r.contact_id === org.auto_assign_last_contact_id)
  const next = rotation[(lastIdx + 1) % rotation.length]
  const dispatcher = next.contacts
  if (!dispatcher) return null

  const { data: opportunity, error: oppErr } = await admin
    .from('opportunities')
    .select('id, title, value, vehicle, vehicle_year, vehicle_make, vehicle_model, vehicle_vin, pickup_address, dropoff_address, contact_id, contacts!contact_id(full_name, phone, email)')
    .eq('id', opportunityId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (oppErr || !opportunity) return null

  await admin.from('opportunities').update({ assigned_dispatcher_id: dispatcher.id }).eq('id', opportunityId).eq('org_id', orgId)
  await admin.from('organizations').update({ auto_assign_last_contact_id: dispatcher.id }).eq('id', orgId)

  const { emailSent, emailError } = await notifyDispatcherOfLead({ orgId, dispatcher, opportunity })
  return { dispatcherContactId: dispatcher.id, emailSent, emailError }
}
