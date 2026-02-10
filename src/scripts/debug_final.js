
const licenseService = require('../services/licenseService');

async function test() {
    console.log('--- Starting Final Activation Verification ---');
    console.log('Generated HWID:', licenseService.hwid);
    
    // Use the known key
    const key = 'NEO-2026-IFX6-6EPS';
    
    try {
        console.log(`Attempting to activate with key: ${key}`);
        const result = await licenseService.activateLicense(key);
        console.log('Activation Result:', result);
    } catch (e) {
        console.error('Activation Failed:', e.message);
    }
}

test();
