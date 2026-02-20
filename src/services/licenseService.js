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
 
        // this.init(); // Removed automatic init to allow configService to load first
    }

    init() {
        this.hwid = this.generateHWID();
        this.fetchDeviceModel();
        this.loadLicense();
        
        // Periodic validation (Every 1 hour)
        setInterval(() => {
            this.validateRemoteLicense();
        }, 60 * 60 * 1000);

        // Initial validation (Boot up)
        setTimeout(() => {
            this.validateRemoteLicense();
        }, 30000); // Wait 30s for network
    }

    async validateRemoteLicense() {
        if (!this.isValid || !this.licenseData || !this.licenseData.key) return;

        console.log('LicenseService: Validating license remotely...');
        try {
            const sanitize = (s) => typeof s === 'string' ? s.trim().replace(/^[`'"]+|[`'"]+$/g, '') : s;
            const supabaseUrl = sanitize(configService.get('supabase_activation_url'));
            const supabaseKey = sanitize(configService.get('supabase_anon_key'));
            
            if (!supabaseUrl || !supabaseKey) return;

            // Use the validate-license Edge Function
            const url = new URL(supabaseUrl);
            const host = url.hostname.replace('functions.supabase.co', 'supabase.co');
            const projectUrl = `${url.protocol}//${host}`;
            
            const targetUrl = new URL(`${projectUrl}/functions/v1/validate-license`);

            const payload = JSON.stringify({
                license_key: this.licenseData.key,
                hwid: this.hwid,
                device_model: this.deviceModel
            });

            const isHttps = targetUrl.protocol === 'https:';
            const client = isHttps ? https : http;

            const options = {
                hostname: targetUrl.hostname,
                port: targetUrl.port || (isHttps ? 443 : 80),
                path: targetUrl.pathname + targetUrl.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${supabaseKey}`,
                    'Content-Length': Buffer.byteLength(payload)
                }
            };

            const req = client.request(options, (res) => {
                let body = '';
                res.on('data', (chunk) => body += chunk);
                res.on('end', () => {
                    try {
                        if (res.statusCode === 200) {
                            const data = JSON.parse(body);
                            if (data.valid === false) {
                                console.warn('LicenseService: Remote validation failed. Disabling license.');
                                this.revokeLicense(data.reason || 'Remote Validation Failed');
                            } else {
                                console.log('LicenseService: Remote validation success.');
                            }
                        } else {
                            console.warn(`LicenseService: Validation check failed (${res.statusCode})`);
                        }
                    } catch (e) {
                        console.error('LicenseService: Error parsing validation response', e);
                    }
                });
            });

            req.on('error', (e) => console.error('LicenseService: Validation network error', e.message));
            req.write(payload);
            req.end();

        } catch (e) {
            console.error('LicenseService: Error during remote validation', e.message);
        }
    }

    revokeLicense(reason) {
        console.warn(`LicenseService: Revoking license. Reason: ${reason}`);
        
        // Remove file
        if (fs.existsSync(this.licensePath)) {
            try {
                fs.unlinkSync(this.licensePath);
            } catch (e) {
                console.error('Failed to delete license file:', e);
            }
        }

        // Reset state
        this.isValid = false;
        this.licenseData = {
            type: 'RESTRICTED',
            owner: 'Unlicensed',
            expires: 'Revoked: ' + reason
        };
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

            const sanitize = (s) => typeof s === 'string' ? s.trim().replace(/^[`'"]+|[`'"]+$/g, '') : s;
            const backend = (sanitize(configService.get('license_backend')) || 'api').toLowerCase();
            const supabaseUrl = sanitize(configService.get('supabase_activation_url'));
            const supabaseKey = sanitize(configService.get('supabase_anon_key'));
            this.apiUrl = sanitize(configService.get('license_api_url')) || this.apiUrl;
            // Supabase Function Backend (preferred when configured)
            if (backend === 'supabase' && supabaseUrl) {
                try {
                    const url = new URL(supabaseUrl);
                    if (!url.pathname || url.pathname === '/') {
                        url.pathname = '/activate';
                    }
                    const headers = {
                        'Content-Type': 'application/json',
                        'Accept': '*/*',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PisoWifi/1.0'
                    };
                    if (supabaseKey) {
                        headers['Authorization'] = `Bearer ${supabaseKey}`;
                    }
                    console.log('LicenseService: Supabase URL:', url.toString());
                    const isHttpsFn = url.protocol === 'https:';
                    const clientFn = isHttpsFn ? https : http;
                    const optionsFn = {
                        hostname: url.hostname,
                        port: url.port || (isHttpsFn ? 443 : 80),
                        path: url.pathname + url.search,
                        method: 'POST',
                        headers
                    };
                    const handleResponse = (res, nextAttempt) => {
                        console.log('LicenseService: Supabase status:', res.statusCode);
                        let body = '';
                        res.on('data', (chunk) => body += chunk);
                        res.on('end', () => {
                            if (res.statusCode === 404 || /not found/i.test(body)) {
                                if (nextAttempt) return nextAttempt();
                            }
                            try {
                                const response = JSON.parse(body);
                                if (response.success === true || response.status === 'success' || response.token || response.message === 'License Activated') {
                                    this.saveLicense(response, key);
                                    return resolve(response);
                                }
                                return reject(new Error(response.error || response.message || 'Supabase activation failed'));
                            } catch (e) {
                                return reject(new Error('Supabase response: ' + body.substring(0, 100)));
                            }
                        });
                    };
                    const reqFn = clientFn.request(optionsFn, (res) => handleResponse(res, () => {
                        try {
                            const projectBase = sanitize(configService.get('supabase_project_url'));
                            let altUrl;
                            if (projectBase) {
                                altUrl = new URL(projectBase);
                                altUrl.pathname = (altUrl.pathname && altUrl.pathname !== '/' ? altUrl.pathname : '') + '/functions/v1/activate';
                            } else {
                                const altHost = url.hostname.replace('functions.supabase.co', 'supabase.co');
                                altUrl = new URL(`${url.protocol}//${altHost}`);
                                altUrl.pathname = '/functions/v1/activate';
                            }
                            console.log('LicenseService: Supabase alt URL:', altUrl.toString());
                            const isHttpsAlt = altUrl.protocol === 'https:';
                            const clientAlt = isHttpsAlt ? https : http;
                            const optionsAlt = {
                                hostname: altUrl.hostname,
                                port: altUrl.port || (isHttpsAlt ? 443 : 80),
                                path: altUrl.pathname + altUrl.search,
                                method: 'POST',
                                headers
                            };
                            const reqAlt = clientAlt.request(optionsAlt, (resAlt) => handleResponse(resAlt, null));
                            reqAlt.on('error', (err) => reject(err));
                            reqAlt.write(jsonBody);
                            reqAlt.end();
                        } catch (err) {
                            reject(err);
                        }
                    }));
                    reqFn.on('error', (err) => reject(err));
                    reqFn.write(jsonBody);
                    reqFn.end();
                    return; // Do not continue to API mode
                } catch (e) {
                    console.error('Supabase Activation Error:', e.message);
                    // Fallback to API mode if Supabase fails
                }
            }

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

        // Send confirmation event to Supabase (Best Effort)
        this.sendActivationEvent(key);
    }

    async sendActivationEvent(key) {
        try {
            const sanitize = (s) => typeof s === 'string' ? s.trim().replace(/^[`'"]+|[`'"]+$/g, '') : s;
            const supabaseUrl = sanitize(configService.get('supabase_activation_url'));
            const supabaseKey = sanitize(configService.get('supabase_anon_key'));
            
            if (!supabaseUrl || !supabaseKey) return;

            // Attempt to derive Project URL
            let projectUrl = sanitize(configService.get('supabase_project_url'));
            if (!projectUrl && supabaseUrl) {
                // Heuristic: https://<ref>.functions.supabase.co -> https://<ref>.supabase.co
                const url = new URL(supabaseUrl);
                const host = url.hostname.replace('functions.supabase.co', 'supabase.co');
                projectUrl = `${url.protocol}//${host}`;
            }

            if (!projectUrl) return;

            // Target Table: "activations"
            const targetUrl = new URL(projectUrl);
            targetUrl.pathname = '/rest/v1/activations';
            
            const payload = JSON.stringify({
                license_key: key,
                hwid: this.hwid,
                device_model: this.deviceModel,
                status: 'success',
                activated_at: new Date().toISOString(),
                metadata: {
                    version: '1.0',
                    platform: process.platform
                }
            });

            const isHttps = targetUrl.protocol === 'https:';
            const client = isHttps ? https : http;

            const options = {
                hostname: targetUrl.hostname,
                port: targetUrl.port || (isHttps ? 443 : 80),
                path: targetUrl.pathname + targetUrl.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`,
                    'Content-Length': Buffer.byteLength(payload),
                    'Prefer': 'return=minimal'
                }
            };

            const req = client.request(options, (res) => {
                // Just log status, don't block
                if (res.statusCode >= 400) {
                    console.warn(`LicenseService: Activation event failed with status ${res.statusCode}`);
                } else {
                    console.log('LicenseService: Activation event sent to Supabase');
                }
            });
            
            req.on('error', (e) => console.error('LicenseService: Failed to send activation event:', e.message));
            req.write(payload);
            req.end();

        } catch (e) {
            console.error('LicenseService: Error preparing activation event:', e.message);
        }
    }

    getStatus() {
        const installDate = configService.get('system_install_date');
        const trialDays = 10;
        let trialEnd = null;
        let trialRemainingMs = null;
        if (installDate && this.licenseData && this.licenseData.type === 'TRIAL') {
            trialEnd = Number(installDate) + trialDays * 24 * 60 * 60 * 1000;
            trialRemainingMs = Math.max(0, trialEnd - Date.now());
        }
        return {
            isValid: this.isValid,
            hwid: this.hwid,
            license: this.licenseData,
            device_model: this.deviceModel,
            system_install_date: installDate || null,
            trial_end_ts: trialEnd,
            trial_remaining_ms: trialRemainingMs
        };
    }
}

module.exports = new LicenseService();
