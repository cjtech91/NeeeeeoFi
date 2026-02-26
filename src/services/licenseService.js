const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const configService = require('./configService');
const hardwareService = require('./hardwareService');
const http = require('http');
const https = require('https');
const querystring = require('querystring');
const { EventEmitter } = require('events');
const { createClient } = require('@supabase/supabase-js');
const { db } = require('../database/db');

class LicenseService {
    constructor() {
        this.licensePath = path.join(__dirname, '../../data/license.json');
        this.publicKeyPath = path.join(__dirname, '../config/license_public.pem');
        this.hwid = null;
        this.licenseData = null;
        this.isValid = false;
        this.deviceModel = 'Loading...';
        this.systemSerial = 'Loading...';
        this.events = new EventEmitter();
        this.supabase = null;
        this.licenseWatchChannel = null;
        
        // Default activation server
        this.apiUrl = configService.get('license_api_url') || 'http://localhost:8080/api/activate'; 
        this.savedKey = null; // Store key for auto-recovery
        this.isAutoReactivating = false;
        this.autoReactivationAttempts = 0;
        this.lastAutoReactivationError = null;
        this.triedAutoBind = false;

        // this.init(); // Removed automatic init to allow configService to load first
    }

    init() {
        this.fetchDeviceModel();
        this.fetchSystemSerial();
        // Strictly use System Serial as HWID
        // If unknown, we still use 'Unknown' which will fail validation if not intended,
        // but user explicitly asked to remove previous HWID logic.
        this.hwid = (this.systemSerial && this.systemSerial !== 'Unknown') ? this.systemSerial : 'Unknown';
        
        console.log(`LicenseService: Using HWID: ${this.hwid}`);
        this.loadLicense();

        if (!this.savedKey) {
            try { this.savedKey = configService.get('last_license_key') || this.savedKey; } catch (e) {}
        }

        // Do NOT validate immediately if local license is invalid; activation will run first.
        // Validation is scheduled later only when local state is valid.

        if (!this.isValid && this.savedKey) {
            console.log('LicenseService: Local license invalid or expired. Attempting online auto-reactivation...');
            const delays = [5000, 15000, 30000]; // retry with backoff
            const attempt = (i) => {
                if (i >= delays.length) { 
                    this.isAutoReactivating = false; 
                    return; 
                }
                setTimeout(() => {
                    this.isAutoReactivating = true;
                    this.autoReactivationAttempts = i + 1;
                    this.activateLicense(this.savedKey)
                        .then(() => {
                            console.log('LicenseService: Auto-reactivation SUCCESS');
                            this.lastAutoReactivationError = null;
                            this.isAutoReactivating = false;
                        })
                        .catch(e => {
                            this.lastAutoReactivationError = e && e.message ? e.message : String(e);
                            console.warn('LicenseService: Auto-reactivation failed:', this.lastAutoReactivationError);
                            attempt(i + 1);
                        });
                }, delays[i]);
            };
            attempt(0);
        }

        if (this.isValid && this.savedKey) {
             setTimeout(() => {
                 this.validateRemoteLicense(this.savedKey);
             }, 10000);
        }

        this.startHeartbeat();
        this.startSupabasePolling();
        
        // Ensure System Serial is ready before starting realtime
        if (this.systemSerial && this.systemSerial !== 'Loading...') {
            this.initSupabaseRealtime();
        } else {
             // Retry shortly if serial not ready
             setTimeout(() => this.initSupabaseRealtime(), 2000);
        }
    }

    initSupabaseRealtime() {
        try {
            if (!this.systemSerial || this.systemSerial === 'Loading...' || this.systemSerial === 'Unknown') {
                 // Try fetching again just in case
                 this.fetchSystemSerial();
                 if (!this.systemSerial || this.systemSerial === 'Loading...' || this.systemSerial === 'Unknown') {
                     console.warn('LicenseService: System Serial not available for Realtime listener. Retrying in 5s...');
                     setTimeout(() => this.initSupabaseRealtime(), 5000);
                     return;
                 }
            }

            const sanitize = (s) => typeof s === 'string' ? s.trim().replace(/^[`'"]+|[`'"]+$/g, '') : s;
            const supabaseUrl = sanitize(configService.get('supabase_project_url'));
            const supabaseKey = sanitize(configService.get('supabase_anon_key'));

            if (supabaseUrl && supabaseKey) {
                console.log('LicenseService: Initializing Supabase Realtime...');
                this.supabase = createClient(supabaseUrl, supabaseKey);
                
                // Prioritize listening by System Serial as requested
                this.listenForRevocation(this.systemSerial);
            }
        } catch (e) {
            console.error('LicenseService: Failed to init Supabase Realtime', e);
        }
    }

    listenForRevocation(identifier) {
        if (!identifier || !this.supabase) return;

        // Cleanup existing channel if any
        if (this.licenseWatchChannel) {
             this.supabase.removeChannel(this.licenseWatchChannel);
        }

        console.log(`LicenseService: Listening for realtime changes on identifier: ${identifier}`);

        this.licenseWatchChannel = this.supabase
            .channel('license-watch')
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'licenses',
                    filter: `system_serial=eq.${identifier}`,
                },
                (payload) => {
                    console.log('LicenseService: Realtime license update received:', payload);
                    const newStatus = payload.new.status;
                    const active = payload.new.active;
                    
                    if (newStatus === 'revoked' || active === false) {
                        console.warn('LicenseService: Realtime revocation received! Locking device...');
                        this.revokeLicense('Realtime Revocation by Administrator');
                    }
                }
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    console.log('LicenseService: Realtime subscription active');
                } else {
                    console.log('LicenseService: Realtime status:', status);
                }
            });
    }

    async validateRemoteLicense(keyParam) {
        const keyUse = (keyParam || (this.licenseData && this.licenseData.key) || this.savedKey);
        if (!keyUse) return;

        console.log('LicenseService: Validating license remotely...');
        try {
            const sanitize = (s) => typeof s === 'string' ? s.trim().replace(/^[`'"]+|[`'"]+$/g, '') : s;
            const supabaseUrl = sanitize(configService.get('supabase_activation_url'));
            const supabaseKey = sanitize(configService.get('supabase_anon_key'));
            const explicitValidateUrl = sanitize(configService.get('license_validate_url'));
            
            if (!explicitValidateUrl && (!supabaseUrl || !supabaseKey)) return;

            // Resolve validation URL
            let targetUrl;
            if (explicitValidateUrl) {
                targetUrl = new URL(explicitValidateUrl);
            } else {
                const url = new URL(supabaseUrl);
                const host = url.hostname.replace('functions.supabase.co', 'supabase.co');
                const projectUrl = `${url.protocol}//${host}`;
                targetUrl = new URL(`${projectUrl}/functions/v1/validate-license`);
            }

            const payload = JSON.stringify({
                key: keyUse,
                license_key: keyUse,
                system_serial: this.systemSerial,
                System_Serial: this.systemSerial,
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
                    ...(supabaseKey ? { 'Authorization': `Bearer ${supabaseKey}` } : {}),
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
                            const allowed = (typeof data.allowed === 'boolean') ? data.allowed : (data.valid !== false);
                            if (!allowed) {
                                const status = data.status || 'revoked';
                                const msg = data.message || 'Remote Validation Failed';
                                console.warn(`LicenseService: Validation denied (${status}).`);
                                
                                // Auto-bind fallback: if validation failed due to binding and we have a key, try one-time activation
                                const looksLikeBindFail = /bind/i.test(String(status)) || /bind/i.test(String(msg));
                                if (looksLikeBindFail && keyUse && !this.triedAutoBind) {
                                    this.triedAutoBind = true;
                                    console.log('LicenseService: Attempting auto-bind via activation after bind_failed...');
                                    this.activateLicense(keyUse)
                                        .then(() => {
                                            console.log('LicenseService: Auto-bind activation succeeded. Marking valid.');
                                            this.isValid = true;
                                            try { configService.set('license_last_verified_ts', Date.now(), 'system'); } catch (e) {}
                                            try { this.recordLicenseValidationRow(keyUse, true, 'bound', 'auto-bind'); } catch (e) {}
                                        })
                                        .catch((e) => {
                                            console.warn('LicenseService: Auto-bind activation failed:', e && e.message ? e.message : String(e));
                                            try { this.recordLicenseValidationRow(keyUse, false, status, msg); } catch (e2) {}
                                            this.revokeLicense(`${status}: ${msg}`);
                                        });
                                    return;
                                }
                                
                                console.warn(`LicenseService: Revoking due to validation denial: ${status}`);
                                try { this.recordLicenseValidationRow(keyUse, false, status, msg); } catch (e) {}
                                this.revokeLicense(`${status}: ${msg}`);
                            } else {
                                this.isValid = true;
                                try { configService.set('license_last_verified_ts', Date.now(), 'system'); } catch (e) {}
                                console.log('LicenseService: Validation allowed.');
                                try {
                                    this.recordLicenseValidationRow(keyUse, allowed, data.status || 'ok', data.message || null);
                                } catch (e) {}
                                if (data.token && data.signature) {
                                    try { this.saveLicense(data, keyUse); } catch (e) {}
                    try { this.fireHeartbeat(); } catch (e) {}
                                } else {
                                    try { this.activateLicense(keyUse).catch(() => {}); } catch (e) {}
                    try { this.fireHeartbeat(); } catch (e) {}
                                }
                            }
                        } else {
                            console.warn(`LicenseService: Validation check failed (${res.statusCode})`);
                            try { this.recordLicenseValidationRow(keyUse, false, `http_${res.statusCode}`, 'Validation endpoint error'); } catch (e) {}
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

    startHeartbeat() {
        const sanitize = (s) => typeof s === 'string' ? s.trim().replace(/^[`'"]+|[`'"]+$/g, '') : s;
        const supabaseUrl = sanitize(configService.get('supabase_activation_url'));
        const supabaseKey = sanitize(configService.get('supabase_anon_key'));
        if (!supabaseUrl || !supabaseKey) return;
        let projectUrl = sanitize(configService.get('supabase_project_url'));
        if (!projectUrl) {
            try {
                const url = new URL(supabaseUrl);
                const host = url.hostname.replace('functions.supabase.co', 'supabase.co');
                projectUrl = `${url.protocol}//${host}`;
            } catch (e) { return; }
        }
        const sendBeat = async () => {
            try {
                await this.sendMachineHeartbeat(projectUrl, supabaseKey);
            } catch (e) {}
        };
        const schedule = () => {
            const next = 60000 + Math.floor(Math.random() * 60000);
            setTimeout(async () => {
                await sendBeat();
                schedule();
            }, next);
        };
        setTimeout(async () => {
            await sendBeat();
            schedule();
        }, 10000);
    }

    startSupabasePolling() {
        // Poll licenses table every 30s as a fallback for Realtime
        const sanitize = (s) => typeof s === 'string' ? s.trim().replace(/^[`'"]+|[`'"]+$/g, '') : s;
        const supabaseUrl = sanitize(configService.get('supabase_activation_url'));
        const supabaseKey = sanitize(configService.get('supabase_anon_key'));
        
        if (!supabaseUrl || !supabaseKey) return;

        const poll = async () => {
            if (!this.licenseData || !this.licenseData.key) {
                 setTimeout(poll, 30000);
                 return;
            }

            try {
                // Construct Validation URL from Config
                const url = new URL(supabaseUrl);
                const host = url.hostname.replace('functions.supabase.co', 'supabase.co');
                const projectUrl = `${url.protocol}//${host}`;
                const validateUrl = new URL(`${projectUrl}/functions/v1/validate-license`);
                
                const payload = JSON.stringify({
                    key: this.licenseData.key,
                    system_serial: this.systemSerial,
                    device_model: this.deviceModel
                });

                const isHttps = validateUrl.protocol === 'https:';
                const client = isHttps ? https : http;
                
                const options = {
                    hostname: validateUrl.hostname,
                    port: validateUrl.port || (isHttps ? 443 : 80),
                    path: validateUrl.pathname + validateUrl.search,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${supabaseKey}`,
                        'apikey': supabaseKey,
                        'Content-Length': Buffer.byteLength(payload)
                    }
                };

                const req = client.request(options, (res) => {
                    let body = '';
                    res.on('data', (chunk) => body += chunk);
                    res.on('end', () => {
                        try {
                            const data = JSON.parse(body);
                            const allowed = (typeof data.allowed === 'boolean') ? data.allowed : (data.valid !== false);
                            
                            if (!allowed) {
                                const status = data.status || 'revoked';
                                if (status === 'revoked') {
                                    console.warn(`LicenseService: Validation Polling: License REVOKED. Locking device.`);
                                    this.revokeLicense('Validation Polling Revocation');
                                }
                            }
                        } catch (e) {
                             // Silent fail on parse error during polling
                        }
                    });
                });
                
                req.on('error', () => {}); // Silent fail on network error
                req.write(payload);
                req.end();

            } catch (e) {}
        };
        
        // Start loop
        poll();
    }

    normalizeId(s) {
        if (typeof s !== 'string') return s;
        return s.trim();
    }

    pollSupabaseLicenseRow(projectUrl, supabaseKey) {
        if (!this.licenseData || !this.licenseData.key) return;
        try {
            const targetUrl = new URL(projectUrl);
            targetUrl.pathname = '/rest/v1/licenses';
            // Also fetch system_serial if column exists (optional) but primarily we check status
            targetUrl.search = `key=eq.${encodeURIComponent(this.licenseData.key)}&select=status,active,system_serial,System_Serial,System_serial_bound,hardware_id`;
            const isHttps = targetUrl.protocol === 'https:';
            const client = isHttps ? https : http;
            const options = {
                hostname: targetUrl.hostname,
                port: targetUrl.port || (isHttps ? 443 : 80),
                path: targetUrl.pathname + '?' + targetUrl.search,
                method: 'GET',
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`,
                    'Accept': 'application/json'
                }
            };
            const req = client.request(options, (res) => {
                let body = '';
                res.on('data', (chunk) => body += chunk);
                res.on('end', () => {
                    try {
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            const rows = JSON.parse(body);
                            const row = Array.isArray(rows) ? rows[0] : null;
                            if (row) {
                                const statusRevoked = String(row.status).toLowerCase() === 'revoked';
                                const activeFalse = (typeof row.active === 'boolean' && row.active === false);
                                const revoked = statusRevoked || activeFalse;

                                const unbound = !row.system_serial && !row.System_Serial && !row.System_serial_bound && !row.hardware_id;
                                const rowId = this.normalizeId(row.system_serial || row.System_Serial || row.System_serial_bound || row.hardware_id);
                                const localId = this.normalizeId(this.systemSerial || this.hwid);
                                const mismatch = rowId && localId && rowId !== localId;
                                
                                if (revoked || unbound || mismatch) {
                                    console.warn(`LicenseService: Supabase row indicates revoke/unbound/mismatch. Revoking license.`);
                                    this.revokeLicense(revoked ? 'revoked' : (mismatch ? 'serial_mismatch' : 'unbound'));
                                }
                            }
                        }
                    } catch (e) {
                        console.warn('LicenseService: Supabase poll parse error', e.message);
                    }
                });
            });
            req.on('error', (e) => console.warn('LicenseService: Supabase poll network error', e.message));
            req.end();
        } catch (e) {}
    }

    async sendMachineHeartbeat(projectUrl, supabaseKey) {
        if (!this.systemSerial || this.systemSerial === 'Unknown') return;
        const targetUrl = new URL(projectUrl);
        // Use new minimal table for machine inventory
        targetUrl.pathname = '/rest/v1/neo_machines';
        const hwid = this.hwid || this.systemSerial || null;
        const metadata = {
            last_verified_ts: Number(configService.get('license_last_verified_ts') || 0) || null,
            license_type: this.licenseData && this.licenseData.type ? this.licenseData.type : null,
            app_version: configService.get('app_version') || null
        };
        const body = JSON.stringify({
            system_serial: this.systemSerial,
            hwid,
            device_model: this.deviceModel || null,
            metadata
        });
        const isHttps = targetUrl.protocol === 'https:';
        const client = isHttps ? https : http;
        const options = {
            hostname: targetUrl.hostname,
            port: targetUrl.port || (isHttps ? 443 : 80),
            path: targetUrl.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Prefer': 'resolution=merge-duplicates,return=minimal',
                'Content-Length': Buffer.byteLength(body)
            }
        };
        await new Promise((resolve) => {
            const req = client.request(options, (res) => {
                // no-op; we don't gate on machines response anymore
                res.resume();
                res.on('end', resolve);
            });
            req.on('error', () => resolve());
            req.write(body);
            req.end();
        });
    }

    fireHeartbeat() {
        const sanitize = (s) => typeof s === 'string' ? s.trim().replace(/^[`'"]+|[`'"]+$/g, '') : s;
        const supabaseUrl = sanitize(configService.get('supabase_activation_url'));
        const supabaseKey = sanitize(configService.get('supabase_anon_key'));
        let projectUrl = sanitize(configService.get('supabase_project_url'));
        if (!projectUrl && supabaseUrl) {
            try {
                const url = new URL(supabaseUrl);
                const host = url.hostname.replace('functions.supabase.co', 'supabase.co');
                projectUrl = `${url.protocol}//${host}`;
            } catch (_) {}
        }
        if (projectUrl && supabaseKey) {
            this.sendMachineHeartbeat(projectUrl, supabaseKey);
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
        try {
            this.events.emit('license_state', { state: 'restricted', reason });
        } catch (e) {}
    }

    async fetchDeviceModel() {
        this.deviceModel = await hardwareService.getDeviceModel();
    }

    fetchSystemSerial() {
        try {
            const override = configService.get('system_serial_override');
            if (override && typeof override === 'string' && override.trim().length > 0) {
                this.systemSerial = override.trim();
                return;
            }
            // 1. Try Device Tree (Preferred for embedded)
            const dtPath = '/sys/firmware/devicetree/base/serial-number';
            if (fs.existsSync(dtPath)) {
                // Remove null bytes if any
                const serial = fs.readFileSync(dtPath, 'utf8').replace(/\0/g, '').trim();
                if (serial) {
                    this.systemSerial = serial;
                    return;
                }
            }
            
            // 2. Try /proc/cpuinfo
            if (fs.existsSync('/proc/cpuinfo')) {
                const cpuInfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
                const match = cpuInfo.match(/Serial\s*:\s*([0-9a-f]+)/i);
                if (match && match[1]) {
                    this.systemSerial = match[1];
                    return;
                }
            }
            
            // 3. Windows BIOS Serial
            if (process.platform === 'win32') {
                try {
                    const psOut = execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_BIOS).SerialNumber"', { encoding: 'utf8' });
                    const sn = String(psOut || '').trim().replace(/\r/g, '');
                    if (sn && !/^to be filled by o\.e\.m\.|default string$/i.test(sn)) {
                        this.systemSerial = sn;
                        return;
                    }
                } catch (e) {}
                try {
                    const wmicOut = execSync('wmic bios get serialnumber', { encoding: 'utf8' });
                    const lines = String(wmicOut || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
                    const idx = lines.findIndex(l => /^serialnumber$/i.test(l));
                    const sn = idx >= 0 && lines[idx + 1] ? lines[idx + 1] : lines.find(l => l && !/^serialnumber$/i.test(l));
                    if (sn && !/^to be filled by o\.e\.m\.|default string$/i.test(sn)) {
                        this.systemSerial = sn.trim();
                        return;
                    }
                } catch (e) {}
                // 4. Windows BaseBoard Serial
                try {
                    const psOut2 = execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_BaseBoard).SerialNumber"', { encoding: 'utf8' });
                    const bb = String(psOut2 || '').trim().replace(/\r/g, '');
                    if (bb && !/^to be filled by o\.e\.m\.|default string$/i.test(bb)) {
                        this.systemSerial = bb;
                        return;
                    }
                } catch (e) {}
                try {
                    const wmicOut2 = execSync('wmic baseboard get serialnumber', { encoding: 'utf8' });
                    const lines2 = String(wmicOut2 || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
                    const idx2 = lines2.findIndex(l => /^serialnumber$/i.test(l));
                    const bb = idx2 >= 0 && lines2[idx2 + 1] ? lines2[idx2 + 1] : lines2.find(l => l && !/^serialnumber$/i.test(l));
                    if (bb && !/^to be filled by o\.e\.m\.|default string$/i.test(bb)) {
                        this.systemSerial = bb.trim();
                        return;
                    }
                } catch (e) {}
                // 5. Windows CSProduct UUID
                try {
                    const psUuid = execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_ComputerSystemProduct).UUID"', { encoding: 'utf8' });
                    const uuid = String(psUuid || '').trim().replace(/\r/g, '');
                    if (uuid && !/^00000000-0000-0000-0000-000000000000$/i.test(uuid)) {
                        this.systemSerial = uuid.toUpperCase();
                        return;
                    }
                } catch (e) {}
                try {
                    const wmicUuid = execSync('wmic csproduct get uuid', { encoding: 'utf8' });
                    const lines3 = String(wmicUuid || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
                    const idx3 = lines3.findIndex(l => /^uuid$/i.test(l));
                    const uuid = idx3 >= 0 && lines3[idx3 + 1] ? lines3[idx3 + 1] : lines3.find(l => l && !/^uuid$/i.test(l));
                    if (uuid && !/^00000000-0000-0000-0000-000000000000$/i.test(uuid)) {
                        this.systemSerial = uuid.toUpperCase();
                        return;
                    }
                } catch (e) {}
                // 6. Windows CPU ProcessorId (last resort)
                try {
                    const cpuId = execSync('wmic cpu get ProcessorId', { encoding: 'utf8' });
                    const lines4 = String(cpuId || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
                    const idx4 = lines4.findIndex(l => /^processorid$/i.test(l));
                    const pid = idx4 >= 0 && lines4[idx4 + 1] ? lines4[idx4 + 1] : lines4.find(l => l && !/^processorid$/i.test(l));
                    if (pid) {
                        this.systemSerial = pid.toUpperCase();
                        return;
                    }
                } catch (e) {}
            }
        } catch (e) {
            console.error('LicenseService: Failed to fetch system serial', e.message);
        }
        this.systemSerial = 'Unknown';
    }

    // Old HWID generation logic removed as per user request.
    // This method is deprecated and should not be used.
    generateHWID() {
        return 'DEPRECATED_USE_SYSTEM_SERIAL';
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
                try {
                    let rawData = fs.readFileSync(this.licensePath, 'utf8');
                    if (!rawData || rawData.trim().length < 2) throw new Error('Empty license file');
                    const license = JSON.parse(rawData);
                    
                    if (license.key) this.savedKey = license.key;
                    else if (license.token && license.token.key) this.savedKey = license.token.key;

                const localId = this.normalizeId(this.systemSerial || this.hwid);
                // Ensure localId is not Unknown or Loading
                if (localId === 'Unknown' || localId === 'Loading...') {
                    if (this.systemSerial && this.systemSerial !== 'Unknown' && this.systemSerial !== 'Loading...') {
                         this.hwid = this.systemSerial;
                    } else {
                         this.fetchSystemSerial();
                         this.hwid = this.systemSerial;
                    }
                }
                const tokenId = this.normalizeId(license.token.system_serial || license.token.System_Serial || license.token.hardware_id || license.token.hwid);
                
                console.log(`LicenseService: Verifying. TokenID: ${tokenId}, LocalID: ${this.normalizeId(this.systemSerial || this.hwid)}`);
                
                if (this.verifySignature(license) && tokenId && this.normalizeId(this.systemSerial || this.hwid) && tokenId === this.normalizeId(this.systemSerial || this.hwid)) {
                    this.isValid = true;
                    this.licenseData = license.token;
                    // Add metadata
                    this.licenseData.key = license.key || 'Hidden';
                    this.licenseData.activated_date = license.activated_date || null;
                    
                    console.log('LicenseService: License Validated Successfully');
                    return;
                } else {
                    console.warn('LicenseService: Invalid License or Identity Mismatch');
                }
                } catch(e) { 
                    console.error('License parse error:', e);
                    try {
                        const backup = this.licensePath + '.corrupt.' + Date.now() + '.json';
                        fs.renameSync(this.licensePath, backup);
                        console.warn('LicenseService: Corrupt license moved to backup file:', backup);
                    } catch (_) {}
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
        key = key ? key.trim() : '';
        console.log(`LicenseService: Starting activation with key: "${key}"`);

        // Ensure fields are ready
        if (!this.deviceModel || this.deviceModel === 'Loading...') {
            this.deviceModel = await hardwareService.getDeviceModel();
        }
        if (!this.systemSerial || this.systemSerial === 'Loading...' || this.systemSerial === 'Unknown') {
            this.fetchSystemSerial();
        }
        // Ensure HWID is synced with System Serial (per user instruction to use System Serial)
        if (!this.hwid || this.hwid === 'Unknown') {
            this.hwid = (this.systemSerial && this.systemSerial !== 'Unknown') ? this.systemSerial : 'Unknown';
        }

        const system_serial = this.systemSerial;
        const device_model = this.deviceModel;

        console.log(`LicenseService: System Serial: "${system_serial}", Device Model: "${device_model}"`);

        if (!key || !system_serial || system_serial === 'Unknown') {
            throw new Error('Missing local key or System Serial initialization');
        }

        // Configuration
        const sanitize = (s) => typeof s === 'string' ? s.trim().replace(/^[`'"]+|[`'"]+$/g, '') : s;
        const FUNCTION_URL = sanitize(configService.get('supabase_activation_url')) || 'https://nmrhhxsfcxabmoqriloj.supabase.co/functions/v1/activate';
        const ANON_KEY = sanitize(configService.get('supabase_anon_key'));

        if (!ANON_KEY) {
            throw new Error('Supabase Anon Key is missing in configuration');
        }

        // Prepare Request
        const url = new URL(FUNCTION_URL);
        const payload = JSON.stringify({
            key,
            system_serial,
            hwid: system_serial,     // Backend compatibility: Some versions expect 'hwid'
            serial: system_serial,   // Backend compatibility: Some versions expect 'serial'
            System_Serial: system_serial, // Backend compatibility: Case sensitivity
            device_model
        });

        const options = {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ANON_KEY}`,
                'apikey': ANON_KEY,
                'Content-Length': Buffer.byteLength(payload)
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', (chunk) => body += chunk);
                res.on('end', () => {
                    try {
                        const data = JSON.parse(body);
                        
                        // Check for success (Supabase Function convention)
                        if (!res.statusCode || res.statusCode >= 400 || (!data.allowed && !data.token)) {
                             return reject(new Error(data.message || data.error || `Activation failed with status ${res.statusCode}`));
                        }

                        // Success
                        this.saveLicense(data, key);
                        resolve(data);
                    } catch (e) {
                        reject(new Error('Failed to parse activation response: ' + body));
                    }
                });
            });

            req.on('error', (e) => reject(new Error('Network error during activation: ' + e.message)));
            req.write(payload);
            req.end();
        });
    }

    saveLicense(response, key) {
        const tmpPath = this.licensePath + '.tmp';
        fs.writeFileSync(tmpPath, JSON.stringify({
            token: response.token || response, 
            signature: response.signature,
            key: key,
            activated_date: Date.now()
        }, null, 2));
        fs.renameSync(tmpPath, this.licensePath);
        this.savedKey = key;
        try { 
            configService.set('last_license_key', key, 'system'); 
            configService.set('license_last_verified_ts', Date.now(), 'system');
        } catch (e) {}
        
        // Persist activation to local database for audit/resilience
        try {
            const hash = crypto.createHash('sha256').update(String(key)).digest('hex');
            const tokenJson = JSON.stringify(response.token || response);
            db.prepare(`
              INSERT INTO license_activations
                (license_key_hash, system_serial, device_model, token_json, signature, status, message, activated_at)
              VALUES
                (?, ?, ?, ?, ?, 'success', NULL, datetime('now','localtime'))
            `).run(
              hash,
              this.systemSerial || null,
              this.deviceModel || null,
              tokenJson,
              response.signature || null
            );
        } catch (e) {
            console.warn('LicenseService: Failed to log activation locally:', e.message);
        }
        
        this.loadLicense();

        // Send confirmation event to Supabase (Best Effort)
        this.sendActivationEvent(key);
        try {
            this.events.emit('license_state', { state: 'active', key });
            // Start listening for revocation immediately after activation
            if (this.systemSerial && this.systemSerial !== 'Unknown') {
                this.listenForRevocation(this.systemSerial);
            }
        } catch (e) {}
        try { this.fireHeartbeat(); } catch (e) {}
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
                system_serial: this.systemSerial,
                hwid: this.systemSerial, // Match table column
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

    async recordLicenseValidationRow(key, allowed, status, message) {
        try {
            const sanitize = (s) => typeof s === 'string' ? s.trim().replace(/^[`'"]+|[`'"]+$/g, '') : s;
            const supabaseUrl = sanitize(configService.get('supabase_activation_url'));
            const supabaseKey = sanitize(configService.get('supabase_anon_key'));
            let projectUrl = sanitize(configService.get('supabase_project_url'));
            if (!projectUrl && supabaseUrl) {
                const u = new URL(supabaseUrl);
                const host = u.hostname.replace('functions.supabase.co', 'supabase.co');
                projectUrl = `${u.protocol}//${host}`;
            }
            if (!projectUrl || !supabaseKey) return;
            const licenseId = await this.lookupLicenseId(projectUrl, supabaseKey, key);
            if (!licenseId) return;
            const targetUrl = new URL(projectUrl);
            targetUrl.pathname = '/rest/v1/license_validations';
            const body = JSON.stringify({
                license_id: licenseId,
                system_serial: this.systemSerial,
                allowed: !!allowed,
                status: status || 'ok',
                message: message || null,
                device_model: this.deviceModel || null
            });
            const isHttps = targetUrl.protocol === 'https:';
            const client = isHttps ? https : http;
            const options = {
                hostname: targetUrl.hostname,
                port: targetUrl.port || (isHttps ? 443 : 80),
                path: targetUrl.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`,
                    'Prefer': 'return=minimal',
                    'Content-Length': Buffer.byteLength(body)
                }
            };
            await new Promise((resolve) => {
                const req = client.request(options, (res) => { res.resume(); resolve(); });
                req.on('error', () => resolve());
                req.write(body);
                req.end();
            });
        } catch (_) {}
    }

    async lookupLicenseId(projectUrl, supabaseKey, key) {
        try {
            const targetUrl = new URL(projectUrl);
            targetUrl.pathname = '/rest/v1/licenses';
            targetUrl.search = `key=eq.${encodeURIComponent(key)}&select=id&limit=1`;
            const isHttps = targetUrl.protocol === 'https:';
            const client = isHttps ? https : http;
            const options = {
                hostname: targetUrl.hostname,
                port: targetUrl.port || (isHttps ? 443 : 80),
                path: targetUrl.pathname + '?' + targetUrl.search,
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`
                }
            };
            return await new Promise((resolve) => {
                const req = client.request(options, (res) => {
                    let body = '';
                    res.on('data', (c) => body += c);
                    res.on('end', () => {
                        try {
                            if (res.statusCode >= 200 && res.statusCode < 300) {
                                const rows = JSON.parse(body);
                                const row = Array.isArray(rows) ? rows[0] : null;
                                resolve(row && row.id ? row.id : null);
                            } else {
                                resolve(null);
                            }
                        } catch (_) { resolve(null); }
                    });
                });
                req.on('error', () => resolve(null));
                req.end();
            });
        } catch (_) { return null; }
    }

    getStatus() {
        const installDate = configService.get('system_install_date');
        const trialDays = 10;
        let trialEnd = null;
        let trialRemainingMs = null;
        let lastVerifiedTs = null;
        try { lastVerifiedTs = configService.get('license_last_verified_ts') || null; } catch (e) {}
        if (installDate && this.licenseData && this.licenseData.type === 'TRIAL') {
            trialEnd = Number(installDate) + trialDays * 24 * 60 * 60 * 1000;
            trialRemainingMs = Math.max(0, trialEnd - Date.now());
        }
        return {
            isValid: this.isValid,
            hwid: this.hwid,
            system_serial: this.systemSerial,
            license: this.licenseData,
            device_model: this.deviceModel,
            system_install_date: installDate || null,
            trial_end_ts: trialEnd,
            trial_remaining_ms: trialRemainingMs,
            auto_reactivating: this.isAutoReactivating,
            saved_key_present: !!this.savedKey,
            last_verified_ts: lastVerifiedTs,
            auto_reactivation_attempts: this.autoReactivationAttempts,
            auto_reactivation_error: this.lastAutoReactivationError
        };
    }
}

module.exports = new LicenseService();
