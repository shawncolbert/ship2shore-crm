import { admin } from './_shared/supabaseAdmin.js'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json', ...cors }, body: JSON.stringify(body),
})

// Public, unauthenticated -- the driver-facing side of "Ask driver for
// quote" (Pipeline.jsx / create-carrier-quote.js). Deliberately never
// returns system_estimate to the driver: showing them the CRM's own
// mileage-based number would anchor their price instead of getting an
// independent one to compare against.
async function getQuoteRequest(token) {
  const { data, error } = await admin
    .from('carrier_quote_requests')
    .select('pickup_address, dropoff_address, miles, status, org_id, organizations(name)')
    .eq('token', String(token || '').trim()).maybeSingle()
  if (error) return { status: 500, body: { error: error.message } }
  if (!data) return { status: 404, body: { error: 'Quote request not found.' } }
  return {
    status: 200,
    body: {
      pickupAddress: data.pickup_address, dropoffAddress: data.dropoff_address,
      miles: data.miles, status: data.status, orgName: data.organizations?.name || 'our team',
    },
  }
}

// Sends the driver's quote straight to the org owner's Telegram (their own
// private chat if linked, else the shared group -- same fallback
// sendTelegramLeadAlert uses) with a comparison against the system's own
// estimate, so Shawn can see at a glance whether this driver is above or
// below what the mileage formula guessed -- without the driver ever having
// seen that number themselves.
async function notifyOwnerOfQuote(request) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const groupChatId = process.env.TELEGRAM_GROUP_CHAT_ID
  if (!token || !groupChatId) return

  const { data: org } = await admin
    .from('organizations').select('owner_dispatcher_contact_id').eq('id', request.org_id).maybeSingle()
  let chatId = groupChatId
  if (org?.owner_dispatcher_contact_id) {
    const { data: owner } = await admin
      .from('contacts').select('telegram_chat_id').eq('id', org.owner_dispatcher_contact_id).maybeSingle()
    if (owner?.telegram_chat_id) chatId = owner.telegram_chat_id
  }

  const est = request.system_estimate != null ? Number(request.system_estimate) : null
  const quoted = Number(request.quoted_amount)
  const diffLine = est != null
    ? (quoted > est
        ? `$${(quoted - est).toLocaleString()} more than the system estimate ($${est.toLocaleString()}).`
        : quoted < est
          ? `$${(est - quoted).toLocaleString()} less than the system estimate ($${est.toLocaleString()}).`
          : `Matches the system estimate exactly ($${est.toLocaleString()}).`)
    : 'No system estimate was available to compare against.'

  const lines = [
    '🚚 DRIVER QUOTE RECEIVED',
    '',
    `Driver: ${request.driver_name || 'Unknown'}${request.driver_phone ? ` — ${request.driver_phone}` : ''}`,
    `Route: ${request.pickup_address} → ${request.dropoff_address}`,
    request.miles ? `${Math.round(request.miles)} mi` : null,
    '',
    `💵 Quoted: $${quoted.toLocaleString()}`,
    diffLine,
  ].filter(Boolean)

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: lines.join('\n') }),
  })
}

async function submitQuote(payload) {
  const { token, driver_name, driver_phone, quoted_amount } = payload
  const amount = Number(quoted_amount)
  if (!token || !driver_name || !Number.isFinite(amount) || amount <= 0) {
    return { status: 400, body: { error: 'Name and a valid quote amount are required.' } }
  }

  const { data: request, error: fetchErr } = await admin
    .from('carrier_quote_requests').select('*').eq('token', String(token).trim()).maybeSingle()
  if (fetchErr || !request) return { status: 404, body: { error: 'Quote request not found.' } }

  // Matches the driver's phone to a saved contact (e.g. a regular driver
  // like "Samor Ali") so this quote shows up on their contact page instead
  // of only ever existing as a Telegram message that scrolls away. Last-10-
  // digit comparison, not an exact string match -- phones on file are a mix
  // of "+16305204242" and "+1 509-221-9979" formatting, and a plain .eq()
  // would silently miss most of them.
  let contactId = null
  const cleanPhone = driver_phone ? String(driver_phone).replace(/\D/g, '').slice(-10) : null
  if (cleanPhone) {
    const { data: candidates } = await admin.from('contacts').select('id, phone').eq('org_id', request.org_id).not('phone', 'is', null)
    const match = (candidates || []).find((c) => String(c.phone).replace(/\D/g, '').slice(-10) === cleanPhone)
    if (match) contactId = match.id
  }

  const { error: updErr } = await admin
    .from('carrier_quote_requests')
    .update({
      status: 'quoted', quoted_at: new Date().toISOString(),
      driver_name: String(driver_name).trim(),
      driver_phone: driver_phone ? String(driver_phone).trim() : null,
      quoted_amount: amount,
      contact_id: contactId,
    })
    .eq('token', request.token)
  if (updErr) return { status: 500, body: { error: updErr.message } }

  try {
    await notifyOwnerOfQuote({ ...request, driver_name, driver_phone, quoted_amount: amount })
  } catch (e) {
    console.error('❌ notifyOwnerOfQuote failed:', e)
  }

  return { status: 200, body: { ok: true } }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors }
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { action } = payload

  try {
    if (action === 'get') {
      const r = await getQuoteRequest(payload.token)
      return json(r.status, r.body)
    }
    if (action === 'submit') {
      const r = await submitQuote(payload)
      return json(r.status, r.body)
    }
    return json(400, { error: 'Unknown action' })
  } catch (e) {
    return json(500, { error: String(e.message || e) })
  }
}
