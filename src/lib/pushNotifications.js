import { supabase, fetchMyOrgId } from './supabase'

// The VAPID public key -- baked in at build time (Vite only exposes
// VITE_-prefixed vars to the browser bundle), matching the private key
// held server-side in check-unfollowed-leads.js / _shared/webPush.js.
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

// The Push API wants the VAPID key as a raw Uint8Array, not the
// base64url string Netlify/env vars store it as.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && !!VAPID_PUBLIC_KEY
}

// Prompts for notification permission (if not already decided) and
// subscribes this browser/device to push, saving the subscription so
// check-unfollowed-leads.js (and any future new-lead push) can reach it.
// Throws if the user denies the browser permission prompt -- callers
// should catch and show that plainly rather than as a generic error.
export async function subscribeToPush() {
  if (!pushSupported()) throw new Error('Push notifications aren\'t supported in this browser.')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notification permission was not granted.')

  const registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }

  const json = subscription.toJSON()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in.')
  const orgId = await fetchMyOrgId()

  const { error } = await supabase.from('push_subscriptions').upsert({
    org_id: orgId, user_id: user.id, endpoint: json.endpoint,
    p256dh: json.keys.p256dh, auth: json.keys.auth,
  }, { onConflict: 'endpoint' })
  if (error) throw error

  return true
}

// Whether THIS browser/device already has an active push subscription --
// doesn't distinguish "never asked" from "denied," callers should also
// check Notification.permission for that if they need to explain why.
export async function isPushSubscribed() {
  if (!pushSupported()) return false
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  return !!subscription
}
