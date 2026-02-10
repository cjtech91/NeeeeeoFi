const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../database/pisowifi.sqlite');
const db = new Database(dbPath);

console.log('--- Checking Footer Settings ---');
const textRow = db.prepare("SELECT * FROM settings WHERE key = 'portal_footer_text'").get();
const linkRow = db.prepare("SELECT * FROM settings WHERE key = 'portal_footer_link'").get();

console.log('portal_footer_text:', textRow ? textRow.value : 'NOT FOUND');
console.log('portal_footer_link:', linkRow ? linkRow.value : 'NOT FOUND');
