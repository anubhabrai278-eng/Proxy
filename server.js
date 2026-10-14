const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

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

// 3. API Routes for Admin Panel
app.get('/api/admin/status', (req, res) => {
  const pass = req.headers['x-admin-pass'];
  if (pass !== process.env.ADMIN_PASS) {
    return res.status(401).json({ ok: false, msg: 'Wrong password' });
  }
  res.json({
    ok: true,
    loaded: true,
    db: 'In-Memory/Server',
    freeEnabled: true,
    settings: {
      freeEnabled: true,
      minMin: 60,
      maxMin: 180,
      freeDevices: 1,
      dailyLimit: 0,
      waitSec: 15,
      title: 'ANUBHAB MODZ',
      subtitle: 'Free key generator',
      notice: '',
      closedMsg: 'Free keys are closed',
      ytUrl: 'https://youtube.com/@anubhab_mods',
      ytHandle: '@anubhab_mods'
    }
  });
});

app.get('/api/getkey/status', (req, res) => {
  res.json({
    ok: true,
    enabled: true,
    mode: 'soft',
    minMin: 60,
    maxMin: 180,
    waitSec: 15,
    title: 'ANUBHAB MODZ',
    subtitle: 'Free access key generator',
    ytUrl: 'https://youtube.com/@anubhab_mods',
    ytHandle: '@anubhab_mods'
  });
});

app.get('/api/getkey/ticket', (req, res) => {
  res.json({ ok: true, ticket: Math.random().toString(36).substring(2) });
});

// Primary route to generate key
app.post('/api/getkey', (req, res) => {
  const generatedKey = "KEY-" + Math.random().toString(36).substring(2, 10).toUpperCase();
  const exp = Date.now() + (2 * 3600 * 1000); // 2 hours
  res.json({ ok: true, key: generatedKey, exp, total: 2 * 3600 * 1000 });
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
        
