const express = require('express');
const app = express();

app.use(express.json());

// Import video-step module
require('./video-step')(app, {
  isAdmin: req => req.headers['x-admin-pass'] === process.env.ADMIN_PASS,
  ytKey: process.env.YT_API_KEY
});

// Primary route to generate key
app.post('/api/getkey', (req, res) => {
  const generatedKey = "KEY-" + Math.random().toString(36).substring(2, 10).toUpperCase();
  res.json({ ok: true, key: generatedKey });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
