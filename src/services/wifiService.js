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
            const config = {
                interface: newConfig.interface || 'wlan0',
                bridge: 'br0',
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

            let fileContent = '';
            for (const [key, value] of Object.entries(config)) {
                fileContent += `${key}=${value}\n`;
            }

            // Write config file
            if (process.platform !== 'win32') {
                const configDir = path.dirname(HOSTAPD_CONF);
                if (!fs.existsSync(configDir)) {
                    try {
                        console.log(`Creating directory: ${configDir}`);
                        fs.mkdirSync(configDir, { recursive: true });
                    } catch (err) {
                        console.error(`Failed to create directory ${configDir}:`, err);
                        throw new Error(`Failed to create directory ${configDir}: ${err.message}`);
                    }
                }
                
                // Double check if directory exists and is writable
                try {
                    fs.accessSync(configDir, fs.constants.W_OK);
                } catch (err) {
                    console.error(`Directory ${configDir} is not writable:`, err);
                    throw new Error(`Directory ${configDir} is not writable: ${err.message}`);
                }

                fs.writeFileSync(HOSTAPD_CONF, fileContent);
            } else {
                console.log('Windows: Skipping hostapd.conf write');
            }

            // Enable/Start or Stop service
            if (newConfig.enabled) {
                // Pre-flight check: Stop wpa_supplicant on this interface to avoid conflict
                // And ensure RFKill is unblocked
                await this.execPromise(`rfkill unblock wifi || true`);
                await this.execPromise(`killall wpa_supplicant || true`);

                // Ensure interface is free from bridge and down (Clean State)
                await this.execPromise(`ip link set ${config.interface} nomaster || true`);
                await this.execPromise(`ip link set ${config.interface} down || true`);
                
                await this.execPromise('systemctl unmask hostapd');
                await this.execPromise('systemctl enable hostapd');
                
                // Stop first to ensure clean state
                await this.execPromise('systemctl stop hostapd || true');
                await this.execPromise('systemctl start hostapd');
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
