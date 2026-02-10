const express = require('express');
const os = require('os');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const { initDb, db } = require('./database/db');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require("socket.io");
const networkService = require('./services/networkService');
const coinService = require('./services/coinService');
const voucherService = require('./services/voucherService');
const bandwidthService = require('./services/bandwidthService');
const monitoringService = require('./services/monitoringService');
const configService = require('./services/configService');
const networkConfigService = require('./services/networkConfigService');
const pppoeServerService = require('./services/pppoeServerService');
const hardwareService = require('./services/hardwareService');
const firewallService = require('./services/firewallService');
const dnsService = require('./services/dnsService');
const sessionService = require('./services/sessionService');
const systemService = require('./services/systemService');
const logService = require('./services/logService');
const chatService = require('./services/chatService');
const walledGardenService = require('./services/walledGardenService');
const wifiService = require('./services/wifiService');
const licenseService = require('./services/licenseService');
const crypto = require('crypto');

// Session Token Management
let currentAdminSessionToken = null;

function loadAdminSessionToken() {
    try {
        const admin = db.prepare('SELECT session_token FROM admins WHERE id = 1').get();
        if (admin && admin.session_token) {
            currentAdminSessionToken = admin.session_token;
        } else {
            // Generate initial if missing
            currentAdminSessionToken = crypto.randomBytes(32).toString('hex');
            db.prepare('UPDATE admins SET session_token = ? WHERE id = 1').run(currentAdminSessionToken);
        }
        console.log('Admin Session Token Loaded');
    } catch (e) {
        console.error('Failed to load admin session token:', e);
        // Fallback for safety
        currentAdminSessionToken = crypto.randomBytes(32).toString('hex');
    }
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;
const PORTAL_DOMAIN = 'pisowifi.local';
const PORTAL_URL = `http://${PORTAL_DOMAIN}:${PORT}/portal`;
const SUB_VENDO_OFFLINE_AFTER_MS = 70000;

// Debug: Log paths
console.log('--- Path Debug ---');
console.log('__dirname:', __dirname);
console.log('Public Dir:', path.join(__dirname, '../public'));
console.log('Portal File:', path.join(__dirname, '../public', 'portal.html'));
console.log('------------------');

// Middleware
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '100mb' }));
app.use(cookieParser());
// Trust reverse proxies so req.ip/req.ips/X-Forwarded-For are usable
app.set('trust proxy', true);

// License API
app.get('/api/license/status', (req, res) => res.json(licenseService.getStatus()));

app.post('/api/license/activate', async (req, res) => {
    try {
        const { key } = req.body;
        const result = await licenseService.activateLicense(key);
        res.json(result);
    } catch (e) {
        res.status(400).json({ success: false, error: e.message });
    }
});

// License Enforcement Middleware
app.use('/api', (req, res, next) => {
    // Allow license APIs and Auth
    if (req.path.startsWith('/license/') || 
        req.path.startsWith('/auth/')) {
        return next();
    }
    
    // If not valid, block all other APIs (Coin, Voucher, Settings, etc.)
    if (!licenseService.getStatus().isValid) {
        // Allow session and traffic updates even if expired, to not break existing user experience too harshly
        if (req.path.startsWith('/session/') || req.path.startsWith('/traffic/')) {
            return next();
        }
         return res.status(403).json({ success: false, error: 'System Unlicensed. Please contact administrator.', code: 'LICENSE_REQUIRED' });
    }
    next();
});

// Set view engine
// app.set('view engine', 'ejs');
// app.set('views', path.join(__dirname, 'views'));


// PPPoE Expired Redirection Middleware
app.use((req, res, next) => {
    // Check if request is coming from Expired Pool (172.15.10.x)
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    // Normalize IP (handle ::ffff:172.15.10.x)
    const ipv4 = clientIp.replace(/^.*:/, '');

    // Get config dynamically
    let expiredPrefix = '172.15.10.';
    let serverIp = '10.10.10.1';
    
    try {
        const config = pppoeServerService.getConfig();
        if (config.expired_pool) {
             const expiredStart = config.expired_pool.split('-')[0].trim();
             expiredPrefix = expiredStart.substring(0, expiredStart.lastIndexOf('.') + 1);
        }
        if (config.local_ip) {
            serverIp = config.local_ip;
        }
    } catch (e) {
        // Fallback to default
    }

    if (ipv4.startsWith(expiredPrefix)) {
        // Redirect to expired portal if not already there
        if (req.path === '/expired.html' || 
            req.path.startsWith('/api/') || 
            req.path.startsWith('/assets/') ||
            req.path.match(/\.(css|js|png|jpg|ico|woff2?)$/)) {
            return next();
        }
        
        // Force redirect to the Expired Gateway IP (e.g. 172.15.10.1)
        // We use the prefix (172.15.10.) + "1" to construct the gateway IP.
        const expiredGateway = `${expiredPrefix}1`;
        return res.redirect(`http://${expiredGateway}/expired.html`);
    }
    next();
});

// PPPoE User Info API (for Expired Portal)
app.get('/api/pppoe/me', (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const ipv4 = clientIp.replace(/^.*:/, '');

    try {
        // Find user by current IP
        // We check pppoe_users where current_ip matches and join profile to get name
        const user = db.prepare(`
            SELECT u.username, u.mac_address, u.expiration_date, COALESCE(p.name, u.profile_name) as profile_name, p.price 
            FROM pppoe_users u
            LEFT JOIN pppoe_profiles p ON u.profile_id = p.id
            WHERE u.current_ip = ?
        `).get(ipv4);
        
        if (user) {
            res.json({ 
                success: true, 
                username: user.username, 
                mac_address: user.mac_address,
                profile_name: user.profile_name,
                expiration_date: user.expiration_date,
                price: user.price
            });
        } else {
            res.json({ success: false, error: 'User not found' });
        }
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Authentication Middleware
// (Handled later in the file)


function servePortalBanner(absolutePath) {
    return (req, res, next) => {
        try {
            if (absolutePath && fs.existsSync(absolutePath)) {
                try {
                    fs.accessSync(absolutePath, fs.constants.R_OK);
                } catch (e) {
                    return next();
                }
                return res.sendFile(absolutePath, (err) => {
                    if (err) return next();
                });
            }
        } catch (e) {}
        return next();
    };
}

app.get('/op-banner.jpg', servePortalBanner('/root/linux_pisowifi/public/op-banner.jpg'));
app.get('/op-banner.png', servePortalBanner('/root/linux_pisowifi/public/op-banner.png'));
app.get('/op-banner1.jpg', servePortalBanner('/root/linux_pisowifi/public/op-banner1.jpg'));
app.get('/op-banner1.png', servePortalBanner('/root/linux_pisowifi/public/op-banner1.png'));
app.get('/op-banner1', servePortalBanner('/root/linux_pisowifi/public/op-banner1'));
app.get('/op-banner1', servePortalBanner('/root/linux_pisowifi/public/op-banner1.jpg'));
app.get('/op-banner1', servePortalBanner('/root/linux_pisowifi/public/op-banner1.png'));


// Middleware to enforce Unified Portal Domain (Fixes Roaming/LocalStorage issues)
app.use((req, res, next) => {
    // Skip for API, assets, or if already on correct domain
    // Also skip for direct IP access IF it's localhost (debugging) OR explicitly requesting admin
    // Also skip if Hostname IS an IP address (e.g. WAN management), UNLESS it's a captive probe
    const isIpAddress = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(req.hostname);

    if (req.path.startsWith('/api/') || 
        req.path.startsWith('/assets/') || 
        req.path.startsWith('/admin') || 
        req.hostname === PORTAL_DOMAIN ||
        req.hostname === 'localhost' ||
        req.ip === '127.0.0.1' ||
        isIpAddress || // Allow direct IP access (e.g. 20.0.0.226)
        req.path.match(/\.(js|css|png|jpg|jpeg|gif|ico|woff|woff2|ttf|eot)$/)) {
        return next();
    }

    // Identify Captive Portal probes
    const isProbe = req.path === '/generate_204' || 
                    req.path === '/hotspot-detect.html' || 
                    req.path === '/ncsi.txt' || 
                    req.path === '/connecttest.txt' ||
                    (req.get('User-Agent') && req.get('User-Agent').includes('CaptiveNetworkSupport'));

    // Redirect to Unified Portal Domain
    if (isProbe || req.path === '/portal' || req.path === '/' || (req.method === 'GET' && req.accepts('html'))) {
        return res.redirect(PORTAL_URL);
    }

    next();
});

app.use(express.static(path.join(__dirname, '../public'))); // Fix: Public folder is at root, one level up from src

// Serve Chart.js from node_modules if available (for offline support)
try {
    const chartJsPath = require.resolve('chart.js/dist/chart.umd.js');
    app.get('/js/chart.js', (req, res) => {
        res.sendFile(chartJsPath);
    });
} catch (e) {
    console.log('Chart.js not found in node_modules. Using CDN fallback.');
}

// Routes for Portal and Admin (Clean URLs)
function getActivePortalFile() {
    const theme = configService.get('portal_theme', 'portal.html');
    if (!theme || typeof theme !== 'string') return 'portal.html';
    // Security check
    if (!theme.startsWith('portal') || !theme.endsWith('.html') || theme.includes('/') || theme.includes('\\')) {
        return 'portal.html';
    }
    // Check existence
    if (!fs.existsSync(path.join(__dirname, '../public', theme))) {
        return 'portal.html';
    }
    return theme;
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', getActivePortalFile()));
});
app.get('/portal', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', getActivePortalFile()));
});
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// Initialize Database & Services
(async () => {
    try {
        initDb();
        loadAdminSessionToken();

        // Initialize Config Services first (after DB is ready)
        configService.init();
        networkConfigService.init();
        
        // Initialize Coin Service (depends on config)
        await coinService.init();

        // Ensure Sub Vendo Key exists
        const existingKey = configService.get('sub_vendo_key');
        if (!existingKey) {
            const defaultKey = crypto.randomBytes(8).toString('hex');
            configService.set('sub_vendo_key', defaultKey);
            console.log(`Generated default Sub Vendo Key: ${defaultKey}`);
        }

        await networkService.init();
        await bandwidthService.init(networkService.wanInterface, 'br0'); // Initialize QoS (CAKE)
        await firewallService.init(); // Initialize Firewall/AdBlocker
        await walledGardenService.init(); // Initialize Walled Garden
        hardwareService.init(); // Initialize Hardware (Relay/Temp)
        await pppoeServerService.init(networkService.wanInterface); // Initialize PPPoE Server
        
        // Restore sessions for active users after restart
        const activeUsers = db.prepare('SELECT mac_address, ip_address, download_speed, upload_speed FROM users WHERE time_remaining > 0 AND is_paused = 0').all();
        console.log(`Restoring ${activeUsers.length} active sessions...`);
        for (const user of activeUsers) {
            await networkService.allowUser(user.mac_address);
            if (user.ip_address) {
                await bandwidthService.setLimit(user.ip_address, user.download_speed, user.upload_speed);
            }
        }
        
        console.log(`System initialized with WAN: ${networkService.wanInterface}`);
        
        // Start Session Monitoring (Idle Timeout & Traffic Stats)
        // Set to 1000ms (1 second) for real-time updates
        sessionService.startMonitoring(1000);

        // Check Internet Connectivity
        const hasInternet = await networkService.checkInternetConnection();
        if (hasInternet) {
            console.log('✅ Internet Connection: ONLINE');
        } else {
            console.warn('⚠️ Internet Connection: OFFLINE (Check WAN Interface or Cable)');
        }

    } catch (e) {
        console.error('Initialization failed:', e);
    }
})();

// --- Helper Functions ---
function generateClientId() {
    return crypto.randomBytes(16).toString('hex');
}

function generateUserCode() {
    // Generate a 6-character alphanumeric code (Capital letters + Numbers, excluding easily confused ones)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; 
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `CJ-${code}`;
}

function normalizeIp(ip) {
    if (!ip || typeof ip !== 'string') return ip;
    return ip.replace(/^::ffff:/, '');
}

function getClientIp(req) {
    const xfwd = req.headers['x-forwarded-for'];
    if (typeof xfwd === 'string' && xfwd.length > 0) {
        const first = xfwd.split(',')[0].trim();
        return normalizeIp(first);
    }
    if (Array.isArray(req.ips) && req.ips.length > 0) {
        return normalizeIp(req.ips[0]);
    }
    return normalizeIp(req.ip);
}

function generateUniqueUserCode() {
    let userCode = null;
    while (true) {
        userCode = generateUserCode();
        const existing = db.prepare('SELECT id FROM users WHERE user_code = ?').get(userCode);
        if (!existing) return userCode;
    }
}

function getTcClassIdFromIp(ip) {
    if (!ip || typeof ip !== 'string') return null;
    const sanitized = normalizeIp(ip);
    const parts = sanitized.split('.');
    if (parts.length !== 4) return null;
    const last = Number(parts[3]);
    if (!Number.isFinite(last) || last <= 0 || last > 9999) return null;
    return String(last);
}

// --- Time Countdown Loop ---
// Robust loop using setTimeout to prevent overlap and memory issues
let lastTick = Date.now();

// Prepare statements once (Performance Optimization)
const selectActiveUsers = db.prepare('SELECT id, user_code, mac_address, ip_address, time_remaining, total_data_up, total_data_down, interface, download_speed, upload_speed FROM users WHERE time_remaining > 0 AND is_paused = 0');
const updateTime = db.prepare('UPDATE users SET time_remaining = ? WHERE id = ?');
const updateUserInterfaceAndIp = db.prepare('UPDATE users SET interface = ?, ip_address = ? WHERE id = ?');
const expireUser = db.prepare('UPDATE users SET time_remaining = 0, is_connected = 0 WHERE id = ?');
const updateTraffic = db.prepare('UPDATE users SET total_data_up = ?, total_data_down = ? WHERE id = ?');
const updateTrafficActivity = db.prepare('UPDATE users SET last_traffic_at = CURRENT_TIMESTAMP WHERE id = ?');
const pauseUser = db.prepare('UPDATE users SET is_paused = 1, is_connected = 1 WHERE id = ?');
const insertSystemLog = db.prepare('INSERT INTO system_logs (category, level, message, timestamp) VALUES (?, ?, ?, CURRENT_TIMESTAMP)');

// Traffic Cache to calculate deltas
// Key: mac_address, Value: { dl: last_dl_bytes, ul: last_ul_bytes }
const trafficCache = {};

// Counter for traffic sync (run every 5s)
let trafficSyncCounter = 0;
// Counter for interface sync (run every 10s - faster for roaming)
let interfaceSyncCounter = 0;

const countdownLoop = async () => {
    try {
        const now = Date.now();
        // Calculate elapsed seconds since last successful tick
        // Use Math.max to prevent negative issues if clock changes
        const deltaSeconds = Math.max(0, Math.floor((now - lastTick) / 1000));
        
        // Only run update if at least 1 second has passed
        if (deltaSeconds >= 1) {
            // 1. Get all active, unpaused users
            const users = selectActiveUsers.all();
            
            // 2. Fetch Traffic Stats if sync interval (every 1s)
            trafficSyncCounter += deltaSeconds;
            let trafficStats = null;
            if (trafficSyncCounter >= 1) {
                trafficStats = await monitoringService.getClientTraffic(configService.get('lan_interface') || 'br0');
                trafficSyncCounter = 0;
            }

            // 3. Interface Sync (every 10s)
            interfaceSyncCounter += deltaSeconds;
            let currentClients = null;
            if (interfaceSyncCounter >= 10) {
                currentClients = await networkService.getConnectedClients();
                interfaceSyncCounter = 0;
            }

            for (const user of users) {
                // Decrement by actual elapsed time
                const newTime = user.time_remaining - deltaSeconds;
                
                if (newTime <= 0) {
                    // Time Expired
                    expireUser.run(user.id);
                    await networkService.blockUser(user.mac_address, user.ip_address);
                    if (user.ip_address) {
                        await bandwidthService.removeLimit(user.ip_address);
                    }
                    console.log(`[Session] User ${user.mac_address} expired (IP: ${user.ip_address || 'N/A'}). Connection removed.`);
                    
                    // Log to System Logs for Hotspot History
                    try {
                        const logMsg = JSON.stringify({
                            type: 'session_expired',
                            details: {
                                user_code: user.user_code,
                                mac_address: user.mac_address,
                                ip_address: user.ip_address
                            }
                        });
                        insertSystemLog.run('HOTSPOT', 'info', logMsg);
                    } catch (e) {
                        console.error('Failed to log session expiration:', e);
                    }

                    // Clean up cache
                    delete trafficCache[user.mac_address];
                } else {
                    // Update time
                    updateTime.run(newTime, user.id);
                    
                    // Update Interface/IP if detected change (Roaming Logic)
                    if (currentClients && user.mac_address) {
                        const normalizedMac = user.mac_address.toLowerCase();
                        const clientInfo = currentClients[normalizedMac];
                        
                        if (clientInfo) {
                            const hasIpChanged = clientInfo.ip !== user.ip_address;
                            const hasIfaceChanged = clientInfo.interface !== user.interface;

                            if (hasIpChanged || hasIfaceChanged) {
                                // 1. Update DB
                                updateUserInterfaceAndIp.run(clientInfo.interface, clientInfo.ip, user.id);
                                
                                // 2. Clean up old limits/rules if IP changed
                                if (hasIpChanged && user.ip_address) {
                                     bandwidthService.removeLimit(user.ip_address).catch(() => {});
                                     // blockUser/allowUser handles iptables, allowUser clears old? 
                                     // networkService.allowUser adds to internet_users set.
                                     // Ideally we should remove old IP from set, but ipset might handle it or we leave it to expire?
                                     // For now, focusing on enabling the NEW connection.
                                }

                                // 3. Apply new limits/rules
                                if (user.download_speed || user.upload_speed) {
                                    bandwidthService.setLimit(clientInfo.ip, user.download_speed, user.upload_speed).catch(() => {});
                                }
                                
                                // 4. Re-authorize in Firewall (ipset)
                                networkService.allowUser(user.mac_address, clientInfo.ip).catch(() => {});
                                
                                console.log(`[Roaming] User ${user.mac_address} moved to ${clientInfo.interface} (IP: ${clientInfo.ip})`);
                            }
                        }
                    }

                    // Update Traffic & Check Idle (only if stats fetched)
                    if (trafficStats) {
                        const normalizedIp = normalizeIp(user.ip_address);
                        const hasUl = !!normalizedIp && !!trafficStats.uploads[normalizedIp];
                        const tcId = getTcClassIdFromIp(normalizedIp);
                        const hasDlByIp = !!tcId && !!trafficStats.downloads[tcId];
                        const dlStat = (tcId && trafficStats.downloads[tcId]) || { bytes: 0, idle: 0 };
                        const ulStat = (normalizedIp && trafficStats.uploads[normalizedIp]) || { bytes: 0, idle: 0 };
                        
                        // Calculate Deltas
                        const cache = trafficCache[user.mac_address];
                        if (!cache) {
                            trafficCache[user.mac_address] = { dl: dlStat.bytes || 0, ul: ulStat.bytes || 0 };
                        }
                        
                        // Handle tc reset (if current bytes < last bytes, assume reset and take current as delta)
                        const dlDelta = cache ? (dlStat.bytes >= cache.dl ? dlStat.bytes - cache.dl : dlStat.bytes) : 0;
                        const ulDelta = cache ? (ulStat.bytes >= cache.ul ? ulStat.bytes - cache.ul : ulStat.bytes) : 0;
                        
                        // Update DB if there is traffic
                        if (dlDelta > 0 || ulDelta > 0) {
                            const newTotalDl = (user.total_data_down || 0) + dlDelta;
                            const newTotalUl = (user.total_data_up || 0) + ulDelta;
                            updateTraffic.run(newTotalUl, newTotalDl, user.id);
                            updateTrafficActivity.run(user.id);
                        }

                        trafficCache[user.mac_address] = { dl: dlStat.bytes || 0, ul: ulStat.bytes || 0 };
                        
                        // Auto-Pause on Idle is handled by SessionService (checkIdleUsers)
                    }
                }
            }
            // Update lastTick to now (roughly)
            lastTick = now;
        }
    } catch (e) {
        console.error('Error in countdown loop:', e);
    }

    // Schedule next run
    setTimeout(countdownLoop, 1000);
};

// Start the loop
countdownLoop();

// --- Firewall Sync Loop (Every 60s) ---
// Ensures that connected users in DB are actually allowed in Firewall
setInterval(async () => {
    try {
        await sessionService.syncFirewall();
    } catch (e) {
        console.error('Error in firewall sync loop:', e);
    }
}, 60000);

// --- Coin Listener ---
const coinSessions = new Map();

function formatMac(mac) {
    return typeof mac === 'string' ? mac.toLowerCase() : mac;
}

function computeBestRateForAmount(totalAmount) {
    const amount = Number(totalAmount) || 0;
    if (amount <= 0) return { minutes: 0, upload_speed: null, download_speed: null };

    const rates = db.prepare('SELECT * FROM rates ORDER BY amount ASC').all();
    if (!rates || rates.length === 0) return { minutes: 0, upload_speed: null, download_speed: null };

    const bestMinutes = Array(amount + 1).fill(-Infinity);
    const prev = Array(amount + 1).fill(null);
    bestMinutes[0] = 0;

    for (let a = 1; a <= amount; a++) {
        for (const r of rates) {
            const rAmount = Number(r.amount) || 0;
            const rMinutes = Number(r.minutes) || 0;
            if (rAmount <= 0 || rMinutes <= 0 || rAmount > a) continue;

            const candidate = bestMinutes[a - rAmount] + rMinutes;
            if (candidate > bestMinutes[a]) {
                bestMinutes[a] = candidate;
                prev[a] = { from: a - rAmount, rateId: r.id };
            }
        }
    }

    let usedRateIds = [];
    if (bestMinutes[amount] !== -Infinity) {
        let cursor = amount;
        while (cursor > 0 && prev[cursor]) {
            usedRateIds.push(prev[cursor].rateId);
            cursor = prev[cursor].from;
        }
    } else {
        const baseRate = rates.find(r => Number(r.amount) === 1);
        if (!baseRate) return { minutes: 0, upload_speed: null, download_speed: null };
        return {
            minutes: amount * (Number(baseRate.minutes) || 0),
            upload_speed: baseRate.upload_speed,
            download_speed: baseRate.download_speed
        };
    }

    let selectedUpload = null;
    let selectedDownload = null;
    for (const id of usedRateIds) {
        const r = rates.find(x => x.id === id);
        if (!r) continue;
        const ul = Number(r.upload_speed);
        const dl = Number(r.download_speed);
        if (Number.isFinite(ul)) selectedUpload = selectedUpload == null ? ul : Math.max(selectedUpload, ul);
        if (Number.isFinite(dl)) selectedDownload = selectedDownload == null ? dl : Math.max(selectedDownload, dl);
    }

    return {
        minutes: bestMinutes[amount],
        upload_speed: selectedUpload,
        download_speed: selectedDownload
    };
}

function findCoinSessionByMac(mac) {
    const targetMac = formatMac(mac);
    for (const [key, session] of coinSessions.entries()) {
        if (formatMac(session.mac) === targetMac) {
            return { key, session };
        }
    }
    return null;
}

async function finalizeCoinSession(sessionKey, reason) {
    const session = coinSessions.get(sessionKey);
    if (!session) return { success: false, error: 'No active coin session' };

    const mac = formatMac(session.mac);
    const ip = session.ip;
    const clientId = session.clientId;
    const amount = Number(session.pendingAmount) || 0;
    const saleSource = session.lastSource || session.targetDeviceId || 'hardware';
    const sourceAmounts = session.sourceAmounts || {};

    if (session.timeout) clearTimeout(session.timeout);
    session.timeout = null;

    if (sessionKey === 'hardware') {
        hardwareService.setRelay(false);
    } else if (sessionKey.startsWith('subvendo:')) {
        try {
            const deviceIdStr = sessionKey.slice('subvendo:'.length);
            const svDevice = db.prepare('SELECT id, ip_address, relay_pin_active_state FROM sub_vendo_devices WHERE device_id = ?').get(deviceIdStr);
            if (svDevice && svDevice.ip_address) {
                await controlSubVendoRelay(svDevice.ip_address, 'off', svDevice.relay_pin_active_state);
            }
        } catch (e) {
            console.error('[Coin] Error turning off sub-vendo relay:', e);
        }
    }

    coinSessions.delete(sessionKey);

    if (amount <= 0) {
        io.emit('coin_finalized', { mac, amount: 0, secondsAdded: 0, reason });
        return { success: true, amount: 0, secondsAdded: 0 };
    }

    // Lookup user FIRST to get/generate user_code for sales tracking
    let user = db.prepare('SELECT * FROM users WHERE mac_address = ?').get(mac);
    if (!user) {
        user = db.prepare('SELECT * FROM users WHERE lower(mac_address) = lower(?)').get(mac);
        if (user && user.mac_address !== mac) {
            try {
                db.prepare('UPDATE users SET mac_address = ? WHERE id = ?').run(mac, user.id);
                user = { ...user, mac_address: mac };
            } catch (e) {}
        }
    }

    let userCode = user ? user.user_code : null;
    if (!userCode) {
        userCode = generateUniqueUserCode();
        // If user exists, update their code immediately
        if (user) {
            try {
                db.prepare('UPDATE users SET user_code = ? WHERE id = ?').run(userCode, user.id);
                user.user_code = userCode;
            } catch (e) {
                console.error('[Sales] Failed to update user code:', e);
            }
        }
    }

    try {
        // Record sales per source
        const sources = sourceAmounts;
        // Fallback if sourceAmounts is empty but amount > 0 (should not happen, but safe fallback)
        if (Object.keys(sources).length === 0) {
            sources[saleSource] = amount;
        }

        const now = new Date();
        // Adjust to Philippines Time (UTC+8) manually if system time is UTC
        // Or trust the system time if timedatectl worked.
        // Safer approach: Get local ISO string with offset
        const timestamp = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0, 19).replace('T', ' ');

        const insertSale = db.prepare('INSERT INTO sales (amount, mac_address, source, user_code, timestamp) VALUES (?, ?, ?, ?, ?)');
        
        for (const [src, amt] of Object.entries(sources)) {
            if (amt > 0) {
                insertSale.run(amt, mac, src, userCode, timestamp);
            }
        }
    } catch (err) {
        console.error('[Sales] Error recording sale:', err);
    }
    
    // Calculate best time and speeds using Greedy logic
    const best = calculateTimeFromRates(amount, clientId);
    const minutesToAdd = Number(best.minutes) || 0;
    const secondsToAdd = minutesToAdd * 60;

    // Calculate Points Earned
    const pointsEarningRate = Number(configService.get('points_earning_rate')) || 0; // Default 0 (disabled) if not set
    const pointsEarned = Math.floor(amount * pointsEarningRate);

    // Apply points if earned
    if (pointsEarned > 0 && user) {
        try {
            db.prepare('UPDATE users SET points_balance = COALESCE(points_balance, 0) + ? WHERE id = ?').run(pointsEarned, user.id);
            // Update the local user object for speed/limit calculations if needed (though not used below)
            user.points_balance = (user.points_balance || 0) + pointsEarned;
        } catch (e) {
            console.error('[Sales] Failed to add points:', e);
        }
    }

    if (secondsToAdd <= 0) {
        io.emit('coin_finalized', { mac, amount, secondsAdded: 0, reason });
        return { success: false, error: 'No rate available for this amount' };
    }

    const prevUpload = (user && user.upload_speed != null) ? Number(user.upload_speed) : 1024;
    const prevDownload = (user && user.download_speed != null) ? Number(user.download_speed) : 5120;
    const nextUpload = (best.upload_speed != null) ? Number(best.upload_speed) : null;
    const nextDownload = (best.download_speed != null) ? Number(best.download_speed) : null;
    let uploadSpeed = (nextUpload != null && nextUpload > prevUpload) ? nextUpload : prevUpload;
    let downloadSpeed = (nextDownload != null && nextDownload > prevDownload) ? nextDownload : prevDownload;

    // Check for Sub-Vendo Device specific bandwidth settings
    if (clientId && Number.isInteger(Number(clientId))) {
        try {
             const svDevice = db.prepare('SELECT download_speed, upload_speed FROM sub_vendo_devices WHERE id = ?').get(clientId);
             if (svDevice) {
                 if (svDevice.download_speed != null) downloadSpeed = svDevice.download_speed;
                 if (svDevice.upload_speed != null) uploadSpeed = svDevice.upload_speed;
             }
        } catch (e) {
             console.error('Error fetching sub-vendo device settings:', e);
        }
    }

    // Resolve Interface
    let iface = null;
    if (ip) {
        iface = await networkService.getInterfaceForIp(ip);
    }

    if (user) {
        db.prepare(`
            UPDATE users 
            SET time_remaining = time_remaining + ?, 
                total_time = total_time + ?,
                points_balance = points_balance + ?,
                upload_speed = COALESCE(?, upload_speed), 
                download_speed = COALESCE(?, download_speed), 
                is_paused = 0,
                user_code = COALESCE(user_code, ?),
                ip_address = COALESCE(?, ip_address),
                client_id = ?,
                is_connected = 1,
                last_active_at = CURRENT_TIMESTAMP,
                last_traffic_at = CURRENT_TIMESTAMP,
                interface = COALESCE(?, interface)
            WHERE id = ?
        `).run(secondsToAdd, secondsToAdd, pointsEarned, uploadSpeed, downloadSpeed, userCode, ip, clientId, iface, user.id);
    } else {
        db.prepare(`
            INSERT INTO users (mac_address, ip_address, client_id, time_remaining, total_time, points_balance, upload_speed, download_speed, is_paused, is_connected, user_code, last_active_at, last_traffic_at, interface) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)
        `).run(mac, ip, clientId, secondsToAdd, secondsToAdd, pointsEarned, uploadSpeed, downloadSpeed, userCode, iface);
    }

    await networkService.allowUser(mac, ip);
    if (ip) await bandwidthService.setLimit(ip, downloadSpeed, uploadSpeed);

    io.emit('user_code_generated', { mac, code: userCode });
    // Emit points update if points were earned
    if (pointsEarned > 0) {
        io.emit('points_earned', { mac, points: pointsEarned, total: (user ? user.points_balance : 0) + pointsEarned });
    }
    io.emit('coin_finalized', { mac, amount, secondsAdded: secondsToAdd, reason });
    return { success: true, amount, minutesAdded: minutesToAdd, secondsAdded: secondsToAdd, pointsEarned };
}

// Helper: Calculate best time for a given amount using available rates
function calculateTimeFromRates(amount, deviceId = null) {
    try {
        // 1. Get all rates sorted by amount DESC (highest first), then minutes DESC (best value first)
        // We cast to INTEGER to ensure numerical sorting even if stored as strings
        let rates;
        let useDeviceRates = false;

        if (deviceId && Number.isInteger(Number(deviceId))) {
             // Check if the device has specific rate configuration
             const hasRates = db.prepare('SELECT 1 FROM sub_vendo_device_rates WHERE device_id = ? LIMIT 1').get(deviceId);
             if (hasRates) {
                 useDeviceRates = true;
             }
        }

        if (useDeviceRates) {
            rates = db.prepare(`
                SELECT r.* 
                FROM rates r
                JOIN sub_vendo_device_rates svr ON r.id = svr.rate_id
                WHERE svr.device_id = ? AND svr.visible = 1
                ORDER BY CAST(r.amount AS INTEGER) DESC, r.minutes DESC
            `).all(deviceId);
        } else {
            rates = db.prepare('SELECT * FROM rates ORDER BY CAST(amount AS INTEGER) DESC, minutes DESC').all();
        }
        
        let remainingAmount = amount;
        let totalMinutes = 0;
        let maxRateUsed = null;
        
        // 2. Greedy approach: match largest denominations first
        for (const rate of rates) {
            if (remainingAmount >= rate.amount) {
                const count = Math.floor(remainingAmount / rate.amount);
                totalMinutes += count * rate.minutes;
                remainingAmount -= count * rate.amount;
                
                if (!maxRateUsed) maxRateUsed = rate; // Capture properties of the largest rate used
            }
        }
        
        // 3. Fallback for any remainder
        if (remainingAmount > 0) {
            const baseRate = rates.find(r => r.amount === 1);
            if (baseRate) {
                totalMinutes += remainingAmount * baseRate.minutes;
                if (!maxRateUsed) maxRateUsed = baseRate;
            }
        }

        return {
            minutes: totalMinutes,
            upload_speed: maxRateUsed ? maxRateUsed.upload_speed : null,
            download_speed: maxRateUsed ? maxRateUsed.download_speed : null
        };
    } catch (err) {
        console.error('Error calculating rates:', err);
        return { minutes: 0, upload_speed: null, download_speed: null };
    }
}

// Helper: Calculate best time for a given points amount
function calculateTimeFromPointRates(points) {
    try {
        const rates = db.prepare('SELECT * FROM point_rates ORDER BY points DESC').all();
        
        let remainingPoints = points;
        let totalSeconds = 0;
        let maxRateUsed = null;
        
        // Greedy approach
        for (const rate of rates) {
            if (remainingPoints >= rate.points) {
                const count = Math.floor(remainingPoints / rate.points);
                const duration = (rate.duration && rate.duration > 0) ? rate.duration : (rate.minutes * 60);
                
                totalSeconds += count * duration;
                remainingPoints -= count * rate.points;
                
                if (!maxRateUsed) maxRateUsed = rate;
            }
        }
        
        return {
            seconds: totalSeconds,
            minutes: Math.floor(totalSeconds / 60),
            upload_speed: maxRateUsed ? maxRateUsed.upload_speed : null,
            download_speed: maxRateUsed ? maxRateUsed.download_speed : null
        };
    } catch (err) {
        console.error('Error calculating point rates:', err);
        return { minutes: 0, upload_speed: null, download_speed: null };
    }
}

async function controlSubVendoRelay(ip, state, activeState = 'LOW') {
    return new Promise((resolve, reject) => {
        // ESP8266 Logic (Fixed Firmware):
        // The firmware now handles Active HIGH/LOW logic internally.
        // We just send 'on' or 'off' command, and the firmware translates it based on config.
        
        const command = state;
        // Ensure activeState is valid (default to LOW if null/undefined/empty)
        const finalActiveState = activeState || 'LOW';
        
        // We also send activeState to ensure firmware is in sync immediately.
        
        const req = http.get(`http://${ip}/relay?state=${command}&activeState=${finalActiveState}`, (res) => {
            if (res.statusCode === 200) {
                console.log(`[SubVendo] Relay ${state} (Active: ${finalActiveState}, Cmd: ${command}) for ${ip} success`);
                resolve(true);
            } else {
                console.error(`[SubVendo] Relay ${state} for ${ip} failed: ${res.statusCode}`);
                reject(new Error(`Status ${res.statusCode}`));
            }
        });
        req.on('error', (e) => {
            console.error(`[SubVendo] Relay ${state} for ${ip} error:`, e.message);
            reject(e);
        });
        req.setTimeout(5000, () => {
            req.abort();
            reject(new Error('Timeout'));
        });
    });
}

async function handleCoinPulseEvent(pulseCount, source) {
    const pulses = Number(pulseCount) || 0;
    if (pulses <= 0) return;

    io.emit('coin_pulse', { pulses, source });

    const sessionKey = source || 'hardware';
    const session = coinSessions.get(sessionKey);

    if (session) {
        const mode = session.selectionMode || configService.get('vendo_selection_mode') || 'auto';
        if (mode === 'manual' && session.targetDeviceId) {
            if (source !== session.targetDeviceId) {
                console.log(`[Coin] Ignored pulse from ${source} (Target: ${session.targetDeviceId})`);
                return;
            }
        }

        session.lastSource = source || session.lastSource || 'hardware';
        session.pendingAmount += pulses;

        const src = source || 'hardware';
        if (!session.sourceAmounts) session.sourceAmounts = {};
        if (!session.sourceAmounts[src]) session.sourceAmounts[src] = 0;
        session.sourceAmounts[src] += pulses;

        const totalAmount = session.pendingAmount;

        const best = calculateTimeFromRates(totalAmount, session.clientId);
        const minutes = best.minutes;
        session.pendingMinutes = minutes;

        console.log(`[Coin] ${source || 'unknown'} | User ${session.mac} | Total: P${totalAmount} | Time: ${minutes} mins`);

        io.emit('coin_pending_update', {
            mac: session.mac,
            amount: totalAmount,
            minutes: minutes
        });

        if (session.timeout) clearTimeout(session.timeout);
        session.timeout = setTimeout(() => {
            finalizeCoinSession(sessionKey, 'timeout').catch(e => console.error('[Coin] Finalize error:', e));
        }, 30000);
    } else {
        console.log(`[Coin] ${source || 'unknown'} pulse ignored: No user in Insert Coin mode`);
    }
}

coinService.on('coin', async (pulseCount) => {
    console.log(`Hardware Coin Event: ${pulseCount} pulses`);
    await handleCoinPulseEvent(pulseCount, 'hardware');
});

// Middleware: Check Session & Seamless Reconnection
app.use(async (req, res, next) => {
    if (req.path.startsWith('/public') || req.path.startsWith('/socket.io')) return next();

    let clientId = req.cookies.client_id;
    if (!clientId) {
        clientId = generateClientId();
        res.cookie('client_id', clientId, { maxAge: 30 * 24 * 60 * 60 * 1000 });
    }

    const clientIp = getClientIp(req);
    const macRaw = await networkService.getMacFromIp(clientIp);
    const mac = formatMac(macRaw);

    // Try to find user by Client ID or MAC
    let user = null;
    
    // 1. Check Cookie (Strongest persistent identifier for roaming)
    if (clientId) {
        user = db.prepare('SELECT * FROM users WHERE client_id = ?').get(clientId);
        
        // Handle MAC Randomization / Roaming
        // If we found a user by cookie, but their MAC has changed (and is valid)
        if (user && mac && user.mac_address !== mac) {
            console.log(`[Roaming] User ${user.id} changed MAC from ${user.mac_address} to ${mac}`);
            
            // Check if the new MAC is already in use by another ACTIVE user
            const existingMacUser = db.prepare('SELECT * FROM users WHERE mac_address = ?').get(mac);
            
            if (existingMacUser && existingMacUser.id !== user.id && existingMacUser.time_remaining > 0) {
                 // Conflict: New MAC belongs to another active user.
                 // Trust the MAC over the cookie in this rare case.
                 console.log(`[Roaming] Conflict: MAC ${mac} belongs to another active user. Switching to that user.`);
                 user = existingMacUser;
            } else {
                 // No conflict (or target is inactive), so we claim the MAC for the Cookie user.
                 
                 // 1. Remove old MAC authorization (clean up)
                 await networkService.blockUser(user.mac_address);
                 
                 // 2. If the new MAC was pointing to a stale user record, clear it to avoid unique constraint error
                 if (existingMacUser) {
                      db.prepare('DELETE FROM users WHERE id = ?').run(existingMacUser.id);
                 }
                 
                 // 3. Update current user to new MAC
                 db.prepare('UPDATE users SET mac_address = ? WHERE id = ?').run(mac, user.id);
                 user.mac_address = mac;
            }
        }
    }

    // 2. Fallback to MAC lookup if no cookie user found
    if (!user && mac) {
        user = db.prepare('SELECT * FROM users WHERE mac_address = ?').get(mac);
        // Case-insensitive check
        if (!user) {
             const caseUser = db.prepare('SELECT * FROM users WHERE lower(mac_address) = lower(?)').get(mac);
             if (caseUser) {
                 // Fix casing in DB
                 db.prepare('UPDATE users SET mac_address = ? WHERE id = ?').run(mac, caseUser.id);
                 user = { ...caseUser, mac_address: mac };
             }
        }
        
        // Auto-link Device ID (Cookie) to User if missing
        // This ensures existing users get linked to their device ID for future roaming
        if (user && clientId && user.client_id !== clientId) {
             console.log(`[Session] Linking User ${user.id} (MAC: ${mac}) to Device ID: ${clientId}`);
             db.prepare('UPDATE users SET client_id = ? WHERE id = ?').run(clientId, user.id);
             user.client_id = clientId;
        }
    }

    if (!mac) {
        console.warn(`[Warning] Could not detect MAC address for IP: ${clientIp}`);
    }

    // Logic: If user exists, has time, AND is not paused
    if (user) {
        req.user = user; // Always attach user so API can return status (even if paused/expired)

        if (user.time_remaining > 0 && user.is_paused === 0) {
            // Initialize session_expiry if not set
            if (!user.session_expiry) {
                const sessionTimeoutMinutes = Number(configService.get('session_timeout_minutes')) || 30; // Default 30 minutes
                const expiryDate = new Date(Date.now() + sessionTimeoutMinutes * 60000);
                // SQLite DATETIME format: YYYY-MM-DD HH:MM:SS
                const expiryStr = expiryDate.toISOString().replace('T', ' ').slice(0, 19);
                db.prepare('UPDATE users SET session_expiry = ? WHERE id = ?').run(expiryStr, user.id);
            }

            const isNewAuth = await networkService.allowUser(user.mac_address);
            
            // Apply bandwidth limit if newly authorized or IP changed
            if (isNewAuth || user.ip_address !== clientIp) {
                 if (user.ip_address && user.ip_address !== clientIp) {
                     await bandwidthService.removeLimit(user.ip_address);
                 }
                 await bandwidthService.setLimit(clientIp, user.download_speed, user.upload_speed);
            }
            
            // Sync IP if changed
            if (user.ip_address !== clientIp) {
                // Safety: Clear this IP from any other users to prevent duplicates
                db.prepare('UPDATE users SET ip_address = NULL WHERE ip_address = ? AND id != ?').run(clientIp, user.id);
                
                // Update interface
                const newIface = await networkService.getInterfaceForIp(clientIp);
                
                // Update current user
                db.prepare('UPDATE users SET ip_address = ?, interface = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(clientIp, newIface, user.id);
            }
            
            // Mark user connected in DB to reflect live status
            if (user.is_connected === 0) {
                db.prepare('UPDATE users SET is_connected = 1, is_paused = 0, updated_at = CURRENT_TIMESTAMP, last_active_at = CURRENT_TIMESTAMP, last_traffic_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
                user.is_connected = 1;
                user.is_paused = 0;
            }
        } else {
            // If paused or no time, ensure blocked
            await networkService.blockUser(user.mac_address);
            
            // Only disconnect if time is up (preserve Connected status if just Paused)
            if (user.time_remaining <= 0) {
                if (user.is_connected !== 0) {
                    db.prepare('UPDATE users SET is_connected = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
                    user.is_connected = 0;
                }
            }
        }
    }

    req.clientId = clientId;
    req.macAddress = mac;
    next();
});

// --- Points Redemption API ---
app.post('/api/points/redeem', async (req, res) => {
    const user = req.user;
    const { points } = req.body;
    
    if (!user) return res.status(401).json({ error: 'User not identified' });
    
    const pointsToRedeem = Number(points);
    if (!pointsToRedeem || pointsToRedeem <= 0) return res.status(400).json({ error: 'Invalid points amount' });
    
    if ((user.points_balance || 0) < pointsToRedeem) {
        return res.status(400).json({ error: 'Insufficient points balance' });
    }
    
    try {
        const result = calculateTimeFromPointRates(pointsToRedeem);
        if (result.seconds <= 0) {
             return res.status(400).json({ error: 'Not enough points for any reward' });
        }
        
        const secondsToAdd = result.seconds;
        
        const prevUpload = (user.upload_speed != null) ? Number(user.upload_speed) : 1024;
        const prevDownload = (user.download_speed != null) ? Number(user.download_speed) : 5120;
        const nextUpload = (result.upload_speed != null) ? Number(result.upload_speed) : null;
        const nextDownload = (result.download_speed != null) ? Number(result.download_speed) : null;
        
        const finalUpload = (nextUpload != null && nextUpload > prevUpload) ? nextUpload : prevUpload;
        const finalDownload = (nextDownload != null && nextDownload > prevDownload) ? nextDownload : prevDownload;
        
        db.prepare(`
            UPDATE users 
            SET points_balance = points_balance - ?,
                time_remaining = time_remaining + ?,
                total_time = total_time + ?,
                upload_speed = COALESCE(?, upload_speed),
                download_speed = COALESCE(?, download_speed),
                is_connected = 1,
                is_paused = 0,
                last_active_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(pointsToRedeem, secondsToAdd, secondsToAdd, finalUpload, finalDownload, user.id);
        
        // Re-apply limits
        if (user.ip_address) {
             await bandwidthService.setLimit(user.ip_address, finalDownload, finalUpload);
             await networkService.allowUser(user.mac_address, user.ip_address);
        }
        
        const remaining = (user.points_balance || 0) - pointsToRedeem;
        
        // Emit update
        io.emit('points_redeemed', { 
            mac: user.mac_address, 
            redeemed: pointsToRedeem, 
            remaining: remaining,
            minutesAdded: result.minutes
        });
        
        res.json({ success: true, remaining_points: remaining, minutes_added: result.minutes });
        
    } catch (e) {
        console.error('Redemption Error:', e);
        res.status(500).json({ error: 'Redemption failed' });
    }
});

// --- Socket.IO ---
io.on('connection', (socket) => {
    socket.on('disconnect', () => {});

    // --- Chat Events ---
    socket.on('join_chat', ({ mac, id, type }) => {
        const chatKey = id || mac;
        if (!chatKey) return;
        
        const enabledSetting = configService.get('chat_enabled');
        const enabled = enabledSetting !== false && enabledSetting !== 'false';

        if (!enabled) {
             socket.emit('chat_status', { enabled: false });
             return;
        }
        
        socket.emit('chat_status', { enabled: true });
        const room = `chat_${chatKey}`;
        socket.join(room);
        console.log(`Socket ${socket.id} joined room ${room}`);
        
        // Send history
        try {
            const history = chatService.getMessages(chatKey, 50, type);
            socket.emit('chat_history', history);
        } catch (e) {
            console.error('Error fetching chat history:', e);
        }
    });

    socket.on('send_message', ({ mac, id, message, type }) => {
        const chatKey = id || mac;
        if (!chatKey || !message) return;
        
        const enabledSetting = configService.get('chat_enabled');
        const enabled = enabledSetting !== false && enabledSetting !== 'false';

        if (!enabled) return;

        try {
            chatService.saveMessage(chatKey, message, false, type || 'hotspot'); // isFromAdmin = false
            
            const msgObj = {
                sender: 'user',
                message: message,
                timestamp: new Date(),
                chat_type: type || 'hotspot'
            };

            // Emit to the room (user sees it)
            io.to(`chat_${chatKey}`).emit('new_message', msgObj);
            
            // Notify admins
            io.emit('admin_new_message', {
                mac: chatKey,
                ...msgObj,
                unread_count: 1 
            });

        } catch (e) {
            console.error('Chat save error:', e);
        }
    });

    socket.on('admin_join_chat', ({ mac, id }) => {
        const chatKey = id || mac;
        const room = `chat_${chatKey}`;
        socket.join(room);
        chatService.markAsRead(chatKey);
        console.log(`Admin ${socket.id} joined room ${room}`);
    });

    socket.on('admin_send_message', ({ mac, id, message, type }) => {
        const chatKey = id || mac;
        if (!chatKey || !message) return;
        try {
            chatService.saveMessage(chatKey, message, true, type || 'hotspot'); // isFromAdmin = true
            
            io.to(`chat_${chatKey}`).emit('new_message', {
                sender: 'admin',
                message: message,
                timestamp: new Date(),
                chat_type: type || 'hotspot'
            });
        } catch (e) {
            console.error('Admin chat save error:', e);
        }
    });
});

// --- Auth Helper ---
function isAuthenticated(req, res, next) {
    // Debug Auth
    // console.log(`[Auth Check] Path: ${req.path}`);
    // console.log(`[Auth Check] Cookie: ${req.cookies.admin_session}`);
    // console.log(`[Auth Check] Token:  ${currentAdminSessionToken}`);
    
    if (req.cookies.admin_session && req.cookies.admin_session === currentAdminSessionToken) {
        return next();
    }
    console.warn(`[Auth Check] Failed for ${req.path}. Client sent: ${req.cookies.admin_session ? 'Invalid Cookie' : 'No Cookie'}`);
    res.status(401).json({ error: 'Unauthorized' });
}

// --- Routes ---

// 0. Admin Auth
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
    
    // Simple check (In production use bcrypt.compare)
    if (admin && admin.password_hash === password) {
        logService.info('SYSTEM', `Admin login successful (User: ${username})`);
        
        // Generate new persistent token
        const newToken = crypto.randomBytes(32).toString('hex');
        db.prepare('UPDATE admins SET session_token = ? WHERE id = 1').run(newToken);
        currentAdminSessionToken = newToken;

        res.cookie('admin_session', currentAdminSessionToken, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });
        res.json({ success: true });
    } else {
        logService.warn('SYSTEM', `Admin login failed (User: ${username})`);
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

app.post('/api/auth/logout', (req, res) => {
    logService.info('SYSTEM', 'Admin logout');
    res.clearCookie('admin_session');
    res.json({ success: true });
});

const resetTokens = new Map(); // Token -> Expiry Timestamp

app.get('/api/auth/security-question', (req, res) => {
    try {
        let admin = db.prepare('SELECT security_question FROM admins WHERE id = 1').get();
        
        // Self-healing: If no question, set default
        if (!admin || !admin.security_question) {
            console.log('No security question found. Seeding default...');
            db.prepare('UPDATE admins SET security_question = ?, security_answer = ? WHERE id = 1')
              .run('What is the name of your first pet?', 'admin');
            admin = { security_question: 'What is the name of your first pet?' };
        }

        if (admin && admin.security_question) {
            res.json({ hasQuestion: true, question: admin.security_question });
        } else {
            // Should not happen due to self-healing
            res.json({ hasQuestion: false });
        }
    } catch (e) {
        console.error('Error fetching security question:', e);
        res.status(500).json({ error: 'Failed to fetch security question' });
    }
});

app.post('/api/auth/verify-security', (req, res) => {
    const { answer } = req.body;
    try {
        const admin = db.prepare('SELECT security_answer FROM admins WHERE id = 1').get();
        if (!admin || !admin.security_answer) {
            return res.status(400).json({ error: 'No security question configured' });
        }

        if (admin.security_answer.toLowerCase().trim() === answer.toLowerCase().trim()) {
            const token = crypto.randomBytes(32).toString('hex');
            resetTokens.set(token, Date.now() + 300000); // 5 minutes validity
            logService.info('SYSTEM', 'Security question verified successfully');
            res.json({ success: true, token });
        } else {
            logService.warn('SYSTEM', 'Security question verification failed');
            res.status(401).json({ error: 'Wrong answer' });
        }
    } catch (e) {
        logService.error('SYSTEM', `Security verification error: ${e.message}`);
        res.status(500).json({ error: 'Verification failed' });
    }
});

app.post('/api/auth/reset-credentials', (req, res) => {
    const { token, username, password, security_question, security_answer } = req.body;
    
    if (!resetTokens.has(token) || resetTokens.get(token) < Date.now()) {
        logService.warn('SYSTEM', 'Password reset attempt with invalid/expired token');
        return res.status(401).json({ error: 'Invalid or expired reset token' });
    }

    if (!username || !password || !security_question || !security_answer) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    try {
        db.prepare(`
            UPDATE admins 
            SET username = ?, password_hash = ?, security_question = ?, security_answer = ? 
            WHERE id = 1
        `).run(username, password, security_question, security_answer);
        
        resetTokens.delete(token); // Consume token
        logService.critical('SYSTEM', `Admin credentials reset via security question (New User: ${username})`);
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        logService.error('SYSTEM', `Failed to reset credentials: ${e.message}`);
        res.status(500).json({ error: 'Failed to reset credentials' });
    }
});

// Logs API
app.get('/api/logs', isAuthenticated, async (req, res) => {
    const { source, limit } = req.query;
    const limitVal = parseInt(limit) || 100;
    try {
        let logs = [];
        switch (source) {
            case 'pppoe':
                logs = await logService.getPppoeLogs(limitVal);
                break;
            case 'hotspot':
                logs = logService.getHotspotLogs(limitVal);
                break;
            case 'vouchers':
                logs = logService.getVoucherLogs(limitVal);
                break;
            case 'errors':
                logs = logService.getCriticalErrors(limitVal);
                break;
            case 'system':
            default:
                logs = logService.getSystemLogs(limitVal);
                break;
        }
        res.json(logs);
    } catch (e) {
        console.error("API Logs Error:", e);
        // Ensure we send a JSON response even on error
        res.status(500).json({ 
            error: "Failed to fetch logs", 
            message: e.message, 
            stack: process.env.NODE_ENV === 'development' ? e.stack : undefined 
        });
    }
});

// Chat APIs
app.get('/api/admin/chat/conversations', isAuthenticated, (req, res) => {
    try {
        const type = req.query.type || null;
        const convos = chatService.getAllConversations(type);
        res.json(convos);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/chat/history/:mac', isAuthenticated, (req, res) => {
    try {
        const history = chatService.getMessages(req.params.mac);
        // Mark as read when admin fetches full history
        chatService.markAsRead(req.params.mac);
        res.json(history);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- System Routes ---

// Get Admin Credentials (Safe)
app.get('/api/admin/security/credentials', isAuthenticated, (req, res) => {
    try {
        const admin = db.prepare('SELECT username, security_question, security_answer FROM admins WHERE id = 1').get();
        if (admin) {
            res.json(admin);
        } else {
            res.status(404).json({ error: 'Admin not found' });
        }
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to fetch credentials' });
    }
});

// Update Admin Credentials
app.post('/api/admin/security/credentials', isAuthenticated, (req, res) => {
    const { username, password, security_question, security_answer } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    
    try {
        let sql = 'UPDATE admins SET username = ?, password_hash = ?';
        const params = [username, password];

        if (security_question && security_answer) {
            sql += ', security_question = ?, security_answer = ?';
            params.push(security_question, security_answer);
        }

        sql += ' WHERE id = 1';
        db.prepare(sql).run(...params);
        
        logService.warn('SYSTEM', `Admin credentials updated (User: ${username})`);
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        logService.error('SYSTEM', `Failed to update credentials: ${e.message}`);
        res.status(500).json({ error: 'Failed to update credentials' });
    }
});

// System Maintenance
app.get('/api/admin/system/verify', isAuthenticated, async (req, res) => {
    try {
        const results = await systemService.verifyConfiguration();
        res.json(results);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/system/reboot', isAuthenticated, async (req, res) => {
    try {
        await systemService.reboot();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Company Settings API
app.get('/api/admin/system/company', isAuthenticated, async (req, res) => {
    try {
        const settings = await systemService.getCompanySettings();
        res.json(settings);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to get company settings' });
    }
});

app.post('/api/admin/system/company', isAuthenticated, async (req, res) => {
    try {
        const { company_name, company_contact, company_email, logo_base64 } = req.body;
        const data = { company_name, company_contact, company_email };

        if (logo_base64) {
            // Decode and save image
            const matches = logo_base64.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
                const type = matches[1];
                const buffer = Buffer.from(matches[2], 'base64');
                const filename = `custom_logo_${Date.now()}.${type === 'jpeg' ? 'jpg' : type}`;
                const publicPath = path.join(__dirname, '../public');
                const filePath = path.join(publicPath, 'uploads', filename);
                
                // Ensure uploads dir exists
                if (!fs.existsSync(path.join(publicPath, 'uploads'))) {
                    fs.mkdirSync(path.join(publicPath, 'uploads'), { recursive: true });
                }

                fs.writeFileSync(filePath, buffer);
                data.company_logo = `/uploads/${filename}`;
            }
        }

        await systemService.saveCompanySettings(data);
        res.json({ success: true, ...data });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to save company settings' });
    }
});

// Hostname Management
app.get('/api/admin/system/hostname', isAuthenticated, (req, res) => {
    try {
        const hostname = require('os').hostname();
        res.json({ hostname });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/system/hostname', isAuthenticated, async (req, res) => {
    try {
        const { hostname } = req.body;
        if (!hostname || !/^[a-zA-Z0-9-]+$/.test(hostname)) {
            return res.status(400).json({ error: "Invalid hostname format" });
        }
        
        const scriptPath = path.join(__dirname, 'scripts', 'set_hostname.sh');
        await networkService.runCommand(`bash "${scriptPath}" "${hostname}"`);
        
        res.json({ success: true, message: "Hostname updated successfully. Reboot recommended." });
    } catch (e) {
        console.error("Set Hostname Error:", e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/system/reset', isAuthenticated, async (req, res) => {
    try {
        await systemService.factoryReset();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/system/create-update', isAuthenticated, async (req, res) => {
    try {
        const filePath = await systemService.createUpdatePackage();
        res.download(filePath, (err) => {
            if (!err) {
                try { fs.unlinkSync(filePath); } catch(e) {} 
            }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/system/apply-update', isAuthenticated, async (req, res) => {
    try {
        const { fileData } = req.body;
        if (!fileData) throw new Error("No file data provided");
        
        // This might take a while, so we respond immediately or handle async?
        // Ideally we wait for extraction and restart trigger.
        await systemService.applyUpdatePackage(fileData);
        res.json({ success: true });
    } catch (e) {
        console.error("Update Error:", e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/system/upgrade', isAuthenticated, async (req, res) => {
    try {
        const { type } = req.body;
        await systemService.upgrade(type);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


app.post('/api/admin/system/restore', isAuthenticated, async (req, res) => {
    const { backup } = req.body || {};
    if (!backup) {
        return res.status(400).json({ error: 'Missing backup data' });
    }

    try {
        const base64Data = backup.replace(/^data:.*;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const restorePath = path.join(__dirname, 'database', 'restore-temp.sqlite');
        fs.writeFileSync(restorePath, buffer);

        await systemService.restoreFromBackup(restorePath);

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/system/backup', isAuthenticated, (req, res) => {
    try {
        const dbPath = path.join(__dirname, 'database', 'pisowifi.sqlite');
        if (!fs.existsSync(dbPath)) {
            return res.status(500).json({ error: 'Database file not found' });
        }

        const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
        const filename = `pisowifi-backup-${timestamp}.sqlite`;

        logService.info('SYSTEM', 'App data backup requested via Admin Panel');
        res.download(dbPath, filename, (err) => {
            if (err && !res.headersSent) {
                res.status(500).end();
            }
        });
    } catch (e) {
        if (!res.headersSent) {
            res.status(500).json({ error: e.message });
        }
    }
});

// 0.1 Dashboard Stats
app.get('/api/admin/dashboard', isAuthenticated, async (req, res) => {
    res.set('Cache-Control', 'no-store');

    const stats = {
        uptime: os.uptime(),
        load_avg: os.loadavg(),
        cpu_usage: await monitoringService.getCpuUsage(),
        memory: {
            total: os.totalmem(),
            free: os.freemem()
        },
        storage: await monitoringService.getDiskUsage(),
        cpu_temp: await hardwareService.getCpuTemp(),
        device_model: await hardwareService.getDeviceModel(),
        internet_connected: await monitoringService.checkInternet(),
        network_interfaces: await monitoringService.getInterfaceStats(),
        total_sales_today: db.prepare(`
            SELECT SUM(amount) as total
            FROM sales
            WHERE date(datetime(timestamp, '+8 hours')) = date('now', '+8 hours')
        `).get().total || 0,
        total_sales_week: db.prepare("SELECT SUM(amount) as total FROM sales WHERE date(datetime(timestamp, '+8 hours')) >= date('now', '+8 hours', '-7 days')").get().total || 0,
        total_sales_month: db.prepare("SELECT SUM(amount) as total FROM sales WHERE date(datetime(timestamp, '+8 hours')) >= date('now', '+8 hours', 'start of month')").get().total || 0,
        total_sales_year: db.prepare("SELECT SUM(amount) as total FROM sales WHERE date(datetime(timestamp, '+8 hours')) >= date('now', '+8 hours', 'start of year')").get().total || 0,
        clients_connected: db.prepare("SELECT COUNT(*) as c FROM users WHERE is_connected = 1 AND is_paused = 0 AND time_remaining > 0").get().c || 0,
        clients_paused: db.prepare("SELECT COUNT(*) as c FROM users WHERE is_paused = 1 AND time_remaining > 0").get().c || 0,
        clients_disconnected: db.prepare("SELECT COUNT(*) as c FROM users WHERE is_connected = 0 AND is_paused = 0 AND time_remaining > 0").get().c || 0,
        pppoe_online: db.prepare("SELECT COUNT(*) as c FROM pppoe_users WHERE current_ip IS NOT NULL AND current_ip != ''").get().c || 0,
        pppoe_offline: db.prepare("SELECT COUNT(*) as c FROM pppoe_users WHERE current_ip IS NULL OR current_ip = ''").get().c || 0,
        pppoe_expired: db.prepare("SELECT COUNT(*) as c FROM pppoe_users WHERE datetime(expiration_date) < datetime('now')").get().c || 0
    };
    res.json(stats);
});

// PPPoE Profiles API
app.get('/api/admin/pppoe/profiles', isAuthenticated, (req, res) => {
    try {
        const profiles = pppoeServerService.getProfiles();
        res.json(profiles);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/admin/pppoe/profiles', isAuthenticated, (req, res) => {
    try {
        const profile = pppoeServerService.addProfile(req.body);
        res.json({ success: true, profile });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.put('/api/admin/pppoe/profiles/:id', isAuthenticated, (req, res) => {
    try {
        const profile = pppoeServerService.updateProfile(req.params.id, req.body);
        res.json({ success: true, profile });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.delete('/api/admin/pppoe/profiles/:id', isAuthenticated, (req, res) => {
    try {
        pppoeServerService.deleteProfile(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// PPPoE Sales API
app.get('/api/admin/pppoe/sales', isAuthenticated, (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const sales = pppoeServerService.getSales(startDate, endDate);
        res.json(sales);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.delete('/api/admin/pppoe/sales/:id', isAuthenticated, (req, res) => {
    try {
        const result = pppoeServerService.deleteSale(req.params.id);
        res.json(result);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 0.1.5 Network Interfaces
app.get('/api/admin/network-interfaces', isAuthenticated, async (req, res) => {
    try {
        const interfaces = await monitoringService.getNetworkInterfaces();
        res.json(interfaces);
    } catch (error) {
        console.error("Error fetching interfaces:", error);
        res.status(500).json({ error: "Failed to fetch network interfaces" });
    }
});

// 0.1.6 Update WAN Interface
app.post('/api/admin/settings/wan', isAuthenticated, async (req, res) => {
    const { interface: iface } = req.body;
    if (!iface) return res.status(400).json({ error: 'Interface is required' });
    
    try {
        networkService.saveWanInterface(iface);
        res.json({ success: true, wan_interface: iface });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Portal Theme Configuration
app.get('/api/admin/portal/themes', isAuthenticated, (req, res) => {
    try {
        const publicDir = path.join(__dirname, '../public');
        if (fs.existsSync(publicDir)) {
            const files = fs.readdirSync(publicDir);
            const themes = files.filter(f => f.startsWith('portal') && f.endsWith('.html'));
            res.json({ themes, active: configService.get('portal_theme', 'portal.html') });
        } else {
            res.json({ themes: ['portal.html'], active: 'portal.html' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// System Time & NTP API
app.get('/api/admin/system/time', isAuthenticated, async (req, res) => {
    try {
        const settings = await systemService.getTimeSettings();
        res.json(settings);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/system/time', isAuthenticated, async (req, res) => {
    try {
        await systemService.saveTimeSettings(req.body);
        res.json({ success: true });
    } catch (e) {
        console.error('API Error /api/admin/system/time:', e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/system/timezones', isAuthenticated, async (req, res) => {
    try {
        const timezones = await systemService.getTimezones();
        res.json(timezones);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Logs API
app.get('/api/admin/logs/system', isAuthenticated, (req, res) => {
    try {
        const logs = logService.getSystemLogs();
        res.json(logs);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/logs/pppoe', isAuthenticated, async (req, res) => {
    try {
        const logs = await logService.getPppoeLogs();
        res.json(logs);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/logs/vouchers', isAuthenticated, (req, res) => {
    try {
        const logs = logService.getVoucherLogs();
        res.json(logs);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/logs/errors', isAuthenticated, (req, res) => {
    try {
        const logs = logService.getCriticalErrors();
        res.json(logs);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 0.2 Sales Reports
app.get('/api/admin/sales', isAuthenticated, (req, res) => {
    const type = req.query.type || 'daily'; // daily, weekly, monthly, yearly
    let query = "";
    
    if (type === 'daily') {
        query = `
            SELECT date(datetime(timestamp, '+8 hours')) as label, SUM(amount) as value
            FROM sales
            WHERE date(datetime(timestamp, '+8 hours')) >= date('now', '+8 hours', '-6 days')
              AND date(datetime(timestamp, '+8 hours')) <= date('now', '+8 hours')
            GROUP BY date(datetime(timestamp, '+8 hours'))
            ORDER BY label ASC
        `;
    } else if (type === 'weekly') {
        query = `SELECT strftime('%Y-W%W', datetime(timestamp, '+8 hours')) as label, SUM(amount) as value FROM sales 
                 WHERE date(datetime(timestamp, '+8 hours')) >= date('now', '+8 hours', '-84 days') 
                 GROUP BY strftime('%Y-W%W', datetime(timestamp, '+8 hours')) ORDER BY label ASC`;
    } else if (type === 'monthly') {
        query = `SELECT strftime('%Y-%m', datetime(timestamp, '+8 hours')) as label, SUM(amount) as value FROM sales 
                 WHERE date(datetime(timestamp, '+8 hours')) >= date('now', '+8 hours', '-12 months') 
                 GROUP BY strftime('%Y-%m', datetime(timestamp, '+8 hours')) ORDER BY label ASC`;
    } else if (type === 'yearly') {
        query = `SELECT strftime('%Y', datetime(timestamp, '+8 hours')) as label, SUM(amount) as value FROM sales 
                 WHERE date(datetime(timestamp, '+8 hours')) >= date('now', '+8 hours', '-5 years') 
                 GROUP BY strftime('%Y', datetime(timestamp, '+8 hours')) ORDER BY label ASC`;
    } else if (type === 'history') {
        // Full History (Limit 500 for performance)
        query = `SELECT * FROM sales ORDER BY timestamp DESC LIMIT 500`;
        const data = db.prepare(query).all();
        return res.json(data);
    }
    
    const data = db.prepare(query).all();
    res.json(data);
});

app.get('/api/admin/sales/by-device', isAuthenticated, (req, res) => {
    const type = req.query.type || 'daily';
    try {
        let rangeQuery = '';
        if (type === 'daily') {
            rangeQuery = `date(datetime(timestamp, '+8 hours')) = date('now', '+8 hours')`;
        } else if (type === 'weekly') {
            rangeQuery = `date(datetime(timestamp, '+8 hours')) >= date('now', '+8 hours', '-7 days')`;
        } else if (type === 'monthly') {
            rangeQuery = `date(datetime(timestamp, '+8 hours')) >= date('now', '+8 hours', 'start of month')`;
        } else if (type === 'yearly') {
            rangeQuery = `date(datetime(timestamp, '+8 hours')) >= date('now', '+8 hours', 'start of year')`;
        } else if (type === 'history') {
            rangeQuery = `1=1`;
        } else {
            return res.status(400).json({ error: 'Invalid type' });
        }

        // 1. Get all unique sources from sales (to capture legacy/unregistered) + 'hardware'
        const salesSources = db.prepare("SELECT DISTINCT COALESCE(source, 'hardware') as source FROM sales").all().map(s => s.source);
        
        // 2. Get all registered sub devices
        const subDevices = db.prepare('SELECT device_id, name, last_coins_out_at FROM sub_vendo_devices').all();
        const deviceInfoById = new Map(subDevices.map(d => [String(d.device_id), { name: d.name, last_coins_out_at: d.last_coins_out_at }]));
        
        // 3. Build Master Set of Sources
        const allSources = new Set(['hardware']);
        salesSources.forEach(s => allSources.add(s));
        subDevices.forEach(d => allSources.add(`subvendo:${d.device_id}`));

        // 4. Pre-fetch Aggregates
        // Total (Based on Filter)
        const totalRows = db.prepare(`
            SELECT COALESCE(source, 'hardware') AS source, SUM(amount) AS total
            FROM ${type === 'history' ? "(SELECT * FROM sales ORDER BY timestamp DESC LIMIT 500)" : "sales"}
            WHERE ${type === 'history' ? "1=1" : rangeQuery}
            GROUP BY COALESCE(source, 'hardware')
        `).all();
        const totalMap = new Map(totalRows.map(r => [String(r.source), Number(r.total) || 0]));

        // Daily (Always Today)
        const todayRows = db.prepare(`
            SELECT COALESCE(source, 'hardware') AS source, SUM(amount) AS daily
            FROM sales
            WHERE date(datetime(timestamp, '+8 hours')) = date('now', '+8 hours')
            GROUP BY COALESCE(source, 'hardware')
        `).all();
        const dailyMap = new Map(todayRows.map(r => [String(r.source), Number(r.daily) || 0]));

        const mainCoinsOutAt = configService.get('main_coins_out_at', null);
        const pendingStmt = db.prepare(`
            SELECT SUM(amount) AS pending FROM sales WHERE COALESCE(source, 'hardware') = ? AND (? IS NULL OR timestamp > ?)
        `);

        // 5. Build Result List
        const result = [];
        for (const source of allSources) {
            let name = source;
            let lastOut = null;
            let isHidden = false; // Optional: hide sources with no activity ever?

            if (source === 'hardware') {
                name = 'Main Vendo';
                lastOut = mainCoinsOutAt || null;
            } else if (source.startsWith('subvendo:')) {
                const deviceId = source.slice('subvendo:'.length);
                const info = deviceInfoById.get(deviceId);
                if (info) {
                    name = info.name || `ESP8266 ${deviceId}`;
                    lastOut = info.last_coins_out_at || null;
                } else {
                    // Unregistered subvendo found in sales
                    name = `Unregistered ${deviceId}`;
                }
            }

            const total = totalMap.get(source) || 0;
            const daily = dailyMap.get(source) || 0;
            const pendingRow = pendingStmt.get(source, lastOut, lastOut);
            const pending = (pendingRow && Number(pendingRow.pending)) || 0;

            // Optional: Filter out devices with absolutely zero data to reduce clutter? 
            // User requirement: "every sub vendo(esp8266) must have a Total..."
            // So we list all registered devices + any other source with non-zero metrics.
            const isRegistered = source === 'hardware' || (source.startsWith('subvendo:') && deviceInfoById.has(source.slice('subvendo:'.length)));
            const hasMetrics = total > 0 || daily > 0 || pending > 0;

            if (isRegistered || hasMetrics) {
                result.push({ source, name, total, daily, pending });
            }
        }
        
        // Sort by Total DESC
        result.sort((a, b) => b.total - a.total);

        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/sales/by-client', isAuthenticated, (req, res) => {
    const type = req.query.type || 'monthly';
    try {
        let rangeQuery = '';
        if (type === 'daily') {
            rangeQuery = `
                date(datetime(s.timestamp, '+8 hours')) = date('now', '+8 hours')
            `;
        } else if (type === 'weekly') {
            rangeQuery = `date(datetime(s.timestamp, '+8 hours')) >= date('now', '+8 hours', '-7 days')`;
        } else if (type === 'monthly') {
            rangeQuery = `date(datetime(s.timestamp, '+8 hours')) >= date('now', '+8 hours', 'start of month')`;
        } else if (type === 'yearly') {
            rangeQuery = `date(datetime(s.timestamp, '+8 hours')) >= date('now', '+8 hours', 'start of year')`;
        } else {
            return res.status(400).json({ error: 'Invalid type' });
        }

        const rows = db.prepare(`
            SELECT 
                MAX(s.mac_address) as mac_address,
                MAX(s.user_code) as user_code,
                MAX(u.alias) as alias,
                MAX(u.client_id) as client_id,
                COALESCE(SUM(s.amount), 0) as total
            FROM sales s
            LEFT JOIN users u ON (s.user_code IS NOT NULL AND s.user_code != '' AND u.user_code = s.user_code) 
                              OR ((s.user_code IS NULL OR s.user_code = '') AND u.mac_address = s.mac_address)
            WHERE (s.mac_address IS NOT NULL OR s.user_code IS NOT NULL) AND ${rangeQuery}
            GROUP BY COALESCE(NULLIF(s.user_code, ''), s.mac_address)
            ORDER BY total DESC
            LIMIT 50
        `).all();

        res.json(rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/sales/coins-out', isAuthenticated, (req, res) => {
    console.log('[API] Coins Out Request:', req.body);
    try {
        const { source, amount, base, percent } = req.body || {};
        if (!source) return res.status(400).json({ error: 'source required' });
        const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

        let lastOut = null;
        if (source === 'hardware') {
            lastOut = configService.get('main_coins_out_at', null);
        } else if (source.startsWith('subvendo:')) {
            const deviceId = source.slice('subvendo:'.length);
            const info = db.prepare('SELECT last_coins_out_at FROM sub_vendo_devices WHERE device_id = ?').get(deviceId);
            lastOut = info ? info.last_coins_out_at : null;
        } else {
            lastOut = configService.get(`coins_out_at_${source}`, null);
        }

        const pendingRow = db.prepare(
            "SELECT SUM(amount) AS pending FROM sales WHERE COALESCE(source, 'hardware') = ? AND (? IS NULL OR timestamp > ?)"
        ).get(source, lastOut, lastOut);
        const pending = (pendingRow && Number(pendingRow.pending)) || 0;

        let baseAmount = Number(base);
        if (!Number.isFinite(baseAmount) || baseAmount <= 0 || baseAmount > pending) {
            baseAmount = pending;
        }

        let pctVal = Number(percent);
        if (!Number.isFinite(pctVal)) pctVal = 0;
        if (pctVal < 0) pctVal = 0;
        if (pctVal > 100) pctVal = 100;

        let loggedAmount = Number(amount);
        if (!Number.isFinite(loggedAmount) || loggedAmount <= 0 || loggedAmount > baseAmount) {
            loggedAmount = baseAmount - (baseAmount * (pctVal / 100));
        }
        if (loggedAmount > pending) loggedAmount = pending;

        db.prepare('INSERT INTO coins_out_logs (source, amount, base_amount, partner_percent, created_at) VALUES (?, ?, ?, ?, ?)').run(
            source,
            loggedAmount,
            baseAmount,
            pctVal,
            now
        );

        if (source === 'hardware') {
            configService.set('main_coins_out_at', now);
        } else if (source.startsWith('subvendo:')) {
            const deviceId = source.slice('subvendo:'.length);
            db.prepare('UPDATE sub_vendo_devices SET last_coins_out_at = ? WHERE device_id = ?').run(now, deviceId);
        } else {
            configService.set(`coins_out_at_${source}`, now);
        }
        res.json({ success: true, coins_out_at: now, amount: loggedAmount, pending, base_amount: baseAmount, partner_percent: pctVal });
    } catch (e) {
        console.error('[API] Coins Out Error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/sales/coins-out/logs', isAuthenticated, (req, res) => {
    try {
        const source = req.query.source;
        if (!source) return res.status(400).json({ error: 'source required' });
        const rows = db
            .prepare('SELECT id, source, amount, base_amount, partner_percent, created_at FROM coins_out_logs WHERE source = ? ORDER BY created_at DESC LIMIT 100')
            .all(source);
        res.json(rows);
    } catch (e) {
        console.error('[API] Coins Out Logs Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// 0.4 Settings
app.get('/api/admin/settings', isAuthenticated, (req, res) => {
    const allSettings = configService.getAll();
    const filteredSettings = { ...allSettings };
    const hiddenKeys = [
        'wan_interface', 
        'lan_interface', 
        'portal_port', 
        'temp_threshold', 
        'rate_1_peso', 
        'rate_5_peso', 
        'rate_10_peso'
    ];
    hiddenKeys.forEach(key => delete filteredSettings[key]);
    res.json(filteredSettings);
});

app.post('/api/admin/settings', isAuthenticated, (req, res) => {
    const settings = req.body; // Expect { key: value, ... }
    for (const [key, value] of Object.entries(settings)) {
        configService.set(key, value);
    }
    // Trigger re-init of services if needed
    coinService.initGpio();
    hardwareService.initRelay();
    res.json({ success: true });
});

// 0.4.1 Portal Configuration
app.get('/api/portal/config', (req, res) => {
    const rawFree = configService.get('portal_free_time_widget_enabled');
    const freeEnabled = rawFree === '1' || rawFree === 'true' || rawFree === true;
    
    // Scan slideshow images dynamically
    let slideshowImages = [];
    try {
        const slideDir = path.join(__dirname, '../public/slideshow');
        if (fs.existsSync(slideDir)) {
             slideshowImages = fs.readdirSync(slideDir).filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
        }
    } catch(e) {}

    const config = {
        container_max_width: configService.get('portal_container_width'),
        icon_size: configService.get('portal_icon_size'),
        status_icon_container_size: configService.get('portal_status_icon_container_size'),
        banner_height: configService.get('portal_banner_height'),
        banner_version: configService.get('portal_banner_version') || Date.now(),
        banner_filename: configService.get('portal_banner_filename'),
        use_default_banner: configService.get('portal_use_default_banner', true),
        default_banner_file: configService.get('portal_default_banner_file', 'op-banner.png'),
        hide_voucher_code: configService.get('portal_hide_voucher_code'),
        banner_mode: configService.get('portal_banner_mode', 'fixed'), // fixed or slideshow
        slideshow_interval: configService.get('portal_slideshow_interval', 3000),
        slideshow_images: slideshowImages, // Use dynamic list
        free_time_widget_enabled: freeEnabled,
        footer_text: configService.get('portal_footer_text', ''),
        footer_link: configService.get('portal_footer_link', ''),
        theme: configService.get('portal_theme', 'portal.html'),
        ticker_text: configService.get('portal_ticker_text', 'Thank you for choosing our piso wifi hotspot services!'),
        ticker_enabled: configService.get('portal_ticker_enabled', false)
    };
    res.json(config);
});

// 0.5 PPPoE Server API
app.get('/api/admin/pppoe/config', isAuthenticated, (req, res) => {
    try {
        const config = pppoeServerService.getConfig();
        res.json(config);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/pppoe/config', isAuthenticated, (req, res) => {
    try {
        const config = pppoeServerService.saveConfig(req.body);
        res.json({ success: true, config });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/pppoe/users', isAuthenticated, (req, res) => {
    try {
        const users = pppoeServerService.getUsers();
        res.json(users);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/pppoe/users', isAuthenticated, (req, res) => {
    try {
        const user = pppoeServerService.addUser(req.body);
        res.json({ success: true, user });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/admin/pppoe/users/:id', isAuthenticated, (req, res) => {
    try {
        const user = pppoeServerService.updateUser(req.params.id, req.body);
        res.json({ success: true, user });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/admin/pppoe/users/:id', isAuthenticated, (req, res) => {
    try {
        pppoeServerService.deleteUser(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/pppoe/kick', isAuthenticated, (req, res) => {
    try {
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, error: 'User ID is required' });
        
        pppoeServerService.kickUser(id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/admin/pppoe/users/:id/renew', isAuthenticated, (req, res) => {
    try {
        const user = pppoeServerService.renewUser(req.params.id);
        res.json({ success: true, user });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/admin/portal-config', isAuthenticated, (req, res) => {
    const { 
        container_width, icon_size, status_container_size, banner_height, 
        use_default_banner, default_banner_file, hide_voucher_code,
        banner_mode, slideshow_interval, footer_text, footer_link, theme,
        ticker_text, ticker_enabled
    } = req.body;

    if (container_width) configService.set('portal_container_width', container_width);
    if (icon_size) configService.set('portal_icon_size', icon_size);
    if (status_container_size) configService.set('portal_status_icon_container_size', status_container_size);
    if (banner_height) configService.set('portal_banner_height', banner_height);
    if (default_banner_file) configService.set('portal_default_banner_file', default_banner_file);
    
    // New Settings
    if (banner_mode) configService.set('portal_banner_mode', banner_mode);
    if (slideshow_interval) configService.set('portal_slideshow_interval', Number(slideshow_interval));

    if (footer_text !== undefined) configService.set('portal_footer_text', footer_text);
    if (footer_link !== undefined) configService.set('portal_footer_link', footer_link);

    if (ticker_text !== undefined) configService.set('portal_ticker_text', ticker_text);
    configService.set('portal_ticker_enabled', !!ticker_enabled);

    if (theme) {
        if (theme.startsWith('portal') && theme.endsWith('.html') && !theme.includes('/') && !theme.includes('\\')) {
             configService.set('portal_theme', theme, 'portal');
        }
    }

    // Boolean setting
    configService.set('portal_use_default_banner', !!use_default_banner);
    configService.set('portal_hide_voucher_code', !!hide_voucher_code);
    
    res.json({ success: true });
});

// --- Portal Templates ---
app.post('/api/admin/portal-templates', isAuthenticated, (req, res) => {
    try {
        const { name, config } = req.body;
        if (!name || !config) return res.status(400).json({ success: false, error: 'Name and config are required' });

        const stmt = db.prepare('INSERT INTO portal_templates (name, config) VALUES (?, ?)');
        const result = stmt.run(name, JSON.stringify(config));
        
        res.json({ success: true, id: result.lastInsertRowid });
    } catch (e) {
        if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(400).json({ success: false, error: 'Template name already exists' });
        }
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/admin/portal-templates', isAuthenticated, (req, res) => {
    try {
        const templates = db.prepare('SELECT id, name, created_at FROM portal_templates ORDER BY created_at DESC').all();
        res.json(templates);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/admin/portal-templates/:id', isAuthenticated, (req, res) => {
    try {
        const template = db.prepare('SELECT * FROM portal_templates WHERE id = ?').get(req.params.id);
        if (!template) return res.status(404).json({ success: false, error: 'Template not found' });
        
        template.config = JSON.parse(template.config);
        res.json(template);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.delete('/api/admin/portal-templates/:id', isAuthenticated, (req, res) => {
    try {
        const result = db.prepare('DELETE FROM portal_templates WHERE id = ?').run(req.params.id);
        if (result.changes === 0) return res.status(404).json({ success: false, error: 'Template not found' });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/admin/points-config', isAuthenticated, (req, res) => {
    const { points_earning_rate } = req.body;
    
    if (points_earning_rate !== undefined) {
        configService.set('points_earning_rate', Number(points_earning_rate));
    }
    
    res.json({ success: true });
});

app.get('/api/admin/points-config', isAuthenticated, (req, res) => {
    const rate = configService.get('points_earning_rate') || 0;
    res.json({ points_earning_rate: rate });
});

// --- Slideshow Management ---

app.get('/api/admin/slideshow-images', isAuthenticated, (req, res) => {
    try {
        // Source of truth: File System
        const slideDir = path.join(__dirname, '../public/slideshow');
        if (!fs.existsSync(slideDir)) {
            fs.mkdirSync(slideDir, { recursive: true });
            return res.json([]);
        }

        const files = fs.readdirSync(slideDir);
        // Filter for images
        const images = files.filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
        
        // Update config to match FS (optional, but keeps sync)
        configService.set('portal_slideshow_images', images);

        res.json(images);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/upload-slideshow-image', isAuthenticated, (req, res) => {
    const { image, type } = req.body;
    if (!image || !type) return res.status(400).json({ error: 'Missing image data' });

    try {
        const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, 'base64');
        const ext = type === 'image/png' ? 'png' : 'jpg';
        const filename = `slide-${Date.now()}.${ext}`;
        
        // Ensure directory exists
        const slideDir = path.join(__dirname, '../public/slideshow');
        if (!fs.existsSync(slideDir)) {
            fs.mkdirSync(slideDir, { recursive: true });
        }

        const filepath = path.join(slideDir, filename);
        fs.writeFileSync(filepath, buffer);

        // Update Config List
        const images = configService.get('portal_slideshow_images', []);
        images.push(filename);
        configService.set('portal_slideshow_images', images);

        res.json({ success: true, filename });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to save slide' });
    }
});

app.delete('/api/admin/slideshow-image/:filename', isAuthenticated, (req, res) => {
    const filename = req.params.filename;
    try {
        // Remove from disk
        const filepath = path.join(__dirname, '../public/slideshow', filename);
        if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
        }

        // Remove from config
        let images = configService.get('portal_slideshow_images', []);
        images = images.filter(img => img !== filename);
        configService.set('portal_slideshow_images', images);

        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to delete slide' });
    }
});

app.post('/api/admin/upload-banner', isAuthenticated, (req, res) => {
    const { image, type } = req.body;
    if (!image || !type) return res.status(400).json({ error: 'Missing image data' });
    
    try {
        const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, 'base64');
        const ext = type === 'image/png' ? 'png' : 'jpg';
        const filename = `custom-banner.${ext}`;
        const filepath = path.join(__dirname, '../public', filename);
        
        fs.writeFileSync(filepath, buffer);
        configService.set('portal_banner_version', Date.now()); // Force refresh
        configService.set('portal_banner_filename', filename);
        
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to save banner' });
    }
});


app.get('/api/admin/walled-garden', isAuthenticated, (req, res) => {
    try {
        const list = walledGardenService.getAll();
        res.json(list);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/walled-garden', isAuthenticated, async (req, res) => {
    const { domain, type } = req.body;
    if (!domain || !type) return res.status(400).json({ error: 'Domain and Type are required' });
    
    try {
        const entry = await walledGardenService.add(domain, type);
        res.json({ success: true, entry });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/admin/walled-garden/:id', isAuthenticated, (req, res) => {
    try {
        const success = walledGardenService.remove(req.params.id);
        res.json({ success });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- Sub Vendo API ---

// 1. Get Key
app.get('/api/admin/subvendo/key', isAuthenticated, (req, res) => {
    const key = configService.get('sub_vendo_key') || '';
    res.json({ key });
});

// 2. Set Key
app.post('/api/admin/subvendo/key', isAuthenticated, (req, res) => {
    const { key } = req.body;
    // Allow empty string to clear key
    configService.set('sub_vendo_key', key || '');
    res.json({ success: true });
});

// 2.1 Free Time Widget Toggle
app.get('/api/admin/subvendo/free-time-widget', isAuthenticated, (req, res) => {
    const raw = configService.get('portal_free_time_widget_enabled');
    const enabled = raw === '1' || raw === 'true' || raw === true;
    res.json({ enabled });
});

app.post('/api/admin/subvendo/free-time-widget', isAuthenticated, (req, res) => {
    const body = req.body || {};
    const enabled = !!body.enabled;
    configService.set('portal_free_time_widget_enabled', enabled ? '1' : '');
    res.json({ success: true, enabled });
});

// 3. List Devices
app.get('/api/admin/subvendo/devices', isAuthenticated, (req, res) => {
    try {
        const devices = db.prepare('SELECT * FROM sub_vendo_devices ORDER BY created_at DESC').all();
        const now = Date.now();
        // Calculate start of day in local time for daily sales
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayIso = today.toISOString(); // Note: sales timestamp is usually UTC/ISO

        const enrichedDevices = devices.map(d => {
            let online = false;
            if (d.last_active_at) {
                const raw = String(d.last_active_at);
                const parsedA = new Date(raw);
                const parsedB = new Date(raw.includes('T') ? raw : (raw.replace(' ', 'T') + 'Z'));
                const lastActive = isNaN(parsedA.getTime()) ? parsedB : parsedA;
                if (!isNaN(lastActive.getTime())) {
                    const diffMs = now - lastActive.getTime();
                    if (diffMs < SUB_VENDO_OFFLINE_AFTER_MS) online = true;
                }
            }

            // Sales Stats
            const source = `subvendo:${d.id}`;
            const totalSales = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM sales WHERE source = ?").get(source).total;
            
            const dailySales = db.prepare(`
                SELECT COALESCE(SUM(amount), 0) as total 
                FROM sales 
                WHERE source = ? AND date(datetime(timestamp, '+8 hours')) = date('now', '+8 hours')
            `).get(source).total;

            const lastCoinsOut = d.last_coins_out_at || '1970-01-01 00:00:00';
            const unCoinsOutSales = db.prepare(`
                SELECT COALESCE(SUM(amount), 0) as total 
                FROM sales 
                WHERE source = ? AND timestamp > ?
            `).get(source, lastCoinsOut).total;

            return {
                ...d,
                online,
                total_sales: totalSales,
                daily_sales: dailySales,
                uncoins_out_sales: unCoinsOutSales
            };
        });
        res.json(enrichedDevices);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 3.1 Coins Out
app.post('/api/admin/subvendo/devices/:id/coins-out', isAuthenticated, (req, res) => {
    try {
        const id = req.params.id;
        db.prepare("UPDATE sub_vendo_devices SET last_coins_out_at = datetime('now', 'localtime') WHERE id = ?").run(id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 4. Delete Device
app.delete('/api/admin/subvendo/devices/:id', isAuthenticated, (req, res) => {
    try {
        db.prepare('DELETE FROM sub_vendo_devices WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 4.1 Update Device
app.put('/api/admin/subvendo/devices/:id', isAuthenticated, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });

    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name : null;
    const description = typeof body.description === 'string' ? body.description : null;

    const asIntOrNull = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.trunc(n) : null;
    };

    const coinPin = asIntOrNull(body.coin_pin);
    const relayPin = asIntOrNull(body.relay_pin);
    const pesoPerPulse = asIntOrNull(body.peso_per_pulse);
    const downloadSpeed = asIntOrNull(body.download_speed);
    const uploadSpeed = asIntOrNull(body.upload_speed);
    const freeTimeSeconds = asIntOrNull(body.free_time_seconds);
    const freeTimeReclaimDays = asIntOrNull(body.free_time_reclaim_days);
    const freeTimeVlan = typeof body.free_time_vlan === 'string' ? body.free_time_vlan : null;
    const freeTimeEnabled = body.free_time_enabled == null ? null : (body.free_time_enabled ? 1 : 0);
    const freeTimeDownloadSpeed = asIntOrNull(body.free_time_download_speed);
    const freeTimeUploadSpeed = asIntOrNull(body.free_time_upload_speed);
    const relayPinActiveState = typeof body.relay_pin_active_state === 'string' ? body.relay_pin_active_state : null;

    if (coinPin != null && (coinPin < 0 || coinPin > 16)) return res.status(400).json({ error: 'Invalid coin pin' });
    if (relayPin != null && (relayPin < 0 || relayPin > 16)) return res.status(400).json({ error: 'Invalid relay pin' });
    if (pesoPerPulse != null && (pesoPerPulse < 1 || pesoPerPulse > 100)) return res.status(400).json({ error: 'Invalid vendo rate' });
    if (relayPinActiveState != null && !['HIGH', 'LOW'].includes(relayPinActiveState)) return res.status(400).json({ error: 'Invalid relay pin active state' });

    try {
        db.prepare(`
            UPDATE sub_vendo_devices
            SET name = COALESCE(?, name),
                description = COALESCE(?, description),
                coin_pin = COALESCE(?, coin_pin),
                relay_pin = COALESCE(?, relay_pin),
                peso_per_pulse = COALESCE(?, peso_per_pulse),
                download_speed = COALESCE(?, download_speed),
                upload_speed = COALESCE(?, upload_speed),
                free_time_seconds = COALESCE(?, free_time_seconds),
                free_time_reclaim_days = COALESCE(?, free_time_reclaim_days),
                free_time_vlan = COALESCE(?, free_time_vlan),
                free_time_enabled = COALESCE(?, free_time_enabled),
                free_time_download_speed = COALESCE(?, free_time_download_speed),
                free_time_upload_speed = COALESCE(?, free_time_upload_speed),
                relay_pin_active_state = COALESCE(?, relay_pin_active_state)
            WHERE id = ?
        `).run(
            name,
            description,
            coinPin,
            relayPin,
            pesoPerPulse,
            downloadSpeed,
            uploadSpeed,
            freeTimeSeconds,
            freeTimeReclaimDays,
            freeTimeVlan,
            freeTimeEnabled,
            freeTimeDownloadSpeed,
            freeTimeUploadSpeed,
            relayPinActiveState,
            id
        );

        const device = db.prepare('SELECT * FROM sub_vendo_devices WHERE id = ?').get(id);

        // Immediately apply relay state based on current session status
        if (device && device.ip_address) {
            const sessionKey = `subvendo:${device.device_id}`;
            const isActive = coinSessions.has(sessionKey);
            const targetState = isActive ? 'on' : 'off';
            
            // Fire and forget - attempt to update relay immediately
            controlSubVendoRelay(device.ip_address, targetState, device.relay_pin_active_state)
                .then(() => console.log(`[SubVendo] Immediate relay update for ${device.name} (${device.ip_address}) -> ${targetState} (Active: ${device.relay_pin_active_state})`))
                .catch(err => console.error(`[SubVendo] Failed immediate relay update for ${device.name}:`, err.message));
        }

        res.json({ success: true, device });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/subvendo/devices/:id/rates', isAuthenticated, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const allRates = db.prepare('SELECT * FROM rates ORDER BY amount ASC').all();
        const vis = db.prepare('SELECT rate_id FROM sub_vendo_device_rates WHERE device_id = ? AND visible = 1').all(id).map(r => r.rate_id);
        const result = allRates.map(r => ({
            ...r,
            visible: vis.includes(r.id)
        }));
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/admin/subvendo/devices/:id/rates', isAuthenticated, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
    const body = req.body || {};
    const visibleRateIds = Array.isArray(body.visible_rate_ids) ? body.visible_rate_ids.map(Number).filter(Number.isFinite) : [];
    try {
        const device = db.prepare('SELECT id FROM sub_vendo_devices WHERE id = ?').get(id);
        if (!device) return res.status(404).json({ error: 'Device not found' });
        db.prepare('DELETE FROM sub_vendo_device_rates WHERE device_id = ?').run(id);
        const stmt = db.prepare('INSERT INTO sub_vendo_device_rates (device_id, rate_id, visible) VALUES (?, ?, 1)');
        for (const rid of visibleRateIds) {
            const r = db.prepare('SELECT id FROM rates WHERE id = ?').get(rid);
            if (r) stmt.run(id, rid);
        }
        const vis = db.prepare('SELECT rate_id FROM sub_vendo_device_rates WHERE device_id = ? AND visible = 1').all(id);
        res.json({ success: true, visible_rate_ids: vis.map(x => x.rate_id) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 4.2 Waiting List Management
app.get('/api/admin/subvendo/waiting', isAuthenticated, (req, res) => {
    try {
        const list = db.prepare('SELECT * FROM sub_vendo_waiting_list ORDER BY created_at DESC').all();
        res.json(list);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/subvendo/approve', isAuthenticated, (req, res) => {
    const { id } = req.body; // Waiting list ID
    try {
        const waiting = db.prepare('SELECT * FROM sub_vendo_waiting_list WHERE id = ?').get(id);
        if (!waiting) return res.status(404).json({ error: 'Request not found' });
        
        // Move to devices
        const now = new Date().toISOString();
        // Check if already exists (edge case)
        const existing = db.prepare('SELECT id FROM sub_vendo_devices WHERE device_id = ?').get(waiting.device_id);
        if (existing) {
             // Just update
             db.prepare('UPDATE sub_vendo_devices SET last_active_at = ?, ip_address = ? WHERE id = ?')
               .run(now, waiting.ip_address, existing.id);
        } else {
             db.prepare('INSERT INTO sub_vendo_devices (device_id, name, status, last_active_at, ip_address) VALUES (?, ?, ?, ?, ?)')
               .run(waiting.device_id, waiting.name, 'active', now, waiting.ip_address);
        }
            
        // Remove from waiting list
        db.prepare('DELETE FROM sub_vendo_waiting_list WHERE id = ?').run(id);
        
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/subvendo/decline', isAuthenticated, (req, res) => {
    const { id } = req.body;
    try {
        db.prepare('DELETE FROM sub_vendo_waiting_list WHERE id = ?').run(id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 5. Auth/Bind (Public Endpoint for ESP8266)
app.post('/api/subvendo/auth', (req, res) => {
    const { key, device_id, name } = req.body;
    
    // 1. Validate Key
    const masterKey = configService.get('sub_vendo_key');
    // If no master key set, disable registration
    if (!masterKey) {
        return res.status(403).json({ error: 'Sub Vendo registration disabled (No key set)' });
    }

    if (masterKey !== key) {
        return res.status(401).json({ error: 'Invalid authentication key' });
    }

    if (!device_id) {
        return res.status(400).json({ error: 'Device ID is required' });
    }

    try {
        const now = new Date().toISOString();
        const ip = (req.ip || req.connection.remoteAddress || '').replace(/^::ffff:/, '');

        // 2. Check if device exists in APPROVED devices
        let device = db.prepare('SELECT * FROM sub_vendo_devices WHERE device_id = ?').get(device_id);

        if (device) {
            // Approved device: Update active status
            db.prepare(`
                UPDATE sub_vendo_devices
                SET last_active_at = ?,
                    status = ?,
                    ip_address = ?,
                    name = CASE
                        WHEN name IS NULL OR name = '' OR name = 'Unknown Device' THEN COALESCE(?, name)
                        ELSE name
                    END
                WHERE id = ?
            `).run(now, 'active', ip, name, device.id);
            
            // Re-fetch to return latest
            device = db.prepare('SELECT * FROM sub_vendo_devices WHERE device_id = ?').get(device_id);
            console.log(`[SubVendo] Auth/Heartbeat from ${device_id} (${name}) at ${now}`);

            // Return only necessary config to keep payload small and reliable for ESP8266
            const deviceConfig = {
                id: device.id,
                device_id: device.device_id,
                name: device.name,
                coin_pin: device.coin_pin,
                relay_pin: device.relay_pin,
                peso_per_pulse: device.peso_per_pulse,
                relay_pin_active_state: device.relay_pin_active_state || 'LOW'
            };

            return res.json({ success: true, message: 'Authenticated and binded successfully', device: deviceConfig });
        }
        
        // 3. Not approved: Check/Add to Waiting List
        let waiting = db.prepare('SELECT * FROM sub_vendo_waiting_list WHERE device_id = ?').get(device_id);
        if (waiting) {
             // Update info
             db.prepare('UPDATE sub_vendo_waiting_list SET ip_address = ?, name = COALESCE(?, name), key = ? WHERE id = ?')
               .run(ip, name, key, waiting.id);
        } else {
             // Add to waiting list
             db.prepare('INSERT INTO sub_vendo_waiting_list (device_id, name, key, ip_address) VALUES (?, ?, ?, ?)')
               .run(device_id, name || 'New Device', key, ip);
        }
        
        // Return 200 with minimal info so device keeps retrying but doesn't crash
        return res.json({ success: true, message: 'Device is in waiting list', status: 'pending' });

    } catch (e) {
        console.error('Sub Vendo Auth Error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/subvendo/pulse', (req, res) => {
    const { key, device_id, pulses } = req.body || {};

    const masterKey = configService.get('sub_vendo_key');
    if (!masterKey) return res.status(403).json({ error: 'Sub Vendo disabled (No key set)' });
    if (masterKey !== key) return res.status(401).json({ error: 'Invalid authentication key' });
    if (!device_id) return res.status(400).json({ error: 'Device ID is required' });

    const count = Math.trunc(Number(pulses));
    if (!Number.isFinite(count) || count <= 0 || count > 200) return res.status(400).json({ error: 'Invalid pulses' });

    try {
        const device = db.prepare('SELECT * FROM sub_vendo_devices WHERE device_id = ?').get(device_id);
        if (!device) return res.status(404).json({ error: 'Device not registered' });
        if (device.status && device.status !== 'active') return res.status(403).json({ error: 'Device inactive' });
        
        const now = new Date().toISOString();
        db.prepare('UPDATE sub_vendo_devices SET last_active_at = ? WHERE id = ?').run(now, device.id);

        const pesoPerPulse = Number(device.peso_per_pulse) > 0 ? Number(device.peso_per_pulse) : 1;
        const amount = count * pesoPerPulse;
        handleCoinPulseEvent(amount, `subvendo:${device_id}`).catch(() => {});

        res.json({ success: true, pulses: count, amount });
    } catch (e) {
        console.error('Sub Vendo Pulse Error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 0.5 Network Stats (Existing)
app.get('/api/admin/network-stats', isAuthenticated, async (req, res) => {
    const stats = await monitoringService.getInterfaceStats();
    res.json(stats);
});

// 0.5.1 QoS Configuration
app.get('/api/admin/qos/config', isAuthenticated, (req, res) => {
    res.json({
        default_download_speed: configService.get('default_download_speed') || 5120,
        default_upload_speed: configService.get('default_upload_speed') || 1024,
        qos_mode: configService.get('qos_mode') || 'gaming'
    });
});

app.post('/api/admin/qos/config', isAuthenticated, async (req, res) => {
    const { default_download_speed, default_upload_speed, qos_mode } = req.body;
    if (default_download_speed) configService.set('default_download_speed', default_download_speed);
    if (default_upload_speed) configService.set('default_upload_speed', default_upload_speed);
    
    if (qos_mode) {
        configService.set('qos_mode', qos_mode);
        // Apply Mode
        await bandwidthService.setMode(qos_mode);
    }
    
    res.json({ success: true });
});

app.post('/api/admin/qos/rage', isAuthenticated, (req, res) => {
    // 5 minutes default
    bandwidthService.triggerRageMode(300);
    res.json({ success: true, message: "Rage Mode Activated!" });
});

app.post('/api/admin/qos/limit', isAuthenticated, async (req, res) => {
    const { ip, download_speed, upload_speed } = req.body;
    if (!ip) return res.status(400).json({ error: 'IP Address is required' });

    try {
        // Update DB
        const result = db.prepare('UPDATE users SET download_speed = ?, upload_speed = ? WHERE ip_address = ?').run(download_speed, upload_speed, ip);
        
        if (result.changes > 0) {
            // Apply immediately
            await bandwidthService.setLimit(ip, download_speed, upload_speed);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'User not found or IP not assigned' });
        }
    } catch (e) {
        console.error("QoS Limit Error:", e);
        res.status(500).json({ error: "Failed to set limit" });
    }
});



// 0.6 Network Configuration
app.get('/api/admin/wifi/config', isAuthenticated, async (req, res) => {
    try {
        const config = await wifiService.getConfig();
        res.json(config);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/wifi/config', isAuthenticated, async (req, res) => {
    try {
        await wifiService.saveConfig(req.body);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/network/vlans', isAuthenticated, (req, res) => {
    try {
        res.json(networkConfigService.getVlans());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/network/status', isAuthenticated, async (req, res) => {
    try {
        const isOnline = await networkService.checkInternetConnection();
        res.json({ online: isOnline });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/network/wan', isAuthenticated, (req, res) => {
    res.json(networkConfigService.getWanConfig());
});

app.post('/api/admin/network/wan', isAuthenticated, async (req, res) => {
    try {
        await networkConfigService.setWanConfig(req.body);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Failed to save WAN configuration" });
    }
});

// ZeroTier
app.get('/api/admin/network/zerotier', isAuthenticated, async (req, res) => {
    const status = await networkService.getZeroTierStatus();
    res.json(status);
});

app.post('/api/admin/network/zerotier/join', isAuthenticated, async (req, res) => {
    try {
        const { networkId } = req.body;
        const success = await networkService.joinZeroTier(networkId);
        if (success) res.json({ success: true });
        else res.status(500).json({ error: "Failed to join network" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/network/zerotier/install', isAuthenticated, async (req, res) => {
    try {
        await networkService.installZeroTier();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/network/zerotier/leave', isAuthenticated, async (req, res) => {
    try {
        const { networkId } = req.body;
        const success = await networkService.leaveZeroTier(networkId);
        if (success) res.json({ success: true });
        else res.status(500).json({ error: "Failed to leave network" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// DHCP Server
app.get('/api/admin/network/dhcp', isAuthenticated, (req, res) => {
    res.json(networkConfigService.getDhcpConfig());
});

app.post('/api/admin/network/dhcp/settings', isAuthenticated, async (req, res) => {
    try {
        await networkConfigService.saveDhcpSettings(req.body);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/admin/network/dhcp/next-slot', isAuthenticated, (req, res) => {
    try {
        res.json(networkConfigService.getNextDhcpInfo());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/network/dhcp/servers', isAuthenticated, async (req, res) => {
    try {
        await networkConfigService.addDhcpServer(req.body);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/admin/network/dhcp/servers/:interface', isAuthenticated, async (req, res) => {
    try {
        await networkConfigService.removeDhcpServer(req.params.interface);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


app.get('/api/admin/network/vlans', isAuthenticated, (req, res) => {
    res.json(networkConfigService.getVlans());
});

app.post('/api/admin/network/vlans/batch', isAuthenticated, async (req, res) => {
    try {
        const count = await networkConfigService.addVlans(req.body);
        if (count > 0) {
            // Trigger runtime update REMOVED - must be applied manually
            // const networkService = require('./services/networkService');
            // await networkService.initVlans();
            res.json({ success: true, count });
        } else {
            res.status(400).json({ error: "No VLANs added" });
        }
    } catch (error) {
        console.error("Batch Add VLAN Error:", error);
        res.status(500).json({ error: error.message || "Failed to add VLANs" });
    }
});

app.post('/api/admin/network/vlans/apply', isAuthenticated, async (req, res) => {
    try {
        await networkConfigService.applyNetworkChanges();
        const networkService = require('./services/networkService');
        await networkService.initVlans();
        res.json({ success: true });
    } catch (error) {
        console.error("Apply VLAN Changes Error:", error);
        res.status(500).json({ error: error.message || "Failed to apply changes" });
    }
});

app.post('/api/admin/network/vlans', isAuthenticated, async (req, res) => {
    try {
        await networkConfigService.addVlan(req.body);
        // Trigger runtime update REMOVED - must be applied manually
        // const networkService = require('./services/networkService');
        // await networkService.initVlans();
        res.json({ success: true });
    } catch (error) {
        console.error("Add VLAN Error:", error);
        res.status(500).json({ error: error.message || "Failed to add VLAN" });
    }
});

app.put('/api/admin/network/vlans/:id', isAuthenticated, async (req, res) => {
    try {
        await networkConfigService.updateVlan(req.params.id, req.body);
        // Trigger runtime update REMOVED - must be applied manually
        // const networkService = require('./services/networkService');
        // await networkService.initVlans();
        res.json({ success: true });
    } catch (error) {
        console.error("Update VLAN Error:", error);
        res.status(500).json({ error: error.message || "Failed to update VLAN" });
    }
});

app.delete('/api/admin/network/vlans/:id', isAuthenticated, async (req, res) => {
    try {
        // Get vlan info before removing to know what interface to delete
        // const vlans = networkConfigService.getVlans();
        // const vlan = vlans.find(v => v.id === req.params.id);
        
        await networkConfigService.removeVlan(req.params.id);
        
        // if (vlan) {
        //     const networkService = require('./services/networkService');
        //     // Remove interface at runtime
        //     const interfaceName = `${vlan.parent}.${vlan.vlanId}`;
        //     await networkService.runCommand(`ip link delete ${interfaceName}`);
        // }
        
        res.json({ success: true });
    } catch (error) {
        console.error("Remove VLAN Error:", error);
        res.status(500).json({ error: error.message || "Failed to remove VLAN" });
    }
});

// Bridge Configuration
app.get('/api/admin/network/bridges', isAuthenticated, (req, res) => {
    try {
        const bridges = networkConfigService.getBridges();
        res.json(bridges);
    } catch (e) {
        console.error("Bridge API Error:", e);
        res.status(500).json({ error: e.message, stack: e.stack });
    }
});

app.post('/api/admin/network/bridges', isAuthenticated, async (req, res) => {
    try {
        await networkConfigService.addBridge(req.body);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/admin/network/bridges/:name', isAuthenticated, async (req, res) => {
    try {
        await networkConfigService.updateBridge(req.params.name, req.body);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/admin/network/bridges/:name', isAuthenticated, async (req, res) => {
    try {
        await networkConfigService.removeBridge(req.params.name);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 0.7 Firewall / AdBlock Configuration
app.get('/api/admin/firewall/rules', isAuthenticated, (req, res) => {
    try {
        const rules = firewallService.getRules();
        res.json(rules);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/firewall/rules', isAuthenticated, async (req, res) => {
    try {
        const { port, protocol, comment } = req.body;
        if (!port) return res.status(400).json({ error: "Port is required" });
        
        const rule = await firewallService.addRule(port, protocol || 'BOTH', comment || '');
        res.json({ success: true, rule });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/admin/firewall/rules/:id', isAuthenticated, async (req, res) => {
    try {
        const success = await firewallService.removeRule(req.params.id);
        if (success) res.json({ success: true });
        else res.status(404).json({ error: "Rule not found" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 1. Dashboard Data
app.get('/api/admin/system/verify', isAuthenticated, async (req, res) => {
    try {
        const results = await systemService.verifyConfiguration();
        res.json(results);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// System Hostname Management
app.get('/api/admin/system/hostname', isAuthenticated, (req, res) => {
    try {
        const hostname = require('os').hostname();
        res.json({ hostname });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/system/hostname', isAuthenticated, async (req, res) => {
    try {
        const { hostname } = req.body;
        if (!hostname || !/^[a-zA-Z0-9-]+$/.test(hostname)) {
            return res.status(400).json({ error: "Invalid hostname format" });
        }

        const scriptPath = path.join(__dirname, 'scripts', 'set_hostname.sh');
        await require('./services/networkService').runCommand(`bash "${scriptPath}" "${hostname}"`);
        
        res.json({ success: true, message: "Hostname updated successfully. Reboot recommended." });
    } catch (e) {
        console.error("Set Hostname Error:", e);
        res.status(500).json({ error: e.message });
    }
});

app.get(['/generate_204', '/hotspot-detect.html', '/ncsi.txt', '/connecttest.txt'], (req, res) => {
    res.redirect(PORTAL_URL);
});

// Internal: PPPoE User Connected Hook
app.post('/api/internal/pppoe-connected', async (req, res) => {
    const { interface: iface, ip, username, mac } = req.body;
    console.log(`PPPoE Hook: User ${username} connected on ${iface} with IP ${ip} [MAC: ${mac || 'N/A'}]`);

    if (!username || !ip) return res.status(400).json({ error: "Missing fields" });

    try {
        const user = db.prepare("SELECT * FROM pppoe_users WHERE username = ?").get(username);
        if (user) {
            // Update User IP, Interface, and MAC
            // Use COALESCE to keep existing MAC if new one is null/empty (though usually we want to update it)
            // If mac is provided, update it.
            const macVal = mac || user.mac_address; // Fallback to existing if not provided
            
            db.prepare("UPDATE pppoe_users SET current_ip = ?, interface = ?, mac_address = ?, is_active = 1, connected_at = DATETIME('now'), last_updated = DATETIME('now') WHERE id = ?").run(ip, iface, macVal, user.id);
            
            // Check for expiration
            const now = new Date();
            let isExpired = false;
            if (user.expiration_date) {
                const expDate = new Date(user.expiration_date);
                if (expDate < now) {
                    isExpired = true;
                }
            }

            // Determine Rates
            let up = user.rate_limit_up || 0;
            let down = user.rate_limit_down || 0;
            
            // If expired and profile_id_on_expiry is set, override limits
            if (isExpired && user.profile_id_on_expiry) {
                const profile = db.prepare("SELECT * FROM pppoe_profiles WHERE id = ?").get(user.profile_id_on_expiry);
                if (profile) {
                    up = profile.rate_limit_up;
                    down = profile.rate_limit_down;
                    console.log(`User ${username} is expired. Applying Expiry Profile: ${profile.name}`);
                }
            } else if ((!up || !down) && user.profile_id) {
                // Fallback to main profile
                const profile = db.prepare("SELECT * FROM pppoe_profiles WHERE id = ?").get(user.profile_id);
                if (profile) {
                    if (!up) up = profile.rate_limit_up;
                    if (!down) down = profile.rate_limit_down;
                }
            }
            
            // Apply Limit
            // If limits are 0 (unlimited in UI), we might want to skip or apply a very high limit.
            // But bandwidthService.setLimit defaults 0 to 5Mbps.
            // We'll trust the values for now. If they are > 0, we apply them.
            if (up > 0 || down > 0) {
                 console.log(`Applying PPPoE Limits for ${username}: ${down}kbps / ${up}kbps`);
                 await bandwidthService.setLimit(ip, down, up);
            } else {
                 console.log(`No limits found for PPPoE user ${username} (or set to 0/Unlimited). BandwidthService defaults may apply if called.`);
                 // If we want 'Unlimited', we should arguably NOT call setLimit, or call unlimit.
                 // For now, let's assume if 0, we do nothing (unlimited by default if not shaped).
            }
        } else {
            console.warn(`PPPoE Hook: Unknown user ${username}`);
        }
        res.json({ success: true });
    } catch (e) {
        console.error("PPPoE Hook Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// 2. Main Portal Pages
app.get('/', (req, res) => {
    res.redirect('/portal');
});

app.get('/portal', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'portal.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'admin.html'));
});

// 3. Client API Endpoints (Used by portal.html)

// Get Status
app.get('/api/status', async (req, res) => {
    const { macAddress, user } = req;
    let ip = getClientIp(req);
    // Prefer DB IP if available (handles roaming and proxy cases)
    if (user && user.ip_address) {
        ip = normalizeIp(user.ip_address);
    }

    // Prefer DB MAC if available, else use detected one
    let mac = formatMac(user && user.mac_address ? user.mac_address : macAddress);
    if (!mac && ip) {
        // Attempt to resolve MAC live if missing
        try {
            const resolved = await require('./services/networkService').getMacFromIp(ip);
            mac = formatMac(resolved);
        } catch (e) {}
    }

    if (user && user.is_connected) {
        sessionService.updateActivity(mac);
    }

    const coinEntry = mac ? findCoinSessionByMac(mac) : null;
    const coinSession = coinEntry ? coinEntry.session : null;
    const pendingAmount = coinSession ? (Number(coinSession.pendingAmount) || 0) : 0;
    const pendingMinutes = pendingAmount > 0 ? (Number(calculateTimeFromRates(pendingAmount, coinSession.clientId).minutes) || 0) : 0;

    if (user && !user.user_code) {
        try {
            const newCode = generateUniqueUserCode();
            db.prepare('UPDATE users SET user_code = ? WHERE id = ?').run(newCode, user.id);
            user.user_code = newCode;
        } catch(e) {
            console.error('Error generating missing user code:', e);
        }
    }
    
    // Get points balance
    const pointsBalance = user ? (user.points_balance || 0) : 0;

    const vendoMode = configService.get('vendo_selection_mode') || 'auto';
    let availableVendos = [{ id: 'hardware', name: 'Main Vendo', is_online: true, has_free_time: false }];
    try {
        const mainEnabledRaw = configService.get('main_free_time_enabled');
        const mainEnabled = mainEnabledRaw === '1' || mainEnabledRaw === 1 || mainEnabledRaw === true || mainEnabledRaw === 'true';
        const mainSeconds = Number(configService.get('main_free_time_seconds') || 0);
        if (mainEnabled && Number.isFinite(mainSeconds) && mainSeconds > 0) {
            availableVendos[0].has_free_time = true;
        }
        const subs = db.prepare('SELECT device_id, name, status, last_active_at, free_time_enabled, free_time_seconds, ip_address FROM sub_vendo_devices ORDER BY created_at DESC').all();
        const now = new Date();

        // Helper to check subnet
        const ipToLong = (ip) => {
            if (!ip) return 0;
            const parts = ip.split('.');
            if (parts.length !== 4) return 0;
            return parts.reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
        };
        const isSameSubnet = (ip1, ip2, mask) => {
             if (!ip1 || !ip2 || !mask) return false;
             try {
                const m = ipToLong(mask);
                return (ipToLong(ip1) & m) === (ipToLong(ip2) & m);
             } catch(e) { return false; }
        };

        const currentIp = getClientIp(req);
        let clientInterface = null;
        if (currentIp) {
            const ifaces = os.networkInterfaces();
            for (const name in ifaces) {
                 for (const iface of ifaces[name]) {
                      if (iface.family === 'IPv4' && !iface.internal) {
                           if (isSameSubnet(currentIp, iface.address, iface.netmask)) {
                                clientInterface = iface;
                                break;
                           }
                      }
                 }
                 if (clientInterface) break;
            }
        }

        availableVendos = availableVendos.concat(subs.map(s => {
            let isOnline = false;
            if (s.last_active_at) {
                const raw = String(s.last_active_at);
                const parsedA = new Date(raw);
                const parsedB = new Date(raw.includes('T') ? raw : (raw.replace(' ', 'T') + 'Z'));
                const lastActiveLocal = isNaN(parsedA.getTime()) ? parsedB : parsedA;
                
                if (!isNaN(lastActiveLocal.getTime())) {
                    const diffMs = (now - lastActiveLocal);
                    if (diffMs < SUB_VENDO_OFFLINE_AFTER_MS) isOnline = true;
                }
            }
            
            const hasFreeTime = (Number(s.free_time_enabled) === 1) && Number(s.free_time_seconds || 0) > 0;
            
            let isLocal = false;
            if (s.ip_address && clientInterface) {
                 if (isSameSubnet(s.ip_address, clientInterface.address, clientInterface.netmask)) {
                      isLocal = true;
                 }
            }

            return {
                id: `subvendo:${s.device_id}`,
                name: s.name || `Device ${s.device_id}`,
                status: s.status || null,
                is_online: isOnline,
                last_seen: s.last_active_at,
                has_free_time: hasFreeTime,
                is_local: isLocal
            };
        }));
    } catch (e) {
        console.error('Error fetching vendos:', e);
    }

    const activeCoinSession = coinSession ? {
        selection_mode: coinSession.selectionMode || null,
        target_device_id: coinSession.targetDeviceId || null
    } : null;

    res.set('Cache-Control', 'no-store');
    res.json({
        mac: mac || null,
        ip: ip || null,
        session_code: user ? user.user_code : null,
        time_remaining: user ? user.time_remaining : 0,
        points_balance: pointsBalance,
        is_paused: user ? user.is_paused : 0,
        is_connected: user ? user.is_connected : 0,
        pending_amount: pendingAmount,
        pending_minutes: pendingMinutes,
        status: user && user.time_remaining > 0 ? 'active' : 'expired',
        vendo_mode: vendoMode,
        available_vendos: availableVendos,
        coin_session: activeCoinSession
    });
});

// Auth: Restore Session (Switch Device / Resume)
app.post('/api/session/restore', async (req, res) => {
    const { code, deviceId } = req.body;
    const ip = normalizeIp(req.ip);
    const mac = formatMac(await networkService.getMacFromIp(ip));

    if (!mac) return res.json({ success: false, error: 'Could not detect MAC address' });

    let user = null;

    // 1. Try Restore by Device ID (Preferred for Roaming)
    if (deviceId) {
        user = db.prepare('SELECT * FROM users WHERE client_id = ?').get(deviceId);
        
        if (user) {
             console.log(`[Restore] Found user by DeviceID: ${deviceId} (Old MAC: ${user.mac_address}, New MAC: ${mac})`);
             // Roaming Check
             if (formatMac(user.mac_address) !== mac) {
                 // Check if new MAC is already taken by another active user
                 const conflict = db.prepare('SELECT * FROM users WHERE mac_address = ? AND id != ? AND time_remaining > 0').get(mac, user.id);
                 if (conflict) {
                     return res.json({ success: false, error: 'Device ID valid, but current MAC is in use by another active session.' });
                 }
                 
                 // Update MAC (Roaming)
                 console.log(`[Restore] Roaming detected. Updating MAC ${user.mac_address} -> ${mac}`);
                 db.prepare('UPDATE users SET mac_address = ? WHERE id = ?').run(mac, user.id);
                 
                 // Block old MAC to be safe (Clean up old firewall rule)
                 await networkService.blockUser(user.mac_address);
                 user.mac_address = mac;
             }
        }
    }

    // 2. Try Restore by Code (Legacy + Manual Transfer)
    if (!user && code) {
        user = db.prepare('SELECT * FROM users WHERE user_code = ?').get(code);
        if (user) {
             // Handle Session Transfer (Roaming via Code)
             if (formatMac(user.mac_address) !== mac) {
                 console.log(`[Restore] Code transfer detected. ${user.mac_address} -> ${mac}`);
                 
                 // Check if new MAC is busy
                 const conflict = db.prepare('SELECT * FROM users WHERE mac_address = ? AND id != ? AND time_remaining > 0').get(mac, user.id);
                 if (conflict) {
                     return res.json({ success: false, error: 'Cannot transfer session. This device already has an active session.' });
                 }

                 // Block old MAC
                 await networkService.blockUser(user.mac_address);
                 
                 // Update to new MAC
                 db.prepare('UPDATE users SET mac_address = ? WHERE id = ?').run(mac, user.id);
                 user.mac_address = mac;
                 
                 // Link to current deviceId if available
                 if (deviceId) {
                     db.prepare('UPDATE users SET client_id = ? WHERE id = ?').run(deviceId, user.id);
                     user.client_id = deviceId;
                 }
             }
        }
    }

    if (!user) {
        return res.json({ success: false, error: 'Invalid Session or Code' });
    }
    
    // Check time
    if (user.time_remaining <= 0) {
         return res.json({ success: false, error: 'Session Expired' });
    }

    // 3. Restore Access
    await networkService.allowUser(user.mac_address);
    
    // Update IP & QoS
    if (ip) {
        db.prepare('UPDATE users SET ip_address = ?, is_connected = 1, is_paused = 0, last_active_at = CURRENT_TIMESTAMP, last_traffic_at = CURRENT_TIMESTAMP WHERE id = ?').run(ip, user.id);
        await bandwidthService.setLimit(ip, user.download_speed, user.upload_speed);
    }
    
    // Ensure cookie is set (syncs cookie with deviceId if missing)
    if (user.client_id) {
         res.cookie('client_id', user.client_id, { maxAge: 30 * 24 * 60 * 60 * 1000 });
    }

    return res.json({ success: true, message: 'Session resumed', user });
});

// Coin Inserted (Called by hardware or simulated)
app.post('/api/coin-inserted', async (req, res) => {
    const { pulses, mac_address, device_id } = req.body;
    const amount = Number(pulses) || 0;
    const mac = formatMac(mac_address);

    if (!mac || amount <= 0) return res.status(400).json({ success: false, error: 'Invalid coin payload' });

    let source = 'hardware';
    let svDevice = null;

    if (device_id) {
        try {
            svDevice = db.prepare('SELECT * FROM sub_vendo_devices WHERE device_id = ?').get(device_id);
            if (svDevice) {
                source = `subvendo:${svDevice.device_id}`;
                // Update last active
                db.prepare('UPDATE sub_vendo_devices SET last_active_at = datetime("now", "localtime") WHERE id = ?').run(svDevice.id);
            }
        } catch (e) {
            console.error('[Coin] Error checking sub-vendo device:', e);
        }
    }

    // Check for active coin session to route pulse
    const session = coinSessions.get(source);
    if (session) {
        console.log(`[Coin] Delegating sub-vendo pulse to session: ${source}`);
        await handleCoinPulseEvent(amount, source);
        return res.json({ success: true, message: 'Pulse processed by active session', mode: 'session' });
    }

    try {
        db.prepare('INSERT INTO sales (amount, mac_address, source) VALUES (?, ?, ?)').run(amount, mac, source);
    } catch (err) {
        console.error('[Sales] Error recording sale:', err);
    }

    // Pass device ID (database ID) if available for rate calculation
    const best = calculateTimeFromRates(amount, svDevice ? svDevice.id : null);
    const minutesToAdd = Number(best.minutes) || 0;
    const secondsToAdd = minutesToAdd * 60;

    if (secondsToAdd <= 0) return res.status(400).json({ success: false, error: 'No rate available for this amount' });

    const user = db.prepare('SELECT * FROM users WHERE lower(mac_address) = lower(?)').get(mac);
    const prevUpload = (user && user.upload_speed != null) ? Number(user.upload_speed) : 1024;
    const prevDownload = (user && user.download_speed != null) ? Number(user.download_speed) : 5120;
    const nextUpload = (best.upload_speed != null) ? Number(best.upload_speed) : null;
    const nextDownload = (best.download_speed != null) ? Number(best.download_speed) : null;
    let uploadSpeed = (nextUpload != null && nextUpload > prevUpload) ? nextUpload : prevUpload;
    let downloadSpeed = (nextDownload != null && nextDownload > prevDownload) ? nextDownload : prevDownload;

    // Apply Sub-Vendo specific speed overrides if they exist
    if (svDevice) {
        if (svDevice.download_speed != null) downloadSpeed = svDevice.download_speed;
        if (svDevice.upload_speed != null) uploadSpeed = svDevice.upload_speed;
    }

    if (user) {
        db.prepare(`
            UPDATE users 
            SET time_remaining = time_remaining + ?, 
                total_time = total_time + ?,
                upload_speed = COALESCE(?, upload_speed), 
                download_speed = COALESCE(?, download_speed),
                is_paused = 0,
                is_connected = 1,
                last_active_at = CURRENT_TIMESTAMP,
                last_traffic_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(secondsToAdd, secondsToAdd, uploadSpeed, downloadSpeed, user.id);
    } else {
        db.prepare(`
            INSERT INTO users (mac_address, time_remaining, total_time, upload_speed, download_speed, is_paused, is_connected, last_active_at, last_traffic_at) 
            VALUES (?, ?, ?, ?, ?, 0, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(mac, secondsToAdd, secondsToAdd, uploadSpeed, downloadSpeed);
    }

    networkService.allowUser(mac);

    // Apply speed immediately if user has an IP (Connected)
    try {
        const currentUser = db.prepare('SELECT ip_address FROM users WHERE mac_address = ?').get(mac);
        if (currentUser && currentUser.ip_address) {
             await bandwidthService.setLimit(currentUser.ip_address, downloadSpeed, uploadSpeed);
        }
    } catch (e) {
        console.error('[Coin] Error applying speed:', e);
    }

    res.json({ success: true, amount, minutesAdded: minutesToAdd, secondsAdded: secondsToAdd });
});

// Start Coin Mode
app.post('/api/coin/start', async (req, res) => {
    let ip = req.ip;
    if (ip.startsWith('::ffff:')) ip = ip.substring(7);
    const mac = formatMac(await networkService.getMacFromIp(ip));
    if (!mac) return res.json({ success: false, error: 'Could not detect MAC' });

    const banRecord = db.prepare('SELECT * FROM access_control WHERE mac_address = ?').get(mac);
    if (banRecord && banRecord.banned_until) {
        const bannedUntil = new Date(banRecord.banned_until);
        if (bannedUntil > new Date()) {
            const minutesLeft = Math.ceil((bannedUntil - new Date()) / 60000);
            return res.json({ success: false, error: `You are banned for ${minutesLeft} minutes due to too many failed attempts.` });
        }
    }

    const bodyMode = (req.body && typeof req.body.selectionMode === 'string') ? req.body.selectionMode.trim().toLowerCase() : '';
    const defaultMode = configService.get('vendo_selection_mode') || 'auto';
    const mode = (bodyMode === 'auto' || bodyMode === 'manual') ? bodyMode : defaultMode;

    let targetDeviceId = req.body && typeof req.body.targetDeviceId === 'string' ? req.body.targetDeviceId : null;
    if (mode !== 'manual') {
        targetDeviceId = null;
    } else if (!targetDeviceId) {
        targetDeviceId = 'hardware';
    }

    const sessionKey = targetDeviceId || 'hardware';
    const existing = coinSessions.get(sessionKey);

    if (existing && formatMac(existing.mac) !== mac) {
        console.log(`[Coin] User ${mac} blocked. Coinslot busy with ${existing.mac} on ${sessionKey}`);
        return res.json({ success: false, error: 'Coinslot Busy Please Try again later' });
    }

    let pending = 0;
    if (existing && formatMac(existing.mac) === mac) {
        pending = existing.pendingAmount || 0;
    }

    const clientId = req.body.deviceId || req.clientId;
    const session = {
        ip,
        mac,
        clientId,
        start: Date.now(),
        pendingAmount: pending,
        sourceAmounts: existing && existing.sourceAmounts ? existing.sourceAmounts : {},
        targetDeviceId,
        selectionMode: mode,
        lastSource: existing ? existing.lastSource : null,
        timeout: null
    };

    if (pending > 0) {
        if (!session.sourceAmounts) session.sourceAmounts = {};
        if (!session.sourceAmounts['hardware']) session.sourceAmounts['hardware'] = pending;
    }

    if (sessionKey === 'hardware') {
        hardwareService.setRelay(true);
    } else if (sessionKey.startsWith('subvendo:')) {
        try {
            const deviceIdStr = sessionKey.slice('subvendo:'.length);
            const svDevice = db.prepare('SELECT id, ip_address, relay_pin_active_state FROM sub_vendo_devices WHERE device_id = ?').get(deviceIdStr);
            if (svDevice) {
                session.clientId = svDevice.id; // Override clientId with DB ID for rates
                if (svDevice.ip_address) {
                    await controlSubVendoRelay(svDevice.ip_address, 'on', svDevice.relay_pin_active_state);
                }
            }
        } catch (e) {
            console.error('[Coin] Error turning on sub-vendo relay:', e);
        }
    }

    if (session.timeout) clearTimeout(session.timeout);
    session.timeout = setTimeout(() => { 
        finalizeCoinSession(sessionKey, 'timeout').catch(e => console.error('[Coin] Finalize error:', e));
    }, 60000);

    coinSessions.set(sessionKey, session);

    console.log(`[Coin] User ${mac} started inserting coins on ${sessionKey}`);
    res.json({ success: true });
});

app.post('/api/coin/done', async (req, res) => {
    let ip = req.ip;
    if (ip.startsWith('::ffff:')) ip = ip.substring(7);
    const mac = formatMac(await networkService.getMacFromIp(ip));
    if (!mac) return res.json({ success: false, error: 'Could not detect MAC' });

    const entry = findCoinSessionByMac(mac);
    if (!entry) {
        return res.json({ success: false, error: 'No active coin session' });
    }

    try {
        const result = await finalizeCoinSession(entry.key, 'done');
        res.json(result);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/claim-free-time', async (req, res) => {
    const body = req.body || {};
    const rawMac = body.mac || req.macAddress || (req.user && req.user.mac_address) || null;
    const mac = formatMac(rawMac);
    if (!mac) {
        return res.status(400).json({ success: false, error: 'Could not detect device MAC address.' });
    }

    let ip = getClientIp(req);
    if (req.user && req.user.ip_address) {
        ip = normalizeIp(req.user.ip_address);
    }

    const targetId = typeof body.targetDeviceId === 'string' ? body.targetDeviceId : null;
    let deviceConfig = null;

    if (targetId && targetId.startsWith('subvendo:')) {
        const deviceKey = targetId.substring('subvendo:'.length);
        let svDevice = null;
        try {
            svDevice = db.prepare('SELECT * FROM sub_vendo_devices WHERE device_id = ?').get(deviceKey);
        } catch (e) {
            return res.json({ success: false, error: 'Failed to load free time configuration.' });
        }
        if (!svDevice) {
            return res.json({ success: false, error: 'Free time is not configured for this vendo.' });
        }
        const freeDl = Number(svDevice.free_time_download_speed || 0);
        const freeUl = Number(svDevice.free_time_upload_speed || 0);
        let dl = null;
        let ul = null;
        if (Number.isFinite(freeDl) && freeDl > 0) {
            dl = freeDl;
        } else if (svDevice.download_speed != null) {
            dl = svDevice.download_speed;
        }
        if (Number.isFinite(freeUl) && freeUl > 0) {
            ul = freeUl;
        } else if (svDevice.upload_speed != null) {
            ul = svDevice.upload_speed;
        }
        deviceConfig = {
            free_time_enabled: svDevice.free_time_enabled,
            free_time_seconds: svDevice.free_time_seconds,
            free_time_reclaim_days: svDevice.free_time_reclaim_days,
            free_time_vlan: svDevice.free_time_vlan,
            download_speed: dl,
            upload_speed: ul
        };
    } else {
        const enabledRaw = configService.get('main_free_time_enabled');
        const enabled = enabledRaw === '1' || enabledRaw === 1 || enabledRaw === true || enabledRaw === 'true';
        const seconds = Number(configService.get('main_free_time_seconds') || 0);
        const reclaimDaysRaw = configService.get('main_free_time_reclaim_days');
        const vlan = configService.get('main_free_time_vlan') || null;
        const dlKbps = Number(configService.get('main_free_time_download_speed') || 0);
        const ulKbps = Number(configService.get('main_free_time_upload_speed') || 0);

        if (!enabled || !Number.isFinite(seconds) || seconds <= 0) {
            return res.json({ success: false, error: 'Free time is not configured for this vendo.' });
        }

        deviceConfig = {
            free_time_enabled: enabled ? 1 : 0,
            free_time_seconds: seconds,
            free_time_reclaim_days: reclaimDaysRaw,
            free_time_vlan: vlan,
            download_speed: Number.isFinite(dlKbps) && dlKbps > 0 ? dlKbps : null,
            upload_speed: Number.isFinite(ulKbps) && ulKbps > 0 ? ulKbps : null
        };
    }

    const enabledFlag = Number(deviceConfig.free_time_enabled || 0) === 1;
    const secondsToAdd = Number(deviceConfig.free_time_seconds || 0);

    if (!enabledFlag || !Number.isFinite(secondsToAdd) || secondsToAdd <= 0) {
        return res.json({ success: false, error: 'Free time is not available for this vendo.' });
    }

    let reclaimDays = null;
    if (deviceConfig.free_time_reclaim_days != null && deviceConfig.free_time_reclaim_days !== '') {
        const parsed = Number(deviceConfig.free_time_reclaim_days);
        if (Number.isFinite(parsed) && parsed >= 0) {
            reclaimDays = parsed;
        }
    }

    let lastClaim = null;
    try {
        lastClaim = db.prepare('SELECT claimed_at FROM free_time_claims WHERE mac_address = ? ORDER BY claimed_at DESC LIMIT 1').get(mac);
    } catch (e) {}

    if (lastClaim && lastClaim.claimed_at) {
        const lastTime = new Date(String(lastClaim.claimed_at));
        if (!isNaN(lastTime.getTime())) {
            if (reclaimDays == null) {
                return res.json({ success: false, error: 'You have already claimed free time.' });
            }
            if (reclaimDays > 0) {
                const now = new Date();
                const elapsedMs = now - lastTime;
                const periodMs = reclaimDays * 86400000;
                if (elapsedMs < periodMs) {
                    const remainingMs = periodMs - elapsedMs;
                    const remainingHours = Math.ceil(remainingMs / 3600000);
                    return res.json({
                        success: false,
                        error: `You can claim free time again in about ${remainingHours} hour(s).`
                    });
                }
            }
        }
    }

    let user = db.prepare('SELECT * FROM users WHERE mac_address = ?').get(mac);
    if (!user) {
        user = db.prepare('SELECT * FROM users WHERE lower(mac_address) = lower(?)').get(mac);
        if (user && user.mac_address !== mac) {
            try {
                db.prepare('UPDATE users SET mac_address = ? WHERE id = ?').run(mac, user.id);
                user = { ...user, mac_address: mac };
            } catch (e) {}
        }
    }

    let userCode = user ? user.user_code : null;
    if (!userCode) userCode = generateUniqueUserCode();

    const prevUpload = (user && user.upload_speed != null) ? Number(user.upload_speed) : 1024;
    const prevDownload = (user && user.download_speed != null) ? Number(user.download_speed) : 5120;

    let downloadSpeed = prevDownload;
    let uploadSpeed = prevUpload;

    if (deviceConfig.download_speed != null) {
        const d = Number(deviceConfig.download_speed);
        if (Number.isFinite(d) && d > 0) downloadSpeed = d;
    }
    if (deviceConfig.upload_speed != null) {
        const u = Number(deviceConfig.upload_speed);
        if (Number.isFinite(u) && u > 0) uploadSpeed = u;
    }

    const clientId = req.clientId || null;

    try {
        if (user) {
            db.prepare(`
                UPDATE users
                SET time_remaining = time_remaining + ?,
                    total_time = total_time + ?,
                    upload_speed = COALESCE(?, upload_speed),
                    download_speed = COALESCE(?, download_speed),
                    is_paused = 0,
                    user_code = COALESCE(user_code, ?),
                    ip_address = COALESCE(?, ip_address),
                    client_id = COALESCE(?, client_id),
                    is_connected = 1,
                    last_active_at = CURRENT_TIMESTAMP,
                    last_traffic_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(secondsToAdd, secondsToAdd, uploadSpeed, downloadSpeed, userCode, ip, clientId, user.id);
        } else {
            db.prepare(`
                INSERT INTO users (mac_address, ip_address, client_id, time_remaining, total_time, upload_speed, download_speed, is_paused, is_connected, user_code, last_active_at, last_traffic_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `).run(mac, ip, clientId, secondsToAdd, secondsToAdd, downloadSpeed, uploadSpeed, userCode);
        }

        db.prepare('INSERT INTO free_time_claims (mac_address, interface) VALUES (?, ?)').run(mac, deviceConfig.free_time_vlan || null);

        await networkService.allowUser(mac, ip);
        if (ip) {
            await bandwidthService.setLimit(ip, downloadSpeed, uploadSpeed);
        }

        return res.json({ success: true, secondsAdded: secondsToAdd });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

// Voucher Redeem
app.post('/api/voucher/redeem', async (req, res) => {
    const { code, mac: bodyMac } = req.body;
    const mac = req.macAddress || bodyMac; // Prioritize middleware, fallback to body
    
    if (!mac) return res.status(400).json({ success: false, error: "Could not detect MAC address." });

    // 1. Check if user is banned
    const banRecord = db.prepare('SELECT * FROM access_control WHERE mac_address = ?').get(mac);
    if (banRecord && banRecord.banned_until) {
        const bannedUntil = new Date(banRecord.banned_until);
        if (bannedUntil > new Date()) {
            const minutesLeft = Math.ceil((bannedUntil - new Date()) / 60000);
            return res.json({ success: false, error: `You are banned for ${minutesLeft} minutes due to too many failed attempts.` });
        }
    }
    
    // Pass IP address to resolve interface
    const result = await voucherService.redeemVoucher(code, mac, req.body.deviceId || req.clientId, req.ip);
    
    if (result.success) {
        // Reset failed attempts
        db.prepare('INSERT INTO access_control (mac_address, failed_attempts, banned_until) VALUES (?, 0, NULL) ON CONFLICT(mac_address) DO UPDATE SET failed_attempts = 0, banned_until = NULL').run(mac);

        await networkService.allowUser(mac);
        // Apply bandwidth limit (use request IP or stored IP)
        // If the user is redeeming from the device itself, req.ip is correct.
        if (req.ip) {
            await bandwidthService.setLimit(req.ip, result.download_speed, result.upload_speed);
        }

        // Emit points earned event if any
        if (result.pointsEarned > 0) {
            io.emit('points_earned', { 
                mac: mac, 
                points: result.pointsEarned,
                total_points: db.prepare('SELECT points_balance FROM users WHERE mac_address = ?').get(mac)?.points_balance || 0
            });
        }

        res.json({ success: true, added_time: result.duration, points_earned: result.pointsEarned });
    } else {
        // Handle failure & Ban Logic
        const banCounter = parseInt(configService.get('ban_counter')) || 10;
        const banDuration = parseInt(configService.get('ban_duration')) || 1;

        // Upsert failure count
        const currentFailures = (banRecord ? banRecord.failed_attempts : 0) + 1;
        let bannedUntil = null;
        let errorMsg = result.message;

        if (currentFailures >= banCounter) {
            bannedUntil = new Date(Date.now() + banDuration * 60000).toISOString();
            errorMsg = `You are banned for ${banDuration} minutes due to too many failed attempts.`;
        }

        db.prepare(`
            INSERT INTO access_control (mac_address, failed_attempts, banned_until, updated_at) 
            VALUES (?, ?, ?, CURRENT_TIMESTAMP) 
            ON CONFLICT(mac_address) DO UPDATE SET 
                failed_attempts = ?,
                banned_until = ?,
                updated_at = CURRENT_TIMESTAMP
        `).run(mac, currentFailures, bannedUntil, currentFailures, bannedUntil);

        res.json({ success: false, error: errorMsg });
    }
});

// Pause Time
app.post('/api/session/pause', async (req, res) => {
    if (req.user) {
        try {
            db.prepare('UPDATE users SET is_paused = 1, is_connected = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.user.id);
        } catch (e) {}
        try {
            await networkService.blockUser(req.user.mac_address, req.user.ip_address);
        } catch (e) {}
        try {
            if (req.user.ip_address) {
                await bandwidthService.removeLimit(req.user.ip_address);
            }
        } catch (e) {}
    }
    res.json({ success: true });
});

// Resume Time
app.post('/api/session/resume', async (req, res) => {
    if (req.user) {
        let clientIp = req.ip;
        if (clientIp.startsWith('::ffff:')) clientIp = clientIp.substring(7);

        // Update IP in case it changed while paused, and set is_paused=0
        db.prepare('UPDATE users SET is_paused = 0, ip_address = ?, last_active_at = CURRENT_TIMESTAMP, last_traffic_at = CURRENT_TIMESTAMP WHERE id = ?').run(clientIp, req.user.id);
        
        // Safety: Ensure no one else holds this IP
        db.prepare('UPDATE users SET ip_address = NULL WHERE ip_address = ? AND id != ?').run(clientIp, req.user.id);

        await networkService.allowUser(req.user.mac_address);
        
        // Re-apply bandwidth limit to the CURRENT IP
        await bandwidthService.setLimit(clientIp, req.user.download_speed, req.user.upload_speed);
    }
    res.json({ success: true });
});

// Admin: Generate Vouchers
app.post('/api/admin/vouchers/generate', isAuthenticated, (req, res) => {
    try {
        const options = req.body;
        const { codes, batchId } = voucherService.generateVouchers(options);
        res.json({ success: true, codes, batchId });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Admin: List Vouchers
app.get('/api/admin/vouchers', isAuthenticated, (req, res) => {
    const includeUsed = req.query.includeUsed === '1' || req.query.includeUsed === 'true';
    const batchId = req.query.batchId || null;
    const conditions = [];
    const params = [];
    if (!includeUsed) {
        conditions.push('COALESCE(is_used, 0) = 0');
    }
    if (batchId) {
        conditions.push('batch_id = ?');
        params.push(batchId);
    }
    let sql = 'SELECT * FROM vouchers';
    if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY created_at DESC';
    if (!batchId) {
        sql += ' LIMIT 500';
    }
    const vouchers = db.prepare(sql).all(...params);
    res.json(vouchers);
});

// Admin: List Voucher Batches
app.get('/api/admin/voucher-batches', isAuthenticated, (req, res) => {
    const rows = db.prepare(`
        SELECT batch_id, MIN(created_at) AS created_at, MAX(plan_name) AS plan_name, MAX(price) AS price, COUNT(*) AS count
        FROM vouchers
        WHERE batch_id IS NOT NULL AND batch_id != ''
        GROUP BY batch_id
        ORDER BY created_at DESC
        LIMIT 200
    `).all();
    res.json(rows);
});

// Admin: Delete Voucher Batch
app.delete('/api/admin/voucher-batches/:batchId', isAuthenticated, (req, res) => {
    const { batchId } = req.params;
    if (!batchId) return res.status(400).json({ error: 'Batch ID required' });
    try {
        const result = db.prepare('DELETE FROM vouchers WHERE batch_id = ?').run(batchId);
        res.json({ success: true, count: result.changes });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Admin: Export Voucher Batch (CSV)
app.get('/api/admin/voucher-batches/:batchId/export', isAuthenticated, (req, res) => {
    const { batchId } = req.params;
    if (!batchId) return res.status(400).send('Batch ID required');
    
    try {
        const vouchers = db.prepare(`
            SELECT code, plan_name, price, duration, upload_speed, download_speed, data_limit, created_at 
            FROM vouchers 
            WHERE batch_id = ?
        `).all(batchId);

        if (vouchers.length === 0) return res.status(404).send('No vouchers found');

        // Simple CSV generation
        const header = 'Code,Plan,Price,Duration(Minutes),UL(Kbps),DL(Kbps),DataLimit(MB),Created\n';
        const rows = vouchers.map(v => 
            `${v.code},"${v.plan_name}",${v.price},${Math.round((v.duration||0)/60)},${v.upload_speed},${v.download_speed},${v.data_limit},${v.created_at}`
        ).join('\n');

        const csv = header + rows;
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="vouchers-${batchId}.csv"`);
        res.send(csv);

    } catch (e) {
        res.status(500).send('Error generating CSV: ' + e.message);
    }
});

// Admin: Delete Vouchers
app.delete('/api/admin/vouchers', isAuthenticated, (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids)) {
             return res.status(400).json({ success: false, error: 'Invalid IDs' });
        }
        
        const deleteStmt = db.prepare('DELETE FROM vouchers WHERE id = ?');
        const transaction = db.transaction((voucherIds) => {
            for (const id of voucherIds) deleteStmt.run(id);
        });
        
        transaction(ids);
        res.json({ success: true, count: ids.length });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Public: Get Rates for Portal
app.get('/api/rates', (req, res) => {
    try {
        const deviceParam = String(req.query.device || '').trim();
        let rates = [];
        if (deviceParam.startsWith('subvendo:')) {
            const did = deviceParam.slice('subvendo:'.length);
            const dev = db.prepare('SELECT id FROM sub_vendo_devices WHERE device_id = ?').get(did);
            if (dev) {
                const mapped = db.prepare(`
                    SELECT r.amount, r.minutes, r.upload_speed, r.download_speed, r.is_pausable
                    FROM rates r
                    JOIN sub_vendo_device_rates m ON m.rate_id = r.id
                    WHERE m.device_id = ? AND m.visible = 1
                    ORDER BY r.amount ASC
                `).all(dev.id);
                rates = mapped.length > 0 ? mapped : db.prepare('SELECT amount, minutes, upload_speed, download_speed, is_pausable FROM rates ORDER BY amount ASC').all();
            } else {
                rates = db.prepare('SELECT amount, minutes, upload_speed, download_speed, is_pausable FROM rates ORDER BY amount ASC').all();
            }
        } else {
            rates = db.prepare('SELECT amount, minutes, upload_speed, download_speed, is_pausable FROM rates ORDER BY amount ASC').all();
        }
        res.json(rates);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Admin: Get Rates
app.get('/api/admin/rates', isAuthenticated, (req, res) => {
    try {
        const rates = db.prepare('SELECT * FROM rates ORDER BY amount ASC').all();
        res.json(rates);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Admin: Add/Edit Rate
app.post('/api/admin/rates', isAuthenticated, (req, res) => {
    try {
        const { id, amount, minutes, upload_speed, download_speed, is_pausable } = req.body;
        
        if (id) {
            db.prepare(`UPDATE rates SET amount=?, minutes=?, upload_speed=?, download_speed=?, is_pausable=? WHERE id=?`)
              .run(amount, minutes, upload_speed, download_speed, is_pausable, id);
        } else {
            db.prepare(`INSERT INTO rates (amount, minutes, upload_speed, download_speed, is_pausable) VALUES (?, ?, ?, ?, ?)`)
              .run(amount, minutes, upload_speed, download_speed, is_pausable);
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Admin: Delete Rate
app.delete('/api/admin/rates/:id', isAuthenticated, (req, res) => {
    try {
        db.prepare('DELETE FROM rates WHERE id=?').run(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Public: Get Point Rates
app.get('/api/point-rates', (req, res) => {
    try {
        const rates = db.prepare('SELECT * FROM point_rates ORDER BY points ASC').all();
        res.json(rates);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Admin: Get Point Rates
app.get('/api/admin/point-rates', isAuthenticated, (req, res) => {
    try {
        const rates = db.prepare('SELECT * FROM point_rates ORDER BY points ASC').all();
        res.json(rates);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Admin: Add/Edit Point Rate
app.post('/api/admin/point-rates', isAuthenticated, (req, res) => {
    try {
        const { id, points, minutes, duration, upload_speed, download_speed, is_pausable, description } = req.body;
        
        // Ensure duration is set. If not provided, fallback to minutes * 60
        const finalDuration = (duration !== undefined && duration !== null) ? Number(duration) : (Number(minutes) * 60);

        if (id) {
            db.prepare(`UPDATE point_rates SET points=?, minutes=?, duration=?, upload_speed=?, download_speed=?, is_pausable=?, description=? WHERE id=?`)
              .run(points, minutes || 0, finalDuration, upload_speed || 5120, download_speed || 5120, is_pausable, description, id);
        } else {
            db.prepare(`INSERT INTO point_rates (points, minutes, duration, upload_speed, download_speed, is_pausable, description) VALUES (?, ?, ?, ?, ?, ?, ?)`)
              .run(points, minutes || 0, finalDuration, upload_speed || 5120, download_speed || 5120, is_pausable, description);
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Admin: Delete Point Rate
app.delete('/api/admin/point-rates/:id', isAuthenticated, (req, res) => {
    try {
        db.prepare('DELETE FROM point_rates WHERE id=?').run(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Admin: Get Devices
app.get('/api/admin/devices', isAuthenticated, async (req, res) => {
    try {
        const globalIdleSec = Number(configService.get('idle_timeout_seconds')) || 120;
        
        // Send Server Time for Client Sync
        res.set('X-Server-Time', Date.now().toString());

        // Get totals by MAC (legacy/fallback)
        const salesTotals = db.prepare(`
            SELECT lower(mac_address) as mac, COALESCE(SUM(amount), 0) as total_amount
            FROM sales
            GROUP BY lower(mac_address)
        `).all();

        const salesMap = new Map();
        for (const row of salesTotals) {
            salesMap.set(row.mac, Number(row.total_amount) || 0);
        }

        // Get totals by User Code (Primary)
        const salesByCode = db.prepare(`
            SELECT user_code, COALESCE(SUM(amount), 0) as total_amount
            FROM sales
            WHERE user_code IS NOT NULL AND user_code != ''
            GROUP BY user_code
        `).all();

        const salesCodeMap = new Map();
        for (const row of salesByCode) {
            salesCodeMap.set(row.user_code, Number(row.total_amount) || 0);
        }

        let connectedDevices = [];
        try {
            if (monitoringService && typeof monitoringService.getConnectedDevices === 'function') {
                connectedDevices = await monitoringService.getConnectedDevices();
            }
        } catch (err) {
            console.error('Error fetching connected devices:', err);
        }

        const devices = db.prepare(`
            SELECT u.*, 
            (SELECT code FROM vouchers WHERE used_by_user_id = u.id ORDER BY used_at DESC LIMIT 1) as last_voucher_code
            FROM users u 
            ORDER BY u.updated_at DESC
        `).all();

        const devicesWithTimeout = devices.map(d => {
            let speed = { dl_speed: 0, ul_speed: 0 };
            try {
                if (sessionService && typeof sessionService.getCurrentSpeed === 'function') {
                    speed = sessionService.getCurrentSpeed(d.ip_address);
                }
            } catch (err) {
                console.error("Error getting speed for " + d.ip_address, err);
            }

            const macKey = d.mac_address ? String(d.mac_address).toLowerCase() : null;
            
            // Priority: User Code Total -> MAC Address Total
            let totalCoins = 0;
            if (d.user_code && salesCodeMap.has(d.user_code)) {
                totalCoins = salesCodeMap.get(d.user_code);
            } else if (macKey && salesMap.has(macKey)) {
                totalCoins = salesMap.get(macKey);
            }

            let iface = null;
            if (connectedDevices && connectedDevices.length) {
                const normIp = d.ip_address ? String(d.ip_address).replace('::ffff:', '') : null;
                const normMac = d.mac_address ? String(d.mac_address).toLowerCase() : null;
                const match = connectedDevices.find(cd => {
                    const cdIp = cd.ip ? String(cd.ip) : null;
                    const cdMac = cd.mac ? String(cd.mac).toLowerCase() : null;
                    if (normIp && cdIp && cdIp === normIp) return true;
                    if (normMac && cdMac && cdMac === normMac) return true;
                    return false;
                });
                if (match && match.interface) {
                    let rawIface = String(match.interface);
                    if (rawIface === 'wlan0') rawIface = 'br0';
                    iface = rawIface;
                }
            }

            return {
                ...d,
                effective_idle_timeout: d.idle_timeout || globalIdleSec,
                current_speed: speed,
                total_coins: totalCoins,
                interface: iface
            };
        });

        res.json(devicesWithTimeout);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Admin: Update Device
app.put('/api/admin/devices/:id', isAuthenticated, async (req, res) => {
    try {
        const id = req.params.id;
        const { session_code, time_remaining, download_speed, upload_speed } = req.body;
        
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });

        // Update both session_code (legacy) and user_code (actual)
        const codeToUpdate = session_code !== undefined ? session_code : (user.user_code || user.session_code);
        
        const dl = download_speed !== undefined ? Number(download_speed) : user.download_speed;
        const ul = upload_speed !== undefined ? Number(upload_speed) : user.upload_speed;

        db.prepare(`
            UPDATE users 
            SET session_code = ?, 
                user_code = ?, 
                time_remaining = ?,
                download_speed = ?,
                upload_speed = ?
            WHERE id = ?
        `).run(
            codeToUpdate, 
            codeToUpdate, 
            time_remaining !== undefined ? time_remaining : user.time_remaining, 
            dl,
            ul,
            id
        );

        // Apply bandwidth limit immediately if connected
        if (user.ip_address && (download_speed !== undefined || upload_speed !== undefined)) {
            try {
                await bandwidthService.setLimit(user.ip_address, dl, ul);
            } catch (bwError) {
                console.error("Failed to apply bandwidth limit:", bwError);
            }
        }

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Admin: Delete Device (Disconnect)
app.delete('/api/admin/devices/:id', isAuthenticated, async (req, res) => {
    try {
        const id = req.params.id;
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        
        if (user) {
            // Cut internet access
            await networkService.blockUser(user.mac_address);
            db.prepare('DELETE FROM users WHERE id = ?').run(id);
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Listen with error handling
server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        console.log(`Port ${PORT} is already in use.`);
        console.log('Trying to kill the existing process...');
        
        // Try to kill the process on Linux/Unix
        require('child_process').exec(`fuser -k ${PORT}/tcp`, (err) => {
                    if (err) {
                         console.log('Could not kill process automatically. Please run: killall node');
                         process.exit(1);
                    } else {
                         console.log('Process killed. Retrying in 2 seconds...');
                         setTimeout(() => {
                             server.close();
                             server.listen(PORT);
                         }, 2000);
                    }
                });
    } else {
        console.error('Server Error:', e);
    }
});

// Initialize System (Firewall & QoS) - Linux Only
// Note: Moved to main init block at top of file to prevent race conditions and double initialization

// Global Error Handler (Express)
app.use((err, req, res, next) => {
    console.error('Unhandled Express Error:', err);
    logService.critical('SYSTEM', `Unhandled Express Error: ${err.message}`);
    res.status(500).json({ error: 'Internal Server Error' });
});

// Global Process Error Handlers
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    // Ensure logService is available (it should be)
    try {
        logService.critical('SYSTEM', `Uncaught Exception: ${err.message}\nStack: ${err.stack}`);
    } catch (e) {
        console.error('Failed to log critical error:', e);
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
    try {
        logService.critical('SYSTEM', `Unhandled Rejection: ${reason}`);
    } catch (e) {
        console.error('Failed to log critical error:', e);
    }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Piso Wifi Server running on http://0.0.0.0:${PORT}`);
});

// Graceful Shutdown
const shutdown = async (signal) => {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);
    
    // 1. Stop Monitoring Intervals
    sessionService.stopMonitoring();
    networkService.stopInterfaceMonitor();
    
    // 2. Stop Services
    try {
        if (coinService && coinService.cleanup) coinService.cleanup();
        // HardwareService usually doesn't need explicit cleanup if just GPIO writes, 
        // but if it has intervals, they should be cleared.
    } catch (e) {
        console.error('Error stopping services:', e);
    }

    // 3. Close Server
    server.close(() => {
        console.log('HTTP Server closed.');
        
        // 4. Close Database
        try {
            if (db && db.open) {
                db.close();
                console.log('Database connection closed.');
            }
        } catch (e) {
            console.error('Error closing database:', e);
        }
        
        console.log('Shutdown complete.');
        process.exit(0);
    });

    // Force exit if hanging
    setTimeout(() => {
        console.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 5000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
