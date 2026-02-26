
const configService = require('../services/configService');
const licenseService = require('../services/licenseService');

// Mock Config for standalone test
configService.get = (key) => {
    if (key === 'license_backend') return 'supabase';
    if (key === 'supabase_activation_url') return 'https://nmrhhxsfcxabmoqriloj.supabase.co/functions/v1/activate';
    if (key === 'supabase_project_url') return 'https://nmrhhxsfcxabmoqriloj.supabase.co';
    if (key === 'supabase_anon_key') return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5tcmhoeHNmY3hhYm1vcXJpbG9qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0MDE3MzMsImV4cCI6MjA4NTk3NzczM30.jpX2PSm7wgzyFLRcLrC5sAi67o4fdDg0j11KIYfFfYA';
    return null;
};

async function test() {
    console.log('--- Starting Final Activation Verification ---');
    console.log('Generated HWID:', licenseService.hwid);
    
    // Use the known key
    const key = 'NEO-7CVJ-AMP0-YJQ9';
    
    try {
        console.log(`Attempting to activate with key: ${key}`);
        const result = await licenseService.activateLicense(key);
        console.log('Activation Result:', result);
    } catch (e) {
        console.error('Activation Failed:', e.message);
    }
}

test();
