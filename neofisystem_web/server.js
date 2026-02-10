const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./database/db');

const app = express();
const PORT = 8080; // Running on port 8080 to avoid conflict with main app (3000)

app.use(cors());
app.use(bodyParser.json());

// Load Private Key
const privateKey = fs.readFileSync(path.join(__dirname, 'keys/private.pem'), 'utf8');

// Helper: Sign Data
function signData(data) {
    const sign = crypto.createSign('SHA256');
    sign.update(JSON.stringify(data));
    sign.end();
    return sign.sign(privateKey, 'base64');
}

// Helper: Generate License Key
function generateLicenseKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = 'NEO';
    for (let i = 0; i < 3; i++) {
        key += '-';
        for (let j = 0; j < 4; j++) {
            key += chars.charAt(Math.floor(Math.random() * chars.length));
        }
    }
    return key;
}

// API: Generate New License (Admin only - practically)
app.post('/api/admin/generate', (req, res) => {
    // In production, add authentication here!
    const key = generateLicenseKey();
    try {
        const stmt = db.prepare('INSERT INTO licenses (license_key) VALUES (?)');
        stmt.run(key);
        res.json({ success: true, key });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Activate License
app.post('/api/activate', (req, res) => {
    const { key, hwid } = req.body;

    if (!key || !hwid) {
        return res.status(400).json({ success: false, error: 'Missing key or hwid' });
    }

    const license = db.prepare('SELECT * FROM licenses WHERE license_key = ?').get(key);

    if (!license) {
        return res.status(404).json({ success: false, error: 'Invalid license key' });
    }

    if (license.status === 'revoked') {
        return res.status(403).json({ success: false, error: 'License revoked' });
    }

    // If unused, bind it
    if (license.status === 'unused') {
        db.prepare('UPDATE licenses SET status = ?, hwid = ?, activated_at = ? WHERE id = ?')
          .run('active', hwid, new Date().toISOString(), license.id);
        
        const payload = { key, hwid, type: 'full', activated_at: new Date().toISOString() };
        const signature = signData(payload);
        
        return res.json({ success: true, token: payload, signature });
    }

    // If active, check HWID
    if (license.status === 'active') {
        if (license.hwid === hwid) {
            // Re-issue signature
            const payload = { key, hwid, type: 'full', activated_at: license.activated_at };
            const signature = signData(payload);
            return res.json({ success: true, token: payload, signature });
        } else {
            return res.status(403).json({ success: false, error: 'License already used on another device' });
        }
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`License Server running on http://localhost:${PORT}`);
});
