import { admin } from './_shared/supabaseAdmin.js'

// Public, unauthenticated -- resolves a tracked link's real target URL and
// counts the click in the same call, atomically (increment_external_card_click).
// Used by the /go/:slug redirect page. Nothing here touches the external
// site the link points to.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json', ...cors }, body: JSON.stringify(body),
})

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors }
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const slug = String(payload.slug || '').trim()
  if (!slug) return json(400, { error: 'Missing slug' })

  try {
    const { data, error } = await admin
      .from('external_card_links').select('target_url, active').eq('slug', slug).maybeSingle()
    if (error) return json(500, { error: error.message })
    if (!data) return json(404, { error: 'This link is not set up.' })
    if (data.active === false) return json(410, { error: 'This card is no longer active.' })

    // Best-effort count -- a failed increment should never block the redirect,
    // but it must still be awaited: the function's execution context can be
    // frozen the instant the response is returned, so a fire-and-forget call
    // here could simply never run.
    try { await admin.rpc('increment_external_card_click', { p_slug: slug }) } catch { /* count is best-effort */ }

    return json(200, { target_url: data.target_url })
  } catch (e) {
    return json(500, { error: String(e.message || e) })
  }
}
