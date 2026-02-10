const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'licenses.db');
const db = new Database(dbPath);

// Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS licenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_key TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'unused', -- unused, active, revoked
    hwid TEXT,
    activated_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

module.exports = db;
