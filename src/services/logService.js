const { db } = require('../database/db');
const fs = require('fs');
const { exec } = require('child_process');

class LogService {
    
    // --- DB Logging ---

    log(level, category, message) {
        try {
            // Use JS Date to ensure consistent local time with Node.js process (matches sales/vouchers)
            const now = new Date();
            const timestamp = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0, 19).replace('T', ' ');
            
            db.prepare("INSERT INTO system_logs (level, category, message, timestamp) VALUES (?, ?, ?, ?)")
              .run(level, category, message, timestamp);
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
    getSystemLogs(limit = 100, date = null, search = null) {
        let query = "SELECT * FROM system_logs";
        const params = [];
        const conditions = [];

        if (date) {
            conditions.push("timestamp LIKE ?");
            params.push(`${date}%`);
        }
        if (search) {
            conditions.push("(message LIKE ? OR category LIKE ?)");
            params.push(`%${search}%`);
            params.push(`%${search}%`);
        }

        if (conditions.length > 0) {
            query += " WHERE " + conditions.join(" AND ");
        }

        query += " ORDER BY timestamp DESC LIMIT ?";
        params.push(limit);

        return db.prepare(query).all(...params);
    }

    /**
     * Get Voucher Logs (from vouchers table)
     * Shows usage history
     */
    getVoucherLogs(limit = 100, date = null, search = null) {
        // Join with users table to get details if needed, but vouchers table has used_by_user_id
        // We focus on used vouchers
        let query = `
            SELECT v.code, v.plan_name, v.price, v.used_at, u.mac_address, u.ip_address 
            FROM vouchers v
            LEFT JOIN users u ON v.used_by_user_id = u.id
            WHERE v.is_used = 1
        `;
        const params = [];

        if (date) {
            query += " AND v.used_at LIKE ?";
            params.push(`${date}%`);
        }
        if (search) {
            query += " AND (v.code LIKE ? OR v.plan_name LIKE ? OR u.mac_address LIKE ? OR u.ip_address LIKE ?)";
            params.push(`%${search}%`);
            params.push(`%${search}%`);
            params.push(`%${search}%`);
            params.push(`%${search}%`);
        }

        query += " ORDER BY v.used_at DESC LIMIT ?";
        params.push(limit);

        return db.prepare(query).all(...params);
    }

    /**
     * Get Hotspot Logs (Combined Vouchers, Sales/Coins, Expirations)
     */
    getHotspotLogs(limit = 100, date = null, search = null) {
        // We will fetch from 3 sources and combine them in JS because they have different schemas
        // 1. Voucher Usage
        let vQuery = `
            SELECT 'voucher_usage' as type, v.used_at as timestamp, 
                   v.code, v.plan_name, v.price, u.mac_address, u.ip_address 
            FROM vouchers v
            LEFT JOIN users u ON v.used_by_user_id = u.id
            WHERE v.is_used = 1
        `;
        const vParams = [];
        if (date) {
            vQuery += " AND v.used_at LIKE ?";
            vParams.push(`${date}%`);
        }
        if (search) {
            vQuery += " AND (v.code LIKE ? OR v.plan_name LIKE ? OR u.mac_address LIKE ? OR u.ip_address LIKE ?)";
            vParams.push(`%${search}%`);
            vParams.push(`%${search}%`);
            vParams.push(`%${search}%`);
            vParams.push(`%${search}%`);
        }
        vQuery += " ORDER BY v.used_at DESC LIMIT ?";
        vParams.push(limit);
        const vouchers = db.prepare(vQuery).all(...vParams);

        // 2. Coin Sales
        let sQuery = `
            SELECT 'coin_insert' as type, s.timestamp, 
                   s.amount, s.source, s.user_code, s.mac_address,
                   sv.name as vendo_name
            FROM sales s
            LEFT JOIN sub_vendo_devices sv ON SUBSTR(s.source, 10) = sv.device_id AND s.source LIKE 'subvendo:%'
            WHERE 1=1
        `;
        const sParams = [];
        if (date) {
            sQuery += " AND s.timestamp LIKE ?";
            sParams.push(`${date}%`);
        }
        if (search) {
            sQuery += " AND (s.source LIKE ? OR s.user_code LIKE ? OR s.mac_address LIKE ? OR sv.name LIKE ?)";
            sParams.push(`%${search}%`);
            sParams.push(`%${search}%`);
            sParams.push(`%${search}%`);
            sParams.push(`%${search}%`);
        }
        sQuery += " ORDER BY s.timestamp DESC LIMIT ?";
        sParams.push(limit);
        const sales = db.prepare(sQuery).all(...sParams);

        // 3. Expirations (from system_logs)
        // We look for category='Hotspot' and type='session_expired' in the message
        let slQuery = `
            SELECT timestamp, message 
            FROM system_logs 
            WHERE category LIKE 'Hotspot'
        `;
        const slParams = [];
        if (date) {
            slQuery += " AND timestamp LIKE ?";
            slParams.push(`${date}%`);
        }
        if (search) {
            slQuery += " AND message LIKE ?";
            slParams.push(`%${search}%`);
        }
        slQuery += " ORDER BY timestamp DESC LIMIT ?";
        slParams.push(limit);
        const systemLogs = db.prepare(slQuery).all(...slParams);

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
                if (['session_expired', 'session_paused', 'session_resumed', 'session_extended'].includes(msg.type)) {
                    combined.push({
                        type: msg.type,
                        timestamp: l.timestamp,
                        details: msg.details
                    });
                }
            } catch (e) {
                // If not JSON, ignore or treat as generic
            }
        });

        // Filter combined results by search text if it wasn't fully caught by SQL
        // (e.g. searching inside JSON details for expiration)
        let results = combined;
        if (search) {
            const lowerSearch = search.toLowerCase();
            results = combined.filter(item => {
                // If we already filtered in SQL (like for vouchers/sales), this is redundant but safe
                // But for session_expired, we only filtered the JSON string.
                // Let's do a deep string check on details
                return JSON.stringify(item).toLowerCase().includes(lowerSearch);
            });
        }

        // Sort by timestamp DESC
        results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        return results.slice(0, limit);
    }

    getSearchSuggestions(query) {
        if (!query || query.length < 1) return [];
        const limit = 10;
        const suggestions = new Set();
        const likeQuery = `%${query}%`;

        try {
            // 1. MAC Addresses (from users table)
            const macs = db.prepare("SELECT mac_address FROM users WHERE mac_address LIKE ? LIMIT ?").all(likeQuery, limit);
            macs.forEach(r => suggestions.add(r.mac_address));

            // 2. User Codes (from sales)
            if (suggestions.size < limit) {
                const codes = db.prepare("SELECT DISTINCT user_code FROM sales WHERE user_code LIKE ? LIMIT ?").all(likeQuery, limit);
                codes.forEach(r => { if(r.user_code) suggestions.add(r.user_code); });
            }

            // 3. Sources (from sales)
            if (suggestions.size < limit) {
                const sources = db.prepare("SELECT DISTINCT source FROM sales WHERE source LIKE ? LIMIT ?").all(likeQuery, limit);
                sources.forEach(r => suggestions.add(r.source));
            }
            
            // 4. Voucher Codes (from vouchers)
            if (suggestions.size < limit) {
                const vCodes = db.prepare("SELECT code FROM vouchers WHERE code LIKE ? LIMIT ?").all(likeQuery, limit);
                vCodes.forEach(r => suggestions.add(r.code));
            }
        } catch (e) {
            console.error("Error getting search suggestions:", e);
        }

        return Array.from(suggestions).slice(0, limit);
    }

    /**
     * Get PPPoE Logs
     * Reads from syslog on Linux, or returns dummy on Windows
     */
    async getPppoeLogs(limit = 100, date = null, search = null) {
        if (process.platform === 'win32') {
            const logs = [
                { timestamp: new Date().toISOString(), message: "Windows Dev: PPPoE Server started" },
                { timestamp: new Date().toISOString(), message: "Windows Dev: User 'test' connected" }
            ];
            let results = logs;
            if (date) {
                results = results.filter(l => l.timestamp.startsWith(date));
            }
            if (search) {
                const lowerSearch = search.toLowerCase();
                results = results.filter(l => l.message.toLowerCase().includes(lowerSearch));
            }
            return results;
        }

        return new Promise((resolve) => {
            // grep for ppp or pppoe in syslog
            // tail -n limit
            let cmd = `grep -E "pppoe|ppp" /var/log/syslog`;
            
            if (date) {
                // Try to grep date. Syslog date format varies.
                // Best effort: grep the date string (YYYY-MM-DD) OR (Mmm DD)
                const d = new Date(date);
                const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                const mmmDd = `${months[d.getMonth()]} ${d.getDate().toString().padStart(2, ' ')}`;
                
                cmd += ` | grep -E "${date}|${mmmDd}"`;
            }

            if (search) {
                // Safe search: escape quotes to prevent injection in shell command
                const safeSearch = search.replace(/"/g, '\\"');
                cmd += ` | grep -i "${safeSearch}"`;
            }

            cmd += ` | tail -n ${limit}`;

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
    getCriticalErrors(limit = 100, date = null, search = null) {
        let query = "SELECT * FROM system_logs WHERE level IN ('ERROR', 'CRITICAL')";
        const params = [];
        
        if (date) {
            query += " AND timestamp LIKE ?";
            params.push(`${date}%`);
        }
        if (search) {
            query += " AND (message LIKE ? OR category LIKE ?)";
            params.push(`%${search}%`);
            params.push(`%${search}%`);
        }

        query += " ORDER BY timestamp DESC LIMIT ?";
        params.push(limit);

        return db.prepare(query).all(...params);
    }
}

module.exports = new LogService();
