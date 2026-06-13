const { exec } = require('child_process');
const { db } = require('../database/db');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const https = require('https');
const logService = require('./logService');

const projectRoot = path.join(__dirname, '../../');
const updatePackageEntries = ['src', 'public', 'package.json', 'ecosystem.config.js'];

function normalizeRelativePath(relativePath) {
    return relativePath.split(path.sep).join('/');
}

function shouldExcludeFromUpdate(relativePath) {
    const normalizedPath = normalizeRelativePath(relativePath);

    if (!normalizedPath) return false;

    if (normalizedPath.startsWith('src/database/')) {
        const basename = path.posix.basename(normalizedPath);

        if (normalizedPath === 'src/database/db.js') {
            return false;
        }

        return (
            basename.endsWith('.sqlite') ||
            basename.includes('.sqlite.') ||
            basename.endsWith('.sqlite-journal') ||
            basename.endsWith('.db') ||
            basename.includes('.db.')
        );
    }

    return false;
}

function copyUpdateTree(sourcePath, destinationPath, relativePath = '') {
    let stats;
    try {
        stats = fs.statSync(sourcePath);
    } catch (error) {
        if (error && error.code === 'ENOENT') {
            return;
        }
        throw error;
    }

    if (shouldExcludeFromUpdate(relativePath)) {
        return;
    }

    if (stats.isDirectory()) {
        fs.mkdirSync(destinationPath, { recursive: true });

        let entries = [];
        try {
            entries = fs.readdirSync(sourcePath);
        } catch (error) {
            if (error && error.code === 'ENOENT') {
                return;
            }
            throw error;
        }

        for (const entry of entries) {
            const childSourcePath = path.join(sourcePath, entry);
            const childDestinationPath = path.join(destinationPath, entry);
            const childRelativePath = relativePath ? path.join(relativePath, entry) : entry;
            copyUpdateTree(childSourcePath, childDestinationPath, childRelativePath);
        }
        return;
    }

    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
}

class SystemService {
    async reboot() {
        logService.warn('SYSTEM', 'System reboot initiated via Admin Panel');
        return new Promise((resolve, reject) => {
            exec('reboot', (error, stdout, stderr) => {
                if (error) {
                    console.error(`Reboot error: ${error}`);
                    // In development/windows, this might fail or do nothing.
                    // We'll resolve anyway for UI simulation if it fails due to permissions/OS
                    if (process.platform === 'win32') {
                        console.log('Simulating reboot on Windows');
                        resolve(true);
                    } else {
                        reject(error);
                    }
                } else {
                    resolve(true);
                }
            });
        });
    }

    async factoryReset() {
        try {
            logService.critical('SYSTEM', 'Factory Reset initiated - Clearing data...');

            try {
                const networkConfigPath = path.join(__dirname, '../../data/network-config.json');
                if (fs.existsSync(networkConfigPath)) {
                    fs.unlinkSync(networkConfigPath);
                }
            } catch (_) {}

            const preservedSettings = (() => {
                try {
                    const rows = db
                        .prepare(
                            `SELECT key, value, type, category, updated_at
                             FROM settings
                             WHERE key LIKE 'license_%'
                                OR category = 'license'
                                OR key = 'last_license_key'`
                        )
                        .all();
                    return Array.isArray(rows) ? rows : [];
                } catch (_) {
                    return [];
                }
            })();

            const tx = db.transaction(() => {
                try {
                    db.exec('PRAGMA foreign_keys = OFF');
                } catch (_) {}

                const tables = db
                    .prepare(
                        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                    )
                    .all()
                    .map(r => r.name)
                    .filter(Boolean);

                for (const table of tables) {
                    try {
                        if (table === 'license_activations') continue;
                        db.prepare(`DELETE FROM ${table}`).run();
                    } catch (_) {}
                }

                try {
                    db.exec('DELETE FROM sqlite_sequence');
                } catch (_) {}

                if (preservedSettings.length) {
                    const stmt = db.prepare(
                        'INSERT OR REPLACE INTO settings (key, value, type, category, updated_at) VALUES (?, ?, ?, ?, ?)'
                    );
                    for (const s of preservedSettings) {
                        try {
                            stmt.run(
                                String(s.key),
                                s.value == null ? null : String(s.value),
                                s.type == null ? null : String(s.type),
                                s.category == null ? null : String(s.category),
                                s.updated_at == null ? null : String(s.updated_at)
                            );
                        } catch (_) {}
                    }
                }

                try {
                    const ratesCount = db.prepare('SELECT count(*) as count FROM rates').get().count;
                    if (ratesCount === 0) {
                        const insertRate = db.prepare(
                            'INSERT INTO rates (amount, minutes, validity_hours, upload_speed, download_speed, is_pausable) VALUES (?, ?, ?, ?, ?, ?)'
                        );
                        insertRate.run(1, 15, 0, 5120, 5120, 1);
                        insertRate.run(5, 120, 0, 5120, 5120, 1);
                        insertRate.run(10, 300, 0, 5120, 5120, 1);
                    }
                } catch (_) {}

                try {
                    const defaults = [
                        { key: 'wan_interface', value: 'eth0', type: 'string', category: 'network' },
                        { key: 'lan_interface', value: 'br0', type: 'string', category: 'network' },
                        { key: 'portal_port', value: '3000', type: 'string', category: 'network' },
                        { key: 'wifi_enabled', value: 'true', type: 'boolean', category: 'network' },
                        { key: 'stp_enabled', value: 'true', type: 'boolean', category: 'network' },
                        { key: 'network_seed_defaults', value: 'true', type: 'boolean', category: 'network' },
                        { key: 'coin_pin', value: '12', type: 'number', category: 'hardware' },
                        { key: 'relay_pin', value: '11', type: 'number', category: 'hardware' },
                        { key: 'bill_pin', value: '19', type: 'number', category: 'hardware' },
                        { key: 'coin_pin_edge', value: 'rising', type: 'string', category: 'hardware' },
                        { key: 'bill_pin_edge', value: 'falling', type: 'string', category: 'hardware' },
                        { key: 'bill_multiplier', value: '1', type: 'number', category: 'hardware' },
                        { key: 'relay_pin_active', value: 'HIGH', type: 'string', category: 'hardware' },
                        { key: 'ban_limit_counter', value: '10', type: 'number', category: 'security' },
                        { key: 'ban_duration', value: '1', type: 'number', category: 'security' },
                        { key: 'pulse_multiplier', value: '5', type: 'number', category: 'hardware' },
                        { key: 'temp_threshold', value: '70', type: 'number', category: 'hardware' },
                        { key: 'rate_1_peso', value: '300', type: 'number', category: 'pricing' },
                        { key: 'rate_5_peso', value: '1800', type: 'number', category: 'pricing' },
                        { key: 'rate_10_peso', value: '3600', type: 'number', category: 'pricing' }
                    ];

                    const insertSetting = db.prepare(
                        'INSERT OR IGNORE INTO settings (key, value, type, category, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)'
                    );
                    for (const s of defaults) {
                        insertSetting.run(s.key, s.value, s.type, s.category);
                    }
                } catch (_) {}

                const superHash = bcrypt.hashSync('Neofi2026', 10);
                const adminHash = bcrypt.hashSync('admin', 10);
                const insert = db.prepare(
                    'INSERT INTO admins (username, password_hash, security_question, security_answer, role, is_super_admin) VALUES (?, ?, ?, ?, ?, ?)'
                );
                insert.run('superadmin', superHash, 'What is the name of your first pet?', 'admin', 'super_admin', 1);
                insert.run('admin', adminHash, 'What is the name of your first pet?', 'admin', 'admin', 0);

                try {
                    db.exec('PRAGMA foreign_keys = ON');
                } catch (_) {}
            });

            tx();

            try {
                const networkConfigService = require('./networkConfigService');
                try {
                    db.prepare(
                        "INSERT INTO settings (key, value, type, category, updated_at) VALUES ('network_seed_defaults', 'true', 'boolean', 'network', CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, type = excluded.type, category = excluded.category, updated_at = CURRENT_TIMESTAMP"
                    ).run();
                } catch (_) {}
                try {
                    networkConfigService.init();
                    networkConfigService.seedDefaultVlansAndDhcp();
                } catch (_) {}
            } catch (_) {}

            logService.info('SYSTEM', 'Factory Reset completed successfully');
            return true;
        } catch (e) {
            console.error('Factory reset error:', e);
            logService.error('SYSTEM', `Factory Reset failed: ${e.message}`);
            throw e;
        }
    }

    async upgrade(type, file = null) {
        // type: 'local' | 'online' | 'ota'
        if (type === 'ota') {
            return this.performOTAUpdate(file); // 'file' here will be the download URL
        }
        console.log(`System upgrade requested: ${type}`);
        return new Promise((resolve) => setTimeout(resolve, 2000));
    }

    async checkOTAUpdate() {
        const otaUrl = 'https://neofisystem.com/api/ota.php';
        return new Promise((resolve, reject) => {
            https.get(otaUrl, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        if (res.statusCode !== 200) {
                            reject(new Error(`OTA Server returned status ${res.statusCode}`));
                            return;
                        }
                        const updateInfo = JSON.parse(data);
                        const currentVersion = this.getSystemVersion();
                        updateInfo.current_version = currentVersion;
                        updateInfo.update_available = this.compareVersions(updateInfo.latest_version, currentVersion) > 0;
                        resolve(updateInfo);
                    } catch (e) {
                        reject(new Error("Failed to parse update info: " + e.message));
                    }
                });
            }).on('error', (err) => {
                reject(new Error("Failed to connect to OTA server: " + err.message));
            });
        });
    }

    getSystemVersion() {
        try {
            const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
            return pkg.version || '1.0.0';
        } catch (e) {
            return '1.0.0';
        }
    }

    compareVersions(v1, v2) {
        if (!v1 || !v2) return 0;
        const parts1 = String(v1).split('.').map(Number);
        const parts2 = String(v2).split('.').map(Number);
        for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
            const p1 = parts1[i] || 0;
            const p2 = parts2[i] || 0;
            if (p1 > p2) return 1;
            if (p1 < p2) return -1;
        }
        return 0;
    }

    async performOTAUpdate(downloadUrl) {
        if (!downloadUrl) throw new Error("No download URL provided for OTA update");
        logService.info('SYSTEM', `OTA Update initiated from ${downloadUrl}`);
        const tempPath = path.join(__dirname, '../../temp_ota_update.bin');
        
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(tempPath);
            https.get(downloadUrl, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                    // Handle redirect
                    this.performOTAUpdate(res.headers.location).then(resolve).catch(reject);
                    return;
                }
                if (res.statusCode !== 200) {
                    reject(new Error(`Failed to download update: HTTP ${res.statusCode}`));
                    return;
                }
                res.pipe(file);
                file.on('finish', () => {
                    file.close(async () => {
                        try {
                            const data = fs.readFileSync(tempPath);
                            const base64Data = data.toString('base64');
                            await this.applyUpdatePackage(base64Data);
                            try { fs.unlinkSync(tempPath); } catch (_) {}
                            resolve(true);
                        } catch (e) {
                            reject(e);
                        }
                    });
                });
            }).on('error', (err) => {
                try { fs.unlinkSync(tempPath); } catch (_) {}
                reject(err);
            });
        });
    }

    async createUpdatePackage() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        // Produce a gzip-compressed tar but use .bin extension for distribution
        const filename = `update-${timestamp}.bin`;
        const outputPath = path.join(projectRoot, filename);
        const stagingDir = path.join(projectRoot, `.update-staging-${timestamp}`);

        return new Promise((resolve, reject) => {
            try {
                fs.rmSync(stagingDir, { recursive: true, force: true });
                fs.mkdirSync(stagingDir, { recursive: true });

                for (const entry of updatePackageEntries) {
                    copyUpdateTree(
                        path.join(projectRoot, entry),
                        path.join(stagingDir, entry),
                        entry
                    );
                }
            } catch (error) {
                try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch (_) {}
                reject(error);
                return;
            }

            const cmd = `tar -czf "${outputPath}" -C "${stagingDir}" .`;

            exec(cmd, { cwd: projectRoot }, (error) => {
                try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch (_) {}

                if (error) reject(error);
                else resolve(outputPath);
            });
        });
    }

    async applyUpdatePackage(base64Data) {
        const buffer = Buffer.from(base64Data, 'base64');
        // Accept .bin or .tar.gz payloads (we store as .bin; tar ignores extension)
        const tempPath = path.join(projectRoot, 'temp_update.bin');
        fs.writeFileSync(tempPath, buffer);
        
        // Extract
        const cmd = `tar -xzf "temp_update.bin" -C .`;
        
        return new Promise((resolve, reject) => {
            exec(cmd, { cwd: projectRoot }, async (error) => {
                if (error) {
                    try { fs.unlinkSync(tempPath); } catch(e) {}
                    reject(error);
                } else {
                    // Clean up
                    try { fs.unlinkSync(tempPath); } catch(e) {}
                    
                    // Attempt to install dependencies if package.json changed
                    try {
                        await new Promise((res) => {
                            exec('npm install --production', { cwd: projectRoot }, () => res());
                        });
                    } catch (e) {
                        console.error('Failed to run npm install:', e);
                    }

                    logService.warn('SYSTEM', 'System update applied via package.');
                    resolve(true);
                }
            });
        });
    }

    // --- NTP & Time Configuration ---

    async getTimeSettings() {
        const settings = db.prepare('SELECT key, value FROM settings WHERE key IN (?, ?, ?, ?, ?)').all(
            'time_sync_mode', 'ntp_server', 'timezone_mode', 'timezone', 'manual_datetime'
        );
        
        const result = {
            time_sync_mode: 'auto',
            ntp_server: '132.163.97.3 202.90.132.242 pool.ntp.org',
            timezone_mode: 'auto',
            timezone: 'Asia/Manila', 
            manual_datetime: ''
        };

        settings.forEach(s => {
            result[s.key] = s.value;
        });

        // Get current system time and timezone
        result.current_system_time = new Date().toISOString();
        
        if (process.platform !== 'win32') {
             try {
                // Try to get actual system timezone
                // result.system_timezone = await this.execPromise("cat /etc/timezone").then(s => s.trim()).catch(() => 'UTC');
             } catch(e) {}
        }

        return result;
    }

    async saveTimeSettings(data) {
        console.log('Saving time settings:', data);
        const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value, category) VALUES (?, ?, ?)');
        const keys = ['time_sync_mode', 'ntp_server', 'timezone_mode', 'timezone', 'manual_datetime'];
        
        const transaction = db.transaction((settings) => {
            keys.forEach(key => {
                if (settings[key] !== undefined) {
                    stmt.run(key, settings[key], 'time');
                }
            });
        });
        
        transaction(data);
        
        await this.applyTimeSettings(data);
        return true;
    }

    // --- Company Branding ---

    async getCompanySettings() {
        const keys = ['company_name', 'company_contact', 'company_email', 'company_logo'];
        const settings = db.prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`).all(keys);
        
        const result = {
            company_name: 'CJTECH PISOWIFI',
            company_contact: '09123456789',
            company_email: 'admin@neofi.com',
            company_logo: '/neologo.png'
        };

        settings.forEach(s => {
            if(s.value) result[s.key] = s.value;
        });

        return result;
    }

    async saveCompanySettings(data) {
        const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value, category) VALUES (?, ?, ?)');
        const keys = ['company_name', 'company_contact', 'company_email', 'company_logo'];
        
        const transaction = db.transaction((settings) => {
            keys.forEach(key => {
                if (settings[key] !== undefined) {
                    stmt.run(key, settings[key], 'branding');
                }
            });
        });
        
        transaction(data);
        return true;
    }

    async applyTimeSettings(settings) {
        console.log('Applying Time Settings:', settings);
        logService.info('SYSTEM', 'Applying time settings configuration');
        
        if (process.platform === 'win32') {
             console.log('Skipping system time commands on Windows');
             return;
        }

        try {
            // 1. Set Timezone
            if (settings.timezone_mode === 'manual' && settings.timezone) {
                await this.execPromise(`timedatectl set-timezone ${settings.timezone}`);
            }

            // 2. Set Time Sync
            if (settings.time_sync_mode === 'auto') {
                await this.execPromise('timedatectl set-ntp true');
                if (settings.ntp_server) {
                    await this.updateNtpConfig(settings.ntp_server);
                }
            } else {
                await this.execPromise('timedatectl set-ntp false');
                if (settings.manual_datetime) {
                    // Format from UI might be ISO or similar. timedatectl expects "YYYY-MM-DD HH:MM:SS"
                    // Assuming input is valid for now or converted
                    await this.execPromise(`timedatectl set-time "${settings.manual_datetime}"`);
                }
            }
        } catch (e) {
            console.error('Error applying time settings:', e);
            logService.error('SYSTEM', `Failed to apply time settings: ${e.message}`);
            throw e; // Re-throw to alert UI
        }
    }

    async updateNtpConfig(server) {
        const configPath = '/etc/systemd/timesyncd.conf';
        try {
            if (fs.existsSync(configPath)) {
                let content = fs.readFileSync(configPath, 'utf8');
                if (content.match(/^NTP=/m)) {
                    content = content.replace(/^NTP=.*$/m, `NTP=${server}`);
                } else {
                    // If [Time] exists, append under it, else append at end
                    if (content.includes('[Time]')) {
                        content = content.replace('[Time]', `[Time]\nNTP=${server}`);
                    } else {
                        content += `\n[Time]\nNTP=${server}\n`;
                    }
                }
                fs.writeFileSync(configPath, content);
                await this.execPromise('systemctl restart systemd-timesyncd');
            }
        } catch (e) {
            console.error('Failed to update timesyncd.conf', e);
        }
    }

    execPromise(cmd) {
        return new Promise((resolve, reject) => {
            exec(cmd, (err, stdout, stderr) => {
                if (err) reject(err);
                else resolve(stdout);
            });
        });
    }

    async getTimezones() {
        if (process.platform === 'win32') {
            return ['Asia/Manila', 'Asia/Tokyo', 'UTC', 'America/New_York']; 
        }
        try {
             const stdout = await this.execPromise('timedatectl list-timezones');
             return stdout.split('\n').filter(Boolean);
        } catch (e) {
            return ['UTC', 'Asia/Manila'];
        }
    }

    async getBoardModel() {
        if (process.platform === 'win32') {
            return 'Windows Development Environment';
        }
        try {
            // Try Device Tree (Raspberry Pi / Orange Pi)
            if (fs.existsSync('/proc/device-tree/model')) {
                const model = fs.readFileSync('/proc/device-tree/model', 'utf8');
                // Remove null bytes
                return model.replace(/\0/g, '').trim();
            }
            // Try DMI (x86)
            if (fs.existsSync('/sys/class/dmi/id/product_name')) {
                const vendor = fs.readFileSync('/sys/class/dmi/id/sys_vendor', 'utf8').trim();
                const product = fs.readFileSync('/sys/class/dmi/id/product_name', 'utf8').trim();
                return `${vendor} ${product}`;
            }
            // Fallback to CPU Model
            const cpus = require('os').cpus();
            if (cpus && cpus.length > 0) {
                return cpus[0].model;
            }
        } catch (e) {
            console.error('Error getting board model:', e);
        }
        return 'Unknown Device';
    }

    async verifyConfiguration() {
        const results = {
            timestamp: new Date().toISOString(),
            checks: []
        };

        const addResult = (category, status, message) => {
            results.checks.push({ category, status, message });
        };

        // 0. Board Model
        const boardModel = await this.getBoardModel();
        addResult('System', 'info', `Device: ${boardModel}`);

        // 1. Internet Connectivity
        if (process.platform === 'win32') {
             addResult('Internet', 'info', 'Skipped on Windows (Development Mode)');
        } else {
            try {
                await this.execPromise('ping -c 1 -W 2 8.8.8.8');
                addResult('Internet', 'success', 'Internet connection is active (Ping 8.8.8.8)');
            } catch (e) {
                addResult('Internet', 'error', 'No Internet connection (Ping 8.8.8.8 failed)');
            }
        }

        // 2. DNS Resolution
        if (process.platform !== 'win32') {
            try {
                await this.execPromise('nslookup google.com 8.8.8.8');
                addResult('DNS', 'success', 'DNS Resolution working (google.com)');
            } catch (e) {
                addResult('DNS', 'warning', 'DNS Resolution failed (nslookup google.com)');
            }
        }

        // 3. Service Status
        const services = ['dnsmasq', 'hostapd', 'nginx', 'nodogsplash'];
        for (const s of services) {
            if (process.platform === 'win32') {
                addResult('Service', 'info', `${s}: Skipped (Windows)`);
                continue;
            }
            try {
                await this.execPromise(`systemctl is-active --quiet ${s}`);
                addResult('Service', 'success', `${s} is running`);
            } catch (e) {
                // Some services might not be installed/required
                addResult('Service', 'warning', `${s} is not running`);
            }
        }

        // 4. Database Integrity
        try {
            const count = db.prepare('SELECT count(*) as c FROM settings').get();
            addResult('Database', 'success', `Database accessible (${count.c} settings loaded)`);
        } catch (e) {
            addResult('Database', 'error', 'Database integrity check failed');
        }

        // 5. Disk Space (Root)
        if (process.platform !== 'win32') {
            try {
                const df = await this.execPromise("df -h / | tail -1 | awk '{print $5}'");
                addResult('Storage', 'info', `Root Usage: ${df.trim()}`);
            } catch(e) {}
        }

        return results;
    }

    async restoreFromBackup(backupPath) {
        const mainDb = db;
        let backupDb = null;
        try {
            backupDb = new Database(backupPath, { readonly: true });

            const tables = [
                'settings',
                'rates',
                'users',
                'vouchers',
                'sales',
                'access_control',
                'walled_garden',
                'pppoe_profiles',
                'pppoe_users',
                'firewall_rules',
                'chat_messages',
                'sub_vendo_devices',
                'sub_vendo_device_rates',
                'free_time_claims',
                'coins_out_logs',
                'system_logs',
                'admins'
            ];

            const migrateTable = (table) => {
                const backupInfo = backupDb.prepare(`PRAGMA table_info(${table})`).all();
                const mainInfo = mainDb.prepare(`PRAGMA table_info(${table})`).all();
                if (!backupInfo.length || !mainInfo.length) return;

                const backupCols = backupInfo.map(c => c.name);
                const mainCols = mainInfo.map(c => c.name);
                const commonCols = mainCols.filter(c => backupCols.includes(c));
                if (!commonCols.length) return;

                const colList = commonCols.join(',');
                const rows = backupDb.prepare(`SELECT ${colList} FROM ${table}`).all();

                mainDb.prepare(`DELETE FROM ${table}`).run();

                if (!rows.length) return;

                const placeholders = commonCols.map(() => '?').join(',');
                const insert = mainDb.prepare(`INSERT INTO ${table} (${colList}) VALUES (${placeholders})`);
                const insertMany = mainDb.transaction((rowsToInsert) => {
                    for (const row of rowsToInsert) {
                        insert.run(commonCols.map(col => row[col]));
                    }
                });
                insertMany(rows);
            };

            const tx = mainDb.transaction(() => {
                for (const table of tables) {
                    migrateTable(table);
                }
            });

            tx();

            logService.info('SYSTEM', 'Database restored from backup');
        } catch (e) {
            logService.error('SYSTEM', `Restore from backup failed: ${e.message}`);
            throw e;
        } finally {
            if (backupDb) {
                try {
                    backupDb.close();
                } catch (err) {}
            }
        }
    }
}

module.exports = new SystemService();
