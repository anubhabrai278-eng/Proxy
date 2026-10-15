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
const VDEF = { enabled: false, videoId: '', watchSec: 30, passHours: 12, requireComment: false, minChars: 5, title: 'Watch the video', hint: '', stats: { done: 0, commented: 0 } };
let video = { ...VDEF, stats: { ...VDEF.stats } };
let passes = {};   // gid -> pass expiry (ms). One video+comment per user, then a pass for passHours: keys yes, video no.

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
    passes = (await fb('/passes')) || {};
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
// ---- YouTube API with several keys: when one key's daily quota is used up, the next key is used ----
// Render env YT_API_KEY can hold ONE key or MANY keys separated by commas (keys from different Google Cloud projects).
const ytKeys = YT_API_KEY.split(',').map(x => x.trim()).filter(Boolean);
const keyDown = {};   // key -> time until it is skipped (quota used up)
const QUOTA_OPEN = process.env.QUOTA_OPEN === '1';   // 1 => when ALL keys are out of quota, let users pass without the YouTube check
const QUOTA_MSG = 'YouTube check limit is full for today. Please try again later (it resets around 12:45 PM Nepal time).';
const isQuota = r => {
  const e = r.j && r.j.error, rs = e && e.errors && e.errors[0] && e.errors[0].reason;
  return !r.ok && (rs === 'quotaExceeded' || rs === 'dailyLimitExceeded' || rs === 'rateLimitExceeded' || /quota/i.test((e && e.message) || ''));
};
async function ytGet(pathq) {
  let last = null;
  for (const k of ytKeys) {
    if ((keyDown[k] || 0) > Date.now()) continue;
    const r = await gj(GOOGLE_API + pathq + (pathq.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(k));
    if (isQuota(r)) { keyDown[k] = Date.now() + 30 * 60000; last = r; continue; }
    return r;
  }
  return last ? { ...last, quota: true } : { ok: false, quota: true, j: { error: { message: 'quota' } } };
}
const ytFail = (r, d) => {
  const m = r.j && r.j.error && r.j.error.message ? String(r.j.error.message).replace(/<[^>]*>/g, '').trim() : '';
  const e = new Error(m || d); e.quota = !!r.quota; return e;
};

async function ytComment(id, videoId) {
  const r = await ytGet('/youtube/v3/comments?part=snippet&id=' + encodeURIComponent(id));
  if (!r.ok) throw ytFail(r, 'YouTube API error');
  const it = r.j.items && r.j.items[0];
  if (!it || !it.snippet) return null;
  if (it.snippet.videoId && it.snippet.videoId !== videoId) return null;
  const a = it.snippet.authorChannelId;
  return { author: (a && a.value) || '', text: it.snippet.textOriginal || it.snippet.textDisplay || '' };
}

// ---- NO-LOGIN mode: find the user's comment by its unique code, then check the public subscription list ----
// 1 quota unit per search. The wider "latest 100 comments" fallback is only used now and then (deep = true).
async function ytFindByCode(code, deep) {
  const base = '/youtube/v3/commentThreads?part=snippet&videoId=' + encodeURIComponent(video.videoId) + '&maxResults=100&textFormat=plainText';
  const tries = ['&searchTerms=' + encodeURIComponent(code)];
  if (deep) tries.push('&order=time');
  for (const extra of tries) {
    const r = await ytGet(base + extra);
    if (!r.ok) throw ytFail(r, 'YouTube API error');
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
    const r = await ytGet('/youtube/v3/channels?part=id&forHandle=' + encodeURIComponent(h));
    if (!r.ok) throw ytFail(r, 'YouTube API error');
    ownChan[h] = r.j.items && r.j.items[0] && r.j.items[0].id;
    if (!ownChan[h]) throw new Error('YouTube channel not found');
  }
  return ownChan[h];
}
// true = subscribed, false = public list and NOT subscribed, null = user keeps subscriptions private (cannot know)
async function ytSubPublic(userChannel) {
  const own = await ownChannelId();
  const r = await ytGet('/youtube/v3/subscriptions?part=id&channelId=' + encodeURIComponent(userChannel) + '&forChannelId=' + encodeURIComponent(own));
  if (r.ok) return !!(r.j.items && r.j.items.length);
  const e = r.j.error || {};
  const reason = e.errors && e.errors[0] && e.errors[0].reason;
  if (!r.quota && (reason === 'subscriptionForbidden' || (e.code === 403 && /subscriptions/i.test(e.message || '')))) return null;
  throw ytFail(r, 'YouTube API error');
}

// ---- one video per user: signed pass (valid passHours) ----
const chanGid = ch => 'c' + sha('g' + ch);          // identity from the commenter's YouTube channel
const ipGid = req => 'i' + ipHash(req);             // fallback identity (no comment) = IP
const pSecret = () => 'pass:' + ADMIN_PASS;
const passSig = t => crypto.createHmac('sha256', pSecret()).update(t).digest('hex').slice(0, 24);
const mkPass = (gid, exp) => { const t = gid + '.' + exp; return t + '.' + passSig(t); };
function readPass(tok) {
  const a = String(tok || '').split('.');
  if (a.length !== 3) return null;
  const t = a[0] + '.' + a[1], want = passSig(t);
  if (a[2].length !== want.length || !crypto.timingSafeEqual(Buffer.from(a[2]), Buffer.from(want))) return null;
  const exp = Number(a[1]);
  if (!(exp > Date.now()) || passes[a[0]] !== exp) return null;   // expired or reset by admin
  return { gid: a[0], exp };
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
  for (const [g, e] of Object.entries(passes)) if (e < now - DAY) { delete passes[g]; fb('/passes/' + g, 'DELETE').catch(() => {}); }
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
      const qs0 = new URLSearchParams(req.url.split('?')[1] || '');
      const pp = readPass(qs0.get('pass'));
      if (pp) return send(res, 200, { ok: true, enabled: true, passed: true, left: pp.exp - Date.now(), videoId: video.videoId,
        watchSec: video.watchSec, requireComment: video.requireComment, title: video.title, hint: video.hint });
      return send(res, 200, { ok: true, enabled: true, videoId: video.videoId, watchSec: video.watchSec,
        requireComment: video.requireComment, minChars: video.minChars, title: video.title, hint: video.hint,
        codeMode: CODE_MODE && !!video.requireComment });
    }
    if (url === '/api/getkey/video/start' && req.method === 'POST') {
      if (throttled(req)) return send(res, 200, { ok: false, msg: 'Too many requests, wait a minute' });
      if (!video.enabled) return send(res, 200, { ok: false, msg: 'Video step is off' });
      const sid = crypto.randomBytes(16).toString('hex');
      const code = 'AM' + randWord(6);
      vSessions.set(sid, { at: Date.now(), code });
      return send(res, 200, { ok: true, sid, code: CODE_MODE && video.requireComment ? code : undefined });
    }
    if (url === '/api/getkey/video/done' && req.method === 'POST') {
      if (throttled(req)) return send(res, 200, { ok: false, msg: 'Too many requests, wait a minute' });
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
          if (s.lastCheck && Date.now() - s.lastCheck < 6000) return send(res, 200, { ok: false, msg: 'Checking your comment, please wait…' });
          s.lastCheck = Date.now(); s.n = (s.n || 0) + 1;
          let c = null, open = false;
          try { c = await ytFindByCode(s.code, s.n % 3 === 0); }
          catch (e) {
            if (e.quota && QUOTA_OPEN) open = true;
            else if (e.quota) return send(res, 200, { ok: false, quota: true, msg: QUOTA_MSG });
            else return send(res, 200, { ok: false, msg: 'Could not check comments yet, retrying… (' + e.message + ')' });
          }
          if (!open) {
            if (!c) return send(res, 200, { ok: false, msg: 'Comment with your code not found yet. Post it publicly on the video, then wait a few seconds…' });
            if (usedComments.has(c.id)) return send(res, 200, { ok: false, msg: 'This comment was already used' });
            if (c.text.toUpperCase().split(s.code).join('').trim().length < video.minChars) return send(res, 200, { ok: false, msg: 'Write a longer comment (at least ' + video.minChars + ' characters) with your code' });
            if (!c.author) return send(res, 200, { ok: false, msg: 'Could not read your channel from the comment' });
            let sub, isOwner = false;
            try { isOwner = c.author === await ownChannelId(); } catch (e) {}
            try { sub = isOwner ? true : await ytSubPublic(c.author); }   // the channel owner cannot subscribe to own channel
            catch (e) {
              if (e.quota && QUOTA_OPEN) sub = true;
              else if (e.quota) return send(res, 200, { ok: false, quota: true, msg: QUOTA_MSG });
              else return send(res, 200, { ok: false, msg: 'Could not check subscription yet, retrying… (' + e.message + ')' });
            }
            if (sub === false) return send(res, 200, { ok: false, notSubscribed: true, msg: 'You have not subscribed to the channel yet. Subscribe with the same account you commented with.' });
            if (sub === null && SUB_STRICT) return send(res, 200, { ok: false, msg: 'Your subscriptions are private. On YouTube: Settings > Privacy > turn OFF "Keep all my subscriptions private", then try again.' });
            author = c.author; usedComments.add(c.id);
          }
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
      const pgid = author ? chanGid(author) : ipGid(req);
      let pexp = passes[pgid], already = true;
      if (!(pexp > Date.now())) {                    // first time (or the last pass ended): new pass
        already = false;
        pexp = Date.now() + (video.passHours || 12) * 3600000;
        passes[pgid] = pexp; fbq('/passes/' + pgid, 'PUT', pexp);
        video.stats.done++; if (b.commented) video.stats.commented++;
        fb('/video/stats', 'PUT', video.stats).catch(() => {});
      }
      const vt = crypto.randomBytes(18).toString('hex');
      vTokens.set(vt, { exp: Date.now() + 36e5, author, gid: pgid });
      return send(res, 200, { ok: true, vtoken: vt, pass: mkPass(pgid, pexp), passLeft: pexp - Date.now(), already });
    }

    // ---- get a free key ----
    if (url === '/api/getkey' && req.method === 'POST') {
      if (throttled(req)) return send(res, 429, { ok: false, msg: 'Too many requests, wait a minute' });
      if (!store.loaded) return send(res, 503, { ok: false, msg: 'Server database not ready: ' + (store.error || 'try again') });
      if (!settings.freeEnabled) return send(res, 403, { ok: false, msg: settings.closedMsg || 'Free keys are closed right now' });
      const b = await body(req);

      // 0) video step
      let vrec = null;
      if (video.enabled && video.videoId) {
        vrec = vTokens.get(b.vtoken);
        if (vrec && Date.now() > vrec.exp) vrec = null;
        if (!vrec && b.pass) { const pp = readPass(b.pass); if (pp) vrec = { gid: pp.gid, author: '', exp: pp.exp }; }
        if (!vrec) return send(res, 200, { ok: false, needVideo: true, msg: 'Watch the video first' });
      }
      // 1) YouTube subscribe check
      let gid = '';
      if (GOOGLE_CLIENT_ID) {
        if (!b.token) return send(res, 400, { ok: false, msg: 'Sign in with Google to verify your subscription' });
        let r;
        try { r = await ytGoogle(String(b.token)); }
        catch (e) { return send(res, 401, { ok: false, msg: 'Verification failed: ' + e.message }); }
        if (!r.subbed) return send(res, 403, { ok: false, notSubscribed: true, msg: 'You have not subscribed yet. Subscribe to the channel, then try again.' });
        gid = r.channelId ? chanGid(r.channelId) : '';
        if (vrec && vrec.gid && vrec.gid[0] === 'c' && gid && vrec.gid !== gid)
          return send(res, 403, { ok: false, needVideo: true, msg: 'The video step was done with another Google account' });
      } else if (!okTicket(b.ticket)) {
        return send(res, 403, { ok: false, msg: 'Subscribe on YouTube first, then press verify' });
      } else if (vrec && vrec.gid) {
        gid = vrec.gid;   // no-login mode: one commenter channel (or IP) = one identity
      }
      // 2) daily limit (per IP and per Google channel)
      const ih = ipHash(req);
      if (settings.dailyLimit > 0) {
        const since = Date.now() - DAY;
        const n = Object.values(keys).filter(v => v.pub && v.created > since && (v.ip === ih || (gid && v.gid === gid))).length;
        if (n >= settings.dailyLimit) return send(res, 429, { ok: false, msg: 'Daily limit reached (' + settings.dailyLimit + ' key' + (settings.dailyLimit > 1 ? 's' : '') + ' per day). Try again tomorrow.' });
      }
      // 3) new random key
      const lo = settings.minMin, hi = Math.max(settings.maxMin, settings.minMin);
      const minutes = lo + 5 * crypto.randomInt(0, Math.floor((hi - lo) / 5) + 1);
      let key;
      do { key = 'ANUBHAB-MODZ-' + randWord(8); } while (keys[key]);
      const now = Date.now();
      const obj = { created: now, activatedAt: now, exp: now + minutes * 60000, pub: 1, max: settings.freeDevices, ip: ih, note: 'Free ' + fmtDur(minutes) };
      if (gid) obj.gid = gid;
      try { await fb('/keys/' + key, 'PUT', obj); }
      catch (e) { store.error = 'Save failed: ' + e.message; return send(res, 500, { ok: false, msg: 'Could not save key, try again' }); }
      keys[key] = { ...obj, devices: {} };
      if (b.vtoken) vTokens.delete(b.vtoken);   // video token is one-time
      return send(res, 200, { ok: true, key, exp: obj.exp, total: minutes * 60000, minutes });
    }

    // ================= ADMIN API =================
    if (url.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return send(res, 401, { ok: false, msg: 'Wrong admin password' });

      if (req.method === 'GET' && url === '/api/admin/status')
        return send(res, 200, { ok: true, ...store, freeEnabled: settings.freeEnabled, settings, ytMode: GOOGLE_CLIENT_ID ? 'google' : 'soft', commentCheck: !!YT_API_KEY, free: freeStats() });

      if (req.method === 'POST' && url === '/api/admin/settings') {
        const b = await body(req);
        const n = { ...settings };
        const str = (v, max, d) => (v === undefined ? d : String(v).trim().slice(0, max));
        if (b.freeEnabled !== undefined) n.freeEnabled = !!b.freeEnabled;
        n.minMin = clamp(b.minMin, 5, 1440, n.minMin);
        n.maxMin = clamp(b.maxMin, n.minMin, 1440, Math.max(n.maxMin, n.minMin));
        n.freeDevices = clamp(b.freeDevices, 1, MAX_DEVICES, n.freeDevices);
        n.dailyLimit = clamp(b.dailyLimit, 0, 100, n.dailyLimit);
        n.waitSec = clamp(b.waitSec, 10, 120, n.waitSec);
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

      if (req.method === 'POST' && url === '/api/admin/update') {
        const b = await body(req);
        const n = { ...update };
        n.enabled = !!b.enabled;
        n.latest = clamp(b.latest, 0, 2000000000, n.latest || 0);
        if (b.title !== undefined) n.title = String(b.title).trim().slice(0, 60) || 'Update Available';
        if (b.message !== undefined) n.message = String(b.message).trim().slice(0, 300);
        if (b.link !== undefined) {
          const l = String(b.link).trim().slice(0, 300);
          if (l && !/^https?:\/\//i.test(l)) return send(res, 400, { ok: false, msg: 'Link must start with https://' });
          n.link = l;
        }
        try { await fb('/update', 'PUT', n); }
        catch (e) { return send(res, 500, { ok: false, msg: 'Firebase save failed: ' + e.message }); }
        update = n;
        return send(res, 200, { ok: true, ...update });
      }

      if (req.method === 'GET' && url === '/api/admin/video') return send(res, 200, { ok: true, video });
      if (req.method === 'POST' && url === '/api/admin/video') {
        const b = await body(req);
        const id = extractId(b.video);
        if (b.enabled && !id && !video.videoId) return send(res, 200, { ok: false, msg: 'Valid YouTube link needed' });
        const n = { ...video, stats: { ...video.stats } };
        n.enabled = !!b.enabled;
        if (id) n.videoId = id;
        n.watchSec = clamp(b.watchSec, 5, 600, n.watchSec);
        n.minChars = clamp(b.minChars, 1, 200, n.minChars);
        n.passHours = clamp(b.passHours, 1, 168, n.passHours || 12);
        n.requireComment = !!b.requireComment;
        n.title = String(b.title || '').slice(0, 40) || VDEF.title;
        n.hint = String(b.hint || '').slice(0, 100);
        try { await fb('/video', 'PUT', n); }
        catch (e) { return send(res, 200, { ok: false, msg: 'Firebase save failed: ' + e.message }); }
        video = n;
        return send(res, 200, { ok: true, video });
      }
      if (req.method === 'POST' && url === '/api/admin/video/reset-passes') {
        passes = {};
        try { await fb('/passes', 'DELETE'); } catch (e) { return send(res, 200, { ok: false, msg: 'Firebase save failed: ' + e.message }); }
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url === '/api/admin/video/reset-stats') {
        video.stats = { done: 0, commented: 0 };
        try { await fb('/video/stats', 'PUT', video.stats); } catch (e) { return send(res, 200, { ok: false, msg: 'Firebase save failed: ' + e.message }); }
        return send(res, 200, { ok: true, video });
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
            const obj = { created: Date.now(), activatedAt: 0, exp: 0 };
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
          if (act[2] === 'reset') {
            await fb('/keys/' + key + '/devices', 'DELETE');
            k.devices = {};
          } else {
            if (!k.activatedAt) return send(res, 400, { ok: false, msg: 'Key not used yet (its 1 day starts at first login)' });
            k.exp = Math.max(k.exp, Date.now()) + DAY;
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
      return send(res, 404, { ok: false, msg: 'Unknown admin route' });
    }

    return send(res, 404, { ok: false, msg: 'Not found' });
  } catch (e) {
    console.error('request error', e);
    try { send(res, 500, { ok: false, msg: 'Server error' }); } catch (_) {}
  }
}).listen(PORT, () => { console.log('Anubhab Modz API listening on ' + PORT); load(); });
