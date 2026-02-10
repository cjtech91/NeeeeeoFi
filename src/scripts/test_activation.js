
const licenseService = require('../services/licenseService');

async function test() {
    console.log('--- Starting Manual Activation Test ---');
    
    // 1. Force set the HWID to the one user provided (to match their context)
    // or just let it generate and see what it is.
    // Let's print the generated one first.
    console.log('Generated HWID:', licenseService.hwid);
    
    // Overwrite for test if needed, but better to test with what the system generates
    // licenseService.hwid = '0d9b014325996864f24d4427270db96dac07d62128eecca6ed448dec3030571c';
    
    const key = 'TEST_KEY_12345';
    
    try {
        console.log(`Attempting to activate with key: ${key}`);
        const result = await licenseService.activateLicense(key);
        console.log('Activation Result:', result);
    } catch (e) {
        console.error('Activation Failed:', e.message);
    }
}

test();
