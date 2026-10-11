// Anubhab Modz key server - zero dependencies (Node 18+). Render: Build "echo ok", Start "node server.js"
// ENV: ADMIN_PASS (admin password), FIREBASE_DB_URL (optional, permanent key storage)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const FB = (process.env.FIREBASE_DB_URL || '').replace(/\/$/, '');
const FILE = path.join(__dirname, 'keys.json');
const DAY = 24 * 60 * 60 * 1000;
let keys = {}; // KEY -> { created, device, activatedAt, exp }
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
      keys = (await (await fetch(FB + '/keys.json')).json()) || {};
      const u = await (await fetch(FB + '/update.json')).json();
      if (u) update = { ...update, ...u };
    } else {
      if (fs.existsSync(FILE)) keys = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      if (fs.existsSync(UFILE)) update = { ...update, ...JSON.parse(fs.readFileSync(UFILE, 'utf8')) };
    }
  } catch (e) { console.error('load failed', e.message); }
}
async function saveUpdate() {
  try {
    if (FB) await fetch(FB + '/update.json', { method: 'PUT', body: JSON.stringify(update) });
    else fs.writeFileSync(UFILE, JSON.stringify(update));
  } catch (e) { console.error('saveUpdate failed', e.message); }
}
async function save() {
  try {
    if (FB) await fetch(FB + '/keys.json', { method: 'PUT', body: JSON.stringify(keys) });
    else fs.writeFileSync(FILE, JSON.stringify(keys));
  } catch (e) { console.error('save failed', e.message); }
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
      const device = String(b.device || '');
      const k = keys[key];
      if (!k) return send(res, 401, { ok: false, msg: 'Wrong key' });
      if (!k.activatedAt) { k.activatedAt = Date.now(); k.exp = k.activatedAt + DAY; k.device = device; await save(); }
      if (k.device && device && k.device !== device) return send(res, 403, { ok: false, msg: 'Key already used on another device' });
      if (Date.now() >= k.exp) return send(res, 403, { ok: false, msg: 'Key expired' });
      return send(res, 200, { ok: true, exp: k.exp });
    }

    if (req.method === 'GET' && url === '/api/config') return send(res, 200, { ok: true, ...update });

    // ---- Admin API ----
    if (url.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return send(res, 401, { ok: false, msg: 'Wrong admin password' });
      if (req.method === 'POST' && url === '/api/admin/generate') {
        const key = 'AM-' + crypto.randomBytes(5).toString('hex').toUpperCase();
        keys[key] = { created: Date.now(), device: '', activatedAt: 0, exp: 0 }; // 1 day keys only
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
      if (req.method === 'GET' && url === '/api/admin/keys') {
        const list = Object.entries(keys).map(([key, v]) => ({ key, ...v })).sort((a, b) => b.created - a.created);
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
