// Builds a plain-text booking summary and hands it off to the device's own
// share sheet or Messages app -- exactly the same "Share This Card" pattern
// already used on the digital business cards (BusinessCardView.jsx): no
// server-side SMS, no provider, no A2P/toll-free registration needed, since
// the message is sent from the dispatcher's own phone number.

// Skips any field that's empty/null rather than printing "Vehicle: undefined"
// or a blank "Pickup: " line.
export function buildBookingSummary({
  customerName, pickupAddress, dropoffAddress,
  vehicleYear, vehicleMake, vehicleModel, vehicleVin,
  serviceLabel, notes, detailUrl,
}) {
  const lines = [`New booking${customerName ? ` — ${customerName}` : ''}`]
  if (pickupAddress) lines.push(`Pickup: ${pickupAddress}`)
  if (dropoffAddress) lines.push(`Drop-off: ${dropoffAddress}`)

  const vehicleWords = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(' ')
  const vehicleLine = [vehicleWords, vehicleVin ? `VIN ${vehicleVin}` : ''].filter(Boolean).join(', ')
  if (vehicleLine) lines.push(`Vehicle: ${vehicleLine}`)

  if (serviceLabel) lines.push(`Service: ${serviceLabel}`)
  if (notes) lines.push(`Notes: ${notes}`)
  if (detailUrl) lines.push(`Full details: ${detailUrl}`)

  return lines.join('\n')
}

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)

// Tries the native share sheet first (Messages, WhatsApp, email, etc., same
// as the card share buttons); falls back to a plain sms: link pre-filled
// with the message body (and the recipient, if their number is known) when
// navigator.share isn't available. Returns false only when the person
// cancelled the native share sheet -- the caller has nothing to do either way.
export async function shareBooking({ summaryText, recipientPhone, title = 'Booking Details' }) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text: summaryText })
      return true
    } catch (err) {
      if (err?.name === 'AbortError') return false
      // Any other failure (e.g. share API present but rejected the payload)
      // falls through to the sms: link below instead of leaving the
      // dispatcher with no way to send the message at all.
    }
  }
  const body = encodeURIComponent(summaryText)
  const phone = recipientPhone ? String(recipientPhone).replace(/[^\d+]/g, '') : ''
  window.location.href = isIOS() ? `sms:${phone}&body=${body}` : `sms:${phone}?body=${body}`
  return true
}
