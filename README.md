# Japonya Yemek Listesi

Netlify'da yayınlanan PWA (`site/`) ve bildirim fonksiyonu (`netlify/functions/notify.mjs`).

- Site: statik, tek dosya (`site/index.html`) + service worker (`site/sw.js`).
- Sohbet, hesap ve oylar Firebase Realtime Database'de tutulur.
- Bildirimler Web Push ile gönderilir. Netlify ortam değişkenleri gerekir:
  `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`.
