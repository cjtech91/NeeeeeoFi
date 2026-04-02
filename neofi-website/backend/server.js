const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = 5000;

app.use(cors());
app.use(bodyParser.json());

// In-memory database (Replace with MongoDB/SQL in production)
let licenses = [];

// --- API FOR DASHBOARD (Frontend) ---

// Get all licenses
app.get('/api/licenses', (req, res) => {
    res.json(licenses);
});

// Generate a new license (Admin/User action)
app.post('/api/license/generate', (req, res) => {
    const { owner, duration, name } = req.body;

    if (!owner || !duration) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Generate unique key format: PW-YYYY-XXXXXXXX
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = 'PW-' + new Date().getFullYear() + '-';
    for (let i = 0; i < 8; i++) key += chars.charAt(Math.floor(Math.random() * chars.length));

    // Calculate expiry
    const expiryDate = new Date();
    if (duration === 'lifetime') {
        expiryDate.setFullYear(expiryDate.getFullYear() + 99);
    } else {
        expiryDate.setMonth(expiryDate.getMonth() + parseInt(duration));
    }

    const newLicense = {
        id: licenses.length + 1,
        license: key, // The key used for activation
        owner,
        name: name || 'Unassigned Device',
        machineId: null, // Starts null, bound upon first activation
        status: 'generated', // generated -> active -> expired
        duration,
        expiry: expiryDate.toISOString().split('T')[0],
        createdAt: new Date().toISOString(),
        deviceInfo: null
    };

    licenses.unshift(newLicense); // Add to top
    console.log(`[License Generated] ${key} for ${owner}`);
    res.json({ success: true, license: newLicense });
});


// --- API FOR DEVICES (Peso Wifi Machines) ---

// 1. Activation Endpoint
// The device calls this when the user enters the license key on the machine.
// Payload: { "licenseKey": "PW-2024-...", "machineId": "AA:BB:CC:DD:EE:FF", "deviceInfo": {...} }
app.post('/api/license/activate', (req, res) => {
    const { licenseKey, machineId, deviceInfo } = req.body;

    console.log(`[Activation Attempt] Key: ${licenseKey}, Machine: ${machineId}`);

    if (!licenseKey || !machineId) {
        return res.status(400).json({ success: false, message: 'Missing license key or machine ID' });
    }

    const license = licenses.find(l => l.license === licenseKey);

    // 1. Check if license exists
    if (!license) {
        return res.status(404).json({ success: false, message: 'Invalid License Key' });
    }

    // 2. Check if already bound to a DIFFERENT machine
    if (license.machineId && license.machineId !== machineId) {
        return res.status(403).json({ 
            success: false, 
            message: 'License is already used on another device',
            boundTo: license.machineId 
        });
    }

    // 3. Check if expired
    if (new Date(license.expiry) < new Date()) {
        license.status = 'expired';
        return res.status(403).json({ success: false, message: 'License has expired' });
    }

    // 4. Bind the device (First time activation)
    if (!license.machineId) {
        license.machineId = machineId;
        license.status = 'active';
        license.activatedAt = new Date().toISOString();
        license.deviceInfo = deviceInfo || {}; // Save IP, OS, etc.
        console.log(`[Activation Success] Bound ${licenseKey} to ${machineId}`);
    }

    // 5. Return Success
    res.json({
        success: true,
        message: 'Activation Successful',
        status: 'active',
        expiry: license.expiry,
        owner: license.owner,
        plan: license.duration
    });
});

// 2. Validation/Heartbeat Endpoint
// The device calls this periodically to check if it's still allowed to run.
app.post('/api/license/validate', (req, res) => {
    const { licenseKey, machineId } = req.body;
    const license = licenses.find(l => l.license === licenseKey);

    if (!license || license.machineId !== machineId) {
        return res.json({ valid: false, message: 'Invalid or Unbound License' });
    }

    if (new Date(license.expiry) < new Date()) {
        return res.json({ valid: false, message: 'License Expired' });
    }

    res.json({ valid: true, expiry: license.expiry });
});

// 3. Transfer License Endpoint
// Allows an owner (or admin) to transfer a license to another user.
app.post('/api/license/transfer', (req, res) => {
    const { licenseKey, newOwner } = req.body;

    if (!licenseKey || !newOwner) {
        return res.status(400).json({ success: false, message: 'Missing license key or new owner' });
    }

    const license = licenses.find(l => l.license === licenseKey);

    if (!license) {
        return res.status(404).json({ success: false, message: 'License not found' });
    }

    // Update the owner
    const oldOwner = license.owner;
    license.owner = newOwner;
    
    console.log(`[License Transfer] ${licenseKey} transferred from ${oldOwner} to ${newOwner}`);

    res.json({
        success: true,
        message: 'License transferred successfully',
        license: license
    });
});

app.listen(PORT, () => {
    console.log(`\n--- NeoFi License Server running on port ${PORT} ---`);
    console.log(`Dashboard API: http://localhost:${PORT}/api/licenses`);
    console.log(`Device Activation: POST http://localhost:${PORT}/api/license/activate`);
});
