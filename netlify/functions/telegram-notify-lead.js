import { sendTelegramLeadAlert } from './_shared/telegramDispatch.js'

// Small internal trigger so non-Node lead sources (the Calendly webhook,
// which runs as a Supabase/Deno Edge Function and can't import the Node
// code in _shared/telegramDispatch.js directly) can still fire the same
// Telegram alert as public-landing-page.js and public-booking.js, without
// duplicating the pricing/geocoding logic in a second runtime.
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' }

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return { statusCode: 400, body: 'Bad JSON' } }
  const { orgId, opportunityId } = body
  if (!orgId || !opportunityId) return { statusCode: 400, body: 'orgId and opportunityId required' }

  try {
    await sendTelegramLeadAlert({ orgId, opportunityId })
  } catch (e) {
    console.error('❌ sendTelegramLeadAlert (via telegram-notify-lead) failed:', e)
  }
  return { statusCode: 200, body: 'ok' }
}
