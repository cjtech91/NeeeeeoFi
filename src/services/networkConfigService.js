const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { db } = require('../database/db');

const CONFIG_PATH = path.join(__dirname, '../../data/network-config.json');

// Ensure data directory exists
const dataDir = path.dirname(CONFIG_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Default Configuration
const DEFAULT_CONFIG = {
    wan: {
        interface: 'eth0',
        mode: 'dynamic', // dynamic, static, pppoe
        static: {
            ip: '',
            netmask: '255.255.255.0',
            gateway: '',
            dns1: '8.8.8.8',
            dns2: '8.8.4.4'
        },
        pppoe: {
            username: '',
            password: '',
            dns1: '8.8.8.8',
            dns2: '8.8.4.4'
        }
    },

    vlans: [], // Array of { id, parent, vlanId, mac }

    dhcp: {
        bitmask: 19, // Default /19
        dns1: '8.8.8.8',
        dns2: '8.8.4.4',
        servers: [] // Array of { interface, subnet, netmask, start, end, lease }
    },

    bridges: [
        {
            name: 'br0',
            ip: '10.0.0.1',
            netmask: '255.255.255.0',
            stp: true,
            interfaces: ['wlan0', 'eth1'] // Default interfaces if available
        }
    ]
};

class NetworkConfigService {
    constructor() {
        // Initialize with default config safely
        this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }

    init() {
        this.config = this.loadConfig();

        // Ensure bridges array exists and has default if empty
        if (!this.config.bridges) {
            this.config.bridges = JSON.parse(JSON.stringify(DEFAULT_CONFIG.bridges));
            this.saveConfig(this.config);
        } else if (this.config.bridges.length === 0) {
            // If exists but empty, ensure default br0 is present
             this.config.bridges = JSON.parse(JSON.stringify(DEFAULT_CONFIG.bridges));
             this.saveConfig(this.config);
        }
    }

    loadConfig() {
        let config = null;

        // 1. Try loading from DB first
        try {
            const row = db.prepare("SELECT value FROM settings WHERE key = 'network_config'").get();
            if (row && row.value) {
                config = JSON.parse(row.value);
                console.log('Network config loaded from Database');
            }
        } catch (dbError) {
            console.error('Warning: Failed to load network config from DB, falling back to file:', dbError.message);
        }

        // 2. Fallback to File if DB failed or was empty
        if (!config && fs.existsSync(CONFIG_PATH)) {
            try {
                const data = fs.readFileSync(CONFIG_PATH, 'utf8');
                config = JSON.parse(data);
                console.log('Network config loaded from File');

                // Attempt to seed DB for next time
                try {
                    db.prepare(`
                        INSERT INTO settings (key, value, type, category, updated_at) 
                        VALUES ('network_config', ?, 'json', 'network', CURRENT_TIMESTAMP)
                        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
                    `).run(JSON.stringify(config));
                } catch (seedError) {
                    console.error('Warning: Failed to seed DB with network config:', seedError.message);
                }
            } catch (fileError) {
                console.error('Error loading network config from file:', fileError);
            }
        }

        // 3. Return Config or Default
        if (config) {
            return { ...DEFAULT_CONFIG, ...config };
        } else {
            return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        }
    }

    saveConfig(newConfig) {
        try {
            this.config = { ...this.config, ...newConfig };
            
            // 1. Save to File (Backup/Legacy)
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2));

            // 2. Save to Database (Primary)
            db.prepare(`
                INSERT INTO settings (key, value, type, category, updated_at) 
                VALUES ('network_config', ?, 'json', 'network', CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
            `).run(JSON.stringify(this.config));

            return true;
        } catch (error) {
            console.error('Error saving network config:', error);
            return false;
        }
    }

    getWanConfig() {
        return this.config.wan;
    }

    async setWanConfig(wanConfig) {
        this.config.wan = { ...this.config.wan, ...wanConfig };
        this.saveConfig(this.config);
        
        console.log('Applying WAN Config:', wanConfig);

        // Update DB for persistence across reboots (for NetworkService)
        try {
            if (wanConfig.interface) {
                 db.prepare("INSERT INTO settings (key, value, category) VALUES ('wan_interface', ?, 'network') ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP").run(wanConfig.interface);
                 console.log('Updated WAN Interface in DB:', wanConfig.interface);
            }
        } catch (e) {
            console.error("Failed to update WAN interface in DB", e);
        }

        const pppoeScript = path.join(__dirname, '../scripts/init_pppoe.sh');
        
        // 1. Always stop any existing PPPoE session first (to ensure clean state)
        console.log('Stopping any existing PPPoE sessions...');
        await new Promise((resolve) => {
            // Ensure executable
            exec(`chmod +x ${pppoeScript}`);
            // Run stop with dummy args
            exec(`${pppoeScript} none none none stop`, (err) => {
                if (err) console.log('PPPoE Stop (benign error or not running):', err.message);
                resolve();
            });
        });

        // 2. Configure PPPoE (Write files) if mode is pppoe
        if (this.config.wan.mode === 'pppoe') {
            const { interface: iface, pppoe } = this.config.wan;
            if (iface && pppoe && pppoe.username && pppoe.password) {
                 const dns1 = pppoe.dns1 || '';
                 const dns2 = pppoe.dns2 || '';
                 
                 console.log('Writing PPPoE configuration...');
                 await new Promise((resolve) => {
                     exec(`${pppoeScript} ${iface} "${pppoe.username}" "${pppoe.password}" configure "${dns1}" "${dns2}"`, (err, stdout, stderr) => {
                         if (err) console.error('Failed to write PPPoE config:', stderr || err.message);
                         else console.log('PPPoE config written successfully.');
                         resolve();
                     });
                 });
            }
        }

        // 3. Apply Network Changes (Netplan)
        // This will configure the physical interface (e.g. eth0 to manual if PPPoE, or dynamic/static otherwise)
        try {
            await this.applyNetworkChanges();
        } catch (e) {
            console.error("Failed to apply changes", e);
        }
        
        // 4. Start PPPoE if mode is pppoe
        if (this.config.wan.mode === 'pppoe') {
            const { interface: iface, pppoe } = this.config.wan;
            if (iface && pppoe && pppoe.username && pppoe.password) {
                 const dns1 = pppoe.dns1 || '';
                 const dns2 = pppoe.dns2 || '';
                 
                 console.log('Starting PPPoE connection...');
                 await new Promise((resolve) => {
                     // We use 'start' action which runs 'pppd call ... updetach'
                     // This waits until connection is established or fails
                     exec(`${pppoeScript} ${iface} "${pppoe.username}" "${pppoe.password}" start "${dns1}" "${dns2}"`, (err, stdout, stderr) => {
                         if (err) console.error('Failed to start PPPoE:', stderr || err.message);
                         else console.log('PPPoE started successfully.');
                         resolve();
                     });
                 });
            }
        }
        
        return true;
    }



    // --- VLAN Management ---
    getVlans() {
        return this.config.vlans || [];
    }

    async addVlan(vlan) {
        if (!this.config.vlans) this.config.vlans = [];
        
        // Validation
        if (!vlan.parent) throw new Error("Parent interface is required");
        if (!vlan.vlanId) throw new Error("VLAN ID is required");
        
        // Check for duplicate
        const exists = this.config.vlans.find(v => v.vlanId == vlan.vlanId && v.parent == vlan.parent);
        if (exists) throw new Error(`VLAN ${vlan.vlanId} on ${vlan.parent} already exists`);

        // Generate ID
        if (!vlan.id) vlan.id = Date.now().toString();

        // Auto-generate MAC if requested or missing
        if (!vlan.mac || vlan.autoMac) {
            vlan.mac = this.generateRandomMac();
        }

        this.config.vlans.push(vlan);
        this.saveConfig(this.config);
        
        // Changes are now applied manually via /apply endpoint
        
        return true;
    }

    async addVlans(vlans) {
        if (!Array.isArray(vlans) || vlans.length === 0) return false;
        if (!this.config.vlans) this.config.vlans = [];

        let addedCount = 0;
        
        for (const vlan of vlans) {
            try {
                // Validation
                if (!vlan.parent || !vlan.vlanId) continue;
                
                // Check for duplicate
                const exists = this.config.vlans.find(v => v.vlanId == vlan.vlanId && v.parent == vlan.parent);
                if (exists) continue;

                // Generate ID
                if (!vlan.id) vlan.id = Date.now().toString() + Math.random().toString(36).substr(2, 5);

                // Auto-generate MAC
                if (!vlan.mac || vlan.autoMac) {
                    vlan.mac = this.generateRandomMac();
                }

                this.config.vlans.push(vlan);
                addedCount++;
            } catch (e) {
                console.error("Error adding VLAN in batch:", e);
            }
        }

        if (addedCount > 0) {
            this.saveConfig(this.config);
            // Changes are now applied manually via /apply endpoint
        }
        
        return addedCount;
    }

    async updateVlan(id, vlanData) {
        if (!this.config.vlans) return false;
        
        const index = this.config.vlans.findIndex(v => v.id === id);
        if (index === -1) {
            throw new Error("VLAN not found");
        }

        const currentVlan = this.config.vlans[index];
        
        // Validation
        // If changing parent or vlanId, check for duplicates
        if ((vlanData.parent && vlanData.parent !== currentVlan.parent) || 
            (vlanData.vlanId && vlanData.vlanId != currentVlan.vlanId)) {
            
            const newParent = vlanData.parent || currentVlan.parent;
            const newVlanId = vlanData.vlanId || currentVlan.vlanId;
            
            const exists = this.config.vlans.find(v => v.vlanId == newVlanId && v.parent == newParent && v.id !== id);
            if (exists) throw new Error(`VLAN ${newVlanId} on ${newParent} already exists`);
        }
        
        // Update fields
        const updatedVlan = { ...currentVlan, ...vlanData };
        
        // Handle MAC
        if (vlanData.autoMac && !vlanData.mac) {
             updatedVlan.mac = this.generateRandomMac();
        }

        this.config.vlans[index] = updatedVlan;
        this.saveConfig(this.config);
        
        // Changes are now applied manually via /apply endpoint

        return true;
    }

    async removeVlan(id) {
        if (!this.config.vlans) return false;
        const initialLen = this.config.vlans.length;
        this.config.vlans = this.config.vlans.filter(v => v.id !== id);
        
        if (this.config.vlans.length === initialLen) {
            throw new Error("VLAN not found");
        }
        
        this.saveConfig(this.config);
        
        // Changes are now applied manually via /apply endpoint

        return true;
    }

    generateRandomMac() {
        // Generate a random MAC address with Locally Administered bit set (x2, x6, xA, xE)
        // We'll use 02:xx:xx:xx:xx:xx
        const hex = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
        return `02:${hex()}:${hex()}:${hex()}:${hex()}:${hex()}`.toUpperCase();
    }

    // --- Bridge Management ---

    async addBridge(bridge) {
        if (!this.config.bridges) this.config.bridges = [];
        if (this.config.bridges.find(b => b.name === bridge.name)) {
            throw new Error(`Bridge ${bridge.name} already exists`);
        }
        
        bridge.stp = !!bridge.stp;
        bridge.interfaces = bridge.interfaces || [];
        
        this.config.bridges.push(bridge);
        this.saveConfig(this.config);
        console.log('Added Bridge:', bridge);
        
        try {
            await this.applyNetworkChanges();
        } catch (e) {
            console.error("Failed to apply changes", e);
        }
        return true;
    }

    async removeBridge(name) {
        if (!this.config.bridges) return false;
        
        const initialLength = this.config.bridges.length;
        this.config.bridges = this.config.bridges.filter(b => b.name !== name);
        
        if (this.config.bridges.length === initialLength) {
            throw new Error("Bridge not found");
        }
        
        this.saveConfig(this.config);
        console.log('Removed Bridge:', name);
        
        try {
            await this.applyNetworkChanges();
        } catch (e) {
            console.error("Failed to apply changes", e);
        }
        return true;
    }

    async updateBridge(name, newConfig) {
        if (!this.config.bridges) return false;
        
        const index = this.config.bridges.findIndex(b => b.name === name);
        if (index === -1) {
            throw new Error("Bridge not found");
        }
        
        const bridge = this.config.bridges[index];
        bridge.ip = newConfig.ip;
        bridge.netmask = newConfig.netmask;
        bridge.stp = !!newConfig.stp;
        bridge.interfaces = newConfig.interfaces || [];
        
        // Handle name change if needed (careful with existing references)
        if (newConfig.name && newConfig.name !== name) {
            if (this.config.bridges.find(b => b.name === newConfig.name)) {
                throw new Error(`Bridge ${newConfig.name} already exists`);
            }
            bridge.name = newConfig.name;
        }

        this.config.bridges[index] = bridge;
        this.saveConfig(this.config);
        console.log('Updated Bridge:', bridge);
        
        try {
            await this.applyNetworkChanges();
        } catch (e) {
            console.error("Failed to apply changes", e);
        }
        return true;
    }

    // --- DHCP Methods ---

    getDhcpConfig() {
        return this.config.dhcp || { bitmask: 19, dns1: '8.8.8.8', dns2: '8.8.4.4', servers: [] };
    }

    async saveDhcpSettings(settings) {
        if (!this.config.dhcp) this.config.dhcp = { servers: [] };
        this.config.dhcp.bitmask = parseInt(settings.bitmask) || 19;
        this.config.dhcp.dns1 = settings.dns1 || '8.8.8.8';
        this.config.dhcp.dns2 = settings.dns2 || '8.8.4.4';
        
        this.saveConfig(this.config);
        // We don't necessarily apply here, as changing bitmask might require re-doing all servers.
        // But we'll leave it to the user to add/remove servers for now.
        return this.config.dhcp;
    }

    async addDhcpServer(server) {
        if (!this.config.dhcp) this.config.dhcp = { bitmask: 19, dns1: '8.8.8.8', dns2: '8.8.4.4', servers: [] };
        
        const existing = this.config.dhcp.servers.find(s => s.interface === server.interface);
        if (existing) throw new Error(`DHCP server for ${server.interface} already exists`);

        // If subnet details not provided, calculate them
        if (!server.subnet) {
            const slot = this.findNextAvailableSlot(this.config.dhcp.bitmask);
            const calc = this.calculateSubnet(slot, this.config.dhcp.bitmask);
            Object.assign(server, calc);
        }

        this.config.dhcp.servers.push(server);
        this.saveConfig(this.config);
        await this.applyDhcpConfig();
        return server;
    }

    async removeDhcpServer(interfaceName) {
        if (!this.config.dhcp || !this.config.dhcp.servers) return;
        
        const server = this.config.dhcp.servers.find(s => s.interface === interfaceName);
        this.config.dhcp.servers = this.config.dhcp.servers.filter(s => s.interface !== interfaceName);
        
        this.saveConfig(this.config);
        
        // Remove IP from interface
        if (server) {
             try {
                 exec(`ip addr flush dev ${interfaceName}`, () => {});
             } catch(e) {}
        }
        
        await this.applyDhcpConfig();
    }

    // --- IP Math Helpers ---
    ipToInt(ip) {
        return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
    }

    intToIp(int) {
        return [
            (int >>> 24) & 255,
            (int >>> 16) & 255,
            (int >>> 8) & 255,
            int & 255
        ].join('.');
    }

    calculateSubnet(index, bitmask) {
        const baseIp = '10.0.0.0';
        const baseInt = this.ipToInt(baseIp);
        const size = Math.pow(2, 32 - bitmask);
        
        const networkInt = baseInt + (index * size);
        const broadcastInt = networkInt + size - 1;
        const gatewayInt = networkInt + 1; // .1
        const poolStartInt = networkInt + 2; // .2
        const poolEndInt = broadcastInt - 1; // .254
        
        // Calculate Netmask
        const maskInt = ~((1 << (32 - bitmask)) - 1);
        
        return {
            subnet: `${this.intToIp(networkInt)}/${bitmask}`,
            netmask: this.intToIp(maskInt),
            gateway: this.intToIp(gatewayInt),
            pool_start: this.intToIp(poolStartInt),
            pool_end: this.intToIp(poolEndInt),
            size: size
        };
    }

    findNextAvailableSlot(bitmask) {
        const servers = this.config.dhcp.servers || [];
        // Map used base network IPs
        const usedSubnets = servers.map(s => s.subnet.split('/')[0]); 
        
        // Start from 1 to avoid conflict with default Bridge (10.0.0.0/24)
        // This reserves the first block for the main LAN/Management interface
        let index = 1;
        // Limit search to prevent infinite loop (e.g., /19 allows 8192 IPs, 10.0.0.0/8 has 256 /16s... it's a lot)
        // 10.0.0.0/8 = 2^24 IPs. /19 = 2^13 IPs. 2^11 = 2048 slots.
        while (index < 2048) {
            const calc = this.calculateSubnet(index, bitmask);
            const networkIp = calc.subnet.split('/')[0];
            if (!usedSubnets.includes(networkIp)) {
                return index;
            }
            index++;
        }
        throw new Error("No more subnets available in 10.x.x.x range");
    }
    
    getNextDhcpInfo() {
        if (!this.config.dhcp) this.config.dhcp = { bitmask: 19, servers: [] };
        const slot = this.findNextAvailableSlot(this.config.dhcp.bitmask);
        return this.calculateSubnet(slot, this.config.dhcp.bitmask);
    }

    async applyDhcpConfig() {
        const dhcp = this.config.dhcp;
        if (!dhcp) return;

        let content = `# Auto-generated by PisoWifi\n`;
        content += `domain-needed\nbogus-priv\n`;
        content += `dhcp-authoritative\n`; // Speed up DHCP
        // bind-dynamic allows dnsmasq to start even if interfaces are missing/down
        // and picks them up when they come up.
        content += `bind-dynamic\n`; 
        
        const util = require('util');
        const execAsync = util.promisify(require('child_process').exec);

        // Loop through servers
        for (const s of dhcp.servers) {
            const tag = s.interface.replace(/[^a-zA-Z0-9]/g, '_');
            
            // interface=vlan.10
            content += `\n# DHCP for ${s.interface}\n`;
            content += `interface=${s.interface}\n`;
            // Use set:<tag> to identify clients on this subnet for specific options
            content += `dhcp-range=set:${tag},${s.pool_start},${s.pool_end},${s.netmask},12h\n`;
            content += `dhcp-option=tag:${tag},3,${s.gateway}\n`; // Option 3: Router
            content += `dhcp-option=tag:${tag},6,${dhcp.dns1},${dhcp.dns2}\n`; // Option 6: DNS
            
            // Ensure Interface IP is set
            try {
                const cidr = `${s.gateway}/${dhcp.bitmask}`;
                
                // We assume this runs on Linux. On Windows (dev) we skip.
                if (process.platform === 'linux') {
                     // Check existence
                     try {
                         const { stdout } = await execAsync(`ip addr show dev ${s.interface}`);
                         if (!stdout.includes(cidr)) {
                             console.log(`Adding IP ${cidr} to ${s.interface}`);
                             await execAsync(`ip addr add ${cidr} dev ${s.interface}`);
                         }

                         // Apply Hotspot Rules (Firewall/NAT/Redirection)
                        const hotspotScript = path.join(__dirname, '../scripts/add_hotspot_interface.sh');
                        // Ensure executable
                        await execAsync(`chmod +x "${hotspotScript}"`);
                        
                        console.log(`Applying hotspot rules for ${s.interface} (Gateway: ${s.gateway}, Bitmask: ${dhcp.bitmask})...`);
                        try {
                            const { stdout: hsOut, stderr: hsErr } = await execAsync(`"${hotspotScript}" ${s.interface} ${s.gateway} ${dhcp.bitmask}`);
                            if (hsOut) console.log(`Hotspot script output (${s.interface}):`, hsOut);
                            if (hsErr) console.warn(`Hotspot script stderr (${s.interface}):`, hsErr);
                        } catch (hsError) {
                            console.error(`Failed to apply hotspot rules for ${s.interface}:`, hsError.message);
                        }
                        
                    } catch (err) {
                        // If interface doesn't exist, ip addr show fails.
                        // But we expect it to exist by now.
                        console.error(`Interface ${s.interface} setup failed:`, err.message);
                        
                        // Retry mechanism: Try applying hotspot rules anyway
                        // This handles cases where 'ip addr show' fails but interface might be up or coming up
                        try {
                            console.log(`Retry: Applying hotspot rules for ${s.interface} despite setup error...`);
                            const hotspotScript = path.join(__dirname, '../scripts/add_hotspot_interface.sh');
                            await execAsync(`chmod +x "${hotspotScript}"`);
                            await execAsync(`"${hotspotScript}" ${s.interface} ${s.gateway} ${dhcp.bitmask}`);
                            console.log(`Retry successful for ${s.interface}`);
                        } catch (retryErr) {
                             console.error(`Retry failed for ${s.interface}:`, retryErr.message);
                        }
                    }
                }
            } catch (e) {
                console.error(`Error setting IP for ${s.interface}:`, e);
            }
        }

        // Write config and restart dnsmasq
        if (process.platform === 'linux') {
            const configPath = '/etc/dnsmasq.d/pisowifi-dhcp.conf';
            try {
                fs.writeFileSync(configPath, content);
                console.log('Restarting dnsmasq...');
                await execAsync('systemctl restart dnsmasq');
                console.log("dnsmasq restarted successfully");
            } catch (e) {
                console.error("Failed to write dnsmasq config or restart service:", e);
            }
        }
    }

    getBridges() {
        if (!this.config.bridges || this.config.bridges.length === 0) {
             // Fallback to default if missing (should be handled in constructor, but double check)
             return [{
                name: 'br0',
                ip: '10.0.0.1',
                netmask: '255.255.255.0',
                stp: false,
                interfaces: []
            }];
        }
        return this.config.bridges;
    }

    async applyNetworkChanges() {
        if (os.platform() === 'win32') {
            console.log('Windows detected: Skipping actual network application.');
            console.log('Generated Netplan Config:\n', this.generateNetplanConfig());
            return;
        }

        try {
            const netplanConfig = this.generateNetplanConfig();
            const netplanPath = '/etc/netplan/01-pisowifi.yaml';
            
            // Write Netplan file
            fs.writeFileSync(netplanPath, netplanConfig);
            
            // Write Routing Script (Policy Routing for Multi-WAN)
            const routeScriptPath = path.join(__dirname, '../scripts/setup_wan_routes.sh');
            const routeScriptContent = this.generateRoutingScript();
            fs.writeFileSync(routeScriptPath, routeScriptContent);
            fs.chmodSync(routeScriptPath, '755');

            console.log('Netplan config written. Applying changes...');
            
            // Lazy load NetworkService to avoid circular dependency
            const networkService = require('./networkService');
            const util = require('util');
            const execAsync = util.promisify(require('child_process').exec);

            // 1. Apply Netplan
            console.log('Executing: netplan apply');
            await execAsync('netplan apply');
            
            // 2. Apply Routing
            if (fs.existsSync(routeScriptPath)) {
                console.log('Executing routing script...');
                await execAsync(routeScriptPath);
            }

            // 3. Re-initialize VLANs (Security & QoS)
            // We use the bridge IP from networkService or default
            const bridgeIp = networkService.bridgeIp || '10.0.0.1';
            console.log(`Re-initializing VLANs with Bridge IP: ${bridgeIp}`);
            await networkService.initVlans(bridgeIp);

            // 4. Re-apply DHCP (Restart DNSMasq)
            console.log('Re-applying DHCP configuration...');
            await this.applyDhcpConfig();

            console.log('Network changes applied successfully.');
            return true;
        } catch (error) {
            console.error('Failed to apply network changes:', error);
            return false;
        }
    }

    generateRoutingScript() {
        const wan = this.config.wan;
        let wanItems = [];
        let strategy = 'failover'; // Default

        if (wan.mode === 'dual_wan' && wan.dual_wan) {
             strategy = wan.dual_wan.strategy || 'failover';
             if (wan.dual_wan.wan1 && wan.dual_wan.wan1.interface) wanItems.push({ ...wan.dual_wan.wan1, id: 1, weight: 1 });
             if (wan.dual_wan.wan2 && wan.dual_wan.wan2.interface) wanItems.push({ ...wan.dual_wan.wan2, id: 2, weight: 1 });
        } else if (wan.mode === 'multi_wan' && Array.isArray(wan.multi_wan)) {
             strategy = 'balance-rr'; // Multi-WAN defaults to balancing usually
             wanItems = wan.multi_wan.filter(w => w.interface).map((w, i) => ({ ...w, id: i + 1, weight: w.weight || 1 }));
        }

        if (wanItems.length <= 1) return '#!/bin/bash\n# Single WAN - No special routing needed\nexit 0';

        // Script Header
        let script = `#!/bin/bash
# Auto-generated routing script for Multi-WAN
# Ensures return traffic goes out the correct interface (Policy Routing)
# AND starts the Active Health Check Monitor

MONITOR_SCRIPT="/usr/local/bin/pisowifi-wan-monitor.sh"
LOG_FILE="/var/log/pisowifi/wan-monitor.log"
mkdir -p /var/log/pisowifi

# Wait for interfaces to be up
sleep 5

# Enable IP Forwarding
sysctl -w net.ipv4.ip_forward=1

# --- 1. Static Policy Routing Setup (Tables & Rules) ---
# Flush existing custom tables to avoid duplicates
`;

        // Flush tables loop
        wanItems.forEach(item => {
            script += `ip rule flush table ${100 + item.id}\n`;
            script += `ip route flush table ${100 + item.id}\n`;
        });

        script += `\n# Configure per-interface routing tables\n`;

        wanItems.forEach(item => {
            const tableId = 100 + item.id;
            const iface = item.interface;
            
            script += `\n# --- WAN ${item.id}: ${iface} ---\n`;
            script += `IP_${item.id}=$(ip -4 addr show ${iface} | grep -oP '(?<=inet\\s)\\d+(\\.\\d+){3}' | head -n 1)\n`;
            // Try to get dynamic gateway first
            script += `GW_${item.id}=$(ip route show dev ${iface} | grep default | awk '{print $3}' | head -n 1)\n`;
            
            // Override if static
            if (item.mode === 'static' && item.static && item.static.gateway) {
                 script += `GW_${item.id}="${item.static.gateway}"\n`;
            }

            script += `if [ -n "$IP_${item.id}" ] && [ -n "$GW_${item.id}" ]; then\n`;
            script += `  echo "Configuring Table ${tableId} for ${iface} ($IP_${item.id} -> $GW_${item.id})"\n`;
            script += `  ip route add default via $GW_${item.id} dev ${iface} table ${tableId}\n`;
            script += `  ip rule add from $IP_${item.id} table ${tableId}\n`;
            script += `fi\n`;
        });

        // --- 2. Generate Monitor Script ---
        script += `\n# --- 2. Generate & Start Active Health Monitor ---\n`;
        script += `cat << 'EOF' > $MONITOR_SCRIPT
#!/bin/bash
# Multi-WAN Active Health Monitor
# Generated by PisoWifi

CHECK_TARGET="8.8.8.8"
CHECK_TARGET_2="1.1.1.1"
INTERVAL=5
STRATEGY="${strategy}"

# Function to check connectivity
check_iface() {
    local iface=$1
    # Try primary target, fallback to secondary
    ping -I $iface -c 1 -W 2 $CHECK_TARGET > /dev/null 2>&1 || ping -I $iface -c 1 -W 2 $CHECK_TARGET_2 > /dev/null 2>&1
    return $?
}

while true; do
    CMD="ip route replace default scope global"
    VALID_COUNT=0
    
    # Check each interface
`;

        // Inject interface checks
        wanItems.forEach(item => {
            script += `    # Check ${item.interface} (Weight: ${item.weight})\n`;
            script += `    IP_${item.id}=$(ip -4 addr show ${item.interface} | grep -oP '(?<=inet\\s)\\d+(\\.\\d+){3}' | head -n 1)\n`;
            script += `    GW_${item.id}=$(ip route show dev ${item.interface} | grep default | awk '{print $3}' | head -n 1)\n`;
            // Static Gateway Override in Monitor (need to inject value if static)
            if (item.mode === 'static' && item.static && item.static.gateway) {
                script += `    GW_${item.id}="${item.static.gateway}"\n`;
            }
            
            // We ping using the Source IP to trigger Policy Routing (Table 10x) which has the gateway
            script += `    if [ -n "$IP_${item.id}" ] && [ -n "$GW_${item.id}" ] && check_iface $IP_${item.id}; then\n`;
            script += `        STATUS_${item.id}="UP"\n`;
            script += `    else\n`;
            script += `        STATUS_${item.id}="DOWN"\n`;
            script += `    fi\n\n`;
        });

        // Route Construction Logic based on Strategy
        script += `    # Construct Route Command based on Strategy\n`;
        
        if (strategy === 'failover') {
            script += `    # FAILOVER: Pick first UP interface\n`;
            script += `    SELECTED=0\n`;
            
            wanItems.forEach(item => {
                script += `    if [ "$SELECTED" -eq 0 ] && [ "$STATUS_${item.id}" == "UP" ]; then\n`;
                script += `        CMD="$CMD nexthop via $GW_${item.id} dev ${item.interface} weight 1"\n`;
                script += `        SELECTED=1\n`;
                script += `        VALID_COUNT=1\n`;
                script += `    fi\n`;
            });
            
        } else {
            // Load Balancing (Weighted Round Robin)
            script += `    # LOAD BALANCING: Add all UP interfaces\n`;
            
            wanItems.forEach(item => {
                script += `    if [ "$STATUS_${item.id}" == "UP" ]; then\n`;
                script += `        CMD="$CMD nexthop via $GW_${item.id} dev ${item.interface} weight ${item.weight}"\n`;
                script += `        VALID_COUNT=$((VALID_COUNT+1))\n`;
                script += `    fi\n`;
            });
        }

        script += `
    # Apply Routes if we have valid gateways
    if [ "$VALID_COUNT" -gt 0 ]; then
        # We only apply if something changed? For now, re-applying ensures correctness
        # echo "Applying: $CMD"
        eval $CMD
    else
        echo "ALL WAN INTERFACES DOWN!"
    fi

    sleep $INTERVAL
done
EOF
`;

        script += `\n# --- 3. Launch Monitor ---\n`;
        script += `chmod +x $MONITOR_SCRIPT\n`;
        script += `pkill -f "pisowifi-wan-monitor.sh"\n`; // Kill old instance
        script += `nohup $MONITOR_SCRIPT > /dev/null 2>&1 &\n`;
        script += `echo "Monitor started in background."\n`;

        return script;
    }

    generateNetplanConfig() {
        const wan = this.config.wan;
        const bridges = this.config.bridges || [];
        const vlans = this.config.vlans || [];
        
        const config = {
            network: {
                version: 2,
                renderer: 'networkd',
                ethernets: {},
                bridges: {},
                vlans: {}
            }
        };

        // Helper to check if interface is used in a bridge
        const isBridged = (ifaceName) => {
            return bridges.some(b => b.interfaces.includes(ifaceName));
        };

        // Collect WAN interfaces to configure
        let wanItems = [];
        let strategy = 'failover'; // Default for Dual WAN

        if (wan.mode === 'dual_wan' && wan.dual_wan) {
             strategy = wan.dual_wan.strategy || 'failover';
             if (wan.dual_wan.wan1 && wan.dual_wan.wan1.interface) wanItems.push({ ...wan.dual_wan.wan1, role: 'wan1' });
             if (wan.dual_wan.wan2 && wan.dual_wan.wan2.interface) wanItems.push({ ...wan.dual_wan.wan2, role: 'wan2' });
        } else if (wan.mode === 'multi_wan' && Array.isArray(wan.multi_wan)) {
             // Multi-WAN defaults to balancing
             strategy = 'balance-rr';
             wanItems = wan.multi_wan.filter(w => w.interface);
        } else if (wan.interface) {
             wanItems.push({ ...wan, role: 'single' });
        }

        // 1. Configure WAN Interfaces (Physical)
        wanItems.forEach((item, index) => {
            const ifaceName = item.interface;
            const isVlan = ifaceName.includes('.');
            
            // Calculate Metric
            let metric = 100; // Default
            if (strategy === 'failover') {
                // Wan1=100, Wan2=200, etc.
                metric = 100 + (index * 100); 
            } else {
                // Balance-RR / Load Balancing: All 100 (ECMP)
                // Unless "Weight" is implemented via script, we keep ECMP here
                metric = 100;
            }

            const ifaceConfig = this.getInterfaceConfig(item, metric);

            if (isVlan) {
                const parent = ifaceName.split('.')[0];
                // Ensure parent exists if not bridged
                if (!isBridged(parent) && !config.network.ethernets[parent]) {
                     config.network.ethernets[parent] = { dhcp4: false, dhcp6: false };
                }
            } else {
                // Physical Interface
                if (!isBridged(ifaceName)) {
                    config.network.ethernets[ifaceName] = ifaceConfig;
                } else {
                    // Bridged interface must be manual
                    config.network.ethernets[ifaceName] = { dhcp4: false, dhcp6: false };
                }
            }
        });

        // 2. Configure Bridges
        bridges.forEach(b => {
            // Ensure all member interfaces are defined in ethernets
            b.interfaces.forEach(iface => {
                if (!config.network.ethernets[iface]) {
                    config.network.ethernets[iface] = { dhcp4: false, dhcp6: false };
                } else {
                    config.network.ethernets[iface] = { dhcp4: false, dhcp6: false };
                }
            });

            const bridgeConfig = {
                interfaces: b.interfaces,
                parameters: {
                    stp: !!b.stp,
                    'forward-delay': 4
                }
            };

            if (b.ip && b.netmask) {
                bridgeConfig.addresses = [`${b.ip}/${this.netmaskToCidr(b.netmask)}`];
                bridgeConfig.dhcp4 = false;
            } else {
                bridgeConfig.dhcp4 = false;
            }

            config.network.bridges[b.name] = bridgeConfig;
        });

        // 3. Configure VLANs
        vlans.forEach(v => {
            if (!v.vlanId || !v.parent) return;
            const interfaceName = `${v.parent}.${v.vlanId}`;
            
            config.network.vlans[interfaceName] = {
                id: parseInt(v.vlanId),
                link: v.parent,
                dhcp4: false,
                dhcp6: false
            };
            
            if (v.mac) {
                config.network.vlans[interfaceName].macaddress = v.mac;
            }

            // Ensure parent is in ethernets if not already
            if (!config.network.ethernets[v.parent]) {
                config.network.ethernets[v.parent] = { dhcp4: false, dhcp6: false };
            }
        });

        // Clean up empty objects
        if (Object.keys(config.network.bridges).length === 0) delete config.network.bridges;
        if (Object.keys(config.network.vlans).length === 0) delete config.network.vlans;

        return this.jsonToYaml(config);
    }

    getInterfaceConfig(settings, metric = 100) {
        const mode = settings.mode || settings.type || 'dynamic';
        
        if (mode === 'dynamic') {
            return { 
                dhcp4: true,
                'dhcp4-overrides': {
                    'route-metric': metric
                }
            };
        } else if (mode === 'static') {
            if (!settings.static) return { dhcp4: true };
            const cidr = this.netmaskToCidr(settings.static.netmask || '255.255.255.0');
            const cfg = {
                dhcp4: false,
                addresses: [`${settings.static.ip || '0.0.0.0'}/${cidr}`]
            };
            
            // Use routes list instead of gateway4 to support metric
            if (settings.static.gateway) {
                cfg.routes = [{
                    to: '0.0.0.0/0',
                    via: settings.static.gateway,
                    metric: metric
                }];
            }

            if (settings.static.dns1 || settings.static.dns2) {
                const dns = [];
                if (settings.static.dns1) dns.push(settings.static.dns1);
                if (settings.static.dns2) dns.push(settings.static.dns2);
                if (settings.static.dns) dns.push(settings.static.dns); 
                
                if (dns.length > 0) {
                    cfg.nameservers = { addresses: dns };
                }
            }
            return cfg;
        } else if (mode === 'pppoe') {
             // For PPPoE, physical interface is unconfigured
             return { dhcp4: false, dhcp6: false, optional: true };
        }
        return { dhcp4: true };
    }

    netmaskToCidr(netmask) {
        return (netmask.split('.').map(Number)
          .map(part => (part >>> 0).toString(2))
          .join('')).split('1').length - 1;
    }

    jsonToYaml(obj, indent = 0) {
        let yaml = '';
        const spaces = ' '.repeat(indent);
        
        for (const key in obj) {
            const value = obj[key];
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                yaml += `${spaces}${key}:\n${this.jsonToYaml(value, indent + 2)}`;
            } else if (Array.isArray(value)) {
                yaml += `${spaces}${key}: [${value.join(', ')}]\n`;
            } else {
                yaml += `${spaces}${key}: ${value}\n`;
            }
        }
        return yaml;
    }
}

module.exports = new NetworkConfigService();
