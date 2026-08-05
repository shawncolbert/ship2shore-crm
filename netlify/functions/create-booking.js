import { admin, userFromToken, orgForUser } from './_shared/supabaseAdmin.js'
import { getDefaultPipeline, getStageByName } from './_shared/pipeline.js'
import { sendCustomerEmail } from './_shared/email.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

const BOOKING_STAGE_NAME = 'New Booking'

function buildEmail(messageType, { customerName, bookingAmount, bookingDetails }) {
  if (messageType === 'delivery_order_request') {
    return {
      subject: 'Ship2Shore - Delivery Order Needed',
      body: `Hi ${customerName},

We're ready to proceed with your booking!

To complete your reservation, please provide:
- Proof of Authorization (POA)
- Delivery order details
- Estimated delivery date/time

${bookingDetails ? `Booking Details:\n${bookingDetails}\n\n` : ''}Please reply with the required information so we can finalize your shipment.

Best regards,
Ship2Shore Logistics`,
    }
  }

  if (messageType === 'payment_link_request') {
    return {
      subject: 'Ship2Shore - Payment Required',
      body: `Hi ${customerName},

Your vehicle is now cleared and ready to ship!

Booking Amount: $${bookingAmount}

${bookingDetails ? `Booking Details:\n${bookingDetails}\n\n` : ''}Please proceed with payment to secure your shipment. A payment link has been attached.

Thank you,
Ship2Shore Logistics`,
    }
  }

  return null
}

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

    const { contactId, newContact, lineItemsSummary, totalValue, sendDeliveryOrder, sendPaymentLink } = body

    if (!contactId && !(newContact?.full_name && newContact?.email)) {
      return json(400, { error: 'Provide contactId, or newContact with full_name and email' })
    }
    if (typeof totalValue !== 'number' || Number.isNaN(totalValue) || totalValue < 0) {
      return json(400, { error: 'totalValue must be a non-negative number' })
    }
    if (!lineItemsSummary) {
      return json(400, { error: 'lineItemsSummary is required' })
    }

    // Resolve (or create) the contact
    let contact
    if (contactId) {
      const { data, error } = await admin
        .from('contacts')
        .select('id, full_name, email')
        .eq('id', contactId)
        .eq('org_id', orgId)
        .single()
      if (error || !data) return json(404, { error: 'Contact not found' })
      contact = data
    } else {
      const { data, error } = await admin
        .from('contacts')
        .insert({
          org_id: orgId,
          full_name: newContact.full_name,
          email: newContact.email,
          tags: ['booking-sidebar'],
        })
        .select('id, full_name, email')
        .single()
      if (error) return json(500, { error: `Failed to create contact: ${error.message}` })
      contact = data
    }

    // Resolve pipeline + stage
    const pipeline = await getDefaultPipeline(orgId)
    if (!pipeline) return json(500, { error: 'No default pipeline configured for this organization' })

    const stage = await getStageByName(orgId, BOOKING_STAGE_NAME)
    if (!stage) return json(500, { error: `Pipeline is missing a "${BOOKING_STAGE_NAME}" stage` })

    // Create the opportunity
    const { data: opportunity, error: oppErr } = await admin
      .from('opportunities')
      .insert({
        org_id: orgId,
        contact_id: contact.id,
        pipeline_id: pipeline.id,
        stage_id: stage.id,
        title: `${contact.full_name} - ${lineItemsSummary}`,
        value: totalValue,
      })
      .select()
      .single()

    if (oppErr) return json(500, { error: `Failed to create booking: ${oppErr.message}` })

    // Send requested emails
    const emailsSent = []
    const emailErrors = []

    if ((sendDeliveryOrder || sendPaymentLink) && !contact.email) {
      emailErrors.push('Contact has no email on file — could not send the requested email(s).')
    } else {
      if (sendDeliveryOrder) {
        const email = buildEmail('delivery_order_request', { customerName: contact.full_name, bookingDetails: lineItemsSummary })
        try {
          await sendCustomerEmail({ orgId, to: contact.email, subject: email.subject, body: email.body, contactId: contact.id })
          emailsSent.push('delivery_order_request')
        } catch (e) {
          console.error('❌ Failed to send delivery order email:', e)
          emailErrors.push(`Delivery order email failed: ${e.message}`)
        }
      }
      if (sendPaymentLink) {
        const email = buildEmail('payment_link_request', { customerName: contact.full_name, bookingAmount: totalValue, bookingDetails: lineItemsSummary })
        try {
          await sendCustomerEmail({ orgId, to: contact.email, subject: email.subject, body: email.body, contactId: contact.id })
          emailsSent.push('payment_link_request')
        } catch (e) {
          console.error('❌ Failed to send payment link email:', e)
          emailErrors.push(`Payment link email failed: ${e.message}`)
        }
      }
    }

    return json(200, { contact, opportunity, emailsSent, emailErrors })
  } catch (e) {
    console.error('❌ create-booking error:', e)
    return json(500, { error: e.message })
  }
}
