const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// In-Memory Database for Keys & Settings (survives while server runs)
let keysDb = [];
let settingsDb = {
  freeEnabled: true,
  minMin: 60,
  maxMin: 180,
  freeDevices: 1,
  dailyLimit: 0,
  waitSec: 15,
  title: 'ANUBHAB MODZ',
  subtitle: 'Free access key generator',
  notice: '',
  closedMsg: 'Free keys are closed right now.',
  ytUrl: 'https://youtube.com/@anubhab_mods',
  ytHandle: '@anubhab_mods'
};

// 1. Serve Admin & Public Web Pages
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/getkey', (req, res) => {
  res.sendFile(path.join(__dirname, 'getkey.html'));
});

// 2. Import video-step module (Must come BEFORE your API routes)
require('./video-step')(app, {
  isAdmin: req => req.headers['x-admin-pass'] === process.env.ADMIN_PASS,
  ytKey: process.env.YT_API_KEY
});

// 3. Admin Status Route
app.get('/api/admin/status', (req, res) => {
  if (req.headers['x-admin-pass'] !== process.env.ADMIN_PASS) {
    return res.status(401).json({ ok: false, msg: 'Wrong password' });
  }
  const activeCount = keysDb.filter(k => !k.activatedAt || (Date.now() < k.exp)).length;
  res.json({
    ok: true,
    loaded: true,
    db: 'Memory Database',
    freeEnabled: settingsDb.freeEnabled,
    settings: settingsDb,
    free: { total: keysDb.length, active: activeCount, today: keysDb.length }
  });
});

// 4. Admin Settings Update Route
app.post('/api/admin/settings', (req, res) => {
  if (req.headers['x-admin-pass'] !== process.env.ADMIN_PASS) {
    return res.status(401).json({ ok: false, msg: 'Wrong password' });
  }
  settingsDb = Object.assign({}, settingsDb, req.body);
  res.json({ ok: true, settings: settingsDb });
});

// 5. Admin Generate Keys Route
app.post('/api/admin/generate', (req, res) => {
  if (req.headers['x-admin-pass'] !== process.env.ADMIN_PASS) {
    return res.status(401).json({ ok: false, msg: 'Wrong password' });
  }
  const count = parseInt(req.body.count, 10) || 1;
  const newKeys = [];
  for (let i = 0; i < count; i++) {
    const kStr = 'AM-' + Math.random().toString(36).substring(2, 10).toUpperCase();
    const keyObj = {
      key: kStr,
      note: req.body.note || '',
      max: settingsDb.freeDevices || 1,
      devices: 0,
      exp: Date.now() + (settingsDb.maxMin || 180) * 60 * 1000,
      activatedAt: null,
      pub: true
    };
    keysDb.unshift(keyObj);
    newKeys.push(kStr);
  }
  res.json({ ok: true, keys: newKeys });
});

// 6. Admin List Keys Route
app.get('/api/admin/keys', (req, res) => {
  if (req.headers['x-admin-pass'] !== process.env.ADMIN_PASS) {
    return res.status(401).json({ ok: false, msg: 'Wrong password' });
  }
  res.json({ ok: true, keys: keysDb });
});

// 7. Public Getkey Status Route
app.get('/api/getkey/status', (req, res) => {
  res.json({
    ok: true,
    enabled: settingsDb.freeEnabled,
    mode: 'soft',
    minMin: settingsDb.minMin,
    maxMin: settingsDb.maxMin,
    waitSec: settingsDb.waitSec,
    title: settingsDb.title,
    subtitle: settingsDb.subtitle,
    notice: settingsDb.notice,
    closedMsg: settingsDb.closedMsg,
    ytUrl: settingsDb.ytUrl,
    ytHandle: settingsDb.ytHandle
  });
});

app.get('/api/getkey/ticket', (req, res) => {
  res.json({ ok: true, ticket: Math.random().toString(36).substring(2) });
});

// 8. Public Generate Key Route (Guarded by video step if enabled)
app.post('/api/getkey', (req, res) => {
  if (!settingsDb.freeEnabled) {
    return res.json({ ok: false, msg: settingsDb.closedMsg || 'Free keys are closed' });
  }
  
  const durationMinutes = Math.floor(Math.random() * (settingsDb.maxMin - settingsDb.minMin + 1)) + settingsDb.minMin;
  const totalMs = durationMinutes * 60 * 1000;
  const kStr = 'FREE-' + Math.random().toString(36).substring(2, 10).toUpperCase();
  
  const keyObj = {
    key: kStr,
    note: 'Website User',
    max: settingsDb.freeDevices || 1,
    devices: 1,
    exp: Date.now() + totalMs,
    activatedAt: Date.now(),
    pub: true
  };
  
  keysDb.unshift(keyObj);
  res.json({ ok: true, key: kStr, exp: keyObj.exp, total: totalMs });
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
