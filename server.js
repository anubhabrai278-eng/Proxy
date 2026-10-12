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
const YT_URL = process.env.YT_URL || 'https://youtube.com/@anubhab_mods?si=NoIqFEuDevSmPk3L';
const YT_HANDLE = process.env.YT_HANDLE || '@anubhab_mods';
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();   // set => real YouTube subscription check via Google login
const GOOGLE_API = process.env.GOOGLE_API_BASE || 'https://www.googleapis.com';
const GOOGLE_AUTH = process.env.GOOGLE_AUTH_BASE || 'https://oauth2.googleapis.com';
const DAY = 24 * 60 * 60 * 1000;
const MAX_DEVICES = 1000;
const WORDS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const store = { persistent: true, error: '', loaded: false, db: FB.replace(/^https?:\/\//, '') };
let keys = {};   // cache of Firebase /keys  ->  KEY: { created, activatedAt, exp, devices: { id: 1 } }
let settings = {            // controlled from the admin panel, saved in Firebase /settings
  freeEnabled: true,        // free key website ON/OFF
  minMin: 60, maxMin: 180,  // random key time range (minutes)
  freeDevices: 1,           // devices allowed per free key
  dailyLimit: 0,            // free keys per user per 24h (0 = unlimited)
  waitSec: 15,              // basic mode: seconds the user must wait after opening YouTube
  ytUrl: YT_URL, ytHandle: YT_HANDLE,
  title: 'ANUBHAB MODZ', subtitle: 'Free access key generator',
  notice: '',               // announcement shown on the website
  closedMsg: 'Free keys are closed right now.'
};   // public free-key website ON/OFF
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
    const st = await fb('/settings');
    if (st) settings = { ...settings, ...st };
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
    req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch (err) { r({}); } });
  });
}
function isAdmin(req) {
  const a = Buffer.from(String(req.headers['x-admin-pass'] || ''));
  const b = Buffer.from(ADMIN_PASS);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function randWord(n) { let r = ''; const b = crypto.randomBytes(n); for (let i = 0; i < n; i++) r += WORDS[b[i] % WORDS.length]; return r; }
function freeStats() {
  const now = Date.now(); let total = 0, active = 0, today = 0;
  for (const v of Object.values(keys)) { if (!v.pub) continue; total++; if (now < v.exp) active++; if (now - v.created < DAY) today++; }
  return { total, active, today };
}
const fmtDur = m => { const h = Math.floor(m / 60), r = m % 60; return (h ? h + 'h' : '') + (h && r ? ' ' : '') + (r ? r + 'm' : ''); };
const devCount = k => Object.keys(k.devices || {}).length;
const maxDev = k => k.max || MAX_DEVICES;
function clientIp(req) { return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(); }
const ipHash = req => crypto.createHash('sha256').update(clientIp(req) + ADMIN_PASS).digest('hex').slice(0, 16);
const hits = new Map();   // simple per-IP throttle for the public website API
function throttled(req) {
  const ip = clientIp(req), now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > 12;
}
// "soft" mode (no Google login): signed ticket, must be at least 10s old (user had time to visit YouTube)
const tSecret = () => 'ticket:' + ADMIN_PASS;
const mkTicket = () => { const t = String(Date.now()); return t + '.' + crypto.createHmac('sha256', tSecret()).update(t).digest('hex').slice(0, 24); };
function okTicket(tk) {
  const [t, sig] = String(tk || '').split('.');
  if (!t || !sig) return false;
  const want = crypto.createHmac('sha256', tSecret()).update(t).digest('hex').slice(0, 24);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return false;
  const age = Date.now() - Number(t);
  return age >= 10000 && age <= 3600000;
}
// real mode: ask YouTube Data API with the user's Google token whether they subscribe to the channel
const ytChan = {};   // handle -> channel id cache
async function ytSubscribed(token) {
  const info = await fetch(GOOGLE_AUTH + '/tokeninfo?access_token=' + encodeURIComponent(token));
  const ij = await info.json().catch(() => ({}));
  if (!info.ok || (ij.aud !== GOOGLE_CLIENT_ID && ij.azp !== GOOGLE_CLIENT_ID)) throw new Error('Google login not valid');
  const H = { Authorization: 'Bearer ' + token };
  const handle = settings.ytHandle;
  if (!ytChan[handle]) {
    const r = await fetch(GOOGLE_API + '/youtube/v3/channels?part=id&forHandle=' + encodeURIComponent(handle), { headers: H });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || 'YouTube API error');
    ytChan[handle] = j.items && j.items[0] && j.items[0].id;
    if (!ytChan[handle]) throw new Error('YouTube channel not found');
  }
  const r2 = await fetch(GOOGLE_API + '/youtube/v3/subscriptions?part=id&mine=true&forChannelId=' + ytChan[handle], { headers: H });
  const j2 = await r2.json().catch(() => ({}));
  if (!r2.ok) throw new Error((j2.error && j2.error.message) || 'YouTube API error');
  return !!(j2.items && j2.items.length);
}
// remove free keys that expired more than 1 hour ago
setInterval(async () => {
  if (!store.loaded) return;
  const now = Date.now();
  for (const [k, v] of Object.entries(keys)) {
    if (v.pub && now > v.exp + 3600000) { try { await fb('/keys/' + k, 'DELETE'); delete keys[k]; } catch (e) {} }
  }
}, 30 * 60 * 1000);

http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

    if (req.method === 'GET' && (url === '/admin' || url === '/admin.html')) {
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'public', 'admin.html'), 'utf8'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && (url === '/getkey' || url === '/getkey.html')) {
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'public', 'getkey.html'), 'utf8'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url === '/') return send(res, 200, 'Anubhab Modz API online - v8 (Firebase only)', 'text/plain');

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
        if (devCount(k) >= maxDev(k)) return send(res, 403, { ok: false, msg: 'Device limit reached' });
        k.devices[dev] = 1;
        fbq('/keys/' + key + '/devices/' + dev, 'PUT', 1);
      }
      return send(res, 200, { ok: true, exp: k.exp });
    }
    if (req.method === 'GET' && url === '/api/config') return send(res, 200, { ok: true, ...update });

    // ---- Public free key website API ----
    if (url === '/api/getkey/status' && req.method === 'GET') {
      return send(res, 200, { ok: true, enabled: settings.freeEnabled, minMin: settings.minMin, maxMin: settings.maxMin,
        mode: GOOGLE_CLIENT_ID ? 'google' : 'soft', clientId: GOOGLE_CLIENT_ID, ytUrl: settings.ytUrl, ytHandle: settings.ytHandle,
        title: settings.title, subtitle: settings.subtitle, notice: settings.notice, closedMsg: settings.closedMsg, waitSec: settings.waitSec });
    }
    if (url === '/api/getkey/ticket' && req.method === 'GET') {
      if (throttled(req)) return send(res, 429, { ok: false, msg: 'Too many requests, wait a minute' });
      return send(res, 200, { ok: true, ticket: mkTicket() });
    }
    if (url === '/api/getkey' && req.method === 'POST') {
      if (throttled(req)) return send(res, 429, { ok: false, msg: 'Too many requests, wait a minute' });
      if (!store.loaded) return send(res, 503, { ok: false, msg: 'Server database not ready, try again' });
      if (!settings.freeEnabled) return send(res, 403, { ok: false, msg: settings.closedMsg || 'Free keys are closed right now' });
      const b = await body(req);
      // 1) YouTube subscribe check
      if (GOOGLE_CLIENT_ID) {
        if (!b.token) return send(res, 400, { ok: false, msg: 'Sign in with Google to verify your subscription' });
        let subbed;
        try { subbed = await ytSubscribed(String(b.token)); }
        catch (e) { return send(res, 401, { ok: false, msg: 'Verification failed: ' + e.message }); }
        if (!subbed) return send(res, 403, { ok: false, notSubscribed: true, msg: 'You have not subscribed yet. Subscribe to the channel, then try again.' });
      } else if (!okTicket(b.ticket)) {
        return send(res, 403, { ok: false, msg: 'Subscribe on YouTube first, then press verify' });
      }
      // 2) daily limit per user (optional)
      const ih = ipHash(req);
      if (settings.dailyLimit > 0) {
        const since = Date.now() - DAY;
        const n = Object.values(keys).filter(v => v.pub && v.ip === ih && v.created > since).length;
        if (n >= settings.dailyLimit) return send(res, 429, { ok: false, msg: 'Daily limit reached (' + settings.dailyLimit + ' key' + (settings.dailyLimit > 1 ? 's' : '') + ' per day). Try again tomorrow.' });
      }
      // 3) new random key every time (website does not remember keys)
      const lo = settings.minMin, hi = Math.max(settings.maxMin, settings.minMin);
      const minutes = lo + 5 * crypto.randomInt(0, Math.floor((hi - lo) / 5) + 1);
      let key;
      do { key = 'ANUBHAB-MODZ-' + randWord(8); } while (keys[key]);
      const now = Date.now();
      const obj = { created: now, activatedAt: now, exp: now + minutes * 60000, pub: 1, max: settings.freeDevices, ip: ih, note: 'Free ' + fmtDur(minutes) };
      try { await fb('/keys/' + key, 'PUT', obj); }
      catch (e) { store.error = 'Save failed: ' + e.message; return send(res, 500, { ok: false, msg: 'Could not save key, try again' }); }
      keys[key] = { ...obj, devices: {} };
      return send(res, 200, { ok: true, key, exp: obj.exp, total: minutes * 60000, minutes });
    }

    // ---- Admin API ----
    if (url.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return send(res, 401, { ok: false, msg: 'Wrong admin password' });

      if (req.method === 'GET' && url === '/api/admin/status') return send(res, 200, { ok: true, ...store, freeEnabled: settings.freeEnabled, settings, ytMode: GOOGLE_CLIENT_ID ? 'google' : 'soft', free: freeStats() });
      if (req.method === 'POST' && url === '/api/admin/settings') {
        const b = await body(req);
        const n = { ...settings };
        const int = (v, a, z, d) => { v = parseInt(v); return isNaN(v) ? d : Math.min(Math.max(v, a), z); };
        const str = (v, max, d) => (v === undefined ? d : String(v).trim().slice(0, max));
        if (b.freeEnabled !== undefined) n.freeEnabled = !!b.freeEnabled;
        n.minMin = int(b.minMin, 5, 1440, n.minMin);
        n.maxMin = int(b.maxMin, n.minMin, 1440, Math.max(n.maxMin, n.minMin));
        n.freeDevices = int(b.freeDevices, 1, MAX_DEVICES, n.freeDevices);
        n.dailyLimit = int(b.dailyLimit, 0, 100, n.dailyLimit);
        n.waitSec = int(b.waitSec, 10, 120, n.waitSec);
        n.title = str(b.title, 40, n.title) || 'ANUBHAB MODZ';
        n.subtitle = str(b.subtitle, 80, n.subtitle);
        n.notice = str(b.notice, 200, n.notice);
        n.closedMsg = str(b.closedMsg, 120, n.closedMsg) || 'Free keys are closed right now.';
        if (b.ytUrl !== undefined) {
          const u = String(b.ytUrl).trim().slice(0, 300);
          if (/^https:\/\/((www|m)\.)?youtube\.com\//.test(u) || /^https:\/\/youtu\.be\//.test(u)) n.ytUrl = u;
          else return send(res, 400, { ok: false, msg: 'YouTube link must start with https://youtube.com/' });
        }
        if (b.ytHandle !== undefined) {
          let hnd = String(b.ytHandle).trim().slice(0, 60);
          if (hnd && hnd[0] !== '@') hnd = '@' + hnd;
          if (!/^@[A-Za-z0-9._-]+$/.test(hnd)) return send(res, 400, { ok: false, msg: 'Channel handle must look like @channelname' });
          n.ytHandle = hnd;
        }
        try { await fb('/settings', 'PUT', n); }
        catch (e) { return send(res, 500, { ok: false, msg: 'Firebase save failed: ' + e.message }); }
        settings = n;
        return send(res, 200, { ok: true, settings });
      }
      if (req.method === 'POST' && (url === '/api/admin/free/expire-all' || url === '/api/admin/free/delete-all')) {
        const del = url.endsWith('delete-all'), now = Date.now();
        let n = 0;
        try {
          for (const [k, v] of Object.entries(keys)) {
            if (!v.pub) continue;
            if (del) { await fb('/keys/' + k, 'DELETE'); delete keys[k]; n++; }
            else if (now < v.exp) { await fb('/keys/' + k + '/exp', 'PUT', now); v.exp = now; n++; }
          }
        } catch (e) { return send(res, 500, { ok: false, msg: 'Firebase save failed: ' + e.message }); }
        return send(res, 200, { ok: true, count: n });
      }
      if (req.method === 'POST' && url === '/api/admin/generate') {
        if (!store.loaded) return send(res, 503, { ok: false, msg: 'Firebase not connected: ' + store.error });
        const b = await body(req);
        const count = Math.min(Math.max(parseInt(b.count) || 1, 1), 50);
        const note = String(b.note || '').slice(0, 60);
        const made = [];
        try {
          for (let i = 0; i < count; i++) {
            let key;
            do { key = 'ANUBHAB-MODZ-' + randWord(8); } while (keys[key]);
            const obj = { created: Date.now(), activatedAt: 0, exp: 0 };   // 1 day, up to 1000 devices
            if (note) obj.note = note;
            await fb('/keys/' + key, 'PUT', obj);
            keys[key] = { ...obj, devices: {} };
            made.push(key);
          }
        } catch (e) {
          store.error = 'Save failed: ' + e.message;
          return send(res, 500, { ok: false, msg: 'Firebase save failed: ' + e.message, keys: made });
        }
        return send(res, 200, { ok: true, key: made[0], keys: made });
      }
      if (req.method === 'GET' && url === '/api/admin/keys') {
        const list = Object.entries(keys).map(([key, v]) => ({ key, created: v.created, activatedAt: v.activatedAt, exp: v.exp, devices: devCount(v), max: maxDev(v), note: v.note || '', pub: !!v.pub })).sort((a, b) => b.created - a.created);
        return send(res, 200, { ok: true, keys: list });
      }
      if (req.method === 'POST' && url === '/api/admin/cleanup') {
        const now = Date.now();
        const dead = Object.keys(keys).filter(k => keys[k].activatedAt && now >= keys[k].exp);
        try { for (const k of dead) { await fb('/keys/' + k, 'DELETE'); delete keys[k]; } }
        catch (e) { return send(res, 500, { ok: false, msg: 'Firebase delete failed: ' + e.message }); }
        return send(res, 200, { ok: true, removed: dead.length });
      }
      const act = url.match(/^\/api\/admin\/keys\/([^/]+)\/(reset|extend)$/);
      if (req.method === 'POST' && act) {
        const key = decodeURIComponent(act[1]).toUpperCase();
        const k = keys[key];
        if (!k) return send(res, 404, { ok: false, msg: 'Key not found' });
        try {
          if (act[2] === 'reset') {          // clear all devices
            await fb('/keys/' + key + '/devices', 'DELETE');
            k.devices = {};
          } else {                           // +1 day
            if (!k.activatedAt) return send(res, 400, { ok: false, msg: 'Key not used yet (its 1 day starts at first login)' });
            const base = Math.max(k.exp, Date.now());
            k.exp = base + DAY;
            await fb('/keys/' + key + '/exp', 'PUT', k.exp);
          }
        } catch (e) { return send(res, 500, { ok: false, msg: 'Firebase save failed: ' + e.message }); }
        return send(res, 200, { ok: true });
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
  } 
