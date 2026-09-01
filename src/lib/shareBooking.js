// Builds a plain-text booking summary and hands it off to the device's own
// share sheet or Messages app -- exactly the same "Share This Card" pattern
// already used on the digital business cards (BusinessCardView.jsx): no
// server-side SMS, no provider, no A2P/toll-free registration needed, since
// the message is sent from the dispatcher's own phone number.

// Skips any field that's empty/null rather than printing "Vehicle: undefined"
// or a blank "Pickup: " line.
export function buildBookingSummary({
  customerName, customerPhone, bookingNumber, pickupAddress, dropoffAddress,
  vehicleYear, vehicleMake, vehicleModel, vehicleVin, photoUrl,
  serviceLabel, notes, detailUrl,
}) {
  const lines = [`🚘 New booking${customerName ? ` — ${customerName}` : ''}`]
  if (bookingNumber) lines.push(`# ${bookingNumber}`)
  if (customerPhone) lines.push(`📞 ${customerPhone}`)
  if (pickupAddress) lines.push(`📦 Pickup: ${pickupAddress}`)
  if (dropoffAddress) lines.push(`🏁 Drop-off: ${dropoffAddress}`)
  // One link, not four -- current location -> pickup -> drop-off as a
  // single multi-stop Google Maps route (leaving origin blank makes the
  // link start from wherever it's opened, and "waypoints" adds the pickup
  // as a stop before the final destination). Google's link works on any
  // phone -- opens the app if installed, falls back to the web map
  // otherwise -- so this replaces the old four-link Google+Apple,
  // two-separate-legs block that made the text unreadably long. Built
  // fresh from whatever pickup/dropoff is passed in here, so re-sharing
  // after correcting an address links to the corrected route, not the
  // original one.
  if (pickupAddress) {
    const routeUrl = dropoffAddress
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dropoffAddress)}&waypoints=${encodeURIComponent(pickupAddress)}`
      : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(pickupAddress)}`
    lines.push(`🗺️ Route: ${routeUrl}`)
  }

  const vehicleWords = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(' ')
  const vehicleLine = [vehicleWords, vehicleVin ? `VIN ${vehicleVin}` : ''].filter(Boolean).join(', ')
  if (vehicleLine) lines.push(`🚗 ${vehicleLine}`)

  if (serviceLabel) lines.push(`Service: ${serviceLabel}`)
  if (notes) lines.push(`📝 ${notes}`)
  if (photoUrl) lines.push(`📷 Photo: ${photoUrl}`)
  if (detailUrl) lines.push(`🔗 Full details: ${detailUrl}`)

  return lines.join('\n')
}

// "Ask driver for quote" -- for any driver, saved contact or not, since
// this is just a text with a link, not tied to a CRM record on their end.
export function buildCarrierQuoteAsk({ pickupAddress, dropoffAddress, url }) {
  return [
    '🚚 Quick job — need a quote',
    '',
    `📍 Pickup: ${pickupAddress}`,
    `🏁 Drop-off: ${dropoffAddress}`,
    '',
    `What would you charge to run this? Quote it here: ${url}`,
  ].join('\n')
}

// Desktop fallback for the buttons below -- navigator.share is mobile-only
// and the sms: link silently does nothing on a Mac/PC unless Messages'
// Continuity handoff happens to be set up, so "Text route" can look broken
// from a desktop browser with no error at all. This copies the same
// message text to the clipboard so it can be pasted into iMessage,
// WhatsApp, email, whatever's actually open.
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)

// When the recipient's phone number is already known (e.g. "Text route" to
// the assigned driver), this goes straight to a pre-addressed sms: link --
// skipping the OS share sheet entirely, since a share sheet has to fetch
// link previews for every URL in the message (route link, tracking link,
// vehicle photo) before it'll even open. Per a 2026-09-01 report, that
// preview-fetching step can hang the whole page for a stretch on a slow
// connection with no error and no way out. Going straight to Messages,
// already addressed to the right person, is also just a better flow than
// making a dispatcher pick a target from a generic share sheet when the
// CRM already knows exactly who this is going to.
//
// Only "Text to another driver (not in system)" -- no known number -- still
// uses navigator.share, since there's no address to go straight to.
export async function shareBooking({ summaryText, recipientPhone, title = 'Booking Details' }) {
  const body = encodeURIComponent(summaryText)

  if (!recipientPhone && navigator.share) {
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
  const phone = recipientPhone ? String(recipientPhone).replace(/[^\d+]/g, '') : ''
  window.location.href = isIOS() ? `sms:${phone}&body=${body}` : `sms:${phone}?body=${body}`
  return true
}
