const { db } = require('../database/db');
const configService = require('../services/configService');

// Initialize config service
configService.init();

console.log('--- Resetting Idle Timeout Configuration ---');

// 1. Fix Global Setting
const currentGlobal = configService.get('idle_timeout_seconds');
console.log(`Current Global Setting: ${currentGlobal}`);

if (currentGlobal !== 120) {
    console.log('Updating Global Setting to 120s...');
    configService.set('idle_timeout_seconds', 120);
    console.log('Global Setting Updated.');
} else {
    console.log('Global Setting is already 120s.');
}

// 2. Fix User Settings
console.log('\n--- Checking User Overrides ---');
const usersWithOverride = db.prepare("SELECT count(*) as count FROM users WHERE idle_timeout IS NOT NULL AND idle_timeout != 120").get();

if (usersWithOverride.count > 0) {
    console.log(`Found ${usersWithOverride.count} users with custom idle timeout (not 120s).`);
    console.log('Resetting all users to use Global Default (NULL)...');
    
    const info = db.prepare("UPDATE users SET idle_timeout = NULL").run();
    console.log(`Updated ${info.changes} users.`);
} else {
    console.log('No users with conflicting custom idle timeout found.');
}

console.log('\n✅ Idle Timeout Reset Complete.');
console.log('Please restart the service for changes to take full effect:');
console.log('  systemctl restart pisowifi.service');
