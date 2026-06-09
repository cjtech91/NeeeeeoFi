const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { db } = require('../database/db');

const HOSTAPD_CONF = '/etc/hostapd/hostapd.conf';
const HOSTAPD_DEFAULT = '/etc/default/hostapd';
const WIFI_CONFIG_KEY = 'wifi_ap_config';

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
            const isActive = await this.isServiceActive('hostapd');

            let saved = null;
            try {
                const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(WIFI_CONFIG_KEY);
                if (row && row.value) saved = JSON.parse(row.value);
            } catch (_) {}
            
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
                    auth_mode: 'open',
                    bridge_enabled: !!config.bridge
                };

                if (config.wpa === '1') this.config.auth_mode = 'wpa';
                else if (config.wpa === '2') this.config.auth_mode = 'wpa2';
                else if (config.wpa === '3') this.config.auth_mode = 'mixed';
                else if (config.auth_algs === '2') this.config.auth_mode = 'shared';
                else this.config.auth_mode = 'open';

                // UI uses 'n' as a selector; hostapd hw_mode does NOT support 'n'.
                // If ieee80211n=1 is present, show it as 'n' in the UI.
                if (String(config.ieee80211n || '').trim() === '1') {
                    this.config.hw_mode = 'n';
                }

                try {
                    db.prepare(`
                        INSERT INTO settings (key, value, type, category, updated_at)
                        VALUES (?, ?, 'json', 'network', CURRENT_TIMESTAMP)
                        ON CONFLICT(key) DO UPDATE SET value = excluded.value, type = 'json', category = 'network', updated_at = CURRENT_TIMESTAMP
                    `).run(WIFI_CONFIG_KEY, JSON.stringify({
                        enabled: !!this.config.enabled,
                        ssid: this.config.ssid,
                        password: this.config.password || '',
                        channel: this.config.channel,
                        hw_mode: this.config.hw_mode,
                        interface: this.config.interface,
                        auth_mode: this.config.auth_mode,
                        bridge_enabled: !!this.config.bridge_enabled
                    }));
                } catch (_) {}
            } else {
                if (saved && typeof saved === 'object') {
                    this.config = {
                        enabled: isActive,
                        ssid: saved.ssid || 'NeoFi_Built-In_WiFi',
                        password: saved.password || '',
                        channel: parseInt(saved.channel) || 6,
                        hw_mode: saved.hw_mode || 'g',
                        interface: saved.interface || 'wlan0',
                        auth_mode: saved.auth_mode || 'open',
                        bridge_enabled: !!saved.bridge_enabled
                    };

                    if (process.platform !== 'win32') {
                        try {
                            const entries = {
                                interface: this.config.interface,
                                driver: 'nl80211',
                                country_code: 'PH',
                                ssid: this.config.ssid,
                                hw_mode: this.config.hw_mode,
                                channel: this.config.channel,
                                macaddr_acl: 0,
                                auth_algs: this.config.auth_mode === 'shared' ? 2 : 1,
                                ignore_broadcast_ssid: 0
                            };
                            if (['wpa', 'wpa2', 'mixed'].includes(this.config.auth_mode) && String(this.config.password || '').trim()) {
                                entries.wpa_passphrase = this.config.password;
                                if (this.config.auth_mode === 'wpa') {
                                    entries.wpa = 1;
                                    entries.wpa_key_mgmt = 'WPA-PSK';
                                    entries.wpa_pairwise = 'TKIP';
                                } else if (this.config.auth_mode === 'wpa2') {
                                    entries.wpa = 2;
                                    entries.wpa_key_mgmt = 'WPA-PSK';
                                    entries.rsn_pairwise = 'CCMP';
                                } else {
                                    entries.wpa = 3;
                                    entries.wpa_key_mgmt = 'WPA-PSK';
                                    entries.wpa_pairwise = 'TKIP';
                                    entries.rsn_pairwise = 'CCMP';
                                }
                            }

                            if (this.config.bridge_enabled) entries.bridge = 'br0';

                            let fileContent = '';
                            for (const [key, value] of Object.entries(entries)) {
                                fileContent += `${key}=${value}\n`;
                            }
                            const configDir = path.dirname(HOSTAPD_CONF);
                            if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
                            fs.writeFileSync(HOSTAPD_CONF, fileContent);
                        } catch (_) {}
                    }
                } else {
                    this.config.enabled = false;
                }
            }
        } catch (e) {
            console.error('Error reading hostapd config:', e);
        }
        
        return this.config;
    }

    async saveConfig(newConfig) {
        try {
            let applied = false;
            let warning = null;
            const resolvedIface = await this.resolveWifiInterface(newConfig.interface || this.config.interface || 'wlan0');

            const requestedHw = String(newConfig.hw_mode || 'g').trim().toLowerCase();
            const hw_mode = (requestedHw === 'n') ? 'g' : (requestedHw || 'g');
            const enable11n = requestedHw === 'n';

            const config = {
                interface: resolvedIface,
                driver: 'nl80211',
                country_code: 'PH',
                ssid: newConfig.ssid || 'NeoFi_Built-In_WiFi',
                hw_mode,
                channel: newConfig.channel || 6,
                macaddr_acl: 0,
                auth_algs: 1,
                ignore_broadcast_ssid: 0
            };

            if (enable11n) {
                config.ieee80211n = 1;
                config.wmm_enabled = 1;
                config.ht_capab = '[HT40-][SHORT-GI-20][SHORT-GI-40]';
            }

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

            try {
                db.prepare(`
                    INSERT INTO settings (key, value, type, category, updated_at)
                    VALUES (?, ?, 'json', 'network', CURRENT_TIMESTAMP)
                    ON CONFLICT(key) DO UPDATE SET value = excluded.value, type = 'json', category = 'network', updated_at = CURRENT_TIMESTAMP
                `).run(WIFI_CONFIG_KEY, JSON.stringify({
                    enabled: !!newConfig.enabled,
                    ssid: config.ssid,
                    password: String(newConfig.password || '').trim(),
                    channel: Number(config.channel) || 6,
                    hw_mode: requestedHw || 'g',
                    interface: config.interface,
                    auth_mode: mode,
                    bridge_enabled: null
                }));
            } catch (_) {}

            const ensureHostapdDaemonConf = async () => {
                if (process.platform === 'win32') return;
                try {
                    const dir = path.dirname(HOSTAPD_DEFAULT);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    let content = '';
                    try { content = fs.existsSync(HOSTAPD_DEFAULT) ? fs.readFileSync(HOSTAPD_DEFAULT, 'utf8') : ''; } catch (_) {}
                    const line = `DAEMON_CONF="${HOSTAPD_CONF}"`;
                    if (/^\s*DAEMON_CONF\s*=/m.test(content)) {
                        content = content.replace(/^\s*DAEMON_CONF\s*=.*$/m, line);
                    } else {
                        content = `${content || ''}\n${line}\n`;
                    }
                    fs.writeFileSync(HOSTAPD_DEFAULT, content.replace(/\n{3,}/g, '\n\n').trim() + '\n');
                } catch (_) {}
            };

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
            let bridgeOk = false;
            if (process.platform !== 'win32') {
                bridgeOk = await canBridge(config.interface, 'br0');
                await writeHostapd(bridgeOk);
                await ensureHostapdDaemonConf();
            } else {
                console.log('Windows: Skipping hostapd.conf write');
            }

            // Enable/Start or Stop service
            if (newConfig.enabled) {
                if (process.platform !== 'win32') {
                    const execIgnore = async (cmd) => {
                        try {
                            await this.execPromise(cmd);
                        } catch (_) {}
                    };

                    await execIgnore('rfkill unblock wifi');
                    await execIgnore(`pkill -f "wpa_supplicant.*-i${config.interface}"`);
                    await execIgnore(`pkill -f "wpa_supplicant.*-i\\s+${config.interface}"`);
                    await execIgnore(`systemctl stop wpa_supplicant@${config.interface}.service`);
                    await execIgnore('systemctl stop wpa_supplicant.service');

                    await execIgnore(`ip link set ${config.interface} nomaster`);
                    await execIgnore(`ip link set ${config.interface} down`);
                    try {
                        const hasNmcli = await this.execPromise('which nmcli >/dev/null 2>&1; echo $?')
                            .then(x => String(x || '').trim() === '0')
                            .catch(() => false);
                        if (hasNmcli) {
                            await execIgnore(`nmcli dev set ${config.interface} managed no`);
                        }
                    } catch (_) {}

                    await this.execPromise('systemctl unmask hostapd');
                    await this.execPromise('systemctl enable hostapd');
                    await execIgnore('systemctl daemon-reload');

                    await execIgnore('systemctl stop hostapd');
                    try {
                        await this.execPromise('systemctl start hostapd');
                        applied = true;
                    } catch (e) {
                        try {
                            await writeHostapd(false);
                            await ensureHostapdDaemonConf();
                            await execIgnore('systemctl stop hostapd');
                            await this.execPromise('systemctl start hostapd');
                            applied = true;
                        } catch (e2) {
                            let extra = '';
                            try {
                                extra = await this.execPromise('systemctl status hostapd --no-pager -n 80 || true');
                                try {
                                    const j = await this.execPromise('journalctl -u hostapd -n 120 --no-pager || true');
                                    if (j && String(j).trim()) extra += `\n\n--- journalctl -u hostapd (last 120) ---\n${j}`;
                                } catch (_) {}
                            } catch (_) {}
                            const msg = (e2 && e2.message) ? e2.message : (e && e.message) ? e.message : 'hostapd start failed';
                            warning = `${msg}${extra ? `\n${extra}` : ''}`;
                            applied = false;
                        }
                    }
                }
            } else {
                if (process.platform !== 'win32') {
                    await this.execPromise('systemctl stop hostapd');
                    await this.execPromise('systemctl disable hostapd');
                }
                applied = true;
            }

            try {
                db.prepare(`
                    INSERT INTO settings (key, value, type, category, updated_at)
                    VALUES (?, ?, 'json', 'network', CURRENT_TIMESTAMP)
                    ON CONFLICT(key) DO UPDATE SET value = excluded.value, type = 'json', category = 'network', updated_at = CURRENT_TIMESTAMP
                `).run(WIFI_CONFIG_KEY, JSON.stringify({
                    enabled: !!newConfig.enabled,
                    ssid: config.ssid,
                    password: String(newConfig.password || '').trim(),
                    channel: Number(config.channel) || 6,
                    hw_mode: requestedHw || 'g',
                    interface: config.interface,
                    auth_mode: mode,
                    bridge_enabled: !!bridgeOk
                }));
            } catch (_) {}
            
            return { applied, warning };
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
