const { db } = require('../database/db');
const fs = require('fs');
const { exec } = require('child_process');

class LogService {
    
    // --- DB Logging ---

    log(level, category, message) {
        try {
            db.prepare("INSERT INTO system_logs (level, category, message, timestamp) VALUES (?, ?, ?, datetime('now', 'localtime'))")
              .run(level, category, message);
        } catch (e) {
            console.error("Failed to write log to DB:", e);
        }
    }

    info(category, message) { this.log('INFO', category, message); }
    warn(category, message) { this.log('WARN', category, message); }
    error(category, message) { this.log('ERROR', category, message); }
    critical(category, message) { this.log('CRITICAL', category, message); }

    // --- Log Retrieval ---

    /**
     * Get System/App Logs from DB
     */
    getSystemLogs(limit = 100) {
        return db.prepare("SELECT * FROM system_logs ORDER BY timestamp DESC LIMIT ?").all(limit);
    }

    /**
     * Get Voucher Logs (from vouchers table)
     * Shows usage history
     */
    getVoucherLogs(limit = 100) {
        // Join with users table to get details if needed, but vouchers table has used_by_user_id
        // We focus on used vouchers
        return db.prepare(`
            SELECT v.code, v.plan_name, v.price, v.used_at, u.mac_address, u.ip_address 
            FROM vouchers v
            LEFT JOIN users u ON v.used_by_user_id = u.id
            WHERE v.is_used = 1
            ORDER BY v.used_at DESC
            LIMIT ?
        `).all(limit);
    }

    /**
     * Get Hotspot Logs (Combined Vouchers, Sales/Coins, Expirations)
     */
    getHotspotLogs(limit = 100) {
        // We will fetch from 3 sources and combine them in JS because they have different schemas
        // 1. Voucher Usage
        const vouchers = db.prepare(`
            SELECT 'voucher_usage' as type, v.used_at as timestamp, 
                   v.code, v.plan_name, v.price, u.mac_address, u.ip_address 
            FROM vouchers v
            LEFT JOIN users u ON v.used_by_user_id = u.id
            WHERE v.is_used = 1
            ORDER BY v.used_at DESC
            LIMIT ?
        `).all(limit);

        // 2. Coin Sales
        const sales = db.prepare(`
            SELECT 'coin_insert' as type, s.timestamp, 
                   s.amount, s.source, s.user_code, s.mac_address,
                   sv.name as vendo_name
            FROM sales s
            LEFT JOIN sub_vendo_devices sv ON SUBSTR(s.source, 10) = sv.device_id AND s.source LIKE 'subvendo:%'
            ORDER BY s.timestamp DESC
            LIMIT ?
        `).all(limit);

        // 3. Expirations (from system_logs)
        // We look for category='HOTSPOT' and type='session_expired' in the message
        const systemLogs = db.prepare(`
            SELECT 'session_expired' as type, timestamp, message 
            FROM system_logs 
            WHERE category = 'HOTSPOT' 
            ORDER BY timestamp DESC
            LIMIT ?
        `).all(limit);

        // Combine and standardize
        const combined = [];

        vouchers.forEach(v => {
            combined.push({
                type: 'voucher_usage',
                timestamp: v.timestamp,
                details: {
                    code: v.code,
                    plan_name: v.plan_name,
                    price: v.price,
                    mac_address: v.mac_address,
                    ip_address: v.ip_address
                }
            });
        });

        sales.forEach(s => {
            combined.push({
                type: 'coin_insert',
                timestamp: s.timestamp,
                details: {
                    amount: s.amount,
                    source: s.vendo_name || s.source,
                    user_code: s.user_code,
                    mac_address: s.mac_address
                }
            });
        });

        systemLogs.forEach(l => {
            try {
                // Try to parse JSON message
                const msg = JSON.parse(l.message);
                if (msg.type === 'session_expired') {
                    combined.push({
                        type: 'session_expired',
                        timestamp: l.timestamp,
                        details: msg.details
                    });
                }
            } catch (e) {
                // If not JSON, ignore or treat as generic
            }
        });

        // Sort by timestamp DESC
        combined.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        return combined.slice(0, limit);
    }

    /**
     * Get PPPoE Logs
     * Reads from syslog on Linux, or returns dummy on Windows
     */
    async getPppoeLogs(limit = 100) {
        if (process.platform === 'win32') {
            return [
                { timestamp: new Date().toISOString(), message: "Windows Dev: PPPoE Server started" },
                { timestamp: new Date().toISOString(), message: "Windows Dev: User 'test' connected" }
            ];
        }

        return new Promise((resolve) => {
            // grep for ppp or pppoe in syslog
            // tail -n limit
            const cmd = `grep -E "pppoe|ppp" /var/log/syslog | tail -n ${limit}`;
            exec(cmd, (err, stdout) => {
                if (err) {
                    // Might fail if syslog doesn't exist or empty grep
                    return resolve([{ timestamp: new Date().toISOString(), message: "No PPPoE logs found or error reading syslog" }]);
                }
                
                // Parse lines roughly
                const lines = stdout.split('\n').filter(l => l).reverse();
                const logs = lines.map(line => {
                    return { raw: line }; 
                });
                resolve(logs);
            });
        });
    }

    /**
     * Get Critical Errors
     * Filter DB logs for ERROR/CRITICAL
     */
    getCriticalErrors(limit = 100) {
        return db.prepare("SELECT * FROM system_logs WHERE level IN ('ERROR', 'CRITICAL') ORDER BY timestamp DESC LIMIT ?").all(limit);
    }
}

module.exports = new LogService();
