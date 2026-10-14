const express = require('express');
const app = express();

const PORT = process.env.PORT || 10000;

app.use(express.json());

// Allowed keys database
let keysDatabase = [
    { key: "ANUBHAB MODZ", status: "active", expires: "2026-12-31" }
];

// Home Route
app.get('/', (req, res) => {
    res.json({
        status: "Online",
        message: "ANUBHAB MODZ New Key Server is Running!",
        developer: "ANUBHAB MODZ"
    });
});

// Key Verify Endpoint (एपले यही लिङ्क जाँच गर्नेछ)
app.get('/api/verify', (req, res) => {
    const userKey = req.query.key;

    if (!userKey) {
        return res.status(400).json({ 
            success: false, 
            message: "Key is missing!" 
        });
    }

    const found = keysDatabase.find(k => k.key.trim() === userKey.trim() && k.status === "active");

    if (found) {
        return res.json({ 
            success: true, 
            message: "Key Validated Successfully!",
            key: found.key,
            status: found.status
        });
    } else {
        return res.status(401).json({ 
            success: false, 
            message: "Invalid or Expired Key!" 
        });
    }
});

// नयाँ Key थप्ने Admin Route
app.post('/api/add-key', (req, res) => {
    const { newKey, secret } = req.body;
    
    if (secret !== "anubhab_secret_pass") {
        return res.status(403).json({ success: false, message: "Unauthorized access!" });
    }

    if (!newKey) {
        return res.status(400).json({ success: false, message: "Key text required!" });
    }

    keysDatabase.push({ key: newKey, status: "active", expires: "2026-12-31" });
    res.json({ success: true, message: "Key added successfully!", keys: keysDatabase });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});
