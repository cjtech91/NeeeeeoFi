const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');
const { db } = require('../database/db'); // Import DB
const networkConfigService = require('./networkConfigService');
const licenseService = require('./licenseService'); // For Limits
const execPromise = util.promisify(exec);

class NetworkService {
    constructor() {
        this.interface = 'br0'; 
        this.wanInterface = 'eth0'; // Default fallback
        this.bridgeIp = '10.0.0.1'; // Default
    }

    async runCommand(command, silent = false) {
        try {
            const { stdout, stderr } = await execPromise(command);
            if (stderr && !silent) console.error(`Command stderr: ${stderr}`);
            return stdout.trim();
        } catch (error) {
            if (!silent) console.error(`Command failed: ${command}`, error);
            // Don't throw for everything, as ARP lookups might fail harmlessly
            return null;
        }
    }

    /**
     * Detect WAN Interface (Default Gateway)
     * Prioritizes DB setting, then auto-detection
     */
    async detectWanInterface() {
        try {
            // 1. Check DB for saved WAN interface
            const savedWan = db.prepare("SELECT value FROM settings WHERE key = 'wan_interface'").get();
            if (savedWan && savedWan.value) {
                // Verify the saved interface actually exists
                const ifCheck = await this.runCommand(`ip link show ${savedWan.value}`, true);
                if (ifCheck) {
                    this.wanInterface = savedWan.value;
                    console.log(`Loaded WAN Interface from DB: ${this.wanInterface}`);
                    return this.wanInterface;
                }
                console.log(`Saved WAN interface ${savedWan.value} not found. Re-detecting...`);
            }

            // 2. Auto-detect (Retry loop)
            // Retry a few times as network might be initializing
            for (let i = 0; i < 3; i++) {
                const output = await this.runCommand('ip route show default');
                if (output) {
                    const match = output.match(/dev\s+(\S+)/);
                    if (match && match[1]) {
                        this.wanInterface = match[1];
                        console.log(`Auto-detected WAN Interface: ${this.wanInterface}`);
                        this.saveWanInterface(this.wanInterface);
                        return this.wanInterface;
                    }
                }
                // Wait 1s before retry
                await new Promise(r => setTimeout(r, 1000));
            }

            // 3. Fallback: Check for any interface with a non-local IP (likely upstream)
            const links = await this.runCommand('ip -4 addr show');
            if (links) {
                // Look for wlan0 or eth0 having an IP that is NOT 127.0.0.1 and NOT 10.0.0.1 (default portal IP)
                // This regex captures interface name from "2: wlan0: ..." lines
                const wlanMatch = links.match(/\d+:\s+(wlan\d+):.*inet\s+([0-9.]+)/);
                if (wlanMatch && wlanMatch[2] !== '127.0.0.1' && !wlanMatch[2].startsWith('10.0.')) {
                     this.wanInterface = wlanMatch[1];
                     console.log(`Fallback: Detected active WiFi interface: ${this.wanInterface}`);
                     this.saveWanInterface(this.wanInterface);
                     return this.wanInterface;
                }
            }

        } catch (e) {
            console.error('Failed to detect WAN interface:', e);
        }
        console.log(`Using fallback WAN Interface: ${this.wanInterface}`);
        return this.wanInterface;
    }

    /**
     * Save WAN Interface to DB
     */
    saveWanInterface(interfaceName) {
        try {
            db.prepare(`
                INSERT INTO settings (key, value, category) 
                VALUES ('wan_interface', ?, 'network')
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
            `).run(interfaceName);
            console.log(`Saved WAN Interface to DB: ${interfaceName}`);
            this.wanInterface = interfaceName;
        } catch (e) {
            console.error('Failed to save WAN interface to DB:', e);
        }
    }

    /**
     * Detect LAN/WiFi Interface
     */
    async detectLanInterface() {
        try {
            const output = await this.runCommand('ls /sys/class/net/');
            if (output) {
                const interfaces = output.split(/\s+/);
                
                // 1. Prioritize Bridge (br0)
                if (interfaces.includes('br0')) {
                    this.interface = 'br0';
                    console.log(`Auto-detected LAN Interface: ${this.interface}`);
                    return this.interface;
                }

                // 2. Prioritize WiFi interfaces if no bridge
                for (const iface of interfaces) {
                    if (iface.startsWith('wlan') || iface.startsWith('wlx')) {
                        this.interface = iface;
                        console.log(`Auto-detected LAN/WiFi Interface: ${this.interface}`);
                        return this.interface;
                    }
                }
            }
        } catch (e) {
            console.error('Failed to detect LAN interface:', e);
        }
        console.log('No WiFi interface detected. Assuming Ethernet/Bridge mode.');
        return null;
    }

    async createVlanInterfaces() {
        try {
            console.log('Pre-creating VLAN Interfaces...');
            const vlans = networkConfigService.getVlans();
            
            for (const vlan of vlans) {
                const parent = vlan.parent || 'eth0'; 
                const vlanId = vlan.vlanId;
                const mac = vlan.mac; 
                
                if (!vlanId) continue;

                const interfaceName = `${parent}.${vlanId}`; 
                
                try {
                    // 1. Create VLAN Interface
                    const exists = await this.runCommand(`ip link show ${interfaceName}`, true);
                    if (!exists) {
                        await this.runCommand(`ip link add link ${parent} name ${interfaceName} type vlan id ${vlanId}`);
                    }
                    
                    // 2. Set MAC Address if provided
                    if (mac) {
                        await this.runCommand(`ip link set dev ${interfaceName} address ${mac}`);
                    }

                    // 3. Bring UP
                    await this.runCommand(`ip link set ${interfaceName} up`);
                    
                } catch (e) {
                    console.error(`Failed to create VLAN ${interfaceName}:`, e);
                }
            }
        } catch (e) {
            console.error('Error in createVlanInterfaces:', e);
        }
    }

    async initVlans(portalIp) {
        try {
            console.log('Initializing VLANs...');
            const vlans = networkConfigService.getVlans();
            
            // --- Prune Deleted VLANs ---
            try {
                // Get list of current VLAN interfaces
                const output = await this.runCommand('ip -o link show type vlan', true);
                
                if (output) {
                    const currentVlans = output.split('\n')
                        .map(line => {
                            // Format: "4: eth0.10@eth0: ..." or "4: eth0.10: ..."
                            const match = line.match(/^\d+:\s+([^@:]+)/);
                            return match ? match[1].trim() : null;
                        })
                        .filter(Boolean);

                    const configuredVlanNames = vlans
                        .filter(v => v.vlanId && v.parent)
                        .map(v => `${v.parent}.${v.vlanId}`);

                    for (const iface of currentVlans) {
                        if (!configuredVlanNames.includes(iface)) {
                            console.log(`Pruning deleted VLAN interface: ${iface}`);
                            await this.runCommand(`ip link delete ${iface}`);
                        }
                    }
                }
            } catch (e) {
                console.warn('VLAN pruning skipped:', e.message);
            }
            // ---------------------------

            for (const vlan of vlans) {
                const parent = vlan.parent || 'eth0'; 
                const vlanId = vlan.vlanId;
                const mac = vlan.mac; // Expecting generated MAC
                
                if (!vlanId) continue;

                const interfaceName = `${parent}.${vlanId}`; 
                
                console.log(`Setting up VLAN ${interfaceName} (MAC: ${mac})...`);

                try {
                    // 1. Create VLAN Interface
                    const exists = await this.runCommand(`ip link show ${interfaceName}`, true);
                    if (!exists) {
                        await this.runCommand(`ip link add link ${parent} name ${interfaceName} type vlan id ${vlanId}`);
                    }
                    
                    // 2. Set MAC Address if provided
                    if (mac) {
                        await this.runCommand(`ip link set dev ${interfaceName} address ${mac}`);
                    }

                    // 3. Bring UP
                    await this.runCommand(`ip link set ${interfaceName} up`);

                    // 4. Secure Interface (Firewall/Captive Portal)
                    if (portalIp) {
                        await this.secureLanInterface(interfaceName, portalIp);
                    }

                    // 5. Initialize QoS (Traffic Control)
                    await this.initQos(interfaceName);
                    
                } catch (e) {
                    console.error(`Failed to setup VLAN ${interfaceName}:`, e);
                }
            }
        } catch (e) {
            console.error('Error in initVlans:', e);
        }
    }

    async secureLanInterface(iface, portalIp) {
        console.log(`Securing Interface ${iface} with Portal IP ${portalIp}...`);
        const script = path.join(__dirname, '../scripts/secure_interface.sh');
        await this.runCommand(`bash "${script}" ${iface} ${portalIp} 3000`);
    }

    async initQos(iface) {
        console.log(`Initializing QoS on ${iface}...`);
        const script = path.join(__dirname, '../scripts/traffic_control.sh');
        // init <wan> <lan>
        await this.runCommand(`bash "${script}" init ${this.wanInterface} ${iface}`);
    }

    /**
     * Initialize Firewall Rules (Walled Garden)
     */
    async init() {
        await this.detectWanInterface();
        await this.detectLanInterface();
        
        console.log('Initializing Network Bridge & Firewall...');
        const netScript = path.join(__dirname, '../scripts/init_network.sh');
        const firewallScript = path.join(__dirname, '../scripts/init_firewall.sh');
        const dnsmasqScript = path.join(__dirname, '../scripts/init_dnsmasq.sh');
        const pppoeScript = path.join(__dirname, '../scripts/init_pppoe.sh');
        const wanRouteScript = path.join(__dirname, '../scripts/setup_wan_routes.sh');
        
        // Ensure scripts are executable and have correct line endings (LF)
        // Fixes "command not found" errors if files were edited on Windows
        // Check if wanRouteScript exists before including it in commands
        let scriptsToFix = `${netScript} ${firewallScript} ${dnsmasqScript} ${pppoeScript}`;
        if (fs.existsSync(wanRouteScript)) {
            scriptsToFix += ` ${wanRouteScript}`;
        }
        
        const secureScript = path.join(__dirname, '../scripts/secure_interface.sh');
        if (fs.existsSync(secureScript)) {
            scriptsToFix += ` ${secureScript}`;
        }

        await this.runCommand(`sed -i 's/\r$//' ${scriptsToFix}`);
        await this.runCommand(`chmod +x ${scriptsToFix}`);
        
        // Apply Multi-WAN Routing & Monitoring if script exists
        if (fs.existsSync(wanRouteScript)) {
            console.log('Applying Multi-WAN Routing & Monitoring...');
            await this.runCommand(wanRouteScript);
        }

        let firewallWanInterface = this.wanInterface;

        // Handle PPPoE Configuration
        const wanConfig = networkConfigService.getWanConfig();
        
        // Always attempt to stop any previous PPPoE session to ensure clean state
        await this.runCommand(`${pppoeScript} none none none stop`, true);

        if (wanConfig.mode === 'pppoe') {
            const { interface: iface, pppoe } = wanConfig;
            if (iface && pppoe && pppoe.username && pppoe.password) {
                // Check if pppd is installed
                const pppdCheck = await this.runCommand('which pppd', true);
                if (!pppdCheck) {
                    console.error('CRITICAL: pppd is NOT installed. PPPoE will fail.');
                    console.error('The system does not have enough memory to auto-install it while running the app.');
                    console.error('PLEASE RUN THIS COMMAND MANUALLY IN THE TERMINAL:');
                    console.error('sudo apt-get update && sudo apt-get install -y ppp pppoe');
                    // Do not attempt auto-install to avoid OOM crash
                }

                console.log(`Starting PPPoE on ${iface}...`);
                const dns1 = pppoe.dns1 || '';
                const dns2 = pppoe.dns2 || '';
                
                // Run PPPoE script with detailed logging
                try {
                    console.log('Executing PPPoE script...');
                    const result = await this.runCommand(`${pppoeScript} ${iface} "${pppoe.username}" "${pppoe.password}" start "${dns1}" "${dns2}"`);
                    if (result !== null) {
                        console.log('PPPoE script completed successfully.');
                    } else {
                        console.error('PPPoE script failed (returned null/error).');
                    }
                } catch (err) {
                    console.error('PPPoE Script Failed:', err);
                }
                
                // Wait for ppp0 to come up (max 10 seconds)
                // With updetach, it should be up immediately, but we double check
                let retries = 0;
                while (retries < 10) {
                    await new Promise(r => setTimeout(r, 1000));
                    const check = await this.runCommand('ip link show ppp0', true);
                    if (check) {
                        console.log('PPPoE Interface (ppp0) is UP');
                        firewallWanInterface = 'ppp0';
                        this.wanInterface = 'ppp0'; // Update for external consumers (e.g. BandwidthService)
                        break;
                    }
                    retries++;
                }
                if (firewallWanInterface !== 'ppp0') {
                    console.error('PPPoE started but ppp0 interface not found after 10s');
                }
            } else {
                console.error('PPPoE enabled but missing configuration');
            }
        }
        
        // 1. Setup Bridge (br0) and add LAN interfaces
        const bridges = networkConfigService.getBridges();
        const mainBridge = bridges.find(b => b.name === 'br0') || bridges[0];
        const bridgeIp = mainBridge ? mainBridge.ip : '10.0.0.1';
        this.bridgeIp = bridgeIp;
        
        // Ensure we exclude the physical WAN interface from the bridge
        const physicalWanInterface = (wanConfig && wanConfig.interface) ? wanConfig.interface : this.wanInterface;

        await this.runCommand(`${netScript} ${physicalWanInterface} ${bridgeIp}`);
        
        // 2. Setup DNSMasq on br0
        await this.runCommand(`${dnsmasqScript} ${bridgeIp}`);
        
        // 3. Setup Firewall on br0
        // Use logical interface (ppp0) for NAT if PPPoE is active
        await this.runCommand(`${firewallScript} ${firewallWanInterface} ${bridgeIp}`);

        // 2.0 Pre-create VLAN interfaces so DHCP config can assign IPs
        await this.createVlanInterfaces();
        
        // 2.1 Apply VLAN DHCP Configurations (from DB/Config)
        // This ensures that any additional DHCP servers (for VLANs) are generated and loaded.
        try {
            console.log('Applying extended DHCP configuration...');
            await networkConfigService.applyDhcpConfig();
        } catch (e) {
            console.error('Failed to apply extended DHCP config:', e);
        }

        // 4. Initialize VLANs (Create interfaces AND Secure them)
        // Must run AFTER firewall script because firewall script flushes tables
        await this.initVlans(bridgeIp);

        // Start Interface Monitor to handle hotplugged USB/ETH devices
        this.startInterfaceMonitor();
    }

    startInterfaceMonitor() {
        if (this.interfaceMonitorInterval) return;
        console.log('Starting Interface Monitor (Hotplug Support)...');
        // Run immediately then interval
        this.ensureInterfacesBridged();
        this.interfaceMonitorInterval = setInterval(async () => {
            await this.ensureInterfacesBridged();
        }, 30000); // Check every 30 seconds
    }

    stopInterfaceMonitor() {
        if (this.interfaceMonitorInterval) {
            clearInterval(this.interfaceMonitorInterval);
            this.interfaceMonitorInterval = null;
            console.log('Stopped Interface Monitor.');
        }
    }

    async ensureInterfacesBridged() {
        if (process.platform !== 'linux') return;

        try {
            // Get all interfaces
            const links = await this.runCommand('ls /sys/class/net/', true);
            if (!links) return;

            const interfaces = links.split(/\s+/);
            const bridge = 'br0';
            
            // Get interfaces currently in bridge
            let currentBridged = [];
            if (fs.existsSync(`/sys/class/net/${bridge}/brif/`)) {
                 const bridgeIfs = await this.runCommand(`ls /sys/class/net/${bridge}/brif/`, true);
                 currentBridged = bridgeIfs ? bridgeIfs.split(/\s+/) : [];
            }

            for (const iface of interfaces) {
                // Skip lo, wan, bridge
                if (iface === 'lo' || iface === this.wanInterface || iface === bridge) continue;
                if (iface.includes('tun') || iface.includes('ppp') || iface.includes('docker')) continue;
                
                const isVlan = iface.includes('vlan') || iface.includes('.');
                const isLan = iface.startsWith('eth') || iface.startsWith('end') || iface.startsWith('enx') || iface.startsWith('wlx') || iface.startsWith('usb');
                
                // 1. Bridging Logic (Only for physical LAN interfaces, NOT VLANs)
                if (isLan && !isVlan && !currentBridged.includes(iface)) {
                    console.log(`Interface Monitor: Found unbridged LAN interface ${iface}. Adding to ${bridge}...`);
                    
                    // Unmanage from NM
                    if (await this.runCommand('which nmcli', true)) {
                         await this.runCommand(`nmcli dev set ${iface} managed no`, true);
                    }
                    
                    // Add to bridge
                    await this.runCommand(`ip link set ${iface} down`);
                    await this.runCommand(`ip addr flush dev ${iface}`);
                    await this.runCommand(`ip link set ${iface} master ${bridge}`);
                    await this.runCommand(`ip link set ${iface} up`);
                    await this.runCommand(`ip link set ${iface} promisc on`);
                    continue; // Once bridged, it's secured via br0
                }

                // 2. Security & QoS Logic (For Standalone LAN/VLAN interfaces)
                // If it's NOT in the bridge, we must secure it individually.
                if ((isLan || isVlan) && !currentBridged.includes(iface)) {
                    // Check if interface is UP
                    try {
                        const operState = fs.readFileSync(`/sys/class/net/${iface}/operstate`, 'utf8').trim();
                        if (operState === 'up' || operState === 'unknown') {
                            const portalIp = this.bridgeIp || '10.0.0.1';
                            
                            // A. Secure Interface (Firewall/Captive Portal)
                            // secureLanInterface calls secure_interface.sh which is now idempotent
                            await this.secureLanInterface(iface, portalIp);
                            
                            // B. Initialize QoS (Traffic Control) if missing
                            // Check if root qdisc (htb 1:) exists
                            const qdiscShow = await this.runCommand(`tc qdisc show dev ${iface}`, true);
                            if (!qdiscShow || !qdiscShow.includes('htb 1:')) {
                                console.log(`Interface Monitor: Initializing QoS on ${iface}...`);
                                await this.initQos(iface);
                            }
                        }
                    } catch (err) {
                        // Ignore errors reading operstate (interface might have vanished)
                    }
                }
            }
        } catch (e) {
            // Silent catch to avoid spamming logs
        }
    }

    async getInterfaceForIp(ip) {
        if (!ip) return null;
        try {
            // Use 'ip route get' to find the egress interface
            // Output: "10.0.30.5 dev end0.300 src 10.0.30.1 uid 0 ..."
            const stdout = await this.runCommand(`ip route get ${ip}`, true);
            if (stdout) {
                const match = stdout.match(/dev\s+([^\s]+)/);
                if (match) return match[1];
            }
        } catch (e) {
            console.error(`Error getting interface for IP ${ip}:`, e.message);
        }
        return null;
    }

    /**
     * Get a map of MAC -> { ip, interface } for all neighbors
     * Efficiently retrieves all connected clients' details using multiple sources
     * Returns: { "00:11:22:33:44:55": { ip: "10.0.0.5", interface: "br0" }, ... }
     */
    async getConnectedClients() {
        const map = {};

        // 1. Linux: /proc/net/arp (Fast & Reliable)
        if (process.platform === 'linux') {
            try {
                if (fs.existsSync('/proc/net/arp')) {
                    const arpContent = fs.readFileSync('/proc/net/arp', 'utf8');
                    const lines = arpContent.split('\n');
                    for (const line of lines) {
                        const parts = line.trim().split(/\s+/);
                        // Header: IP address, HW type, Flags, HW address, Mask, Device
                        // Data: 192.168.1.50 0x1 0x2 00:11:22:33:44:55 * wlan0
                        if (parts.length >= 6) {
                            const ip = parts[0];
                            const mac = parts[3];
                            const iface = parts[5];
                            
                            if (mac && mac.length === 17 && mac !== '00:00:00:00:00:00') {
                                map[mac.toLowerCase()] = { ip, interface: iface };
                            }
                        }
                    }
                }
            } catch (e) {
                console.error('Failed to read /proc/net/arp:', e.message);
            }
        }

        // 2. IP Neighbor (Modern Linux / Updates / Status)
        // Overwrites stale ARP data if REACHABLE
        try {
            const cmd = process.platform === 'win32' ? 'arp -a' : 'ip neigh show';
            const stdout = await this.runCommand(cmd);
            
            if (stdout) {
                const lines = stdout.split('\n');
                for (const line of lines) {
                    if (process.platform === 'win32') {
                         // Windows parsing
                         const parts = line.trim().split(/\s+/);
                         if (parts.length >= 3) {
                             const ip = parts[0];
                             const mac = parts[1];
                             if (ip.match(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/) && mac.match(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/)) {
                                 const normalizedMac = mac.replace(/-/g, ':').toLowerCase();
                                 map[normalizedMac] = { ip, interface: 'eth0' }; 
                             }
                         }
                    } else {
                        // Linux: 10.0.30.5 dev end0.300 lladdr 52:54:00:12:34:56 REACHABLE
                        const parts = line.trim().split(/\s+/);
                        if (parts.length >= 5 && parts[1] === 'dev' && parts[3] === 'lladdr') {
                            const ip = parts[0];
                            const iface = parts[2];
                            const mac = parts[4];
                            
                            // Only add if valid
                            if (ip.match(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/) && mac.includes(':')) {
                                map[mac.toLowerCase()] = { ip, interface: iface };
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Error running neighbor command:', e.message);
        }

        // 3. DNSMasq Leases (Fallback for Hostnames / Missing ARP)
        // Note: Leases don't strictly imply "Connected", but good for resolving IP if ARP missing
        if (process.platform === 'linux') {
            try {
                const leasePaths = [
                    '/var/lib/misc/dnsmasq.leases',
                    '/tmp/dnsmasq.leases',
                    '/var/lib/dnsmasq/dnsmasq.leases'
                ];
                for (const p of leasePaths) {
                    if (!fs.existsSync(p)) continue;
                    const content = fs.readFileSync(p, 'utf8');
                    const lines = content.split('\n');
                    for (const line of lines) {
                        const parts = line.trim().split(/\s+/);
                        // <timestamp> <mac> <ip> <hostname> <clientid>
                        if (parts.length >= 3) {
                            const mac = parts[1];
                            const ip = parts[2];
                            if (mac && mac.length === 17 && !map[mac.toLowerCase()]) {
                                // Only add if not already found (ARP is more authoritative for "Connected")
                                // We don't know interface from leases easily, default to main bridge or lookup
                                map[mac.toLowerCase()] = { ip, interface: 'br0' }; 
                            }
                        }
                    }
                }
            } catch (e) {}
        }

        return map;
    }

    /**
     * Get detailed WAN status: interface, IP, gateway, link state, speed, and gateway reachability
     */
    async getWanStatusDetailed() {
        // Ensure we have a WAN interface detected
        const iface = await this.detectWanInterface();
        const result = {
            interface: iface || null,
            ip: null,
            gateway: null,
            operstate: null,
            speed: null,
            duplex: null,
            gatewayReachable: null,
        };
        if (!iface) return result;

        try {
            // operstate
            if (process.platform === 'linux') {
                try {
                    const oper = fs.readFileSync(`/sys/class/net/${iface}/operstate`, 'utf8').trim();
                    result.operstate = oper;
                } catch (_) {}
            }
            // IPv4 address
            try {
                const ipOut = await this.runCommand(`ip -4 addr show ${iface}`, true);
                const m = ipOut && ipOut.match(/inet\s+(\d+(?:\.\d+){3})/);
                if (m) result.ip = m[1];
            } catch (_) {}
            // Gateway for this iface (prefer per-dev default route)
            try {
                let gwOut = await this.runCommand(`ip route show dev ${iface} | grep default | head -n 1`, true);
                if (!gwOut || !/default/.test(gwOut)) {
                    gwOut = await this.runCommand(`ip route show default | head -n 1`, true);
                }
                const gm = gwOut && gwOut.match(/default via\s+(\d+(?:\.\d+){3})/);
                if (gm) result.gateway = gm[1];
            } catch (_) {}
            // Link speed (ethtool) - may fail for PPP/WiFi
            try {
                const et = await this.runCommand(`ethtool ${iface}`, true);
                if (et) {
                    const sm = et.match(/Speed:\s*([0-9]+(?:Mb|Gb)\/s)/i);
                    const dm = et.match(/Duplex:\s*(\w+)/i);
                    if (sm) result.speed = sm[1];
                    if (dm) result.duplex = dm[1];
                }
            } catch (_) {
                // WiFi fallback (iw)
                try {
                    const iw = await this.runCommand(`iw dev ${iface} link`, true);
                    if (iw) {
                        const bm = iw.match(/tx bitrate:\s*([0-9.]+\s*\w+\/s)/i);
                        if (bm) {
                            result.speed = bm[1];
                            result.duplex = 'wifi';
                        }
                    }
                } catch (_) {}
            }
            // Gateway reachability
            if (result.gateway) {
                try {
                    const ping = await this.runCommand(`ping -c 1 -W 1 ${result.gateway}`, true);
                    result.gatewayReachable = !!(ping && /1 received/.test(ping));
                } catch (_) {
                    result.gatewayReachable = false;
                }
            }
        } catch (_) {}
        return result;
    }

    async applyAntiIspDetect(cfg = null) {
        try {
            const wanIf = await this.detectWanInterface();
            const lanBr = 'br0';
            const enabled = cfg && cfg.enabled ? '1' : '0';
            const ttlMode = (cfg && cfg.ttl_mode) ? String(cfg.ttl_mode) : 'inc1';
            const mssClamp = (cfg && cfg.mss_clamp !== false) ? '1' : '0';
            const hideMgmt = (cfg && cfg.hide_mgmt !== false) ? '1' : '0';
            const script = path.join(__dirname, '../scripts/apply_anti_isp.sh');
            try { await this.runCommand(`chmod +x ${script}`, true); } catch (e) {}
            const cmd = `${script} ${enabled} ${ttlMode} ${mssClamp} ${hideMgmt} ${wanIf || 'eth0'} ${lanBr}`;
            console.log('[Network] Applying Anti-ISP Detect:', cmd);
            await this.runCommand(cmd);
            return true;
        } catch (e) {
            console.error('Failed to apply Anti-ISP Detect:', e.message);
            return false;
        }
    }

    /**
     * Get MAC Address from IP
     */
    async getMacFromIp(ip) {
        // Clean IP (remove ::ffff: prefix if present)
        if (ip.startsWith('::ffff:')) {
            ip = ip.substring(7);
        }

        // Dev/Localhost handling
        if (ip === '::1' || ip === '127.0.0.1') {
            return '00:00:00:00:00:00';
        }

        // 1. Helper to read from file
        const checkFile = (filePath, ip) => {
            try {
                if (fs.existsSync(filePath)) {
                    const content = fs.readFileSync(filePath, 'utf8');
                    // /proc/net/arp format: IP type flags MAC mask dev
                    const lines = content.split('\n');
                    for (const line of lines) {
                        const parts = line.trim().split(/\s+/);
                        if (parts.length >= 4 && parts[0] === ip) {
                            const mac = parts[3];
                            if (mac && mac !== '00:00:00:00:00:00' && !mac.includes('incomplete')) {
                                return mac.toUpperCase();
                            }
                        }
                    }
                }
            } catch (e) {}
            return null;
        };

        // 2. Helper to check command output
        const checkCommand = async (cmd, regex) => {
            try {
                const stdout = await this.runCommand(cmd, true); // silent=true
                if (stdout) {
                    const match = stdout.match(regex);
                    if (match) return match[1].toUpperCase().replace(/-/g, ':');
                }
            } catch (e) {}
            return null;
        };

        // Strategy: Check fast sources first. If fail, PING and retry.
        
        // Pass 1: /proc/net/arp (Fastest, No exec)
        if (process.platform === 'linux') {
            const mac = checkFile('/proc/net/arp', ip);
            if (mac) return mac;
        }

        // Pass 2: ip neigh (Modern Linux)
        if (process.platform === 'linux') {
            const mac = await checkCommand(`ip neigh show ${ip}`, /lladdr\s+([0-9A-Fa-f:]{17})/);
            if (mac) return mac;
        }

        // Pass 3: dnsmasq leases (Reliable for DHCP clients)
        if (process.platform === 'linux') {
            const leasePaths = ['/var/lib/misc/dnsmasq.leases', '/tmp/dnsmasq.leases', '/var/lib/dnsmasq/dnsmasq.leases'];
            for (const p of leasePaths) {
                try {
                    if (fs.existsSync(p)) {
                        const content = fs.readFileSync(p, 'utf8');
                        const lines = content.split('\n');
                        for (const line of lines) {
                            const parts = line.trim().split(/\s+/);
                            // Format: timestamp mac ip hostname clientid
                            if (parts.length >= 3 && parts[2] === ip) {
                                return parts[1].toUpperCase();
                            }
                        }
                    }
                } catch (e) {}
            }
        }

        // Pass 4: PROBE (Ping) + Retry
        // If we haven't found it yet, the ARP entry might be stale or missing.
        // Force an ARP resolution by pinging the IP.
        try {
            // Ping with 0.2s timeout (very fast), count 1
            const pingCmd = process.platform === 'win32' 
                ? `ping -n 1 -w 200 ${ip}` 
                : `ping -c 1 -W 1 ${ip}`; // Linux ping -W is in seconds (min 1s usually) or ms depending on version. Using 1s safe.
            
            await this.runCommand(pingCmd, true);
            
            // Retry /proc/net/arp or ip neigh
            if (process.platform === 'linux') {
                const mac = checkFile('/proc/net/arp', ip);
                if (mac) return mac;
                
                const mac2 = await checkCommand(`ip neigh show ${ip}`, /lladdr\s+([0-9A-Fa-f:]{17})/);
                if (mac2) return mac2;
            }
        } catch (e) {}

        // Pass 5: Fallback to 'arp' command (Windows/Legacy)
        const arpCmd = process.platform === 'win32' ? `arp -a ${ip}` : `arp -n ${ip}`;
        const arpRegex = /([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})/;
        const macFallback = await checkCommand(arpCmd, arpRegex);
        if (macFallback) return macFallback;

        return null;
    }

    /**
     * Check if a user has active TCP/UDP connections
     * Used for Idle Detection
     * @param {string} ip
     * @returns {Promise<boolean>}
     */
    async hasActiveConnections(ip) {
        if (!ip) return false;
        
        if (process.platform === 'linux') {
            try {
                const neighCmd = `ip neigh show ${ip}`;
                const neighResult = await this.runCommand(neighCmd, true);
                // Only consider REACHABLE as truly active.
                    // STALE/DELAY/PROBE are states where the kernel is verifying or waiting.
                    // specifically, PROBE means we are actively looking for them (often because we pinged them).
                    // Treating PROBE as active creates a loop where our own ping keeps the session alive.
                    if (neighResult && neighResult.includes('REACHABLE')) {
                        return true;
                    }
            } catch(e) {}
        }

        return false;
    }

    /**
     * Get all active MAC addresses from ARP/Neighbor table
     * Returns a Map of MAC -> IP
     * Used for auto-resume functionality
     */
    async getActiveMacs() {
        const activeMacs = new Map(); // MAC -> IP

        if (process.platform === 'linux') {
            // 1. Try reading /proc/net/arp (Fastest)
            try {
                if (fs.existsSync('/proc/net/arp')) {
                    const arpContent = fs.readFileSync('/proc/net/arp', 'utf8');
                    const lines = arpContent.split('\n');
                    for (const line of lines) {
                        const parts = line.trim().split(/\s+/);
                        // IP, HW Type, Flags, MAC, Mask, Device
                        if (parts.length >= 6) {
                            const ip = parts[0];
                            const mac = parts[3];
                            // Check valid MAC and ensure not incomplete
                            if (mac && mac.length === 17 && mac !== '00:00:00:00:00:00') {
                                activeMacs.set(mac.toUpperCase(), ip);
                            }
                        }
                    }
                }
            } catch (e) {
                console.error('Failed to read /proc/net/arp:', e.message);
            }

            // 2. Try ip neigh (More accurate for REACHABLE/STALE status)
            try {
                const stdout = await this.runCommand('ip neigh show');
                if (stdout) {
                    const lines = stdout.split('\n');
                    for (const line of lines) {
                        // 10.0.0.5 dev wlan0 lladdr 00:11:22:33:44:55 REACHABLE
                        const match = line.match(/^(\S+)\s+.*lladdr\s+([0-9A-Fa-f:]{17})/);
                        if (match) {
                            activeMacs.set(match[2].toUpperCase(), match[1]);
                        }
                    }
                }
            } catch (e) {}
            
            // 3. Fallback to dnsmasq leases
            try {
                const leasePaths = [
                    '/var/lib/misc/dnsmasq.leases',
                    '/tmp/dnsmasq.leases',
                    '/var/lib/dnsmasq/dnsmasq.leases'
                ];
                for (const p of leasePaths) {
                    if (!fs.existsSync(p)) continue;
                    const content = fs.readFileSync(p, 'utf8');
                    const lines = content.split('\n');
                    for (const line of lines) {
                        const parts = line.trim().split(/\s+/);
                        if (parts.length >= 3) {
                            const mac = parts[1];
                            const ip = parts[2];
                            if (mac && mac.length === 17 && ip) {
                                activeMacs.set(mac.toUpperCase(), ip);
                            }
                        }
                    }
                }
            } catch (e) {}
        } else {
            // Windows fallback (arp -a)
            try {
                const stdout = await this.runCommand('arp -a');
                if (stdout) {
                    // Interface: 192.168.1.5 --- 0x2
                    //   Internet Address      Physical Address      Type
                    //   192.168.1.1           00-11-22-33-44-55     dynamic
                    const lines = stdout.split('\n');
                    for (const line of lines) {
                        const parts = line.trim().split(/\s+/);
                        if (parts.length >= 2) {
                            const ip = parts[0];
                            const macMatch = line.match(/([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})/);
                            if (macMatch) {
                                activeMacs.set(macMatch[0].toUpperCase().replace(/-/g, ':'), ip);
                            }
                        }
                    }
                }
            } catch (e) {}
        }

        return activeMacs;
    }

    async checkInternetConnection() {
        try {
            const wanConfig = networkConfigService.getWanConfig();
            const targets = [];

            if (wanConfig && wanConfig.static) {
                if (wanConfig.static.dns1) targets.push(wanConfig.static.dns1);
                if (wanConfig.static.dns2) targets.push(wanConfig.static.dns2);
            }

            if (wanConfig && wanConfig.pppoe) {
                if (wanConfig.pppoe.dns1) targets.push(wanConfig.pppoe.dns1);
                if (wanConfig.pppoe.dns2) targets.push(wanConfig.pppoe.dns2);
            }

            if (targets.length === 0) {
                targets.push('8.8.8.8', '1.1.1.1');
            }

            // Auto-update active WAN interface based on routing table
            // This ensures we are always tracking the interface actually used for internet
            if (process.platform === 'linux' && targets.length > 0) {
                try {
                    const activeIface = await this.getInterfaceForIp(targets[0]);
                    if (activeIface && activeIface !== 'lo' && activeIface !== 'br0' && activeIface !== this.wanInterface) {
                         console.log(`[Network] Auto-detected active WAN change: ${this.wanInterface} -> ${activeIface}`);
                         this.wanInterface = activeIface;
                    }
                } catch (e) {}
            }

            for (const target of targets) {
                let cmd;
                if (process.platform === 'win32') {
                    cmd = `ping -n 1 -w 2000 ${target}`;
                } else {
                    // Use system routing table. 
                    // Do NOT bind to specific interface with -I unless strictly necessary,
                    // as it causes false negatives if this.wanInterface is stale.
                    cmd = `ping -c 1 -W 2 ${target}`;
                }

                const result = await this.runCommand(cmd, true);
                if (result !== null) {
                    return true;
                }
            }

            return false;
        } catch (e) {
            return false;
        }
    }

    /**
     * Authorize a user by MAC address
     * Strategy: Add rule to 'internet_users' chain to MARK packets with 99
     * Also adds rules to 'traffic_acct' for data usage tracking if IP is provided
     */
    async allowUser(macAddress, ipAddress = null) {
        // console.log(`Authorizing MAC: ${macAddress} IP: ${ipAddress}`);
        
        // --- CHECK LICENSE LIMITS ---
        const limits = licenseService.getLimits();
        if (limits.max_hotspot_users !== Infinity) {
            // Count current active users (is_connected = 1 AND time_remaining > 0)
            const activeCount = db.prepare('SELECT count(*) as count FROM users WHERE is_connected = 1 AND time_remaining > 0').get().count;
            
            // Check if THIS user is already connected (re-authorizing)
            const isAlreadyConnected = db.prepare('SELECT id FROM users WHERE mac_address = ? AND is_connected = 1 AND time_remaining > 0').get(macAddress);

            if (!isAlreadyConnected && activeCount >= limits.max_hotspot_users) {
                console.warn(`[License] Blocked user ${macAddress} - Hotspot User Limit Reached (${activeCount}/${limits.max_hotspot_users})`);
                return false; // Block
            }
        }
        // ----------------------------

        // 1. Authorization Rule (Mangle Table)
        const check = await this.runCommand(`iptables -t mangle -C internet_users -m mac --mac-source ${macAddress} -j MARK --set-mark 99`, true);
        if (check === null) {
            await this.runCommand(`iptables -t mangle -A internet_users -m mac --mac-source ${macAddress} -j MARK --set-mark 99`);
        }

        // 1.1 Resolve IP if not provided
        if (!ipAddress) {
            try {
                const activeMacs = await this.getActiveMacs();
                if (activeMacs.has(macAddress.toUpperCase())) {
                    ipAddress = activeMacs.get(macAddress.toUpperCase());
                    console.log(`[Network] Resolved IP for ${macAddress} -> ${ipAddress} for accounting.`);
                }
            } catch (e) {
                console.error('[Network] Error resolving IP for allowUser:', e);
            }
        }

        // 2. Accounting Rules (Filter Table - Forward Chain)
        if (ipAddress) {
            // Upload Rule (Source IP)
            const checkUp = await this.runCommand(`iptables -C traffic_acct -s ${ipAddress} -j RETURN`, true);
            if (checkUp === null) {
                await this.runCommand(`iptables -A traffic_acct -s ${ipAddress} -j RETURN`);
            }

            // Download Rule (Dest IP)
            const checkDown = await this.runCommand(`iptables -C traffic_acct -d ${ipAddress} -j RETURN`, true);
            if (checkDown === null) {
                await this.runCommand(`iptables -A traffic_acct -d ${ipAddress} -j RETURN`);
            }
        }

        return true; 
    }

    /**
     * Block a user
     */
    async blockUser(macAddress, ipAddress = null) {
        console.log(`Blocking MAC: ${macAddress} (IP: ${ipAddress || 'Unknown'})`);
        
        // 1. Remove iptables Mark Rules
        let success = true;
        while(success) {
             const result = await this.runCommand(`iptables -t mangle -D internet_users -m mac --mac-source ${macAddress} -j MARK --set-mark 99`, true);
             if (result === null) success = false;
        }

        // 2. Resolve Current IP from MAC (in case DB is stale or user roamed)
        let resolvedIp = ipAddress;
        if (!resolvedIp) {
            try {
                const activeMacs = await this.getActiveMacs();
                if (activeMacs.has(macAddress.toUpperCase())) {
                    resolvedIp = activeMacs.get(macAddress.toUpperCase());
                    console.log(`Resolved current IP for ${macAddress} -> ${resolvedIp}`);
                }
            } catch (e) {
                console.error('Error resolving IP for block:', e);
            }
        }

        // 3. Remove Accounting Rules
        if (resolvedIp) {
            let acctSuccess = true;
            while(acctSuccess) {
                const r1 = await this.runCommand(`iptables -D traffic_acct -s ${resolvedIp} -j RETURN`, true);
                const r2 = await this.runCommand(`iptables -D traffic_acct -d ${resolvedIp} -j RETURN`, true);
                if (r1 === null && r2 === null) acctSuccess = false;
            }
        }

        // 4. Force Kill Connections (Conntrack)
        const ipsToBlock = new Set();
        if (ipAddress) ipsToBlock.add(ipAddress);
        if (resolvedIp) ipsToBlock.add(resolvedIp);

        for (const ip of ipsToBlock) {
            console.log(`Killing connections for IP: ${ip}`);
            await this.runCommand(`conntrack -D -s ${ip}`, true);
            await this.runCommand(`conntrack -D -d ${ip}`, true);
        }

        return true;
    }

    /**
     * Get Traffic Stats from iptables
     * Returns Map: IP -> { bytes_up: number, bytes_down: number }
     */
    async getTrafficStats() {
        try {
            // -v: verbose (packet/byte counts)
            // -n: numeric (no DNS lookup)
            // -x: exact (no K/M suffixes)
            // -L traffic_acct: list chain
            // silent=true to avoid error logs if chain doesn't exist yet
            const output = await this.runCommand('iptables -v -n -x -L traffic_acct', true);
            if (!output) return new Map();

            const stats = new Map();
            const lines = output.split('\n');
            
            // Example Output:
            // Chain traffic_acct (1 references)
            //     pkts      bytes target     prot opt in     out     source               destination
            //      100    50000 RETURN     all  --  *      *       192.168.1.50         0.0.0.0/0
            //      200   120000 RETURN     all  --  *      *       0.0.0.0/0            192.168.1.50

            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                // We need at least: pkts, bytes, target, ..., source, destination
                // Index: 0=pkts, 1=bytes, 2=target, ... 7=source, 8=destination
                if (parts.length >= 9 && parts[2] === 'RETURN') {
                    const bytes = parseInt(parts[1], 10);
                    const source = parts[7];
                    const dest = parts[8];

                    // Check if Source is a specific IP (Upload)
                    if (source !== '0.0.0.0/0' && source !== '::/0') {
                        if (!stats.has(source)) stats.set(source, { bytes_up: 0, bytes_down: 0 });
                        stats.get(source).bytes_up += bytes;
                    }
                    
                    // Check if Dest is a specific IP (Download)
                    if (dest !== '0.0.0.0/0' && dest !== '::/0') {
                        if (!stats.has(dest)) stats.set(dest, { bytes_up: 0, bytes_down: 0 });
                        stats.get(dest).bytes_down += bytes;
                    }
                }
            }
            return stats;
        } catch (e) {
            console.error('Failed to get traffic stats:', e);
            return new Map();
        }
    }

    /**
     * Get list of currently authorized MAC addresses from iptables
     * Parses `iptables -t mangle -L internet_users -v -n`
     */
    async getAuthorizedMacs() {
        try {
            const output = await this.runCommand('iptables -t mangle -L internet_users -v -n');
            const authorizedMacs = new Set();
            if (!output) return authorizedMacs;

            const lines = output.split('\n');
            for (const line of lines) {
                // Example line:
                // 0     0     MARK       all  --  *      *       00:00:00:00:00:00    0.0.0.0/0            MAC 00:00:00:00:00:00 MARK set 0x63
                const match = line.match(/MAC\s+([0-9A-Fa-f:]{17})/);
                if (match) {
                    authorizedMacs.add(match[1].toUpperCase());
                }
            }
            return authorizedMacs;
        } catch (e) {
            console.error('Failed to get authorized MACs:', e);
            return new Set();
        }
    }

    /**
     * ZeroTier Integration
     */
    async getZeroTierStatus() {
        try {
            // Check if installed
            const version = await this.runCommand('zerotier-cli -v', true);
            if (!version) {
                return { installed: false };
            }

            // Get Device Info
            const infoOutput = await this.runCommand('zerotier-cli info -j');
            let info = {};
            try {
                info = JSON.parse(infoOutput);
            } catch (e) {
                // Fallback for non-json output versions
                const parts = infoOutput.split(' ');
                if (parts.length >= 3) {
                    info = { address: parts[2], online: parts[4] === 'ONLINE' };
                }
            }

            // Get Networks
            const netOutput = await this.runCommand('zerotier-cli listnetworks -j');
            let networks = [];
            try {
                networks = JSON.parse(netOutput);
            } catch (e) {
                // Fallback text parsing if needed, but -j is standard now
            }

            return {
                installed: true,
                version: version.trim(),
                deviceId: info.address,
                online: info.online,
                networks: networks.map(n => ({
                    id: n.id,
                    name: n.name,
                    status: n.status,
                    type: n.type,
                    mac: n.mac,
                    ip: n.assignedAddresses ? n.assignedAddresses.join(', ') : ''
                }))
            };

        } catch (e) {
            console.error('ZeroTier Status Error:', e);
            return { installed: false, error: e.message };
        }
    }

    async joinZeroTier(networkId) {
        if (!networkId || networkId.length !== 16) {
            throw new Error("Invalid Network ID");
        }
        const result = await this.runCommand(`zerotier-cli join ${networkId}`);
        return result && result.includes('200 join OK');
    }

    async installZeroTier() {
        // Run the installation command
        // curl -s https://install.zerotier.com | sudo bash
        // We assume the user has sudo privileges or is root
        try {
            await this.runCommand('curl -s https://install.zerotier.com | sudo bash', true);
            return true;
        } catch (e) {
            console.error('ZeroTier Install Error:', e);
            throw e;
        }
    }

    async leaveZeroTier(networkId) {
        if (!networkId) throw new Error("Network ID required");
        const result = await this.runCommand(`zerotier-cli leave ${networkId}`);
        return result && result.includes('200 leave OK');
    }
    /**
     * Stop Interface Monitor
     */
    stopInterfaceMonitor() {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
            console.log('[Network] Interface monitor stopped.');
        }
    }
}

module.exports = new NetworkService();
