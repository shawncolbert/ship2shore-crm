import webpush from 'web-push'
import { admin } from './supabaseAdmin.js'

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY
const VAPID_SUBJECT = process.env.VAPID_SUBJECT

let configured = false
function ensureConfigured() {
  if (configured) return true
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) return false
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  configured = true
  return true
}

// Pushes to every device a given app user (profiles.id, not a dispatcher
// contact) has enabled notifications on -- a phone and a laptop both get
// it. Best-effort per-subscription: one dead device (410 Gone, the
// standard "unsubscribed" response) is pruned and doesn't stop delivery to
// the rest. Silently no-ops if VAPID isn't configured or the user has no
// subscriptions, same "never block the caller" shape as sendTelegramLeadAlert.
export async function sendPushToUser({ userId, title, body, url }) {
  if (!ensureConfigured()) return { sent: 0, reason: 'Push not configured' }

  const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', userId)
  if (!subs?.length) return { sent: 0, reason: 'No subscriptions' }

  const payload = JSON.stringify({ title, body, url })
  let sent = 0
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      )
      sent++
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        await admin.from('push_subscriptions').delete().eq('id', sub.id)
      } else {
        console.error('❌ web push failed:', e.statusCode, e.message)
      }
    }
  }
  return { sent }
}

// Pushes to every user with an 'owner' membership on the org -- how Shawn
// gets notified about something regardless of which specific device he's
// on, without the sender needing to know his profile id up front.
export async function sendPushToOrgOwners({ orgId, title, body, url }) {
  const { data: owners } = await admin.from('memberships').select('profile_id').eq('org_id', orgId).eq('role', 'owner')
  if (!owners?.length) return { sent: 0, reason: 'No owners' }
  let sent = 0
  for (const { profile_id } of owners) {
    const result = await sendPushToUser({ userId: profile_id, title, body, url })
    sent += result.sent || 0
  }
  return { sent }
}
