const { db } = require('./src/database/db');
const row = db.prepare("SELECT value FROM settings WHERE key = 'network_config'").get();
if (row && row.value) {
    console.log(JSON.stringify(JSON.parse(row.value), null, 2));
} else {
    console.log('No network_config found in DB');
}
