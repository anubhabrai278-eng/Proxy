// Anubhab Modz key server - ONE file, zero dependencies, Node 18+.
// Everything (keys, settings, update popup, video step) is saved ONLY in Firebase Realtime Database.
// ENV (Render > Environment):
//   ADMIN_PASS         admin password (REQUIRED, change it!)
//   FIREBASE_DB_URL    optional override of the database url
//   FIREBASE_SECRET    optional database secret
//   GOOGLE_CLIENT_ID   OAuth Web client id  -> REAL subscribe check (Google login)
//   YT_API_KEY         YouTube Data API key -> REAL comment check
//   YT_URL, YT_HANDLE  channel link / handle
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
// Google login is OFF by default (no-login mode). To turn it on set USE_GOOGLE_LOGIN=1 AND GOOGLE_CLIENT_ID.
const GOOGLE_CLIENT_ID = process.env.USE_GOOGLE_LOGIN === '1' ? (process.env.GOOGLE_CLIENT_ID || '').trim() : '';
const YT_API_KEY = (process.env.YT_API_KEY || '').trim();
const GOOGLE_API = process.env.GOOGLE_API_BASE || 'https://www.googleapis.com';
const GOOGLE_AUTH = process.env.GOOGLE_AUTH_BASE || 'https://oauth2.googleapis.com';
const PORT = process.env.PORT || 3000;
// NO-LOGIN "code" mode: when GOOGLE_CLIENT_ID is not set but YT_API_KEY is, comments are verified by a unique code
// and the subscription is checked from the commenter's PUBLIC subscription list.
const CODE_MODE = !GOOGLE_CLIENT_ID && !!YT_API_KEY;
const SUB_STRICT = process.env.SUB_STRICT === '1';   // 1 => users with PRIVATE subscriptions are rejected (otherwise they pass)
const DAY = 24 * 60 * 60 * 1000;
const MAX_DEVICES = 1000;
const WORDS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function page(name) {
  for (const p of [path.join(__dirname, name), path.join(__dirname, 'public', name)]) if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  return 'Page file ' + name + ' not found. Upload ' + name + ' next to server.js on GitHub.';
}

const store = { persistent: true, error: '', loaded: false, db: FB.replace(/^https?:\/\//, '') };
let keys = {};
let settings = {
  freeEnabled: true, minMin: 60, maxMin: 180, freeDevices: 1, dailyLimit: 0, waitSec: 15,
  ytUrl: YT_URL, ytHandle: YT_HANDLE,
  title: 'ANUBHAB MODZ', subtitle: 'Free access key generator', notice: '',
  closedMsg: 'Free keys are closed right now.'
};
let update = {
  enabled: false, latest: 0, title: 'Update Available',
  message: 'A new update is available. Tap UPDATE to open our WhatsApp channel.',
  link: 'https://whatsapp.com/channel/0029Vb7xr5tBVJl3HJkMri3P'
};
const VDEF = { enabled: false, videoId: '', watchSec: 30, requireComment: false, minChars: 5, title: 'Watch the video', hint: '', stats: { done: 0, commented: 0 } };
let video = { ...VDEF, stats: { ...VDEF.stats } };

// ---- Firebase REST ----
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
    const u = await fb('/update'); if (u) update = { ...update, ...u };
    const st = await fb('/settings'); if (st) settings = { ...settings, ...st };
    const vd = await fb('/video');
    if (vd) { video = { ...VDEF, ...vd }; video.stats = { ...VDEF.stats, ...(vd.stats || {}) }; }
    store.loaded = true; store.error = '';
  } catch (e) { store.error = 'Load failed: ' + e.message; console.error('load failed', e.message); }
}
async function ensureLoaded() { if (!store.loaded) await load(); }

// ---- helpers ----
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type,x-admin-pass,x-app-version',
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
    req.on('error', () => r({}));
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
const sha = s => crypto.createHash('sha256').update(String(s) + ADMIN_PASS).digest('hex').slice(0, 16);
function clientIp(req) { return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(); }
const ipHash = req => sha(clientIp(req));
const hits = new Map();
function throttled(req) {
  const ip = clientIp(req), now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > 40;
}
const clamp = (n, a, z, d) => { n = parseInt(n, 10); return isNaN(n) ? d : Math.max(a, Math.min(z, n)); };
async function gj(url, headers) {
  const r = await fetch(url, headers ? { headers } : undefined);
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, j };
}

// ---- soft mode ticket ----
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

// ---- REAL YouTube subscribe check (Google login) ----
const ytChan = {};
async function ytGoogle(token) {
  const info = await gj(GOOGLE_AUTH + '/tokeninfo?access_token=' + encodeURIComponent(token));
  if (!info.ok || (info.j.aud !== GOOGLE_CLIENT_ID && info.j.azp !== GOOGLE_CLIENT_ID)) throw new Error('Google login not valid');
  const H = { Authorization: 'Bearer ' + token };
  const handle = settings.ytHandle;
  if (!ytChan[handle]) {
    const c = await gj(GOOGLE_API + '/youtube/v3/channels?part=id&forHandle=' + encodeURIComponent(handle), H);
    if (!c.ok) throw new Error((c.j.error && c.j.error.message) || 'YouTube API error');
    ytChan[handle] = c.j.items && c.j.items[0] && c.j.items[0].id;
    if (!ytChan[handle]) throw new Error('YouTube channel not found');
  }
  const me = await gj(GOOGLE_API + '/youtube/v3/channels?part=id&mine=true', H);
  const channelId = me.ok && me.j.items && me.j.items[0] ? me.j.items[0].id : '';
  const s = await gj(GOOGLE_API + '/youtube/v3/subscriptions?part=id&mine=true&forChannelId=' + ytChan[handle], H);
  if (!s.ok) throw new Error((s.j.error && s.j.error.message) || 'YouTube API error');
  return { subbed: !!(s.j.items && s.j.items.length), channelId };
}
// ---- REAL comment check: comment must exist on the video (+ author id, text length) ----
async function ytComment(id, videoId) {
  const r = await gj(GOOGLE_API + '/youtube/v3/comments?part=snippet&id=' + encodeURIComponent(id) + '&key=' + encodeURIComponent(YT_API_KEY));
  if (!r.ok) throw new Error((r.j.error && r.j.error.message) || 'YouTube API error');
  const it = r.j.items && r.j.items[0];
  if (!it || !it.snippet) return null;
  if (it.snippet.videoId && it.snippet.videoId !== videoId) return null;
  const a = it.snippet.authorChannelId;
  return { author: (a && a.value) || '', text: it.snippet.textOriginal || it.snippet.textDisplay || '' };
}

// ---- NO-LOGIN mode: find the user's comment by its unique code, then check the public subscription list ----
async function ytFindByCode(code) {
  const base = GOOGLE_API + '/youtube/v3/commentThreads?part=snippet&videoId=' + encodeURIComponent(video.videoId) +
    '&maxResults=100&textFormat=plainText&key=' + encodeURIComponent(YT_API_KEY);
  for (const extra of ['&searchTerms=' + encodeURIComponent(code), '&order=time']) {
    const r = await gj(base + extra);
    if (!r.ok) throw new Error((r.j.error && r.j.error.message) || 'YouTube API error');
    for (const it of r.j.items || []) {
      const tl = it.snippet && it.snippet.topLevelComment;
      const sn = tl && tl.snippet;
      const text = sn ? String(sn.textOriginal || sn.textDisplay || '') : '';
      if (sn && text.toUpperCase().includes(code)) {
        return { id: tl.id, author: (sn.authorChannelId && sn.authorChannelId.value) || '', text };
      }
    }
  }
  return null;
}
let ownChan = {};
async function ownChannelId() {
  const h = settings.ytHandle;
  if (!ownChan[h]) {
    const r = await gj(GOOGLE_API + '/youtube/v3/channels?part=id&forHandle=' + encodeURIComponent(h) + '&key=' + encodeURIComponent(YT_API_KEY));
    if (!r.ok) throw new Error((r.j.error && r.j.error.message) || 'YouTube API error');
    ownChan[h] = r.j.items && r.j.items[0] && r.j.items[0].id;
    if (!ownChan[h]) throw new Error('YouTube channel not found');
  }
  return ownChan[h];
}
// true = subscribed, false = public list and NOT subscribed, null = user keeps subscriptions private (cannot know)
async function ytSubPublic(userChannel) {
  const own = await ownChannelId();
  const r = await gj(GOOGLE_API + '/youtube/v3/subscriptions?part=id&channelId=' + encodeURIComponent(userChannel) +
    '&forChannelId=' + encodeURIComponent(own) + '&key=' + encodeURIComponent(YT_API_KEY));
  if (r.ok) return !!(r.j.items && r.j.items.length);
  const e = r.j.error || {};
  const reason = e.errors && e.errors[0] && e.errors[0].reason;
  if (reason === 'subscriptionForbidden' || (e.code === 403 && /subscriptions/i.test(e.message || ''))) return null;
  throw new Error(e.message || 'YouTube API error');
}

// ---- video step state ----
const vSessions = new Map();   // sid -> {at}
const vTokens = new Map();     // vtoken -> {exp, author}
const usedComments = new Set();
const extractId = s => {
  s = String(s || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/|\/v\/)([\w-]{11})/);
  return m ? m[1] : '';
};
const saveVideo = () => fb('/video', 'PUT', video);

setInterval(() => {
  const n = Date.now();
  vSessions.forEach((v, k) => { if (n - v.at > 36e5) vSessions.delete(k); });
  vTokens.forEach((v, k) => { if (n > v.exp) vTokens.delete(k); });
  if (usedComments.size > 20000) usedComments.clear();
}, 60000).unref();

// remove free keys that expired more than 1 hour ago
setInterval(async () => {
  if (!store.loaded) return;
  const now = Date.now();
  for (const [k, v] of Object.entries(keys)) {
    if (v.pub && now > v.exp + 3600000) { try { await fb('/keys/' + k, 'DELETE'); delete keys[k]; } catch (e) {} }
  }
}, 30 * 60 * 1000).unref();

http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    if (req.method === 'GET' && (url === '/admin' || url === '/admin.html')) return send(res, 200, page('admin.html'), 'text/html; charset=utf-8');
    if (req.method === 'GET' && (url === '/getkey' || url === '/getkey.html')) return send(res, 200, page('getkey.html'), 'text/html; charset=utf-8');
    if (req.method === 'GET' && url === '/') return send(res, 200, 'Anubhab Modz API online - v9 (Firebase only)', 'text/plain');

    await ensureLoaded();

    // ================= APP API =================
    if (req.method === 'POST' && url === '/api/verify') {
      if (!store.loaded) return send(res, 503, { ok: false, msg: 'Server database not ready, try again' });
      const b = await body(req);
      const key = String(b.key || '').trim().toUpperCase();
      const dev = String(b.device || '').slice(0, 100).replace(/[.$#\[\]\/]/g, '_');
      const k = keys[key];
      if (!k) return send(res, 401, { ok: false, msg: 'Wrong key' });
      if (!k.devices) k.devices = {};
      if (!k.activatedAt) {
        k.activatedAt = Date.now(); k.exp = k.activatedAt + DAY;
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
    if (req.method === 'GET' && url === '/api/config') {
      const qs = new URLSearchParams(req.url.split('?')[1] || '');
      const v = parseInt(qs.get('v') || req.headers['x-app-version']);
      const cfg = { ...update };
      if (!isNaN(v) && update.latest > 0 && v >= update.latest) cfg.enabled = false;
      return send(res, 200, { ok: true, ...cfg });
    }

    // ================= FREE KEY WEBSITE API =================
    if (url === '/api/getkey/status' && req.method === 'GET') {
      return send(res, 200, { ok: true, enabled: settings.freeEnabled, minMin: settings.minMin, maxMin: settings.maxMin,
        mode: GOOGLE_CLIENT_ID ? 'google' : 'soft', clientId: GOOGLE_CLIENT_ID, ytUrl: settings.ytUrl, ytHandle: settings.ytHandle,
        title: settings.title, subtitle: settings.subtitle, notice: settings.notice, closedMsg: settings.closedMsg, waitSec: settings.waitSec });
    }
    if (url === '/api/getkey/ticket' && req.method === 'GET') {
      if (throttled(req)) return send(res, 429, { ok: false, msg: 'Too many requests, wait a minute' });
      return send(res, 200, { ok: true, ticket: mkTicket() });
    }

    // ---- video step (public) ----
    if (url === '/api/getkey/video' && req.method === 'GET') {
      if (!video.enabled || !video.videoId) return send(res, 200, { ok: true, enabled: false });
      return send(res, 200, { ok: true, enabled: true, videoId: video.videoId, watchSec: video.watchSec,
        requireComment: video.requireComment, minChars: video.minChars, title: video.title, hint: video.hint,
        codeMode: CODE_MODE && !!video.requireComment });
    }
    if (url === '/api/getkey/video/start' && req.method === 'POST') {
      if (!video.enabled) return send(res, 200, { ok: false, msg: 'Video step is off' });
      const sid = crypto.randomBytes(16).toString('hex');
      const code = 'AM' + randWord(6);
      vSessions.set(sid, { at: Date.now(), code });
      return send(res, 200, { ok: true, sid, code: CODE_MODE && video.requireComment ? code : undefined });
    }
    if (url === '/api/getkey/video/done' && req.method === 'POST') {
      const b = await body(req);
      const s = vSessions.get(b.sid);
      if (!s) return send(res, 200, { ok: false, msg: 'Session expired, reload the page' });
      const need = Math.max(5, Math.min(video.watchSec, (parseInt(b.dur, 10) || video.watchSec) - 1));
      const elapsed = (Date.now() - s.at) / 1000;
      if (elapsed < need * 0.9 || (+b.watched || 0) < need * 0.9) return send(res, 200, { ok: false, msg: 'Please watch the video fully' });
      let author = '';
      if (video.requireComment) {
        if (!b.commented) return send(res, 200, { ok: false, msg: 'Please comment on the video' });
        if (CODE_MODE) {
          let c;
          try { c = await ytFindByCode(s.code); }
          catch (e) { return send(res, 200, { ok: false, msg: 'Could not check comments yet, retrying… (' + e.message + ')' }); }
          if (!c) return send(res, 200, { ok: false, msg: 'Comment with your code not found yet. Post it publicly on the video, then wait a few seconds…' });
          if (usedComments.has(c.id)) return send(res, 200, { ok: false, msg: 'This comment was already used' });
          if (c.text.toUpperCase().split(s.code).join('').trim().length < video.minChars) return send(res, 200, { ok: false, msg: 'Write a longer comment (at least ' + video.minChars + ' characters) with your code' });
          if (!c.author) return send(res, 200, { ok: false, msg: 'Could not read your channel from the comment' });
          let sub;
          try { sub = await ytSubPublic(c.author); }
          catch (e) { return send(res, 200, { ok: false, msg: 'Could not check subscription yet, retrying… (' + e.message + ')' }); }
          if (sub === false) return send(res, 200, { ok: false, notSubscribed: true, msg: 'You have not subscribed to the channel yet. Subscribe with the same account you commented with.' });
          if (sub === null && SUB_STRICT) return send(res, 200, { ok: false, msg: 'Your subscriptions are private. On YouTube: Settings > Privacy > turn OFF "Keep all my subscriptions private", then try again.' });
          author = c.author; usedComments.add(c.id);
        } else if (YT_API_KEY) {
          const cid = String(b.commentId || '').slice(0, 80);
          if (!cid) {
            if (GOOGLE_CLIENT_ID) return send(res, 200, { ok: false, msg: 'Post the comment with the button so it can be verified' });
          } else {
            if (usedComments.has(cid)) return send(res, 200, { ok: false, msg: 'This comment was already used' });
            let c;
            try { c = await ytComment(cid, video.videoId); }
            catch (e) { return send(res, 200, { ok: false, msg: 'Could not verify comment yet, retrying… (' + e.message + ')' }); }
            if (!c) return send(res, 200, { ok: false, msg: 'Comment not found on the video' });
            if (c.text.trim().length < video.minChars) return send(res, 200, { ok: false, msg: 'Comment is too short' });
            author = c.author; usedComments.add(cid);
          }
        }
      }
      vSessions.delete(b.sid);
      const vt = crypto.randomBytes(18).toString('hex');
      vTokens.set(vt, { exp: Date.now() + 36e5, author });
      video.stats.done++; if (b.commented) video.stats.commented++;
      fb('/video/stats', 'PUT', video.stats).catch(() => {});
      return send(res, 200, { ok: true, vtoken: vt });
    }

    // ---- get a free key ----
    if (url === '/api/getkey' && req.method === 'POST') {
      if (throttled(req)) return send(res, 429, { ok: false, msg: 'Too many requests, wait a minute' });
      if (!store.loaded) return sen
