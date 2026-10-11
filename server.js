// Anubhab Modz key server - zero dependencies (Node 18+). Render: Build "echo ok", Start "node server.js"
// Keys + update popup are saved ONLY in Firebase Realtime Database (REST API). No local files.
// ENV: ADMIN_PASS (admin password), FIREBASE_DB_URL (optional override), FIREBASE_SECRET (optional)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const FB = (process.env.FIREBASE_DB_URL || 'https://admin-7eca6-default-rtdb.firebaseio.com')
  .trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');
const FB_SECRET = process.env.FIREBASE_SECRET || '';
const DAY = 24 * 60 * 60 * 1000;
const MAX_DEVICES = 1000;
const WORDS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const store = { persistent: true, error: '', loaded: false, db: FB.replace(/^https?:\/\//, '') };
let keys = {};   // cache of Firebase /keys  ->  KEY: { created, activatedAt, exp, devices: { id: 1 } }
let update = {
  enabled: false,
  title: 'Update Available',
  message: 'A new update is available. Tap UPDATE to open our WhatsApp channel.',
  link: 'https://whatsapp.com/channel/0029Vb7xr5tBVJl3HJkMri3P'
};

// ---- Firebase REST API ----
async function fb(p, method, data) {
  const r = await fetch(FB + p + '.json' + (FB_SECRET ? '?auth=' + encodeURIComponent(FB_SECRET) : ''), {
    method: method || 'GET',
    body: data === undefined ? undefined : JSON.stringify(data)
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
  store.error = '';
  return j;
}
// background write: never blocks login, error is shown in admin panel
function fbq(p, method, data) {
  fb(p, method, data).catch(e => { store.error = 'Save failed: ' + e.message; console.error('fb write failed', p, e.message); });
}
async function load() {
  try {
    const k = (await fb('/keys')) || {};
    for (const v of Object.values(k)) {
      if (Array.isArray(v.devices)) v.devices = Object.fromEntries(v.devices.filter(Boolean).map(d => [String(d).replace(/[.$#\[\]\/]/g, '_'), 1]));
      if (!v.devices) v.devices = {};
    }
    keys = k;
    const u = await fb('/update');
    if (u) update = { ...update, ...u };
    store.loaded = true;
    store.error = '';
  } catch (e) { store.error = 'Load failed: ' + e.message; console.error('load failed', e.message); }
}
async function ensureLoaded() { if (!store.loaded) await load(); }

// ---- helpers ----
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type,x-admin-pass',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS'
};
function send(res, code, obj, type) {
  res.writeHead(code, { ...CORS, 'Content-Type': type || 'application/json' });
  res.end(type ? obj : JSON.stringify(obj));
}
function body(req) {
  return new Promise(r => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 1e5) req.destroy(); });
    req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch { r({}); } });
  });
}
function isAdmin(req) {
  const a = Buffer.from(String(req.headers['x-admin-pass'] || ''));
  const b = Buffer.from(ADMIN_PASS);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function randWord(n) { let r = ''; const b = crypto.randomBytes(n); for (let i = 0; i < n; i++) r += WORDS[b[i] % WORDS.length]; return r; }
const devCount = k => Object.keys(k.devices || {}).length;

http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

    if (req.method === 'GET' && (url === '/admin' || url === '/admin.html')) {
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'public', 'admin.html'), 'utf8'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url === '/') return send(res, 200, 'Anubhab Modz API online - v3 (Firebase only)', 'text/plain');

    await ensureLoaded();

    // ---- App API ----
    if (req.method === 'POST' && url === '/api/verify') {
      if (!store.loaded) return send(res, 503, { ok: false, msg: 'Server database not ready, try again' });
      const b = await body(req);
      const key = String(b.key || '').trim().toUpperCase();
      const dev = String(b.device || '').slice(0, 100).replace(/[.$#\[\]\/]/g, '_');
      const k = keys[key];
      if (!k) return send(res, 401, { ok: false, msg: 'Wrong key' });
      if (!k.devices) k.devices = {};
      if (!k.activatedAt) {                       // 1 day starts at first login
        k.activatedAt = Date.now();
        k.exp = k.activatedAt + DAY;
        fbq('/keys/' + key, 'PATCH', { activatedAt: k.activatedAt, exp: k.exp });
      }
      if (Date.now() >= k.exp) return send(res, 403, { ok: false, msg: 'Key expired' });
      if (dev && !k.devices[dev]) {
        if (devCount(k) >= MAX_DEVICES) return send(res, 403, { ok: false, msg: 'Device limit reached' });
        k.devices[dev] = 1;
        fbq('/keys/' + key + '/devices/' + dev, 'PUT', 1);
      }
      return send(res, 200, { ok: true, exp: k.exp });
    }
    if (req.method === 'GET' && url === '/api/config') return send(res, 200, { ok: true, ...update });

    // ---- Admin API ----
    if (url.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return send(res, 401, { ok: false, msg: 'Wrong admin password' });

      if (req.method === 'GET' && url === '/api/admin/status') return send(res, 200, { ok: true, ...store });

      if (req.method === 'POST' && url === '/api/admin/generate') {
        if (!store.loaded) return send(res, 503, { ok: false, msg: 'Firebase not connected: ' + store.error });
        let key;
        do { key = 'ANUBHAB-MODZ-' + randWord(8); } while (keys[key]);
        const obj = { created: Date.now(), activatedAt: 0, exp: 0 };   // 1 day, up to 1000 devices
        try { await fb('/keys/' + key, 'PUT', obj); }
        catch (e) { store.error = 'Save failed: ' + e.message; return send(res, 500, { ok: false, msg: 'Firebase save failed: ' + e.message }); }
        keys[key] = { ...obj, devices: {} };
        return send(res, 200, { ok: true, key });
      }
      if (req.method === 'GET' && url === '/api/admin/keys') {
        const list = Object.entries(keys).map(([key, v]) => ({ key, created: v.created, activatedAt: v.activatedAt, exp: v.exp, devices: devCount(v), max: MAX_DEVICES })).sort((a, b) => b.created - a.created);
        return send(res, 200, { ok: true, keys: list });
      }
      if (req.method === 'DELETE' && url.startsWith('/api/admin/keys/')) {
        const key = decodeURIComponent(url.split('/').pop()).toUpperCase();
        try { await fb('/keys/' + key, 'DELETE'); }
        catch (e) { return send(res, 500, { ok: false, msg: 'Firebase delete failed: ' + e.message }); }
        delete keys[key];
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url === '/api/admin/update') {
        const b = await body(req);
        const u = {
          enabled: !!b.enabled,
          title: String(b.title || 'Update Available').slice(0, 80),
          message: String(b.message || '').slice(0, 500),
          link: String(b.link || '').slice(0, 300)
        };
        try { await fb('/update', 'PUT', u); }
        catch (e) { return send(res, 500, { ok: false, msg: 'Firebase save failed: ' + e.message }); }
        update = u;
        return send(res, 200, { ok: true, ...update });
      }
    }
    send(res, 404, { ok: false, msg: 'Not found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { ok: false, msg: 'Server error' });
  }
}).listen(process.env.PORT || 3000, '0.0.0.0', () => { console.log('running, firebase:', FB); load(); });
