// Yeni sohbet mesajı / "Gidelim" oyu / uygulamaya giriş için diğer kişilere Web Push bildirimi gönderir.
// Gizli anahtar Netlify ortam değişkeninde: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
import webpush from 'web-push';

const DB = process.env.FIREBASE_DB_URL || 'https://travel-food-206c8-default-rtdb.asia-southeast1.firebasedatabase.app';
const SUBJECT = 'https://japan-food-98432b.netlify.app';
const FRESH_MS = 3 * 60 * 1000; // sadece son 3 dakikadaki kayıtlar için bildirim (sahte tetiklemeyi önler)

const idOf = n => 'n_' + String(n || '').toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]/g, '');
const seg = s => encodeURIComponent(String(s));
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const cut = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

async function dbGet(path) {
  const r = await (globalThis.__fetch || fetch)(`${DB}/${path}.json`);
  if (!r.ok) throw new Error('db ' + r.status);
  return r.json();
}
async function dbDelete(path) {
  try { await (globalThis.__fetch || fetch)(`${DB}/${path}.json`, { method: 'DELETE' }); } catch (_) {}
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return json({ error: 'VAPID keys missing' }, 500);
  let body;
  try { body = await req.json(); } catch (_) { return json({ error: 'bad json' }, 400); }
  const { kind, id, u } = body || {};
  if (!['msg', 'vote', 'test', 'online'].includes(kind) || typeof u !== 'string' || u.length > 60) return json({ error: 'bad request' }, 400);
  const now = Date.now();
  let payload, exclude = new Set(), only = null, allow = null;

  if (kind === 'msg') {
    const m = await dbGet(`chat/messages/${seg(id)}`);
    if (!m || typeof m.ts !== 'number' || now - m.ts > FRESH_MS) return json({ skipped: 'not found or old' });
    exclude = new Set([m.u, idOf(m.n)]);
    const text = m.p ? `📍 ${m.p.n}${m.t ? ' — ' + m.t : ''}` : m.t;
    payload = { title: cut(m.n, 40), body: cut(text, 160), tag: 'chat', url: './?v=chat' };
  } else if (kind === 'vote') {
    const v = await dbGet(`votes/${seg(id)}`);
    const by = v && v.by && v.by[u];
    if (!v || !v.p || !by || typeof by.ts !== 'number' || now - by.ts > FRESH_MS) return json({ skipped: 'not found or old' });
    exclude = new Set([u, idOf(by.n)]);
    payload = { title: 'Gidelim 👍', body: cut(`${by.n} gitmek istiyor: ${v.p.n}`, 160), tag: 'vote-' + id, url: './?v=votes' };
  } else if (kind === 'online') {
    // sadece "Biri uygulamaya girince" ayarını açmış ve süre eşiği aşılmış kişilere
    const p = await dbGet(`presence/${seg(u)}`);
    const c = p && p.conns && p.conns[id];
    if (!p || !c || typeof c.ts !== 'number' || now - c.ts > FRESH_MS || typeof p.gap !== 'number') return json({ skipped: 'not found or old' });
    const prefs = (await dbGet('prefs')) || {};
    allow = new Set(Object.entries(prefs).filter(([, x]) => x && typeof x.online === 'number' && x.online > 0 && p.gap >= x.online * 3600e3).map(([pid]) => pid));
    if (!allow.size) return json({ skipped: 'nobody subscribed' });
    exclude = new Set([u, idOf(p.n)]);
    payload = { title: 'Yemek JP', body: cut(`${p.n} uygulamaya girdi 👋`, 160), tag: 'online-' + u, url: './?v=chat' };
  } else {
    only = u;
    payload = { title: 'Yemek JP', body: 'Bildirimler çalışıyor 🎉', tag: 'test', url: './' };
  }

  const subs = (await dbGet('push')) || {};
  webpush.setVapidDetails(SUBJECT, pub, priv);
  const jobs = [];
  for (const [pid, devices] of Object.entries(subs)) {
    if (only ? pid !== only : exclude.has(pid)) continue;
    if (allow && !allow.has(pid)) continue;
    for (const [sk, rec] of Object.entries(devices || {})) {
      if (!rec || !rec.sub || !rec.sub.endpoint) continue;
      jobs.push(webpush.sendNotification(rec.sub, JSON.stringify(payload), { TTL: 6 * 3600, urgency: 'high' })
        .then(() => 'ok')
        .catch(err => { if (err.statusCode === 404 || err.statusCode === 410) dbDelete(`push/${seg(pid)}/${seg(sk)}`); return 'err ' + (err.statusCode || err.message); }));
    }
  }
  const results = await Promise.all(jobs);
  return json({ sent: results.filter(r => r === 'ok').length, failed: results.filter(r => r !== 'ok').length });
};
