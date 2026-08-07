import { admin } from './_shared/supabaseAdmin.js'

// Public, unauthenticated -- serves a published business card by slug, and
// logs the reciprocal "send your info" contact exchange as a new lead tied
// to that card's org. Resolves org_id dynamically from the card row, same
// white-label-ready pattern as public-landing-page.js and funnel-public.js.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json', ...cors }, body: JSON.stringify(body),
})

async function getCard(slug) {
  const { data, error } = await admin
    .from('business_cards')
    .select('*')
    .eq('slug', String(slug || '').trim())
    .maybeSingle()
  if (error) return { status: 500, body: { error: error.message } }
  if (!data || !data.is_published) return { status: 404, body: { error: 'This card is not available.' } }
  return { status: 200, body: { card: data } }
}

const EVENT_KINDS = new Set(['share', 'download', 'scan'])

async function logEvent(payload) {
  const { slug, kind } = payload
  if (!slug || !EVENT_KINDS.has(kind)) return { status: 400, body: { error: 'Invalid event' } }
  const { error } = await admin.rpc('increment_business_card_stat', { p_slug: String(slug).trim(), p_kind: kind })
  if (error) return { status: 500, body: { error: error.message } }
  return { status: 200, body: { ok: true } }
}

async function submitLead(payload) {
  const { slug, name, phone, email } = payload
  if (!slug || !name || !(phone || email)) return { status: 400, body: { error: 'Missing required fields.' } }

  const { data: card } = await admin
    .from('business_cards').select('org_id, full_name').eq('slug', String(slug).trim()).maybeSingle()
  if (!card) return { status: 404, body: { error: 'Card not found.' } }

  const { error } = await admin.from('contacts').insert({
    org_id: card.org_id,
    full_name: String(name).trim(),
    phone: phone ? String(phone).trim() : null,
    email: email ? String(email).trim().toLowerCase() : null,
    source: 'business_card',
    tags: ['business-card'],
    notes: card.full_name ? `Sent their info from ${card.full_name}'s digital business card.` : 'Sent their info from a digital business card.',
  })
  if (error) return { status: 500, body: { error: error.message } }

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
      const r = await getCard(payload.slug)
      return json(r.status, r.body)
    }
    if (action === 'submit_lead') {
      const r = await submitLead(payload)
      return json(r.status, r.body)
    }
    if (action === 'log_event') {
      const r = await logEvent(payload)
      return json(r.status, r.body)
    }
    return json(400, { error: 'Unknown action' })
  } catch (e) {
    return json(500, { error: String(e.message || e) })
  }
}
