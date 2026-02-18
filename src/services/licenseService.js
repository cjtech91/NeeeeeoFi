const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const configService = require('./configService');
const hardwareService = require('./hardwareService');
const http = require('http');
const https = require('https');
const querystring = require('querystring');

class LicenseService {
    constructor() {
        this.licensePath = path.join(__dirname, '../../data/license.json');
        this.publicKeyPath = path.join(__dirname, '../config/license_public.pem');
        this.hwid = null;
        this.licenseData = null;
        this.isValid = false;
        this.deviceModel = 'Loading...';
        
        // Default activation server
        this.apiUrl = configService.get('license_api_url') || 'http://localhost:8080/api/activate'; 

        this.init();
    }

    init() {
        this.hwid = this.generateHWID();
        this.fetchDeviceModel();
        this.loadLicense();
    }

    async fetchDeviceModel() {
        this.deviceModel = await hardwareService.getDeviceModel();
    }

    generateHWID() {
        try {
            if (process.platform === 'win32') {
                // Windows Dev Mode: Use a fixed ID or MachineGUID
                return 'WIN-DEV-MACHINE-ID-12345';
            }

            // Linux: Try to get MAC address of eth0
            let mac = '';
            try {
                mac = fs.readFileSync('/sys/class/net/eth0/address', 'utf8').trim();
            } catch (e) {
                // Fallback to wlan0 or similar if eth0 missing
                try {
                     mac = execSync('cat /sys/class/net/*/address | head -n 1').toString().trim();
                } catch (e2) {}
            }

            // Linux: Try to get CPU Serial (Raspberry Pi specific)
            let cpuSerial = '';
            try {
                const cpuInfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
                const match = cpuInfo.match(/Serial\s*:\s*([0-9a-f]+)/);
                if (match && match[1]) {
                    cpuSerial = match[1];
                }
            } catch (e) {}

            const rawId = `${mac}-${cpuSerial}`;
            return crypto.createHash('sha256').update(rawId).digest('hex');

        } catch (error) {
            console.error('LicenseService: Failed to generate HWID', error);
            return 'UNKNOWN-HWID';
        }
    }

    loadLicense() {
        try {
            // 1. Initialize Install Date if missing
            let installDate = configService.get('system_install_date');
            if (!installDate) {
                installDate = Date.now();
                configService.set('system_install_date', installDate);
                console.log('LicenseService: New installation detected. Trial starts now.');
            }

            // 2. Load License File
            if (fs.existsSync(this.licensePath)) {
                const rawData = fs.readFileSync(this.licensePath, 'utf8');
                const license = JSON.parse(rawData);

                if (this.verifySignature(license) && license.token.hwid === this.hwid) {
                    this.isValid = true;
                    this.licenseData = license.token;
                    // Add metadata
                    this.licenseData.key = license.key || 'Hidden';
                    this.licenseData.activated_date = license.activated_date || null;
                    
                    console.log('LicenseService: License Validated Successfully');
                    return;
                } else {
                    console.warn('LicenseService: Invalid License or HWID Mismatch');
                }
            }

            // 3. Fallback to Trial Logic
            const daysSinceInstall = (Date.now() - parseInt(installDate)) / (1000 * 60 * 60 * 24);
            const trialDays = 10;
            const remainingDays = Math.max(0, Math.ceil(trialDays - daysSinceInstall));

            if (remainingDays > 0) {
                // TRIAL MODE (Full Features)
                console.log(`LicenseService: Running in TRIAL MODE. Remaining Days: ${remainingDays}`);
                this.isValid = true; // API Allowed
                this.licenseData = {
                    type: 'TRIAL',
                    owner: 'Trial User',
                    expires: `In ${remainingDays} days`
                };
            } else {
                // RESTRICTED MODE (Expired Trial)
                console.warn('LicenseService: Trial Expired. Running in RESTRICTED MODE.');
                this.isValid = true; // API Allowed (so they can enter key), but features restricted
                this.licenseData = {
                    type: 'RESTRICTED',
                    owner: 'Unlicensed',
                    expires: 'Expired'
                };
            }

        } catch (error) {
            console.error('LicenseService: Error loading license', error);
            // Default to Restricted if error
            this.isValid = true; 
            this.licenseData = { type: 'RESTRICTED', owner: 'Error', expires: 'Expired' };
        }
    }

    // --- Feature Restrictions ---

    getLimits() {
        if (this.licenseData && (this.licenseData.type === 'full' || this.licenseData.type === 'TRIAL' || this.licenseData.type === 'DEVELOPER')) {
            return {
                max_hotspot_users: Infinity,
                max_pppoe_users: Infinity,
                insert_coin_enabled: true
            };
        }
        // Restricted Mode
        return {
            max_hotspot_users: 1,
            max_pppoe_users: 1,
            insert_coin_enabled: false
        };
    }

    isFeatureEnabled(featureName) {
        const limits = this.getLimits();
        if (featureName === 'insert_coin') return limits.insert_coin_enabled;
        return true;
    }

    verifySignature(license) {
        try {
            if (!fs.existsSync(this.publicKeyPath)) {
                console.error('LicenseService: Public Key missing!');
                return false;
            }
            const publicKey = fs.readFileSync(this.publicKeyPath, 'utf8');
            const verify = crypto.createVerify('SHA256');
            verify.update(JSON.stringify(license.token));
            verify.end();
            return verify.verify(publicKey, license.signature, 'base64');
        } catch (e) {
            console.error('Verify Error:', e);
            return false;
        }
    }

    async activateLicense(key) {
        return new Promise((resolve, reject) => {
            key = key ? key.trim() : ''; // Ensure key is trimmed
            console.log(`LicenseService: Starting activation...`);
            console.log(`LicenseService: Key provided: "${key}"`);
            console.log(`LicenseService: HWID: "${this.hwid}"`);
            console.log(`LicenseService: Device Model: "${this.deviceModel}"`);

            if (!key || !this.hwid) {
                return reject(new Error('Missing local key or HWID initialization'));
            }

            // Comprehensive payload to catch any naming convention
            const initialPayload = {
                // Core expected params
                endpoint: 'activate', 
                action: 'activate',
                key: key,
                machine_id: this.hwid,
                device_model: this.deviceModel
            };

            // 1. Prepare JSON Payload
            // The remote server (PHP) might be expecting JSON input or specific naming.
            // We include aliases to be safe: machine_id vs hwid.
            const payload = {
                endpoint: 'activate', 
                action: 'activate',
                key: key,
                license_key: key, 
                machine_id: this.hwid,
                hwid: this.hwid,
                device_model: this.deviceModel
            };

            const jsonBody = JSON.stringify(payload);
            console.log('LicenseService: Body Payload (JSON):', jsonBody);

            this.apiUrl = configService.get('license_api_url') || this.apiUrl;
            const urlObj = new URL(this.apiUrl);
            // Ensure endpoint is in URL for routing
            if (!urlObj.searchParams.has('endpoint')) {
                urlObj.searchParams.set('endpoint', 'activate');
            }
            
            // Also append key/machine_id to URL as a "Hybrid" request
            // This often fixes issues where POST body is dropped but URL params are read
            urlObj.searchParams.set('key', key);
            urlObj.searchParams.set('machine_id', this.hwid);

            const isHttps = urlObj.protocol === 'https:';
            const client = isHttps ? https : http;

            // Strategy: POST JSON
            const tryPost = () => new Promise((resolvePost, rejectPost) => {
                const options = {
                    hostname: urlObj.hostname,
                    port: urlObj.port || (isHttps ? 443 : 80),
                    path: urlObj.pathname + urlObj.search, 
                    method: 'POST', 
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(jsonBody),
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PisoWifi/1.0', 
                        'Accept': '*/*'
                    }
                };

                const req = client.request(options, (res) => {
                    let body = '';
                    res.on('data', (chunk) => body += chunk);
                    res.on('end', () => {
                        console.log('LicenseService: POST Response Body:', body); // DEBUG
                        try {
                            const response = JSON.parse(body);
                            // Relaxed success check
                            if (response.success === true || response.status === 'success' || response.token || response.message === 'License Activated') {
                                resolvePost(response);
                            } else {
                                rejectPost(new Error(response.message || response.error || 'Unknown Error'));
                            }
                        } catch (e) {
                            // If parsing failed, maybe the body itself is a simple "success" string?
                            if (body.trim().toLowerCase() === 'success') {
                                resolvePost({ success: true, token: { type: 'full' } });
                            } else {
                                rejectPost(new Error('Response: ' + body.substring(0, 100)));
                            }
                        }
                    });
                });
                req.on('error', rejectPost);
                req.write(jsonBody);
                req.end();
            });

            const tryGet = () => new Promise((resolveGet, rejectGet) => {
                const getUrl = new URL(this.apiUrl);
                // Ensure critical params are set explicitly first
                getUrl.searchParams.set('endpoint', 'activate');
                getUrl.searchParams.set('key', key);
                getUrl.searchParams.set('machine_id', this.hwid);
                
                Object.keys(payload).forEach(k => {
                    if (!getUrl.searchParams.has(k)) {
                        getUrl.searchParams.append(k, payload[k]);
                    }
                });
                
                console.log('LicenseService: Trying Fallback GET:', getUrl.toString());

                const options = {
                    hostname: getUrl.hostname,
                    path: getUrl.pathname + getUrl.search,
                    method: 'GET',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PisoWifi/1.0',
                        'Accept': '*/*'
                    }
                };

                const client = getUrl.protocol === 'https:' ? https : http;

                const req = client.request(options, (res) => {
                    let body = '';
                    res.on('data', (chunk) => body += chunk);
                    res.on('end', () => {
                         console.log('LicenseService: GET Response Body:', body); // DEBUG
                         try {
                            const response = JSON.parse(body);
                            if (response.success === true || response.status === 'success' || response.token || response.message === 'License Activated') {
                                resolveGet(response);
                            } else {
                                rejectGet(new Error(response.message || response.error || body));
                            }
                        } catch (e) {
                            rejectGet(new Error('Invalid JSON from GET: ' + body.substring(0, 100)));
                        }
                    });
                });
                
                req.on('error', rejectGet);
                req.end();
            });

            // Execute Strategy
            tryPost()
                .then(response => {
                    this.saveLicense(response, key);
                    resolve(response);
                })
                .catch(err => {
                    console.warn(`LicenseService: POST failed (${err.message}). Retrying with GET...`);
                    return tryGet();
                })
                .then(response => {
                    this.saveLicense(response, key);
                    resolve(response);
                })
                .catch(finalErr => {
                    console.error('LicenseService: All activation attempts failed.');
                    reject(finalErr);
                });
        });
    }

    saveLicense(response, key) {
        fs.writeFileSync(this.licensePath, JSON.stringify({
            token: response.token || response, 
            signature: response.signature,
            key: key,
            activated_date: Date.now()
        }, null, 2));
        
        this.loadLicense();
    }

    getStatus() {
        return {
            isValid: this.isValid,
            hwid: this.hwid,
            license: this.licenseData,
            device_model: this.deviceModel
        };
    }
}

module.exports = new LicenseService();
