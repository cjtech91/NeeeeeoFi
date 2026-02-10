const { db } = require('../database/db');
const configService = require('../services/configService');

// Initialize config service (load settings)
configService.init();

console.log('--- Configuration ---');
const idleTimeout = configService.get('idle_timeout_seconds');
console.log(`Global idle_timeout_seconds: ${idleTimeout} (Type: ${typeof idleTimeout})`);

console.log('\n--- Users with non-null idle_timeout ---');
const users = db.prepare("SELECT mac_address, idle_timeout FROM users WHERE idle_timeout IS NOT NULL").all();
if (users.length === 0) {
    console.log('No users with custom idle_timeout.');
} else {
    users.forEach(u => {
        console.log(`MAC: ${u.mac_address}, Idle: ${u.idle_timeout}`);
    });
}

console.log('\n--- Users active/connected ---');
const active = db.prepare("SELECT mac_address, idle_timeout, last_traffic_at FROM users WHERE is_connected = 1").all();
active.forEach(u => {
    console.log(`MAC: ${u.mac_address}, Idle: ${u.idle_timeout}, LastTraffic: ${u.last_traffic_at}`);
});
