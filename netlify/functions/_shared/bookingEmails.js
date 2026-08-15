// Shared "delivery order request" / "payment link request" email template --
// used by both the booking-sidebar's direct create-booking flow and the AI
// assistant's send_email tool, so the two paths can't drift out of sync (and
// can't quietly re-introduce a hardcoded org name in one of them again).
export function buildBookingEmail(messageType, { customerName, bookingAmount, bookingDetails, orgName }) {
  const brand = orgName || 'Dispatch'
  if (messageType === 'delivery_order_request') {
    return {
      subject: `${brand} - Delivery Order Needed`,
      body: `Hi ${customerName},

We're ready to proceed with your booking!

To complete your reservation, please provide:
- Proof of Authorization (POA)
- Delivery order details
- Estimated delivery date/time

${bookingDetails ? `Booking Details:\n${bookingDetails}\n\n` : ''}Please reply with the required information so we can finalize your shipment.

Best regards,
${brand}`,
    }
  }

  if (messageType === 'payment_link_request') {
    return {
      subject: `${brand} - Payment Required`,
      body: `Hi ${customerName},

Your vehicle is now cleared and ready to ship!

Booking Amount: $${bookingAmount}

${bookingDetails ? `Booking Details:\n${bookingDetails}\n\n` : ''}Please proceed with payment to secure your shipment. A payment link has been attached.

Thank you,
${brand}`,
    }
  }

  return null
}
