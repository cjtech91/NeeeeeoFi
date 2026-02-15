const { db } = require('../database/db');
const bandwidthService = require('./bandwidthService');
const EventEmitter = require('events');

const { exec } = require('child_process');

class SessionService extends EventEmitter {
    constructor() {
        super();
        this.checkInterval = null;
        this.lastTrafficStats = new Map();
        this.currentSpeeds = new Map();
    }

    formatLogTime(seconds) {
        if (seconds <= 0) return '00:00:00';
        const d = Math.floor(seconds / 86400);
        const h = Math.floor((seconds % 86400) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        const pad = (v) => String(v).padStart(2, '0');
        if (d > 0) {
            return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
        }
        return `${pad(h)}:${pad(m)}:${pad(s)}`;
    }

    startMonitoring(intervalMs = 5000) {
        if (this.checkInterval) clearInterval(this.checkInterval);
        
        const runChecks = async () => {
            const networkService = require('./networkService');

            // Run each step independently so a failure in one does not block the rest
            try { 
                await this.updateTrafficStats(); 
            } catch (e) { 
                console.error("[Session] updateTrafficStats failed:", e); 
            }

            let activeMacs = null;
            try { 
                activeMacs = await networkService.getActiveMacs(); 
            } catch (e) { 
                console.error("[Session] getActiveMacs failed:", e); 
                activeMacs = null;
            }
            
            try { await this.checkConnectivity(activeMacs); } 
            catch (e) { console.error("[Session] checkConnectivity failed:", e); }

            try { await this.checkPausedUsers(activeMacs); } 
            catch (e) { console.error("[Session] checkPausedUsers failed:", e); }

            try { await this.checkIdleUsers(); } 
            catch (e) { console.error("[Session] checkIdleUsers failed:", e); }

            try { await this.checkSessionTimeout(); } 
            catch (e) { console.error("[Session] checkSessionTimeout failed:", e); }

            try { await this.syncFirewall(activeMacs); } 
            catch (e) { console.error("[Session] syncFirewall failed:", e); }
        };

        // Run immediately
        runChecks();

        this.checkInterval = setInterval(runChecks, intervalMs);
        
        console.log(`[Session] Idle monitoring started (Interval: ${intervalMs}ms)`);
    }

    stopMonitoring() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
            console.log('[Session] Monitoring stopped.');
        }
    }

    async updateTrafficStats() {
        try {
            const networkService = require('./networkService');
            const currentStats = await networkService.getTrafficStats(); // Map<IP, {bytes_up, bytes_down}>
            const now = Date.now();
            // Avoid division by zero or extremely small intervals
            const timeDiff = Math.max(0.1, (now - (this.lastCheckTime || now)) / 1000); 
            
            if (!this.lastTrafficStats) this.lastTrafficStats = new Map();

            const updates = [];
            const activityUpdates = [];

            for (const [ip, stats] of currentStats) {
                let deltaUp = 0;
                let deltaDown = 0;
                
                if (this.lastTrafficStats.has(ip)) {
                    const last = this.lastTrafficStats.get(ip);
                    if (stats.bytes_up >= last.bytes_up) {
                        deltaUp = stats.bytes_up - last.bytes_up;
                    } else {
                        // Counter reset? Use current value as delta
                        deltaUp = stats.bytes_up;
                    }
                    
                    if (stats.bytes_down >= last.bytes_down) {
                        deltaDown = stats.bytes_down - last.bytes_down;
                    } else {
                        deltaDown = stats.bytes_down;
                    }
                } else {
                    // First time seeing this IP. 
                    // Do NOT assume total is delta (avoids double counting on restart).
                    // Delta remains 0.
                }
                
                // Calculate Speed (Bytes per second)
                const speedUp = Math.floor(deltaUp / timeDiff);
                const speedDown = Math.floor(deltaDown / timeDiff);
                this.currentSpeeds.set(ip, { dl_speed: speedDown, ul_speed: speedUp });

                // Update DB if there is change
                const totalDelta = deltaUp + deltaDown;
                if (totalDelta > 0) {
                     updates.push({ deltaUp, deltaDown, ip });

                     // Reset idle timer if SIGNIFICANT traffic detected (Threshold: 1000 bytes /1KB)
                     if (totalDelta > 1000) {
                         activityUpdates.push(ip);
                     }
                }
            }
            
            // Batch Process Updates (Transaction)
            if (updates.length > 0) {
                const timestamp = new Date(now - (new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 19).replace('T', ' ');
                
                const batchTransaction = db.transaction((trafficUpdates, activeIps, ts) => {
                    const updateTraffic = db.prepare(`
                        UPDATE users 
                        SET total_data_up = total_data_up + ?, 
                            total_data_down = total_data_down + ?
                        WHERE ip_address = ? AND is_connected = 1
                    `);

                    const updateActivity = db.prepare(`
                        UPDATE users 
                        SET last_active_at = ?,
                            last_traffic_at = ?
                        WHERE ip_address = ? AND is_connected = 1
                    `);

                    for (const u of trafficUpdates) {
                        updateTraffic.run(u.deltaUp, u.deltaDown, u.ip);
                    }

                    for (const ip of activeIps) {
                        updateActivity.run(ts, ts, ip);
                    }
                });

                batchTransaction(updates, activityUpdates, timestamp);
            }
            
            // Update last known stats
            this.lastTrafficStats = currentStats;
            this.lastCheckTime = now;

        } catch (e) {
            console.error("[Session] Error updating traffic stats:", e);
        }
    }

    getCurrentSpeed(ip) {
        if (!ip) return { dl_speed: 0, ul_speed: 0 };
        return this.currentSpeeds.get(ip) || { dl_speed: 0, ul_speed: 0 };
    }

    async checkConnectivity(activeMacs = null) {
        // Get all connected users
        const connectedUsers = db.prepare('SELECT * FROM users WHERE is_connected = 1 AND is_paused = 0').all();
        
        for (const user of connectedUsers) {
            // Check for Roaming (IP Change) if activeMacs is available
            if (activeMacs && activeMacs.has(user.mac_address)) {
                const newIp = activeMacs.get(user.mac_address);
                if (newIp && newIp !== user.ip_address) {
                    console.log(`[Session] Roaming (Connected) detected for ${user.mac_address}: IP changed ${user.ip_address} -> ${newIp}`);
                    
                    // Update DB
                    db.prepare('UPDATE users SET ip_address = ? WHERE id = ?').run(newIp, user.id);
                    
                    // Update QoS for new IP (and remove old if possible, but let's just set new for now)
                    if (bandwidthService && bandwidthService.setLimit) {
                         // bandwidthService.removeLimit(user.ip_address); // Optional cleanup
                         await bandwidthService.setLimit(newIp, user.download_speed, user.upload_speed);
                    }
                    
                    // Update Firewall Accounting for new IP
                    try {
                        const networkService = require('./networkService');
                        await networkService.allowUser(user.mac_address, newIp);
                    } catch (e) {
                        console.error(`[Session] Failed to update firewall for roamed user ${user.mac_address}:`, e);
                    }

                    user.ip_address = newIp; // Update local object
                }
            }
            
            // Removed pingUser(user) to reduce CPU load (spawn process).
            // We rely on traffic stats (updateTrafficStats) for "Active" status.
            // this.pingUser(user); 
        }
    }

    pingUser(user) {
        if (!user.ip_address) return;

        // Ping timeout 1s, 1 packet
        const cmd = process.platform === 'win32' 
            ? `ping -n 1 -w 1000 ${user.ip_address}`
            : `ping -c 1 -W 1 ${user.ip_address}`;

        exec(cmd, (error, stdout, stderr) => {
            if (!error) {
                // User is active/reachable
                this.updateActivity(user.mac_address);
            } else {
                // User is unreachable, do not update activity.
                // Their 'last_active_at' will age, eventually triggering checkIdleUsers -> pauseUser
            }
        });
    }

    // Helper to parse SQLite UTC timestamps correctly
    parseDbDate(dateStr) {
        if (!dateStr) return null;
        // SQLite timestamps are stored as 'YYYY-MM-DD HH:MM:SS'
        // If they are stored as Local Time (as generated in checkIdleUsers), we should parse them as Local Time.
        // Appending 'Z' forces UTC interpretation, which causes "Future Time" issues if the string was Local Time.
        if (typeof dateStr === 'string' && !dateStr.endsWith('Z')) {
            // Replace space with T for ISO-like parsing as Local Time
            return new Date(dateStr.replace(' ', 'T')).getTime();
        }
        return new Date(dateStr).getTime();
    }

    async checkIdleUsers() {
        try {
            const configService = require('./configService');
            const networkService = require('./networkService'); // Import here
            const globalIdleSec = Number(configService.get('idle_timeout_seconds')) || 120;
            const globalKeepaliveSec = Number(configService.get('keepalive_timeout_seconds')) || 300;
            // Get all connected users
            const users = db.prepare(`
                SELECT id, mac_address, ip_address, 
                       last_active_at, last_traffic_at, 
                       keepalive_timeout, idle_timeout 
                FROM users 
                WHERE is_connected = 1 AND is_paused = 0
            `).all();

            const now = Date.now();

            for (const user of users) {
                // 1. Check Keepalive Timeout (Disconnected/Unreachable)
                // last_active_at is updated on successful ping (checkConnectivity -> pingUser)
                
                // DISABLED: Keepalive timeout was causing "sudden disconnects" for active users
                // whose devices block ping requests or sleep aggressively.
                // We will rely ONLY on traffic-based activity to keep sessions alive.
                /*
                const keepaliveTimeout = ((user.keepalive_timeout || globalKeepaliveSec)) * 1000;
                const lastActive = user.last_active_at ? this.parseDbDate(user.last_active_at) : now;
                
                if (now - lastActive > keepaliveTimeout) {
                    console.log(`[Session] User ${user.mac_address} timed out (Keepalive). Pausing session. Last seen: ${user.last_active_at}`);
                    await this.pauseUser(user);
                    continue; // User paused, skip idle check
                }
                */

                // 2. Check Idle Timeout (Active Connections Check)
                // REMOVED: Relying on ARP Reachable (hasActiveConnections) prevents Idle Timeout 
                // for devices that are connected but not using data (e.g. screen off).
                // We want to pause users who are not generating TRAFFIC.
                // Traffic updates are handled in updateTrafficStats() which updates last_traffic_at.
                
                /* 
                let hasActiveConns = false;
                if (user.ip_address) {
                    hasActiveConns = await networkService.hasActiveConnections(user.ip_address);
                }

                if (hasActiveConns) {
                    // Active connections detected -> Reset Idle Timer (Update last_traffic_at)
                    // Optimization: Only update DB if it's been > 10s to reduce write load
                    const lastTrafficTime = user.last_traffic_at ? this.parseDbDate(user.last_traffic_at) : 0;
                    if (now - lastTrafficTime > 10000) {
                         db.prepare("UPDATE users SET last_traffic_at = CURRENT_TIMESTAMP WHERE id = ?").run(user.id);
                         // console.log(`[Session] Active connections detected for ${user.mac_address}. Idle timer reset.`);
                    }
                    continue; // Skip timeout check
                }
                */

                // 2.5 Fast Disconnect Detection (New)
                // If Ping failed for > 60s AND No Active Connections (ARP Stale/Unreachable)
                // We treat this as "Device Disconnected" rather than just "Idle".
                // This allows us to pause sessions faster (e.g. 1 min) than the Keepalive (5 min) 
                // or Idle Timeout (which might be long), improving user experience.
                
                // DISABLED: Users reported "sudden disconnects" while browsing.
                // Without reliable ARP/Neighbor state checking (which varies by OS/Driver), 
                // this 60s check is too aggressive if Pings are blocked or dropped.
                // We will rely on the standard Idle Timeout (120s) instead.
                
                /*
                const fastDisconnectThreshold = 60 * 1000; // 60 Seconds
                if (now - lastActive > fastDisconnectThreshold) {
                     console.log(`[Session] User ${user.mac_address} disconnected (Ping+ARP failed > 60s). Pausing session. Last seen: ${user.last_active_at}`);
                     await this.pauseUser(user, 'Device Disconnected');
                     continue;
                }
                */

                // 3. If NO active connections, check if time has elapsed
                // last_traffic_at is updated above or in app.js traffic loop
                // We also check last_active_at (updated by Ping) to avoid disconnecting users who are connected but have low traffic.
                
                // Re-enabled: Idle Timeout per user request.
                // When timeout is reached, we PAUSE the user (stop time, block internet), but do NOT disconnect (keep is_connected=1).
                const idleTimeout = ((user.idle_timeout || globalIdleSec)) * 1000;
                
                const tTraffic = user.last_traffic_at ? this.parseDbDate(user.last_traffic_at) : 0;
                const tActive = user.last_active_at ? this.parseDbDate(user.last_active_at) : 0;
                
                // Use the most recent activity between traffic and active timestamps
                // Fallback to 'now' when both are missing/invalid.
                const lastActivity = Math.max(tTraffic || 0, tActive || 0) || now;

                if (now - lastActivity > idleTimeout) {
                    console.log(`[Session] User ${user.mac_address} timed out (Idle - No Active Connections). Pausing session. Last activity: ${new Date(lastActivity).toISOString()}`);
                    await this.pauseUser(user, 'Idle Timeout');
                }
            }
        } catch (e) {
            console.error("[Session] Error checking idle users:", e);
        }
    }

    async checkSessionTimeout() {
        try {
            // Get users with expired sessions
            // CRITICAL FIX: Only disconnect if time_remaining is ALSO <= 0.
            // Users with time remaining should NEVER be disconnected by session expiry, only Paused by Idle.
            const expiredUsers = db.prepare(`
                SELECT id, mac_address, ip_address 
                FROM users 
                WHERE session_expiry IS NOT NULL 
                  AND session_expiry < CURRENT_TIMESTAMP
                  AND is_connected = 1
                  AND is_paused = 0
                  AND time_remaining <= 0
            `).all();

            if (expiredUsers.length > 0) {
                const networkService = require('./networkService');
                
                for (const user of expiredUsers) {
                    console.log(`[Session] User ${user.mac_address} session expired. Forcing re-login.`);
                    
                    // Reset session_expiry to NULL so they get a new session on next login
                    // Set is_connected = 0 to force portal redirect
                    db.prepare('UPDATE users SET is_connected = 0, session_expiry = NULL WHERE id = ?').run(user.id);
                    
                    // Block access immediately
                    await networkService.blockUser(user.mac_address, user.ip_address);
                    
                    if (user.ip_address) {
                        if (bandwidthService && bandwidthService.removeLimit) {
                            await bandwidthService.removeLimit(user.ip_address);
                        }
                    }
                }
            }
        } catch (e) {
            console.error("[Session] Error checking session timeouts:", e);
        }
    }

    async checkPausedUsers(activeMacs = null) {
        return;
    }

    async resumeUser(user) {
        console.log(`[Session] Auto-resuming user: ${user.mac_address}`);
        
        try {
            // Update DB
            db.prepare('UPDATE users SET is_paused = 0, is_connected = 1, last_active_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
            
            // Log Event
            try {
                const latestUser = db.prepare('SELECT time_remaining, user_code FROM users WHERE id = ?').get(user.id);
                const logData = {
                    type: 'session_resumed',
                    details: {
                        message: `User ${latestUser?.user_code || 'N/A'} resumed session.`,
                        remaining_time: this.formatLogTime(latestUser?.time_remaining || 0),
                        user_code: latestUser?.user_code,
                        mac_address: user.mac_address
                    }
                };
                db.prepare('INSERT INTO system_logs (category, level, message, timestamp) VALUES (?, ?, ?, CURRENT_TIMESTAMP)').run('Hotspot', 'info', JSON.stringify(logData));
            } catch (logErr) {
                console.error('[Session] Failed to log resume:', logErr);
            }

            // Restore Firewall Access
            // Using require inside function to avoid circular dependency
            const networkService = require('./networkService');
            await networkService.allowUser(user.mac_address, user.ip_address);

            // Restore Traffic Control (QoS)
            if (user.ip_address) {
                if (bandwidthService && bandwidthService.setLimit) {
                    await bandwidthService.setLimit(user.ip_address, user.download_speed, user.upload_speed);
                }
            }
            
            // Emit update event
            this.emit('session_updated', { mac: user.mac_address, is_paused: 0 });
        } catch (e) {
            console.error(`[Session] Failed to resume user ${user.mac_address}:`, e);
        }
    }

    async pauseUser(user, reason = 'Idle') {
        console.log(`[Session] Pausing user: ${user.mac_address} (Reason: ${reason})`);
        
        try {
            // Capture final traffic stats before blocking
            await this.updateTrafficStats();

            // Update DB - Keep is_connected = 1 so status shows "Paused" instead of "Offline"
            db.prepare('UPDATE users SET is_paused = 1, is_connected = 1 WHERE id = ?').run(user.id);
            
            // Log Event
            try {
                const latestUser = db.prepare('SELECT time_remaining, user_code FROM users WHERE id = ?').get(user.id);
                const logData = {
                    type: 'session_paused',
                    details: {
                        message: `User ${latestUser?.user_code || 'N/A'} paused. Reason: ${reason}`,
                        remaining_time: this.formatLogTime(latestUser?.time_remaining || 0),
                        user_code: latestUser?.user_code,
                        mac_address: user.mac_address
                    }
                };
                db.prepare('INSERT INTO system_logs (category, level, message, timestamp) VALUES (?, ?, ?, CURRENT_TIMESTAMP)').run('Hotspot', 'info', JSON.stringify(logData));
            } catch (logErr) {
                console.error('[Session] Failed to log pause:', logErr);
            }

            // Remove from Firewall/Internet
            // We must call blockUser to remove the iptables mark
            // Using require inside function to avoid circular dependency if networkService requires sessionService
            const networkService = require('./networkService');
            await networkService.blockUser(user.mac_address, user.ip_address);

            // Remove from Traffic Control (QoS)
            if (bandwidthService && bandwidthService.removeLimit) {
                await bandwidthService.removeLimit(user.ip_address);
            }
            
            // Emit update event
            this.emit('session_updated', { mac: user.mac_address, is_paused: 1 });
        } catch (e) {
            console.error(`[Session] Failed to pause user ${user.mac_address}:`, e);
        }
    }

    async disconnectUser(user) {
        console.log(`[Session] Disconnecting user: ${user.mac_address}`);
        try {
            // Check if user has remaining time. If so, Pause instead of Disconnect.
            const currentUser = db.prepare('SELECT time_remaining FROM users WHERE id = ?').get(user.id);
            if (currentUser && currentUser.time_remaining > 0) {
                 console.log(`[Session] User ${user.mac_address} has time remaining. Pausing instead of disconnecting.`);
                 return this.pauseUser(user, 'Manual Disconnect (Paused)');
            }

            // Capture final traffic stats before blocking
            await this.updateTrafficStats();

            // Force re-login behavior
            db.prepare('UPDATE users SET is_connected = 0, is_paused = 0 WHERE id = ?').run(user.id);
            
            // Block firewall access immediately
            const networkService = require('./networkService');
            await networkService.blockUser(user.mac_address, user.ip_address);
            
            // Remove QoS if IP is known
            if (user.ip_address) {
                if (bandwidthService && bandwidthService.removeLimit) {
                    await bandwidthService.removeLimit(user.ip_address);
                }
            }
        } catch (e) {
            console.error(`[Session] Failed to disconnect user ${user.mac_address}:`, e);
        }
    }

    updateActivity(mac) {
        try {
            db.prepare("UPDATE users SET last_active_at = CURRENT_TIMESTAMP WHERE mac_address = ?").run(mac);
        } catch (e) {
            console.error("[Session] Error updating activity:", e);
        }
    }

    /**
     * Reconciliation Loop: Ensures firewall state matches DB state
     * 1. Get list of MACs currently authorized in iptables
     * 2. Get list of Connected users in DB
     * 3. Sync: Allow missing users, Block unauthorized users
     */
    async syncFirewall(activeMacs = null) {
        try {
            const networkService = require('./networkService');
            
            // 1. Get currently authorized MACs from iptables
            const authorizedMacs = await networkService.getAuthorizedMacs();
            
            // 2. Get Connected Users from DB
            const connectedUsers = db.prepare('SELECT id, mac_address, ip_address, time_remaining, is_paused FROM users WHERE is_connected = 1 AND is_paused = 0 AND time_remaining > 0').all();
            const connectedMacs = new Set(connectedUsers.map(u => u.mac_address.toUpperCase()));

            // 3. Check for Missing Users (In DB but NOT in Firewall) -> ALLOW
            for (const user of connectedUsers) {
                if (!authorizedMacs.has(user.mac_address.toUpperCase())) {
                    console.log(`[Session] Sync: User ${user.mac_address} is connected in DB but missing from Firewall. Re-authorizing.`);
                    await networkService.allowUser(user.mac_address, user.ip_address);
                    // Also restore QoS if needed
                    if (user.ip_address && bandwidthService && bandwidthService.setLimit) {
                         // We don't have speed info in this query, maybe fetch or ignore for now
                         // Ideally we should fetch speeds too
                    }
                }
            }

            // 4. Check for Unauthorized Users (In Firewall but INVALID in DB) -> BLOCK
            if (authorizedMacs.size > 0) {
                for (const mac of authorizedMacs) {
                    // specific check for each mac found in firewall
                    // Use COLLATE NOCASE to handle case-insensitive MAC comparison (DB might be lowercase)
                    const user = db.prepare('SELECT id, time_remaining, is_paused, ip_address FROM users WHERE mac_address = ? COLLATE NOCASE').get(mac);
                    
                    let shouldBlock = false;

                    if (!user) {
                        // User not in DB at all? Block.
                        console.log(`[Session] Sync: MAC ${mac} authorized in firewall but not in DB. Blocking.`);
                        shouldBlock = true;
                    } else if (user.time_remaining <= 0) {
                        // Time expired? Block.
                        console.log(`[Session] Sync: MAC ${mac} authorized but time expired (${user.time_remaining}). Blocking.`);
                        shouldBlock = true;
                    } else if (user.is_paused) {
                         // User paused? Block.
                         console.log(`[Session] Sync: MAC ${mac} authorized but user is PAUSED. Blocking.`);
                         shouldBlock = true;
                    }

                    if (shouldBlock) {
                        await networkService.blockUser(mac, user ? user.ip_address : null);
                    }
                }
            }
        } catch (e) {
            console.error("[Session] Error in syncFirewall:", e);
        }
    }
}

module.exports = new SessionService();
