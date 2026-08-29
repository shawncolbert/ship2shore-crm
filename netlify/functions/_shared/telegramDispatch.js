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

// Netlify env var changes via the API don't retroactively update an
// already-warm function container's process.env -- only a fresh deploy
// (or a cold start) picks up a new value. TELEGRAM_GROUP_CHAT_ID was
// corrected twice via the API without a deploy in between, so warm
// containers kept sending to a stale chat_id even after the value looked
// right in Netlify's dashboard. Forcing a deploy here.
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

  // opportunities has two FKs into contacts (contact_id and
  // assigned_dispatcher_id) -- contacts(...) alone is an ambiguous embed
  // that Supabase rejects outright, which was silently emptying `opp` below
  // and killing every alert before it got anywhere near Telegram. The hint
  // must be the FK's actual constraint name -- opportunities_contact_id_fkey
  // -- matching what fetchDefaultPipeline (src/lib/supabase.js) already
  // uses successfully; a plain contacts!contact_id(...) hint (which is what
  // this said the first time) does not resolve the same way.
  const { data: opp, error: oppErr } = await admin
    .from('opportunities')
    .select('id, title, vehicle, vehicle_year, vehicle_make, vehicle_model, pickup_address, dropoff_address, scheduled_at, escort_fee, value, contacts!opportunities_contact_id_fkey(full_name, phone, email)')
    .eq('id', opportunityId).eq('org_id', orgId).maybeSingle()
  if (oppErr) return { sent: false, reason: `Lookup failed: ${oppErr.message}` }
  if (!opp) return { sent: false, reason: 'Lead not found' }

  const vehicleDesc = [opp.vehicle_year, opp.vehicle_make, opp.vehicle_model].filter(Boolean).join(' ') || opp.vehicle || 'Vehicle not specified'
  const customerName = opp.contacts?.full_name || 'Unknown'
  const phone = opp.contacts?.phone || ''

  // Flat-rate catalog leads (homepage popup, digital business card) already
  // know their price the instant the customer picks a service -- it's on
  // opp.value before this alert ever fires, so there's nothing to estimate.
  // Real transport leads (booking widget, transport landing pages, Calendly)
  // never carry a value this early, so they still run the mileage estimate
  // exactly as before.
  const isFlatRate = opp.value != null
  let quote = null
  if (!isFlatRate) {
    try {
      quote = await estimateLeadQuote({ pickupAddress: opp.pickup_address, dropoffAddress: opp.dropoff_address, scheduledAt: opp.scheduled_at })
    } catch {
      quote = null // best-effort -- the alert still goes out without a number
    }
  }

  // The auto-estimate is a starting point for whoever calls the customer,
  // never something quoted to the customer sight-unseen -- rural pickups,
  // a lifted truck, running condition, none of that is knowable from the
  // intake form alone. Nothing here goes out to the customer until a
  // dispatcher has actually talked to them and set a real price below.
  const lines = [
    '🚨 NEW DISPATCH LEAD',
    '',
    `Client: ${customerName}`,
    phone ? `Phone: ${phone}` : null,
    `Vehicle: ${vehicleDesc}`,
    // Flat-rate catalog leads only ever carry a pickup (the port, for an
    // escort/hotshot/etc.) -- "Route: X → TBD" reads like a transport job
    // that's missing its destination. Only show a Route line once there's
    // an actual dropoff to route to.
    opp.dropoff_address
      ? `Route: ${opp.pickup_address || 'TBD'} → ${opp.dropoff_address}`
      : opp.pickup_address ? `Location: ${opp.pickup_address}` : null,
    '',
    isFlatRate
      ? `💵 Flat rate: $${opp.value.toLocaleString()} — already set from the website request. Tap below only if it needs adjusting.`
      : quote
        ? `Transport starting-point estimate: $${quote.amount.toLocaleString()} (${quote.miles} mi${quote.note ? `, ${quote.note}` : ''}) — confirm with the customer before quoting, rural/lifted/running condition aren't factored in.`
        : 'Could not auto-estimate transport — open the job to price it manually.',
    // Flat port escort fee, entirely separate from the transport number above:
    // always $95, never has a deposit, and isn't touched by "Set price & deposit"
    // (that button only ever changes value/deposit_amount, i.e. transport).
    opp.escort_fee ? `Port escort fee: $${opp.escort_fee.toLocaleString()} — flat, due in full, no deposit.` : null,
    '',
    // Two separate services on the port-transport landing page -- not
    // everyone who wants a port escort also wants transport. Call first
    // and find out which. A flat-rate catalog lead never involves
    // transport at all unless the customer asks for it on the call, so
    // its wording doesn't mention transport up front either.
    opp.escort_fee
      ? 'Call the customer first — find out if they need transport too, or escort only — then tap the matching button below.'
      : isFlatRate
        ? 'Call the customer to confirm the job. Tap below only if the price needs adjusting.'
        : 'Call the customer first, then set the real transport price below.',
  ].filter(Boolean)

  // Telegram inline buttons only accept http(s)/tg:// URLs -- a tel: link
  // gets rejected by the API, and that rejection fails the WHOLE message,
  // not just that button (this is why alerts weren't showing up at all).
  // No real loss: the phone number in the text above is auto-linked to
  // tap-to-call by Telegram's own client on mobile.
  const buttons = [
    [{ text: isFlatRate ? '✏️ Adjust price' : '✏️ Set price & deposit (transport + escort)', callback_data: `sp:${opp.id}` }],
    // Only offered on port-escort leads -- some customers only want the
    // escort, not transport, and this skips the "reply with two numbers"
    // flow for that case: one tap sets transport to $0, leaving just the
    // $95 escort fee.
    opp.escort_fee ? [{ text: '🚷 Escort only — no transport', callback_data: `eo:${opp.id}` }] : null,
    [{ text: '🔗 Open in CRM', url: `${siteOrigin()}/pipeline?job=${opp.id}` }],
  ].filter(Boolean)

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: lines.join('\n'), reply_markup: { inline_keyboard: buttons } }),
  })
  if (!res.ok) return { sent: false, reason: await res.text() }
  return { sent: true }
}

// Posted by tracking-arrive.js when a driver taps "I've arrived" on their
// tracking page -- same best-effort, silently-no-ops-if-unconfigured shape
// as the lead alert above. No buttons needed, this is just a status ping.
export async function sendTelegramArrivalAlert({ orgId, opportunityId, stage }) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_GROUP_CHAT_ID
  if (!token || !chatId) return { sent: false, reason: 'Telegram not configured' }

  const { data: opp, error: oppErr } = await admin
    .from('opportunities')
    .select('id, title, vehicle, vehicle_year, vehicle_make, vehicle_model, contacts!opportunities_contact_id_fkey(full_name)')
    .eq('id', opportunityId).eq('org_id', orgId).maybeSingle()
  if (oppErr || !opp) return { sent: false, reason: oppErr?.message || 'Job not found' }

  const vehicleDesc = [opp.vehicle_year, opp.vehicle_make, opp.vehicle_model].filter(Boolean).join(' ') || opp.vehicle || opp.title || 'Job'
  const customerName = opp.contacts?.full_name || 'Unknown'
  const label = stage === 'dropoff' ? '📦 Driver arrived at DROP-OFF' : '🚗 Driver arrived at PICKUP'

  const text = [label, '', `Client: ${customerName}`, `Vehicle: ${vehicleDesc}`, `🔗 ${siteOrigin()}/pipeline?job=${opp.id}`].join('\n')

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
  if (!res.ok) return { sent: false, reason: await res.text() }
  return { sent: true }
}
