const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function generateKeys() {
    console.log("Generating RSA 2048 Key Pair...");
    
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: {
            type: 'spki',
            format: 'pem'
        },
        privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem'
        }
    });

    // 1. Setup Server Keys Directory
    const serverKeysDir = path.join(__dirname, 'neofisystem_web/keys');
    if (!fs.existsSync(serverKeysDir)) {
        fs.mkdirSync(serverKeysDir, { recursive: true });
    }

    // Save Private Key (Server Only)
    fs.writeFileSync(path.join(serverKeysDir, 'private.pem'), privateKey);
    console.log(`[Server] Private Key saved to: ${path.join(serverKeysDir, 'private.pem')}`);
    
    // Save Public Key (Server Reference)
    fs.writeFileSync(path.join(serverKeysDir, 'public.pem'), publicKey);
    console.log(`[Server] Public Key saved to: ${path.join(serverKeysDir, 'public.pem')}`);
    
    // 2. Setup Client Keys Directory
    const clientKeysDir = path.join(__dirname, 'src/config');
    if (!fs.existsSync(clientKeysDir)) {
        fs.mkdirSync(clientKeysDir, { recursive: true });
    }

    // Save Public Key (Client Verification)
    fs.writeFileSync(path.join(clientKeysDir, 'license_public.pem'), publicKey);
    console.log(`[Client] Public Key saved to: ${path.join(clientKeysDir, 'license_public.pem')}`);

    console.log('\n✅ Keys generated successfully!');
    console.log('   - Private Key: Used by Licensing Server to sign licenses.');
    console.log('   - Public Key:  Used by Piso Wifi Client to verify signatures.');
}

generateKeys();
