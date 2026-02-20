const { db } = require('../database/db');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const logService = require('./logService');
const bandwidthService = require('./bandwidthService');
const licenseService = require('./licenseService'); // For Limits

const CHAP_SECRETS_PATH = '/etc/ppp/chap-secrets';
const PAP_SECRETS_PATH = '/etc/ppp/pap-secrets';
const SCRIPT_PATH = path.join(__dirname, '../scripts/init_pppoe_server.sh');

class PppoeServerService {
    constructor() {
    }

    ipToLong(ip) {
        return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
    }

    longToIp(long) {
        return [
            (long >>> 24) & 255,
            (long >>> 16) & 255,
            (long >>> 8) & 255,
            long & 255
        ].join('.');
    }

    async init(wanInterface = 'eth0') {
        this.initializeConfig();
        console.log("Initializing PPPoE Server Service...");
        logService.info('SYSTEM', 'Initializing PPPoE Server Service');
        this.wanInterface = wanInterface;
        this.applyConfig();

        // Start Expiration Checker (Every 1 minute)
        this.expirationInterval = setInterval(() => {
            this.checkExpirations();
        }, 60 * 1000);
    }

    checkExpirations() {
        try {
            const config = this.getConfig();
            const expiredPool = config.expired_pool || '172.15.10.2-172.15.10.254';
            // Extract common prefix for quick check (assumes /24 or similar alignment)
            const expiredStart = expiredPool.split('-')[0].trim();
            const expiredPrefix = expiredStart.substring(0, expiredStart.lastIndexOf('.') + 1);

            const now = new Date();
            // Get all users (Active OR Expired) to check status
            // Previously we only checked active users, but now we need to catch disabled-but-expired users too
            const users = db.prepare(`
                SELECT u.*
                FROM pppoe_users u 
            `).all();
            
            let secretsNeedUpdate = false;
            const usersToKick = [];

            users.forEach(u => {
                if (u.expiration_date) {
                    const expDate = new Date(u.expiration_date);
                    if (expDate < now) {
                        // User is expired.
                        // Logic: Keep active (is_active=1) but assign to Expired Pool (172.15.10.x).
                        
                        // Ensure user is ACTIVE so they can connect and get the expired IP.
                        if (u.is_active === 0) {
                            console.log(`[ExpirationCheck] Reactivating expired user ${u.username} for redirection...`);
                            db.prepare("UPDATE pppoe_users SET is_active = 1 WHERE id = ?").run(u.id);
                            secretsNeedUpdate = true;
                        }

                        let needsKick = false;

                        // Check if they are already on the expired IP
                        if (u.current_ip && !u.current_ip.startsWith(expiredPrefix)) {
                            // They are connected but with a normal IP. Kick them so they reconnect and get the Expired IP.
                            needsKick = true;
                            console.log(`[ExpirationCheck] User ${u.username} expired. Kicking to force Expired Pool IP...`);
                        } else if (!u.current_ip && u.interface) {
                             // Interface exists but no IP recorded? Kick to be safe.
                             needsKick = true;
                        }

                        // Always sync if we find an expired user to ensure they are in the secrets file with the correct IP.
                        secretsNeedUpdate = true;

                        if (needsKick) {
                            usersToKick.push(u.id);
                        }
                    }
                }
            });

            if (secretsNeedUpdate) {
                this.syncSecrets();
            }

            // Kick users after secrets are updated
            usersToKick.forEach(userId => {
                this.kickUser(userId);
            });

        } catch (e) {
            console.error("Error in checkExpirations:", e);
        }
    }

    initializeConfig() {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'pppoe_server_config'").get();
        if (!row) {
            const defaultConfig = {
                enabled: false,
                interface: 'br0',
                local_ip: '10.10.10.1',
                remote_start: '10.10.10.2',
                remote_count: 50,
                dns1: '8.8.8.8',
                dns2: '8.8.4.4',
                expired_pool: '172.15.10.2-172.15.10.254'
            };
            db.prepare("INSERT INTO settings (key, value, type, category) VALUES (?, ?, 'json', 'network')")
              .run('pppoe_server_config', JSON.stringify(defaultConfig));
        }
    }

    getConfig() {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'pppoe_server_config'").get();
        return row ? JSON.parse(row.value) : {};
    }

    saveConfig(config) {
        db.prepare("UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = 'pppoe_server_config'")
          .run(JSON.stringify(config));
        
        if (config.enabled) {
            this.applyConfig();
        } else {
            this.stopServer();
        }
        return config;
    }

    // --- Profiles ---
    getProfiles() {
        return db.prepare("SELECT * FROM pppoe_profiles ORDER BY name").all();
    }

    addProfile(profile) {
        const stmt = db.prepare("INSERT INTO pppoe_profiles (name, rate_limit_up, rate_limit_down, price) VALUES (?, ?, ?, ?)");
        const info = stmt.run(profile.name, profile.rate_limit_up, profile.rate_limit_down, profile.price || 0);
        return { id: info.lastInsertRowid, ...profile };
    }

    updateProfile(id, profile) {
        db.prepare("UPDATE pppoe_profiles SET name = ?, rate_limit_up = ?, rate_limit_down = ?, price = ? WHERE id = ?")
          .run(profile.name, profile.rate_limit_up, profile.rate_limit_down, profile.price || 0, id);
        
        // Update associated users to reflect profile changes
        db.prepare(`
            UPDATE pppoe_users 
            SET profile_name = ?, rate_limit_up = ?, rate_limit_down = ? 
            WHERE profile_id = ?
        `).run(profile.name, profile.rate_limit_up, profile.rate_limit_down, id);

        this.syncSecrets(); // Sync secrets in case of any future dependencies
        return this.getProfile(id);
    }

    getProfile(id) {
        return db.prepare("SELECT * FROM pppoe_profiles WHERE id = ?").get(id);
    }

    deleteProfile(id) {
        db.prepare("DELETE FROM pppoe_profiles WHERE id = ?").run(id);
        
        // Update users who had this profile to have no profile
        db.prepare(`
            UPDATE pppoe_users 
            SET profile_id = NULL, profile_name = NULL, rate_limit_up = 0, rate_limit_down = 0 
            WHERE profile_id = ?
        `).run(id);

        this.syncSecrets();
        return { success: true };
    }

    // --- Users ---
    getUsers() {
        // Sync active session stats before returning
        this.syncActiveSessions();
        return db.prepare("SELECT * FROM pppoe_users ORDER BY username").all();
    }

    syncActiveSessions() {
        const activeUsers = db.prepare("SELECT * FROM pppoe_users WHERE is_active = 1 AND interface IS NOT NULL").all();
        if (activeUsers.length === 0) return;

        try {
            const netDev = fs.readFileSync('/proc/net/dev', 'utf8');
            const lines = netDev.split('\n');
            const now = new Date();

            const interfaceStats = {};
            lines.forEach(line => {
                // format:   interface: rx_bytes rx_packets ... tx_bytes tx_packets ...
                const match = line.trim().match(/^([^:]+):\s*(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/);
                if (match) {
                    interfaceStats[match[1]] = {
                        rx: parseInt(match[2]),
                        tx: parseInt(match[3])
                    };
                }
            });

            const updateStmt = db.prepare(`
                UPDATE pppoe_users 
                SET rx = ?, tx = ?, current_up = ?, current_down = ?, uptime = ?, last_updated = DATETIME('now')
                WHERE id = ?
            `);

            // Fix: Do not set is_active = 0. Only clear session data.
            const disconnectStmt = db.prepare(`
                UPDATE pppoe_users 
                SET current_ip = NULL, interface = NULL, uptime = NULL, 
                    current_up = 0, current_down = 0, rx = 0, tx = 0 
                WHERE id = ?
            `);

            const transaction = db.transaction((users) => {
                for (const user of users) {
                    if (interfaceStats[user.interface]) {
                        const stats = interfaceStats[user.interface];
                        
                        let currentUp = 0;
                        let currentDown = 0;
                        
                        if (user.last_updated) {
                            const lastUpdate = new Date(user.last_updated);
                            const seconds = (now - lastUpdate) / 1000;
                            // Avoid division by zero or extremely small intervals
                            if (seconds > 0.5) {
                                // Calculate bytes diff
                                const txDiff = stats.tx >= user.tx ? stats.tx - user.tx : stats.tx;
                                const rxDiff = stats.rx >= user.rx ? stats.rx - user.rx : stats.rx;
                                
                                // Bytes per second -> Kbps -> * 8 / 1000 (Standard) or 1024 (Binary)
                                // UI shows 'M' usually meaning Mbps (Decimal) or Mibps (Binary).
                                // Let's use Kbps (1024).
                                currentUp = Math.round(txDiff * 8 / 1024 / seconds);
                                currentDown = Math.round(rxDiff * 8 / 1024 / seconds);
                            } else {
                                // Too fast, keep previous speed
                                currentUp = user.current_up;
                                currentDown = user.current_down;
                            }
                        }

                        // Calculate Uptime
                        let uptimeStr = "0m";
                        if (user.connected_at) {
                            const connectedAt = new Date(user.connected_at);
                            const diffMs = now - connectedAt;
                            const diffMins = Math.floor(diffMs / 60000);
                            const diffHrs = Math.floor(diffMins / 60);
                            const diffDays = Math.floor(diffHrs / 24);
                            
                            if (diffDays > 0) uptimeStr = `${diffDays}d ${diffHrs % 24}h`;
                            else if (diffHrs > 0) uptimeStr = `${diffHrs}h ${diffMins % 60}m`;
                            else uptimeStr = `${diffMins}m`;
                        }

                        updateStmt.run(stats.rx, stats.tx, currentUp, currentDown, uptimeStr, user.id);
                    } else {
                        // Interface missing? Check if it really exists in /sys/class/net/
                        // If not, mark disconnected.
                        // However, on Windows dev environment, /sys/class/net won't exist.
                        // We should add a check for platform.
                        if (process.platform === 'linux') {
                            if (!fs.existsSync(`/sys/class/net/${user.interface}`)) {
                                disconnectStmt.run(user.id);
                            }
                        }
                    }
                }
            });
            
            transaction(activeUsers);

        } catch (e) {
            console.error("Error syncing PPPoE stats:", e);
        }
    }

    addUser(user) {
        try {
            // --- CHECK LICENSE LIMITS ---
            const limits = licenseService.getLimits();
            if (limits.max_pppoe_users !== Infinity) {
                const count = db.prepare('SELECT count(*) as count FROM pppoe_users').get().count;
                if (count >= limits.max_pppoe_users) {
                    const msg = `License Limit Reached: Max ${limits.max_pppoe_users} PPPoE accounts allowed.`;
                    logService.warn('PPPOE', msg);
                    throw new Error(msg);
                }
            }
            // ----------------------------

            // Populate profile details if profile_id is provided
            if (user.profile_id) {
                const profile = this.getProfile(user.profile_id);
                if (profile) {
                    user.profile_name = profile.name;
                    user.rate_limit_up = profile.rate_limit_up;
                    user.rate_limit_down = profile.rate_limit_down;
                }
            }
            
            // Ensure defaults for missing fields to avoid SQL errors
            user.profile_name = user.profile_name || null;
            user.rate_limit_up = user.rate_limit_up || 0;
            user.rate_limit_down = user.rate_limit_down || 0;
            user.mac_address = user.mac_address || null;
            user.profile_id_on_expiry = user.profile_id_on_expiry || null;

            const stmt = db.prepare(`
                INSERT INTO pppoe_users (username, password, profile_id, profile_name, profile_id_on_expiry, rate_limit_up, rate_limit_down, expiration_date, mac_address)
                VALUES (@username, @password, @profile_id, @profile_name, @profile_id_on_expiry, @rate_limit_up, @rate_limit_down, @expiration_date, @mac_address)
            `);
            const info = stmt.run(user);
            this.syncSecrets();
            logService.info('PPPOE', `Created user ${user.username} (Profile: ${user.profile_name || 'None'})`);
            return { id: info.lastInsertRowid, ...user };
        } catch (e) {
            logService.error('PPPOE', `Failed to create user ${user.username}: ${e.message}`);
            throw e;
        }
    }

    updateUser(id, user) {
        // Populate profile details if profile_id is provided
        if (user.profile_id) {
            const profile = this.getProfile(user.profile_id);
            if (profile) {
                user.profile_name = profile.name;
                user.rate_limit_up = profile.rate_limit_up;
                user.rate_limit_down = profile.rate_limit_down;
            }
        }
        
        // Ensure defaults
        user.profile_name = user.profile_name || null;
        user.rate_limit_up = user.rate_limit_up || 0;
        user.rate_limit_down = user.rate_limit_down || 0;
        user.expiration_date = user.expiration_date || null;
        user.is_active = user.is_active !== undefined ? user.is_active : 1;
        user.mac_address = user.mac_address || null;
        user.profile_id_on_expiry = user.profile_id_on_expiry || null;

        const stmt = db.prepare(`
            UPDATE pppoe_users 
            SET username = @username, password = @password, profile_id = @profile_id, profile_name = @profile_name,
                profile_id_on_expiry = @profile_id_on_expiry,
                rate_limit_up = @rate_limit_up, rate_limit_down = @rate_limit_down,
                expiration_date = @expiration_date, is_active = @is_active, mac_address = @mac_address
            WHERE id = @id
        `);
        stmt.run({ ...user, id });
        this.syncSecrets();
        
        // Seamless Profile Switching: Apply new rate limits immediately if user is connected
        const updatedUser = this.getUser(id);
        if (updatedUser && updatedUser.current_ip && updatedUser.is_active) {
            console.log(`[PPPoE] Seamlessly updating limits for active user ${updatedUser.username}: ${updatedUser.rate_limit_down}/${updatedUser.rate_limit_up}`);
            bandwidthService.setLimit(updatedUser.current_ip, updatedUser.rate_limit_down, updatedUser.rate_limit_up)
                .catch(err => console.error(`[PPPoE] Failed to update limits for ${updatedUser.username}:`, err));
        }

        logService.info('PPPOE', `Updated user ${user.username} (Active: ${user.is_active})`);
        return updatedUser;
    }

    getUser(id) {
        return db.prepare("SELECT * FROM pppoe_users WHERE id = ?").get(id);
    }

    deleteUser(id) {
        const user = this.getUser(id);
        db.prepare("DELETE FROM pppoe_users WHERE id = ?").run(id);
        this.syncSecrets();
        if (user) logService.info('PPPOE', `Deleted user ${user.username}`);
        return { success: true };
    }

    renewUser(id) {
        const user = this.getUser(id);
        if (!user) throw new Error('User not found');
        if (!user.expiration_date) throw new Error('User has no expiration date');

        // Logic: New Expiry = Current Expiry + 1 Month (Same time)
        const currentExp = new Date(user.expiration_date);
        
        let newExp = new Date(currentExp);
        const targetMonth = newExp.getMonth() + 1;
        newExp.setMonth(targetMonth);
        
        // Handle month rollover (e.g. Jan 31 -> Mar 3 -> Feb 28)
        if (newExp.getMonth() !== targetMonth % 12) {
            newExp.setDate(0); // Set to last day of previous month
        }

        const isoString = newExp.toISOString();

        db.prepare("UPDATE pppoe_users SET expiration_date = ?, is_active = 1 WHERE id = ?")
          .run(isoString, id);
        
        // --- Record Sale ---
        try {
            let planPrice = 0;
            let planName = user.profile_name || 'Unknown Plan';
            
            if (user.profile_id) {
                const profile = db.prepare('SELECT * FROM pppoe_profiles WHERE id = ?').get(user.profile_id);
                if (profile) {
                    planPrice = profile.price || 0;
                    planName = profile.name;
                }
            }

            db.prepare(`
                INSERT INTO pppoe_sales (user_id, username, plan_name, router_name, plan_price, discount, amount_paid)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                user.id, 
                user.username, 
                planName, 
                'CJTECH MS1', // Default Router Name
                planPrice, 
                0, // Discount
                planPrice // Amount Paid
            );
            
            logService.info('PPPOE', `Recorded sale for user ${user.username}: P${planPrice}`);

        } catch (err) {
            console.error('Failed to record PPPoE sale:', err);
            logService.error('PPPOE', `Failed to record sale for ${user.username}: ${err.message}`);
        }
        // -------------------

        this.syncSecrets();
        
        this.kickUser(id); 

        logService.info('PPPOE', `Renewed user ${user.username}. New expiry: ${isoString}`);
        return { ...user, expiration_date: isoString, is_active: 1 };
    }

    getSales(startDate, endDate) {
        // Expected format: YYYY-MM-DD
        let query = "SELECT * FROM pppoe_sales";
        const params = [];

        if (startDate && endDate) {
            // Add time to cover the full day
            const start = `${startDate} 00:00:00`;
            const end = `${endDate} 23:59:59`;
            query += " WHERE created_at BETWEEN ? AND ?";
            params.push(start, end);
        }

        query += " ORDER BY created_at DESC";
        
        return db.prepare(query).all(params);
    }

    deleteSale(id) {
        db.prepare("DELETE FROM pppoe_sales WHERE id = ?").run(id);
        return { success: true };
    }

    kickUser(id) {
        const user = this.getUser(id);
        if (!user) throw new Error('User not found');

        if (user.interface) {
            // Try to kill the pppd process directly via PID file
            const pidFile = `/var/run/${user.interface}.pid`;
            let killedViaPid = false;

            if (fs.existsSync(pidFile)) {
                try {
                    const pid = fs.readFileSync(pidFile, 'utf8').trim();
                    if (pid) {
                        // Use exec kill to ensure we can kill root processes if needed
                        exec(`kill -15 ${pid}`, (err) => {
                             if (err) console.error(`Failed to kill pppd ${pid}:`, err);
                        });
                        killedViaPid = true;
                    }
                } catch (e) {
                    console.error(`Error reading/killing via pidfile ${pidFile}:`, e);
                }
            }

            // Fallback/Ensure: Bring down interface
            try {
                exec(`ip link set dev ${user.interface} down`, (error, stdout, stderr) => {
                    if (error) {
                        // Only log if we didn't already try to kill it, or if it's a genuine error
                        if (!killedViaPid) console.error(`Error kicking user ${user.username} (interface ${user.interface}):`, error);
                    }
                });
            } catch (e) {
                console.error("Error executing kick command:", e);
            }
        }

        // Update DB: Clear session info
        db.prepare(`
            UPDATE pppoe_users 
            SET interface = NULL, current_ip = NULL, uptime = NULL, 
                current_up = 0, current_down = 0, rx = 0, tx = 0
            WHERE id = ?
        `).run(id);

        logService.info('PPPOE', `Kicked user ${user.username}`);
        return { success: true };
    }

    syncSecrets() {
        // Read existing secrets (to preserve WAN client secrets if any)
        // Ideally we should manage WAN secrets separately or parse them.
        // For now, we'll rewrite the file with all enabled users from DB.
        // WARNING: This overwrites manual edits or other services.
        // TODO: Merge with WAN client user if exists.

        const config = this.getConfig();
        const expiredPool = config.expired_pool || '172.15.10.2-172.15.10.254';
        let startLong, endLong, poolSize;
        
        try {
            const parts = expiredPool.split('-');
            const startStr = parts[0].trim();
            const endStr = parts[1] ? parts[1].trim() : startStr; // Handle single IP case if needed
            startLong = this.ipToLong(startStr);
            endLong = this.ipToLong(endStr);
            poolSize = endLong - startLong + 1;
            if (poolSize <= 0) poolSize = 1;
        } catch (e) {
            console.error("Error parsing expired pool:", e);
            // Fallback
            startLong = this.ipToLong('172.15.10.2');
            poolSize = 253;
        }

        // Get ALL active users (manually disabled users are excluded)
        // JOIN to get profile name for expiry logic
        let users = db.prepare(`
            SELECT u.*, p.name as expiry_profile_name 
            FROM pppoe_users u 
            LEFT JOIN pppoe_profiles p ON u.profile_id_on_expiry = p.id 
            WHERE u.is_active = 1
        `).all();

        // --- ENFORCE LICENSE LIMITS ---
        const limits = licenseService.getLimits();
        if (limits.max_pppoe_users !== Infinity && users.length > limits.max_pppoe_users) {
            console.warn(`[PPPoE] License Limit Enforced: Allowing only ${limits.max_pppoe_users} users out of ${users.length}.`);
            // Sort by ID or creation to be deterministic (keep oldest users?)
            // Or maybe keep most recently connected?
            // For now, let's keep the first ones returned by DB (usually ID order)
            users = users.slice(0, limits.max_pppoe_users);
        }
        // ------------------------------
        
        let content = "# Secrets for PPPoE Server\n# client\tserver\tsecret\tIP addresses\n";
        
        const now = new Date();

        users.forEach(u => {
                let ip = "*";
                
                // Check for expiration
                if (u.expiration_date) {
                    const expDate = new Date(u.expiration_date);
                    if (expDate < now) {
                        // User is expired. Assign to Expired Pool.
                        // Map ID to pool range
                        const hostOffset = u.id % poolSize; 
                        ip = this.longToIp(startLong + hostOffset);
                        console.log(`[SecretsSync] Assigning EXPIRED IP ${ip} to user ${u.username}`);
                    }
                }
                
                content += `"${u.username}" * "${u.password}" ${ip}\n`;
            });

        // Append WAN Client secret if it exists in settings
        try {
            const wanConfigRow = db.prepare("SELECT value FROM settings WHERE key = 'network_config'").get();
            if (wanConfigRow) {
                const wanConfig = JSON.parse(wanConfigRow.value);
                if (wanConfig.wan && wanConfig.wan.pppoe && wanConfig.wan.pppoe.username) {
                     const wanEntry = `\n# WAN Client\n"${wanConfig.wan.pppoe.username}" * "${wanConfig.wan.pppoe.password}" *\n`;
                     content += wanEntry;
                }
            }
        } catch(e) {
            console.error("Error merging WAN secret:", e);
        }

        try {
            fs.writeFileSync(CHAP_SECRETS_PATH, content);
            fs.writeFileSync(PAP_SECRETS_PATH, content); // Write to PAP secrets as well
            console.log("CHAP and PAP secrets updated.");
        } catch (e) {
            console.error("Failed to write secrets:", e);
            logService.error('PPPOE', `Failed to update secrets: ${e.message}`);
        }
    }

    applyConfig() {
        const config = this.getConfig();
        if (!config.enabled) {
            logService.info('PPPOE', 'PPPoE Server disabled in config');
            return;
        }

        this.syncSecrets();
        
        // Calculate Expired Pool CIDR for Firewall Rules
        let expiredPoolArg = '172.15.10.0/24';
        if (config.expired_pool) {
            if (config.expired_pool.includes('/')) {
                expiredPoolArg = config.expired_pool.trim();
            } else if (config.expired_pool.includes('-')) {
                // Convert Range to Subnet (Approximate)
                const parts = config.expired_pool.split('-');
                const startIp = parts[0].trim();
                const prefix = startIp.substring(0, startIp.lastIndexOf('.') + 1);
                expiredPoolArg = `${prefix}0/24`;
            }
        }

        const wanIface = this.wanInterface || 'eth0';
        const cmd = `bash "${SCRIPT_PATH}" start "${config.interface}" "${config.local_ip}" "${config.remote_start}" "${config.remote_count}" "${config.dns1}" "${config.dns2}" "${wanIface}" "${expiredPoolArg}"`;
        
        logService.info('PPPOE', `Starting PPPoE Server on ${config.interface} (WAN: ${wanIface}) with Expired Pool: ${expiredPoolArg}`);

        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                console.error(`PPPoE Start Error: ${error.message}`);
                logService.error('PPPOE', `Failed to start server: ${error.message}`);
                return;
            }
            if (stderr) console.error(`PPPoE Start Stderr: ${stderr}`);
            console.log(`PPPoE Start Output: ${stdout}`);
            logService.info('PPPOE', 'PPPoE Server started successfully');
        });
    }

    stopServer() {
        logService.info('PPPOE', 'Stopping PPPoE Server...');
        exec(`bash "${SCRIPT_PATH}" stop`, (error, stdout, stderr) => {
             if (error) {
                 console.error(`PPPoE Stop Error: ${error}`);
                 logService.error('PPPOE', `Failed to stop server: ${error.message}`);
             } else {
                 logService.info('PPPOE', 'PPPoE Server stopped');
             }
        });
    }
}

module.exports = new PppoeServerService();
