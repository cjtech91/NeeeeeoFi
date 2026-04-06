const EventEmitter = require('events');
const configService = require('./configService');
const boardDetectionService = require('./boardDetectionService');
const licenseService = require('./licenseService');
const fs = require('fs');

const { execSync } = require('child_process');
const path = require('path');

// Use dynamic import for onoff to avoid build errors on Windows dev
let Gpio;
try {
    if (process.platform !== 'win32') {
        Gpio = require('onoff').Gpio;
    }
} catch (e) {
    console.log('GPIO not available (Simulation Mode)');
}

class CoinService extends EventEmitter {
    constructor() {
        super();
        this.gpioPin = null;
        this.coinInsert = null;
        
        this.billPin = null;
        this.billValidator = null;
        this.coinPinEdge = 'both';
        this.coinIdleLevel = null;
        this.lastCoinLevel = null;
        this.burstStartNs = 0n;
        this.burstLastNs = 0n;
        this.burstMaxGapNs = 0n;
        
        this.pulseCount = 0;
        this.lastPulseTime = 0;
        this.lastPulseTimeNs = 0n;
        this.debounceTimer = null;
        this.timer = null;
        this.debounceTime = 0;
        this.commitTimeBase = 400;
        this.commitTimeLarge = 1200;
        
        this.isBanned = false;
        this.banTimer = null;
        this.activityStart = 0; // Track start of pulse activity
        
        // Run cleanup script before initialization (Linux only)
        if (process.platform !== 'win32') {
            try {
                const scriptPath = path.join(__dirname, '../scripts/fix_gpio.sh');
                console.log('CoinService: Running GPIO cleanup script...');
                execSync(`chmod +x "${scriptPath}"`);
                execSync(`"${scriptPath}"`);
                console.log('CoinService: GPIO cleanup complete.');
            } catch (err) {
                console.error('CoinService: GPIO cleanup failed:', err.message);
            }
        }
    }

    async init() {
        // Detect board and update config before initializing GPIO
        if (boardDetectionService && typeof boardDetectionService.init === 'function') {
            boardDetectionService.init();
        }

        // Initialize with config
        await this.initGpio().catch(err => console.error('CoinService: Fatal Init Error', err));
    }
    
    // Helper to force unexport a pin if it's busy
    forceCleanup(pin) {
        if (!pin || process.platform === 'win32') return;
        try {
            console.log(`CoinService: Forcing cleanup of GPIO ${pin}...`);
            // Check if exported first to avoid error? sysfs unexport doesn't care much, but good to check.
            if (fs.existsSync(`/sys/class/gpio/gpio${pin}`)) {
                 fs.writeFileSync('/sys/class/gpio/unexport', pin.toString());
                 console.log(`CoinService: Successfully unexported GPIO ${pin}`);
            }
        } catch (e) {
            console.warn(`CoinService: Failed to force cleanup GPIO ${pin}: ${e.message}`);
        }
    }

    async initGpio() {
        // Allow board detection to disable GPIO completely (e.g., Generic x86/64 builds)
        const gpioEnabled = configService.get('gpio_enabled', true);
        if (!gpioEnabled) {
            console.log('CoinService: GPIO is disabled for this platform (gpio_enabled=false). Running without hardware coin/bill GPIO.');
            return;
        }

        // Optimized timing for accurate AND fast pulse detection:
        // - debounce: 50ms to filter mechanical bounce and electrical noise
        // - commit_time_base: 400ms - faster response while still grouping pulses
        // - commit_time_large: 600ms for larger denominations
        this.debounceTime = Math.max(0, parseInt(configService.get('coin_debounce', 50))); // 50ms debounce
        this.commitTimeBase = Math.max(50, parseInt(configService.get('coin_commit_time', 400))); // Reduced to 400ms
        this.commitTimeBase = Math.max(50, parseInt(configService.get('coin_commit_time_base', this.commitTimeBase)));
        this.commitTimeLarge = Math.max(this.commitTimeBase, parseInt(configService.get('coin_commit_time_large', 600))); // Reduced to 600ms

        // --- Coin Settings ---
        const pin = parseInt(configService.get('coin_pin', 12)); // Default 12 (PA12)
        // Always use BOTH edges for maximum capture reliability; we will count only the active transition.
        let pinEdge = 'both';
        this.coinPinEdge = pinEdge;
        // Active level configuration:
        // - low/high: explicit pulse-active level
        // - auto: determine active level from idle level after pin init (active = inverse(idle))
        const activeLevelCfg = String(configService.get('coin_active_level', 'auto')).toLowerCase();
        this.activeLevel = (activeLevelCfg === 'high') ? 1 : (activeLevelCfg === 'low' ? 0 : null);
        
        // --- Bill Settings ---
        const billPin = parseInt(configService.get('bill_pin', 19)); // Default 19 (PA19) - Changed from 15 to avoid EBUSY
        let billPinEdge = configService.get('bill_pin_edge', 'falling');
        if (typeof billPinEdge === 'string') billPinEdge = billPinEdge.toLowerCase();
        this.billMultiplier = parseInt(configService.get('bill_multiplier', 1));
        
        // --- Ban Settings ---
        // User requested "Insert attempt ban Counter: 10s". 
        // We interpret this as a time limit (seconds) for continuous activity before banning.
        this.banLimit = parseInt(configService.get('ban_limit_counter', 10)); 
        this.banDuration = parseInt(configService.get('ban_duration', 1)); // minutes

        const activeLabel = (this.activeLevel === null) ? 'AUTO' : (this.activeLevel === 0 ? 'LOW' : 'HIGH');
        console.log(`CoinService: Init Coin(GPIO${pin}, ${pinEdge}, Active:${activeLabel}) | Bill(GPIO${billPin}, ${billPinEdge}, x${this.billMultiplier}) | Debounce(${this.debounceTime}ms) | Commit(Base:${this.commitTimeBase}ms Large:${this.commitTimeLarge}ms) | Ban(Limit: ${this.banLimit}s, Duration: ${this.banDuration}m)`);

        // Cleanup Coin Object
        if (this.coinInsert) {
             try { this.coinInsert.unexport(); } catch(e){}
             this.coinInsert = null;
        }
        
        // Cleanup Bill Object
        if (this.billValidator) {
             try { this.billValidator.unexport(); } catch(e){}
             this.billValidator = null;
        }

        this.gpioPin = pin;
        this.billPin = billPin;

        if (Gpio) {
            const initPin = async (pinNum, edge, label) => {
                const debounce = 0; // disable kernel debounce; we handle in software
                try {
                    const gpio = new Gpio(pinNum, 'in', edge, { debounceTimeout: debounce });
                    return gpio;
                } catch (err) {
                    if (err.code === 'EBUSY') {
                        console.warn(`CoinService: GPIO ${pinNum} is BUSY. Attempting force cleanup...`);
                        this.forceCleanup(pinNum);
                        
                        // Wait for cleanup
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                        try {
                            // Retry 1
                            return new Gpio(pinNum, 'in', edge, { debounceTimeout: debounce });
                        } catch (retryErr) {
                            if (retryErr.code === 'EBUSY') {
                                console.warn(`CoinService: GPIO ${pinNum} still BUSY. Trying second cleanup (2s)...`);
                                this.forceCleanup(pinNum);
                                await new Promise(resolve => setTimeout(resolve, 2000));
                                try {
                                    return new Gpio(pinNum, 'in', edge, { debounceTimeout: debounce });
                                } catch (err2) {
                                    console.error(`CoinService: Failed to init ${label} GPIO ${pinNum} after 2nd cleanup:`, err2.message);
                                    return null;
                                }
                            }
                            console.error(`CoinService: Failed to init ${label} GPIO ${pinNum} after cleanup:`, retryErr.message);
                            return null;
                        }
                    } else {
                        console.error(`CoinService: Error initializing ${label} GPIO ${pinNum}:`, err.message);
                        return null;
                    }
                }
            };

            // Coin
            this.coinInsert = await initPin(this.gpioPin, pinEdge, 'Coin');
            if (this.coinInsert) {
                try {
                    const idle = this.coinInsert.readSync();
                    if (idle === 0 || idle === 1) {
                        this.coinIdleLevel = idle;
                        if (this.activeLevel === null) {
                            this.activeLevel = idle === 0 ? 1 : 0;
                        }
                        console.log(`CoinService: Coin idle=${idle} => active=${this.activeLevel === 0 ? 'LOW' : 'HIGH'}`);
                    }
                } catch (e) {}
                this.coinInsert.watch(this.handleCoinPulse.bind(this));
            }
            
            // Bill
            this.billValidator = await initPin(this.billPin, billPinEdge, 'Bill');
            if (this.billValidator) {
                this.billValidator.watch(this.handleBillPulse.bind(this));
            }

        } else {
            console.log('CoinService: Running in simulation mode (Windows/No GPIO)');
        }
    }

    triggerBan() {
        if (this.isBanned) return;
        this.isBanned = true;
        console.warn(`CoinService: BANNED for ${this.banDuration} minutes due to suspicious activity (>${this.banLimit}s).`);
        
        // Clear any pending commits
        this.pulseCount = 0;
        this.activityStart = 0;
        if (this.timer) clearTimeout(this.timer);

        // Unban after duration
        setTimeout(() => {
            this.isBanned = false;
            console.log('CoinService: Ban lifted.');
        }, this.banDuration * 60 * 1000);
    }

    checkBanCondition() {
        if (this.isBanned) return true;
        
        const now = Date.now();
        // Start tracking activity duration on first pulse
        if (this.activityStart === 0) {
            this.activityStart = now;
        } else {
            // Check if activity has exceeded the limit
            const durationSeconds = (now - this.activityStart) / 1000;
            if (durationSeconds > this.banLimit) {
                this.triggerBan();
                return true;
            }
        }
        return false;
    }

    handleCoinPulse(err, value) {
        if (err) return;

        // Check License Restriction
        if (!licenseService.isFeatureEnabled('insert_coin')) {
            console.warn('CoinService: Insert Coin DISABLED due to License Restriction (Trial Expired).');
            return;
        }

        const level = (value === 0 || value === 1) ? value : null;
        if (level === null) return;
        const prevLevel = this.lastCoinLevel;
        this.lastCoinLevel = level;

        if (this.coinPinEdge === 'both') {
            const active = (this.activeLevel === 0 || this.activeLevel === 1) ? this.activeLevel : 0;
            if (level !== active) return;
            if (prevLevel === level) return;
        }

        if (this.checkBanCondition()) return;
        
        const now = Date.now();
        const nowNs = process.hrtime.bigint();
        const debounceNs = BigInt(Math.max(0, Number(this.debounceTime) || 0)) * 1000000n;
        if (debounceNs > 0n) {
            if (this.lastPulseTimeNs && (nowNs - this.lastPulseTimeNs) < debounceNs) return;
        }
        this.lastPulseTime = now;
        this.lastPulseTimeNs = nowNs;

        this.pulseCount++;
        try {
            if (this.burstStartNs === 0n) this.burstStartNs = nowNs;
            if (this.burstLastNs !== 0n) {
                const gap = nowNs - this.burstLastNs;
                if (gap > this.burstMaxGapNs) this.burstMaxGapNs = gap;
            }
            this.burstLastNs = nowNs;
        } catch (e) {}
        try {
            this.emit('pulse', 1);
        } catch (e) {}
        
        // Reset the commit timer
        if (this.timer) clearTimeout(this.timer);

        this.timer = setTimeout(() => {
            this.commitCoins();
        }, (this.pulseCount >= 6) ? this.commitTimeLarge : this.commitTimeBase);
    }
    
    handleBillPulse(err, value) {
        if (err) return;

        // Check License Restriction
        if (!licenseService.isFeatureEnabled('insert_coin')) {
            console.warn('CoinService: Bill Insert DISABLED due to License Restriction (Trial Expired).');
            return;
        }

        if (this.checkBanCondition()) return;
        
        const now = Date.now();
        const nowNs = process.hrtime.bigint();
        const debounceNs = BigInt(Math.max(0, Number(this.debounceTime) || 0)) * 1000000n;
        if (debounceNs > 0n) {
            if (this.lastPulseTimeNs && (nowNs - this.lastPulseTimeNs) < debounceNs) return;
        }
        this.lastPulseTime = now;
        this.lastPulseTimeNs = nowNs;
        
        this.pulseCount += this.billMultiplier; 
        
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.commitCoins();
        }, (this.pulseCount >= 6) ? this.commitTimeLarge : this.commitTimeBase);
    }

    commitCoins() {
        if (this.pulseCount > 0) {
            const rawPulses = this.pulseCount;
            let amount = rawPulses;
            let burstMs = 0;
            let maxGapMs = 0;
            try {
                if (this.burstStartNs && this.burstLastNs && this.burstLastNs >= this.burstStartNs) {
                    burstMs = Number((this.burstLastNs - this.burstStartNs) / 1000000n);
                }
                if (this.burstMaxGapNs && this.burstMaxGapNs > 0n) {
                    maxGapMs = Number(this.burstMaxGapNs) / 1000000;
                }
            } catch (e) {}

            try {
                const map = configService.get('coin_pulse_map', null);
                if (map && typeof map === 'object' && map[String(rawPulses)] != null) {
                    const mapped = Number(map[String(rawPulses)]);
                    if (Number.isFinite(mapped) && mapped > 0) amount = mapped;
                } else {
                    const snapEnabledRaw = configService.get('coin_pulse_snap_enabled', true);
                    const snapEnabled = snapEnabledRaw !== false && snapEnabledRaw !== 'false' && snapEnabledRaw !== 0 && snapEnabledRaw !== '0';
                    if (snapEnabled) {
                        const singleModeRaw = configService.get('coin_single_coin_mode', true);
                        const singleMode = singleModeRaw !== false && singleModeRaw !== 'false' && singleModeRaw !== 0 && singleModeRaw !== '0';
                        if (singleMode) {
                            const maxGapAllowedMs = Math.max(0, parseInt(configService.get('coin_single_coin_max_gap_ms', 800)));
                            const allowSnap = maxGapMs <= maxGapAllowedMs;
                            if (allowSnap) {
                                // Improved pulse snapping with wider tolerance ranges
                                // This helps catch coins even when some pulses are missed
                                // Typical pulse counts: 1 peso = 1 pulse, 5 peso = 5 pulses, 10 peso = 10 pulses, 20 peso = 20 pulses
                                if (rawPulses >= 17) amount = 20;        // 17-20+ -> 20 peso (wider tolerance)
                                else if (rawPulses >= 8 && rawPulses <= 16) amount = 10;  // 8-16 -> 10 peso (wider tolerance)
                                else if (rawPulses >= 3 && rawPulses <= 7) amount = 5;    // 3-7 -> 5 peso (wider tolerance)
                                else if (rawPulses >= 1 && rawPulses <= 2) amount = rawPulses; // 1-2 -> exact (1 or 2 peso)
                            }
                        } else {
                            // Multi-coin mode: More aggressive snapping
                            if (rawPulses >= 17) amount = 20;
                            else if (rawPulses >= 8 && rawPulses <= 16) amount = 10;
                            else if (rawPulses >= 3 && rawPulses <= 7) amount = 5;
                            else if (rawPulses >= 1 && rawPulses <= 2) amount = rawPulses;
                        }
                    }
                }
            } catch (e) {}

            if (amount !== rawPulses) console.log(`Coin Inserted: ${rawPulses} pulses -> ₱${amount}`);
            else console.log(`Coin Inserted: ${rawPulses} pulses`);
            this.emit('coin', amount);
            this.pulseCount = 0;
            this.burstStartNs = 0n;
            this.burstLastNs = 0n;
            this.burstMaxGapNs = 0n;
            this.lastCoinLevel = null;
            this.activityStart = 0; // Reset activity timer on successful commit
        }
    }
}

module.exports = new CoinService();
