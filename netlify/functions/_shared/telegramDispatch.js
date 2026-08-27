import { admin } from './supabaseAdmin.js'
import { calculateGeneralQuote, caPortBracket, isCaPortRoute, seasonFor } from './pricingFormula.js'

// Posts a new-lead alert into the team's Telegram group with a one-tap
// "Send Quote" action, so the team doesn't have to be staring at the CRM to
// catch a fresh lead. Silently no-ops when the org hasn't set up Telegram
// (TELEGRAM_BOT_TOKEN/TELEGRAM_GROUP_CHAT_ID unset) -- same "best-effort,
// never blocks lead creation" shape as autoAssignDispatcher.
//
// Deliberately plain text, no parse_mode -- Telegram's Markdown parser
// rejects the entire message if a customer's name/address/vehicle happens
// to contain an unescaped *, _, [, or a few other characters, which would
// silently swallow a real lead alert. Not worth the risk for a bit of bold text.

function siteOrigin() {
  return process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://dispatch.ship2shorebooking.com'
}

async function mapboxGeocodeOne(address, token) {
  if (!token || !address?.trim()) return null
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${token}&autocomplete=false&country=us&types=address,place&limit=1`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = await res.json()
  return data.features?.[0]?.center || null // [lng, lat]
}

async function mapboxDrivingMiles(from, to, token) {
  if (!token || !from || !to) return null
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${from[0]},${from[1]};${to[0]},${to[1]}?access_token=${token}&overview=false`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = await res.json()
  const meters = data.routes?.[0]?.distance
  return typeof meters === 'number' ? meters / 1609.344 : null
}

// Best-effort automatic quote for a brand-new lead -- vehicle type,
// rural level, and enclosed/open are all human judgment calls a dispatcher
// makes in the CRM's own Price estimator (see PriceEstimator.jsx), so this
// assumes the common case (Sedan, no rural surcharge, open transport) and
// leaves room for a dispatcher to correct it before it's actually quoted.
export async function estimateLeadQuote({ pickupAddress, dropoffAddress, scheduledAt }) {
  const token = process.env.VITE_MAPBOX_TOKEN
  if (!pickupAddress?.trim() || !dropoffAddress?.trim()) return null

  const [from, to] = await Promise.all([
    mapboxGeocodeOne(pickupAddress, token),
    mapboxGeocodeOne(dropoffAddress, token),
  ])
  if (!from || !to) return null
  const miles = await mapboxDrivingMiles(from, to, token)
  if (miles == null) return null

  if (isCaPortRoute(pickupAddress) && miles <= 300) {
    const bracket = caPortBracket(miles)
    if (bracket) return { amount: bracket.quoteLow, miles: Math.round(miles), note: 'CA port local rate (low)' }
  }

  const season = seasonFor(scheduledAt ? new Date(scheduledAt) : new Date())
  const amount = calculateGeneralQuote({ miles, vehicleType: 'Sedan', season, ruralLevel: 'none', transportMode: 'open' })
  return { amount, miles: Math.round(miles), note: null }
}

export async function sendTelegramLeadAlert({ orgId, opportunityId }) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_GROUP_CHAT_ID
  if (!token || !chatId) return { sent: false, reason: 'Telegram not configured' }

  const { data: opp } = await admin
    .from('opportunities')
    .select('id, title, vehicle, vehicle_year, vehicle_make, vehicle_model, pickup_address, dropoff_address, scheduled_at, contacts(full_name, phone, email)')
    .eq('id', opportunityId).eq('org_id', orgId).maybeSingle()
  if (!opp) return { sent: false, reason: 'Lead not found' }

  const vehicleDesc = [opp.vehicle_year, opp.vehicle_make, opp.vehicle_model].filter(Boolean).join(' ') || opp.vehicle || 'Vehicle not specified'
  const customerName = opp.contacts?.full_name || 'Unknown'
  const phone = opp.contacts?.phone || ''

  let quote = null
  try {
    quote = await estimateLeadQuote({ pickupAddress: opp.pickup_address, dropoffAddress: opp.dropoff_address, scheduledAt: opp.scheduled_at })
  } catch {
    quote = null // best-effort -- the alert still goes out without a number
  }

  const lines = [
    '🚨 NEW DISPATCH LEAD',
    '',
    `Client: ${customerName}`,
    phone ? `Phone: ${phone}` : null,
    `Vehicle: ${vehicleDesc}`,
    (opp.pickup_address || opp.dropoff_address) ? `Route: ${opp.pickup_address || 'TBD'} → ${opp.dropoff_address || 'TBD'}` : null,
    '',
    quote ? `Auto-calculated quote: $${quote.amount.toLocaleString()} (${quote.miles} mi${quote.note ? `, ${quote.note}` : ''})` : 'Could not auto-calculate a quote — open the job to price it manually.',
  ].filter(Boolean)

  // Telegram inline buttons only accept http(s)/tg:// URLs -- a tel: link
  // gets rejected by the API, and that rejection fails the WHOLE message,
  // not just that button (this is why alerts weren't showing up at all).
  // No real loss: the phone number in the text above is auto-linked to
  // tap-to-call by Telegram's own client on mobile.
  const buttons = []
  if (quote) {
    buttons.push([{ text: `✅ Send quote — $${quote.amount.toLocaleString()}`, callback_data: `sq:${opp.id}` }])
  }
  buttons.push([{ text: '🔗 Open in CRM', url: `${siteOrigin()}/pipeline?job=${opp.id}` }])

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: lines.join('\n'), reply_markup: { inline_keyboard: buttons } }),
  })
  if (!res.ok) return { sent: false, reason: await res.text() }
  return { sent: true }
}
