const { exec } = require('child_process');
const path = require('path');
const { db } = require('../database/db');
const dns = require('dns');

class WalledGardenService {
    constructor() {
        // Placeholder for script path if needed later
        this.scriptPath = path.join(__dirname, '../scripts/walled_garden.sh');
    }

    getAll() {
        try {
            return db.prepare('SELECT * FROM walled_garden ORDER BY created_at DESC').all();
        } catch (e) {
            console.error("Failed to get walled garden entries:", e);
            return [];
        }
    }

    async resolveDomain(domain) {
        return new Promise((resolve, reject) => {
            dns.lookup(domain, (err, address, family) => {
                if (err) resolve(null); // Return null on failure instead of rejecting
                else resolve(address);
            });
        });
    }

    async resolveDomainAll(domain) {
        try {
            const addrs = new Set();
            try {
                const v4 = await dns.promises.resolve4(domain);
                for (const a of (v4 || [])) addrs.add(a);
            } catch (_) {}
            try {
                const v6 = await dns.promises.resolve6(domain);
                for (const a of (v6 || [])) addrs.add(a);
            } catch (_) {}
            if (addrs.size === 0) {
                const single = await this.resolveDomain(domain);
                if (single) addrs.add(single);
            }
            return Array.from(addrs).slice(0, 50);
        } catch (_) {
            return [];
        }
    }

    async init() {
        console.log("Initializing Walled Garden...");
        await this.runScript('init');
        
        // Restore rules from DB (Create dnsmasq configs)
        // Note: 'init' script clears ipsets but doesn't delete dnsmasq files unless we call flush.
        // But to be safe and consistent, we can re-apply all.
        // Actually, dnsmasq configs persist on disk. 'init' just sets up ipsets/iptables.
        // But if we want to ensure sync, we can loop through DB.
        
        const entries = this.getAll();
        for (const entry of entries) {
             const t = String(entry.type || '').toLowerCase();
             const scriptType = (t === 'deny' || t === 'drop') ? 'DROP' : (t === 'allow' || t === 'accept') ? 'ACCEPT' : String(entry.type || 'ACCEPT').toUpperCase();
             const addr = (entry && entry.address && String(entry.address).trim() && String(entry.address).trim().toLowerCase() !== 'unresolved') ? String(entry.address) : '';
             await this.runScript('add', entry.domain, scriptType, addr);
        }
    }

    async add(domain, type) {
        try {
            // Normalize domain (remove protocol, path, etc.)
            let cleanDomain = domain.toLowerCase().trim();
            cleanDomain = cleanDomain.replace(/^https?:\/\//, ''); // Remove http:// or https://
            cleanDomain = cleanDomain.replace(/^www\./, ''); // Remove leading www.
            cleanDomain = cleanDomain.split('/')[0]; // Remove path
            cleanDomain = cleanDomain.split(':')[0]; // Remove port
            
            if (!cleanDomain) throw new Error("Invalid domain");

            const addresses = await this.resolveDomainAll(cleanDomain);
            const addressText = addresses.length ? addresses.join(', ') : 'Unresolved';

            const t = String(type || '').toLowerCase();
            const normalizedType = (t === 'deny' || t === 'drop') ? 'DROP' : 'ACCEPT';

            const stmt = db.prepare('INSERT INTO walled_garden (domain, type, address) VALUES (?, ?, ?)');
            const info = stmt.run(cleanDomain, normalizedType, addressText);

            // Apply system changes
            const scriptType = normalizedType;
            await this.runScript('init');
            await this.runScript('add', cleanDomain, scriptType, addressText);
            
            return { id: info.lastInsertRowid, domain: cleanDomain, type: normalizedType, address: addressText };
        } catch (e) {
            console.error("Failed to add walled garden entry:", e);
            throw e;
        }
    }

    async remove(id) {
        try {
            const entry = db.prepare('SELECT * FROM walled_garden WHERE id = ?').get(id);
            if (!entry) return false;

            db.prepare('DELETE FROM walled_garden WHERE id = ?').run(id);
            
            // Remove system changes
            await this.runScript('remove', entry.domain);
            
            return true;
        } catch (e) {
            console.error("Failed to remove walled garden entry:", e);
            throw e;
        }
    }

    async runScript(command, ...args) {
        return new Promise((resolve, reject) => {
            // Ensure executable
            try { 
                require('child_process').execSync(`sed -i 's/\r$//' "${this.scriptPath}"`);
                require('fs').chmodSync(this.scriptPath, '755'); 
            } catch(e) {}

            const quotedArgs = args.map(a => `"${String(a).replace(/"/g, '\\"')}"`).join(' ');
            const cmd = `bash "${this.scriptPath}" ${command}${quotedArgs ? ' ' + quotedArgs : ''}`;
            exec(cmd, (error, stdout, stderr) => {
                if (error) {
                    console.error(`WalledGardenService Error (${command}):`, stderr);
                    // Resolve anyway to avoid crashing app, but log error
                    resolve(false);
                } else {
                    resolve(true);
                }
            });
        });
    }
}

module.exports = new WalledGardenService();
