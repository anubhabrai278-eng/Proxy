// Anubhab Modz key server - zero dependencies (Node 18+). Render: Build "echo ok", Start "node server.js"
// ENV: ADMIN_PASS (admin password), FIREBASE_DB_URL (optional, permanent key storage)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const FB = (process.env.FIREBASE_DB_URL || '').replace(/\/$/, '');
const FB_SECRET = process.env.FIREBASE_SECRET || '';
const store = { persistent: !!FB, error: '' };
async function fb(p, method, data) {
  const r = await fetch(FB + p + '.json' + (FB_SECRET ? '?auth=' + encodeURIComponent(FB_SECRET) : ''), { method: method || 'GET', body: data === undefined ? undefined : JSON.stringify(data) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
  store.error = '';
  return j;
}
const FILE = path.join(__dirname, 'keys.json');
const DAY = 24 * 60 * 60 * 1000;
const MAX_DEVICES = 1000;
const WORDS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let keys = {}; // KEY -> { created, devices[], activatedAt, exp }
let saveTimer = null;
function saveSoon() { if (saveTimer) return; saveTimer = setTimeout(() => { saveTimer = null; save(); }, 800); }
function randWord(n) { let r = ''; const b = crypto.randomBytes(n); for (let i = 0; i < n; i++) r += WORDS[b[i] % WORDS.length]; return r; }
const UFILE = path.join(__dirname, 'update.json');
let update = {
  enabled: false,
  title: 'Update Available',
  message: 'A new update is available. Tap UPDATE to open our WhatsApp channel.',
  link: 'https://whatsapp.com/channel/0029Vb7xr5tBVJl3HJkMri3P'
};

async function load() {
  try {
    if (FB) {
      keys = (await fb('/keys')) || {};
      const u = await fb('/update');
      if (u) update = { ...update, ...u };
    } else {
      if (fs.existsSync(FILE)) keys = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      if (fs.existsSync(UFILE)) update = { ...update, ...JSON.parse(fs.readFileSync(UFILE, 'utf8')) };
    }
  } catch (e) { store.error = 'Load failed: ' + e.message; console.error('load failed', e.message); }
}
async function saveUpdate() {
  try {
    if (FB) await fb('/update', 'PUT', update);
    else fs.writeFileSync(UFILE, JSON.stringify(update));
  } catch (e) { store.error = 'Save failed: ' + e.message; console.error('saveUpdate failed', e.message); }
}
async function save() {
  try {
    if (FB) await fb('/keys', 'PUT', keys);
    else fs.writeFileSync(FILE, JSON.stringify(keys));
  } catch (e) { store.error = 'Save failed: ' + e.message; console.error('save failed', e.message); }
}

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

http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

    if (req.method === 'GET' && (url === '/admin' || url === '/admin.html')) {
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'public', 'admin.html'), 'utf8'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url === '/') return send(res, 200, 'Anubhab Modz API online', 'text/plain');

    // ---- App API ----
    if (req.method === 'POST' && url === '/api/verify') {
      const b = await body(req);
      const key = String(b.key || '').trim().toUpperCase();
      const device = String(b.device || '').slice(0, 100);
      const k = keys[key];
      if (!k) return send(res, 401, { ok: false, msg: 'Wrong key' });
      if (!k.devices) k.devices = k.device ? [k.device] : [];   // migrate old keys
      if (!k.activatedAt) { k.activatedAt = Date.now(); k.exp = k.activatedAt + DAY; saveSoon(); } // 1 day starts at first login
      if (Date.now() >= k.exp) return send(res, 403, { ok: false, msg: 'Key expired' });
      if (device && !k.devices.includes(device)) {
        if (k.devices.length >= MAX_DEVICES) return send(res, 403, { ok: false, msg: 'Device limit reached' });
        k.devices.push(device);
        saveSoon();
      }
      return send(res, 200, { ok: true, exp: k.exp });
    }

    if (req.method === 'GET' && url === '/api/config') return send(res, 200, { ok: true, ...update });

    // ---- Admin API ----
    if (url.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return send(res, 401, { ok: false, msg: 'Wrong admin password' });
      if (req.method === 'POST' && url === '/api/admin/generate') {
        let key;
        do { key = 'ANUBHAB-MODZ-' + randWord(8); } while (keys[key]);
        keys[key] = { created: Date.now(), devices: [], activatedAt: 0, exp: 0 }; // 1 day, up to 1000 devices
        await save();
        return send(res, 200, { ok: true, key });
      }
      if (req.method === 'POST' && url === '/api/admin/update') {
        const b = await body(req);
        update = {
          enabled: !!b.enabled,
          title: String(b.title || 'Update Available').slice(0, 80),
          message: String(b.message || '').slice(0, 500),
          link: String(b.link || '').slice(0, 300)
        };
        await saveUpdate();
        return send(res, 200, { ok: true, ...update });
      }
      if (req.method === 'GET' && url === '/api/admin/status') return send(res, 200, { ok: true, ...store });
      if (req.method === 'GET' && url === '/api/admin/keys') {
        const list = Object.entries(keys).map(([key, v]) => ({ key, created: v.created, activatedAt: v.activatedAt, exp: v.exp, devices: (v.devices || (v.device ? [v.device] : [])).length, max: MAX_DEVICES })).sort((a, b) => b.created - a.created);
        return send(res, 200, { ok: true, keys: list });
      }
      if (req.method === 'DELETE' && url.startsWith('/api/admin/keys/')) {
        delete keys[decodeURIComponent(url.split('/').pop()).toUpperCase()];
        await save();
        return send(res, 200, { ok: true });
      }
    }
    send(res, 404, { ok: false, msg: 'Not found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { ok: false, msg: 'Server error' });
  }
}).listen(process.env.PORT || 3000, '0.0.0.0', () => { console.log('running'); load(); });
