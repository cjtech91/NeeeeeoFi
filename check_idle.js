
const { db } = require('./src/database/db');
const row = db.prepare("SELECT * FROM settings WHERE key = 'idle_timeout_seconds'").get();
console.log('Settings:', row);
