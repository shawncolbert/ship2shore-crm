import { precacheAndRoute } from 'workbox-precaching'

// The app shell only -- Netlify functions and Supabase calls are never
// precached or served from cache, so dispatch data is always live. This is
// the same "no stale dispatch data" rule the earlier generateSW config had
// (navigateFallbackDenylist), just expressed by omission here: we simply
// never add a runtime caching route for anything but these precached files.
precacheAndRoute(self.__WB_MANIFEST)

self.skipWaiting()
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// A lead notification (new-lead-for-you, or "this one's gone unanswered")
// pushed from check-unfollowed-leads.js or a future new-lead push. Payload
// is JSON: { title, body, url }. `url` is where tapping the notification
// should land -- usually the Pipeline board focused on that job.
self.addEventListener('push', (event) => {
  let payload = {}
  try { payload = event.data ? event.data.json() : {} } catch { payload = {} }
  const title = payload.title || 'New notification'
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: payload.url || '/pipeline' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

// Focuses an already-open tab instead of opening a duplicate one, when
// possible -- same "don't spawn extra windows" behavior people expect from
// a real app's notifications.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/pipeline'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    })
  )
})
