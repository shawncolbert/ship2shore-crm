import { admin, userFromToken, orgForUser } from './_shared/supabaseAdmin.js'
import { sendCustomerEmail, sendInternalAlert } from './_shared/email.js'
import { renderContract } from './_shared/contractTemplate.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

function siteOrigin(event) {
  return process.env.URL || process.env.DEPLOY_PRIME_URL || `https://${event.headers.host}`
}

function contractEmailHtml({ orgName, publicUrl, totalPrice, depositAmount }) {
  const money = (n) => `$${Number(n || 0).toFixed(2)}`
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
      <p>${orgName} has sent you a booking agreement to review and sign.</p>
      <p>Total: <strong>${money(totalPrice)}</strong> &middot; Deposit to secure this booking: <strong>${money(depositAmount)}</strong></p>
      <p style="margin:20px 0;">
        <a href="${publicUrl}" style="display:inline-block;background:#e8a317;color:#0c2231;font-weight:bold;padding:12px 20px;border-radius:8px;text-decoration:none;">Review &amp; Sign Agreement</a>
      </p>
      <p style="margin:20px 0 4px;font-size:13px;color:#666;">Once signed, your deposit invoice will be emailed to you automatically.</p>
    </div>
  `
}

// Renders and sends a customer-facing booking agreement for a job -- see
// _shared/contractTemplate.js for the wording. The deposit invoice itself
// isn't created/sent here; it's created automatically once the customer
// signs (contract-sign.js), so there's exactly one email to review and one
// action (sign) that immediately produces payment, instead of two
// disconnected sends.
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No org membership' })

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Invalid request body' }) }
  const { opportunityId } = body
  if (!opportunityId) return json(400, { error: 'Missing opportunityId' })

  const { data: opp, error: oppErr } = await admin
    .from('opportunities')
    .select('id, org_id, title, value, deposit_amount, booking_number, contact_id, pickup_address, dropoff_address, vehicle, vehicle_year, vehicle_make, vehicle_model, vehicle_vin, port, scheduled_at, contacts!contact_id(id, full_name, email, phone)')
    .eq('id', opportunityId).eq('org_id', orgId).maybeSingle()
  if (oppErr) return json(500, { error: oppErr.message })
  if (!opp) return json(404, { error: 'Job not found.' })

  const contact = opp.contacts
  if (!contact?.email) return json(400, { error: 'This contact has no email on file — add one before sending a contract.' })
  if (!opp.value) return json(400, { error: 'Set a price on this job before sending a contract.' })

  const { data: org } = await admin
    .from('organizations').select('name, invoice_business_name').eq('id', orgId).maybeSingle()
  const orgName = org?.invoice_business_name || org?.name || 'Us'

  const vehicleDescription = opp.vehicle || [opp.vehicle_year, opp.vehicle_make, opp.vehicle_model].filter(Boolean).join(' ') || null

  const contractBody = renderContract({
    orgName,
    customerName: contact.full_name || contact.email,
    vehicleDescription,
    vehicleVin: opp.vehicle_vin,
    pickupAddress: opp.pickup_address,
    dropoffAddress: opp.dropoff_address,
    scheduledAt: opp.scheduled_at,
    port: opp.port,
    totalPrice: opp.value,
    depositAmount: opp.deposit_amount,
    bookingNumber: opp.booking_number,
  })

  const { data: contract, error: insErr } = await admin
    .from('contracts')
    .insert({
      org_id: orgId,
      opportunity_id: opp.id,
      body: contractBody,
      bill_to_name: contact.full_name || null,
      bill_to_email: contact.email,
      total_price: opp.value,
      deposit_amount: opp.deposit_amount,
      status: 'sent',
      created_by: user.id,
    })
    .select('id')
    .single()
  if (insErr) return json(500, { error: insErr.message })

  const publicUrl = `${siteOrigin(event)}/contract/${contract.id}`

  let emailSent = false
  let emailError = null
  try {
    await sendCustomerEmail({
      orgId,
      to: contact.email,
      subject: `${orgName} — Booking agreement for your review`,
      body: `Please review and sign your booking agreement: ${publicUrl}`,
      html: contractEmailHtml({ orgName, publicUrl, totalPrice: opp.value, depositAmount: opp.deposit_amount }),
      contactId: contact.id,
    })
    emailSent = true
  } catch (e) {
    emailError = String(e.message || e)
  }

  await sendInternalAlert({
    orgId,
    subject: `Contract sent — ${contact.full_name || opp.title || 'Job'}`,
    body:
      `A booking agreement was sent for ${vehicleDescription || opp.title || 'this job'}.\n\n` +
      `Customer: ${contact.full_name || contact.email}\n` +
      `Total: $${Number(opp.value || 0).toFixed(2)} — Deposit: $${Number(opp.deposit_amount || 0).toFixed(2)}\n` +
      `${emailSent ? 'Customer email sent.' : `Customer email failed: ${emailError}`}`,
  })

  return json(200, { ok: true, contractId: contract.id, publicUrl, emailSent, emailError })
}
