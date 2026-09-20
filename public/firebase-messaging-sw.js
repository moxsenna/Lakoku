/* Lakoku — service worker push web (FCM).
 *
 * Mengambil konfigurasi publik dari /api/push/web-config. Bila endpoint 503
 * (Firebase belum dikonfigurasi), worker ini diam — tidak error, tidak retry.
 * Klik notifikasi membuka tautan dalam payload (deep_link) atau beranda.
 */
/* global importScripts, firebase, self */
importScripts(
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js',
)

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link =
    (event.notification && event.notification.data && event.notification.data.link) || '/'
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(link)
            return client.focus()
          }
        }
        return self.clients.openWindow(link)
      }),
  )
})

fetch('/api/push/web-config')
  .then((res) => (res.ok ? res.json() : null))
  .then((webConfig) => {
    if (!webConfig || !webConfig.ok) return
    firebase.initializeApp(webConfig.config)
    const messaging = firebase.messaging()
    messaging.onBackgroundMessage((payload) => {
      const title =
        (payload.notification && payload.notification.title) || 'Lakoku'
      const body =
        (payload.notification && payload.notification.body) ||
        'Ada kabar baru untukmu.'
      const link = (payload.data && payload.data.deep_link) || '/'
      self.registration.showNotification(title, {
        body,
        icon: '/icon.png',
        badge: '/icon.png',
        data: { link },
      })
    })
  })
  .catch(() => undefined)
