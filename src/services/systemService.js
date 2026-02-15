const { exec } = require('child_process');
const { db } = require('../database/db');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logService = require('./logService');

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
            // Clear specific tables
            db.prepare('DELETE FROM sales').run();
            db.prepare('DELETE FROM vouchers').run();
            db.prepare('DELETE FROM users').run();
            db.prepare('DELETE FROM pppoe_users').run();
            db.prepare('DELETE FROM chat_messages').run();
            db.prepare('DELETE FROM system_logs').run();
            // Clear other logs
            db.prepare('DELETE FROM pppoe_sales').run();
            db.prepare('DELETE FROM free_time_claims').run();
            db.prepare('DELETE FROM coins_out_logs').run();
            
            // Reset admin accounts to default: superadmin/superadmin and admin/admin
            db.prepare('DELETE FROM admins').run();
            const superHash = bcrypt.hashSync('Neofi2026', 10);
            const adminHash = bcrypt.hashSync('admin', 10);
            const insert = db.prepare('INSERT INTO admins (username, password_hash, security_question, security_answer, role, is_super_admin) VALUES (?, ?, ?, ?, ?, ?)');
            insert.run('superadmin', superHash, 'What is the name of your first pet?', 'admin', 'super_admin', 1);
            insert.run('admin', adminHash, 'What is the name of your first pet?', 'admin', 'admin', 0);
            
            logService.info('SYSTEM', 'Factory Reset completed successfully');
            return true;
        } catch (e) {
            console.error('Factory reset error:', e);
            logService.error('SYSTEM', `Factory Reset failed: ${e.message}`);
            throw e;
        }
    }

    async upgrade(type, file = null) {
        // Placeholder for upgrade logic
        // type: 'local' | 'online'
        console.log(`System upgrade requested: ${type}`);
        return new Promise((resolve) => setTimeout(resolve, 2000));
    }

    async createUpdatePackage() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `update-${timestamp}.tar.gz`;
        const outputPath = path.join(__dirname, '../../', filename);
        
        // Exclude: node_modules, data, .git, .trae, backups, firmware, *.img, *.iso, and DATABASE files
        const cmd = `tar -czf "${filename}" --exclude=node_modules --exclude=data --exclude=.git --exclude=.trae --exclude=firmware --exclude=*.iso --exclude=*.img --exclude=src/database/*.sqlite --exclude=src/database/*.db --exclude=src/database/*.sqlite-journal src public package.json ecosystem.config.js`;
        
        return new Promise((resolve, reject) => {
            exec(cmd, { cwd: path.join(__dirname, '../../') }, (error) => {
                if (error) reject(error);
                else resolve(outputPath);
            });
        });
    }

    async applyUpdatePackage(base64Data) {
        const buffer = Buffer.from(base64Data, 'base64');
        const tempPath = path.join(__dirname, '../../temp_update.tar.gz');
        fs.writeFileSync(tempPath, buffer);
        
        // Extract
        const cmd = `tar -xzf "temp_update.tar.gz" -C .`;
        
        return new Promise((resolve, reject) => {
            exec(cmd, { cwd: path.join(__dirname, '../../') }, async (error) => {
                if (error) {
                    try { fs.unlinkSync(tempPath); } catch(e) {}
                    reject(error);
                } else {
                    // Clean up
                    try { fs.unlinkSync(tempPath); } catch(e) {}
                    
                    // Attempt to install dependencies if package.json changed
                    try {
                        await new Promise((res) => {
                            exec('npm install --production', { cwd: path.join(__dirname, '../../') }, () => res());
                        });
                    } catch (e) {
                        console.error('Failed to run npm install:', e);
                    }

                    // Restart
                    logService.warn('SYSTEM', 'System updated via package. Restarting...');
                    
                    // Try PM2 restart first
                    exec('pm2 restart all', (err) => {
                        if (err) {
                            // Fallback to process exit (if monitored) or reboot
                            console.log('PM2 restart failed, exiting process...');
                            process.exit(0); 
                        }
                    });
                    
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
