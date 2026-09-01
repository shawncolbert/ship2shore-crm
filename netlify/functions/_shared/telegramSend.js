import { admin } from './supabaseAdmin.js'
import { sendPushToOrgOwners } from './webPush.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Per-2026-09-01 audit: the bot token and fallback group chat used to be
// single global Netlify env vars shared by every org in this database. Any
// org's public lead form could generate a lead that fell back to
// Ship2Shore's own bot/group -- a real cross-tenant leak the moment a
// second org goes live with its own public booking page. Each org now owns
// its own row here (Settings > Dispatch Assignment); a org with nothing
// configured gets "Telegram not configured" for THAT org, never another
// org's bot. This also sidesteps the old stale-env-var-in-a-warm-container
// problem noted below, since a DB read is always current.
export async function getOrgTelegramConfig(orgId) {
  const { data } = await admin
    .from('organizations').select('telegram_bot_token, telegram_group_chat_id').eq('id', orgId).maybeSingle()
  return { token: data?.telegram_bot_token || null, groupChatId: data?.telegram_group_chat_id || null }
}

// Every outbound Telegram send in the app should go through this instead
// of calling fetch(...api.telegram.org...) directly -- per the 2026-08-30
// audit (confirmed independently by two reviews), a failed send was only
// ever a console.error nobody reads, so an expired bot token or a Telegram
// outage could go unnoticed indefinitely. One retry after a short delay
// absorbs a one-off blip without paging anyone; only a failure that
// survives the retry gets logged and pushed.
export async function sendTelegramMessage({ orgId, chatId, text, context, replyMarkup }) {
  const { token } = await getOrgTelegramConfig(orgId)
  if (!token || !chatId) return { sent: false, reason: 'Telegram not configured' }

  const attempt = () =>
    fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
    })

  let res, lastError
  try {
    res = await attempt()
    if (res.ok) return { sent: true }
    lastError = `HTTP ${res.status}: ${await res.text().catch(() => '')}`
  } catch (e) {
    lastError = e.message
  }

  // One retry, short delay -- catches a transient blip without doubling
  // latency on every single failure case.
  await sleep(1500)
  try {
    res = await attempt()
    if (res.ok) return { sent: true }
    lastError = `HTTP ${res.status}: ${await res.text().catch(() => '')}`
  } catch (e) {
    lastError = e.message
  }

  // Both attempts failed -- this is the part that used to just be a
  // console.error. Log it, then push straight to the org owner's phone so
  // a dead bot token or a Telegram outage gets noticed the same day, not
  // whenever someone happens to go looking.
  try {
    await admin.from('telegram_send_failures').insert({ org_id: orgId, context: context || 'unknown', error: lastError })
  } catch (e) {
    console.error('❌ could not log telegram_send_failures:', e)
  }
  try {
    await sendPushToOrgOwners({
      orgId,
      title: '⚠️ Telegram alert failed to send',
      body: `${context || 'A Telegram message'} could not be delivered — check the CRM for this lead directly.`,
      url: '/dashboard',
    })
  } catch (e) {
    console.error('❌ could not push telegram-failure alert:', e)
  }

  return { sent: false, reason: lastError }
}
