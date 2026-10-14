// video-step.js — server side of the "Watch video" step
// Put this file next to server.js (Render / GitHub), then in server.js add:
//
//   require('./video-step')(app, {
//     isAdmin: req => req.headers['x-admin-pass'] === process.env.ADMIN_PASS, // use YOUR admin check
//     store: {                                   // use YOUR Firebase so settings survive restarts
//       get: async () => (await admin.database().ref('freeVideo').once('value')).val(),
//       set: async c => admin.database().ref('freeVideo').set(c)
//     },
//     ytKey: process.env.YT_API_KEY              // optional: verifies real comments via YouTube API
//   });
//
// IMPORTANT: this line must come AFTER cors()/express.json() and BEFORE your existing
// app.post('/api/getkey', ...) route, because it guards that route.

const crypto = require('crypto');

module.exports = function (app, opts) {
  opts = opts || {};
  const express = opts.express || require('express');
  const isAdmin = opts.isAdmin || (() => false);
  const ytKey = opts.ytKey || '';
  let mem = null;
  const store = opts.store || {                       // fallback: memory only (resets on restart)
    get: async () => mem,
    set: async c => { mem = JSON.parse(JSON.stringify(c)); }
  };
  if (!opts.store) console.warn('[video-step] no store given, settings reset on restart');

  const json = express.json({ limit: '10kb' });
  const DEF = { enabled: false, videoId: '', watchSec: 30, requireComment: false, minChars: 5, title: 'Watch the video', hint: '', stats: { done: 0, commented: 0 } };
  let cfg = null;
  async function getCfg() {
    if (!cfg) {
      let s = null; try { s = await store.get(); } catch (e) {}
      cfg = Object.assign({}, DEF, s || {});
      cfg.stats = Object.assign({}, DEF.stats, cfg.stats || {});
    }
    return cfg;
  }
  const saveCfg = async () => { try { await store.set(cfg); } catch (e) { console.error('[video-step] save failed', e.message); } };

  const extractId = s => {
    s = String(s || '').trim();
    if (/^[\w-]{11}$/.test(s)) return s;
    const m = s.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/|\/v\/)([\w-]{11})/);
    return m ? m[1] : '';
  };
  const clamp = (n, a, b, d) => { n = parseInt(n, 10); return isNaN(n) ? d : Math.max(a, Math.min(b, n)); };

  const sessions = new Map();   // sid -> {at}
  const tokens = new Map();     // vtoken -> expiry
  setInterval(() => {
    const n = Date.now();
    sessions.forEach((v, k) => { if (n - v.at > 36e5) sessions.delete(k); });
    tokens.forEach((v, k) => { if (n > v) tokens.delete(k); });
  }, 60000).unref();

  /* ---------- public ---------- */
  app.get('/api/getkey/video', async (req, res) => {
    const c = await getCfg();
    if (!c.enabled || !c.videoId) return res.json({ ok: true, enabled: false });
    res.json({ ok: true, enabled: true, videoId: c.videoId, watchSec: c.watchSec, requireComment: c.requireComment, minChars: c.minChars, title: c.title, hint: c.hint });
  });

  app.post('/api/getkey/video/start', json, async (req, res) => {
    const c = await getCfg();
    if (!c.enabled) return res.json({ ok: false, msg: 'Video step is off' });
    const sid = crypto.randomBytes(16).toString('hex');
    sessions.set(sid, { at: Date.now() });
    res.json({ ok: true, sid });
  });

  app.post('/api/getkey/video/done', json, async (req, res) => {
    const c = await getCfg(), b = req.body || {};
    const s = sessions.get(b.sid);
    if (!s) return res.json({ ok: false, msg: 'Session expired, reload the page' });
    const need = Math.max(5, Math.min(c.watchSec, (parseInt(b.dur, 10) || c.watchSec) - 1));
    const elapsed = (Date.now() - s.at) / 1000;
    if (elapsed < need * 0.9 || (+b.watched || 0) < need * 0.9) return res.json({ ok: false, msg: 'Please watch the video fully' });
    if (c.requireComment) {
      if (!b.commented) return res.json({ ok: false, msg: 'Please comment on the video' });
      if (ytKey && b.commentId) {   // real comment check
        try {
          const r = await fetch('https://www.googleapis.com/youtube/v3/comments?part=snippet&id=' + encodeURIComponent(String(b.commentId).slice(0, 80)) + '&key=' + ytKey);
          const j = await r.json();
          const it = j.items && j.items[0];
          if (!it || (it.snippet.videoId && it.snippet.videoId !== c.videoId)) return res.json({ ok: false, msg: 'Comment not found on the video' });
        } catch (e) { /* YouTube API down: do not block the user */ }
      }
    }
    sessions.delete(b.sid);
    const vt = crypto.randomBytes(18).toString('hex');
    tokens.set(vt, Date.now() + 36e5);
    c.stats.done++; if (b.commented) c.stats.commented++;
    saveCfg();
    res.json({ ok: true, vtoken: vt });
  });

  /* ---------- guard the existing key route (token is used once, only when a key is really issued) ---------- */
  app.post('/api/getkey', json, async (req, res, next) => {
    const c = await getCfg();
    if (!c.enabled || !c.videoId) return next();
    const t = req.body && req.body.vtoken;
    if (!t || !tokens.has(t) || Date.now() > tokens.get(t)) return res.json({ ok: false, needVideo: true, msg: 'Watch the video first' });
    const j = res.json.bind(res);
    res.json = function (body) { if (body && body.ok) tokens.delete(t); return j(body); };
    next();
  });

  /* ---------- admin ---------- */
  const guard = (req, res) => { if (!isAdmin(req)) { res.status(401).json({ ok: false, msg: 'Wrong password' }); return false; } return true; };

  app.get('/api/admin/video', async (req, res) => {
    if (!guard(req, res)) return;
    res.json({ ok: true, video: await getCfg() });
  });

  app.post('/api/admin/video', json, async (req, res) => {
    if (!guard(req, res)) return;
    const c = await getCfg(), b = req.body || {};
    const id = extractId(b.video);
    if (b.enabled && !id) return res.json({ ok: false, msg: 'Valid YouTube link needed' });
    c.enabled = !!b.enabled;
    if (id) c.videoId = id;
    c.watchSec = clamp(b.watchSec, 5, 600, c.watchSec);
    c.minChars = clamp(b.minChars, 1, 200, c.minChars);
    c.requireComment = !!b.requireComment;
    c.title = String(b.title || '').slice(0, 40) || DEF.title;
    c.hint = String(b.hint || '').slice(0, 100);
    await saveCfg();
    res.json({ ok: true, video: c });
  });

  app.post('/api/admin/video/reset-stats', async (req, res) => {
    if (!guard(req, res)) return;
    const c = await getCfg(); c.stats = { done: 0, commented: 0 }; await saveCfg();
    res.json({ ok: true, video: c });
  });
};
        
