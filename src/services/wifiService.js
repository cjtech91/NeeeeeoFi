const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const HOSTAPD_CONF = '/etc/hostapd/hostapd.conf';

class WifiService {
    constructor() {
        this.config = {
            enabled: false,
            ssid: 'NeoFi_Built-In_WiFi',
            wpa_passphrase: 'password123',
            channel: 6,
            hw_mode: 'g',
            interface: 'wlan0'
        };
    }

    async resolveWifiInterface(preferred) {
        const requested = String(preferred || '').trim();
        if (process.platform === 'win32') return requested || 'wlan0';
        const exists = (ifn) => {
            const n = String(ifn || '').trim();
            if (!n) return false;
            return fs.existsSync(`/sys/class/net/${n}`);
        };
        if (requested && exists(requested)) return requested;

        try {
            const out = await this.execPromise('ls /sys/class/net/wl* 2>/dev/null | head -n 1');
            const cand = String(out || '').trim();
            if (cand && exists(cand)) return cand;
        } catch (e) {}

        if (requested) return requested;
        return 'wlan0';
    }

    async getConfig() {
        try {
            // Check if hostapd is running/enabled
            const isActive = await this.isServiceActive('hostapd');
            
            if (fs.existsSync(HOSTAPD_CONF)) {
                const content = fs.readFileSync(HOSTAPD_CONF, 'utf8');
                const lines = content.split('\n');
                const config = {};
                
                lines.forEach(line => {
                    line = line.trim();
                    if (line && !line.startsWith('#')) {
                        const [key, ...values] = line.split('=');
                        if (key && values.length > 0) {
                            config[key.trim()] = values.join('=').trim();
                        }
                    }
                });

                this.config = {
                    enabled: isActive,
                    ssid: config.ssid || 'NeoFi_Built-In_WiFi',
                    password: config.wpa_passphrase || '',
                    channel: parseInt(config.channel) || 6,
                    hw_mode: config.hw_mode || 'g',
                    interface: config.interface || 'wlan0',
                    auth_mode: 'open' // Default
                };

                // Determine auth_mode from config
                if (config.wpa === '1') this.config.auth_mode = 'wpa';
                else if (config.wpa === '2') this.config.auth_mode = 'wpa2';
                else if (config.wpa === '3') this.config.auth_mode = 'mixed';
                else if (config.auth_algs === '2') this.config.auth_mode = 'shared';
                else this.config.auth_mode = 'open';

            } else {
                this.config.enabled = false;
            }
        } catch (e) {
            console.error('Error reading hostapd config:', e);
        }
        
        return this.config;
    }

    async saveConfig(newConfig) {
        try {
            const resolvedIface = await this.resolveWifiInterface(newConfig.interface || this.config.interface || 'wlan0');
            const config = {
                interface: resolvedIface,
                driver: 'nl80211',
                country_code: 'PH',
                ssid: newConfig.ssid || 'NeoFi_Built-In_WiFi',
                hw_mode: newConfig.hw_mode || 'g',
                channel: newConfig.channel || 6,
                macaddr_acl: 0,
                auth_algs: 1,
                ignore_broadcast_ssid: 0
            };

            const mode = newConfig.auth_mode || 'wpa2'; // Default to WPA2 if not specified

            if (mode === 'shared') {
                config.auth_algs = 2;
                // Note: WEP Shared Key requires wep_key0 which is not currently handled.
                // This mode is provided for legacy support but may require manual config for keys.
            } else if (['wpa', 'wpa2', 'mixed'].includes(mode)) {
                // Add WPA settings ONLY if a password is provided
                if (newConfig.password && newConfig.password.trim().length > 0) {
                    config.wpa_passphrase = newConfig.password;
                    
                    if (mode === 'wpa') {
                        config.wpa = 1;
                        config.wpa_key_mgmt = 'WPA-PSK';
                        config.wpa_pairwise = 'TKIP';
                    } else if (mode === 'wpa2') {
                        config.wpa = 2;
                        config.wpa_key_mgmt = 'WPA-PSK';
                        config.rsn_pairwise = 'CCMP';
                    } else if (mode === 'mixed') {
                        config.wpa = 3;
                        config.wpa_key_mgmt = 'WPA-PSK';
                        config.wpa_pairwise = 'TKIP';
                        config.rsn_pairwise = 'CCMP';
                    }
                }
            }
            // 'open' mode uses default auth_algs=1 and no wpa settings

            const canBridge = async (iface, bridge) => {
                if (process.platform === 'win32') return false;
                if (!iface || !bridge) return false;
                if (!fs.existsSync(`/sys/class/net/${bridge}`)) return false;
                try {
                    await this.execPromise(`ip link set ${iface} down || true`);
                    await this.execPromise(`ip link set ${iface} nomaster || true`);
                    await this.execPromise(`ip link set ${iface} master ${bridge}`);
                    await this.execPromise(`ip link set ${iface} nomaster || true`);
                    return true;
                } catch (e) {
                    try { await this.execPromise(`ip link set ${iface} nomaster || true`); } catch (_) {}
                    return false;
                }
            };

            const writeHostapd = async (bridgeEnabled) => {
                const bridge = 'br0';
                const entries = { ...config };
                if (bridgeEnabled) entries.bridge = bridge;
                let fileContent = '';
                for (const [key, value] of Object.entries(entries)) {
                    fileContent += `${key}=${value}\n`;
                }
                if (process.platform !== 'win32') {
                    const configDir = path.dirname(HOSTAPD_CONF);
                    if (!fs.existsSync(configDir)) {
                        fs.mkdirSync(configDir, { recursive: true });
                    }
                    fs.accessSync(configDir, fs.constants.W_OK);
                    fs.writeFileSync(HOSTAPD_CONF, fileContent);
                }
                return { bridgeEnabled, bridge };
            };

            // Write config file
            if (process.platform !== 'win32') {
                const bridgeOk = await canBridge(config.interface, 'br0');
                await writeHostapd(bridgeOk);
            } else {
                console.log('Windows: Skipping hostapd.conf write');
            }

            // Enable/Start or Stop service
            if (newConfig.enabled) {
                // Pre-flight check: Stop wpa_supplicant on this interface to avoid conflict
                // And ensure RFKill is unblocked
                await this.execPromise(`rfkill unblock wifi || true`);
                await this.execPromise(`pkill -f "wpa_supplicant.*-i${config.interface}" || true`);
                await this.execPromise(`pkill -f "wpa_supplicant.*-i\\s+${config.interface}" || true`);

                // Ensure interface is free from bridge and down (Clean State)
                await this.execPromise(`ip link set ${config.interface} nomaster || true`);
                await this.execPromise(`ip link set ${config.interface} down || true`);
                if (await this.execPromise('which nmcli >/dev/null 2>&1; echo $?').then(x => String(x || '').trim() === '0').catch(() => false)) {
                    await this.execPromise(`nmcli dev set ${config.interface} managed no || true`);
                }
                
                await this.execPromise('systemctl unmask hostapd');
                await this.execPromise('systemctl enable hostapd');
                
                // Stop first to ensure clean state
                await this.execPromise('systemctl stop hostapd || true');
                try {
                    await this.execPromise('systemctl start hostapd');
                } catch (e) {
                    try {
                        await writeHostapd(false);
                        await this.execPromise('systemctl stop hostapd || true');
                        await this.execPromise('systemctl start hostapd');
                    } catch (e2) {
                        let extra = '';
                        try {
                            extra = await this.execPromise('systemctl status hostapd --no-pager -n 80 || true');
                        } catch (_) {}
                        const msg = (e2 && e2.message) ? e2.message : (e && e.message) ? e.message : 'hostapd start failed';
                        throw new Error(`${msg}${extra ? `\n${extra}` : ''}`);
                    }
                }
            } else {
                await this.execPromise('systemctl stop hostapd');
                await this.execPromise('systemctl disable hostapd');
            }
            
            return true;
        } catch (e) {
            console.error('Error saving WiFi config:', e);
            throw e;
        }
    }

    async isServiceActive(service) {
        if (process.platform === 'win32') return false;
        try {
            await this.execPromise(`systemctl is-active --quiet ${service}`);
            return true;
        } catch (e) {
            return false;
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
}

module.exports = new WifiService();
