const db = require('./database/db');
const crypto = require('crypto');

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

const key = generateLicenseKey();
try {
    const stmt = db.prepare('INSERT INTO licenses (license_key) VALUES (?)');
    stmt.run(key);
    console.log('------------------------------------------------');
    console.log('License Key Generated Successfully:');
    console.log(key);
    console.log('------------------------------------------------');
} catch (err) {
    console.error('Error generating license:', err.message);
}
