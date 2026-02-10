const { db } = require('./src/database/db');
const info = db.prepare('PRAGMA table_info(chat_messages)').all();
console.log(JSON.stringify(info, null, 2));
