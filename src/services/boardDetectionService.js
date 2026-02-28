const fs = require('fs');
const { execSync } = require('child_process');
const configService = require('./configService');

class BoardDetectionService {
    constructor() {
        this.boardModel = null;
        this.gpioMapping = null;
    }

    init() {
        this.detectBoard();
    }

    detectBoard() {
        try {
            // Method 1: Check device tree model
            if (fs.existsSync('/proc/device-tree/model')) {
                const model = fs.readFileSync('/proc/device-tree/model', 'utf8').trim().replace(/\0/g, '');
                this.boardModel = model;
                console.log(`Board Detection: Found model: ${model}`);
                this.setGpioMapping(model);
                return;
            }

            // Method 2: Check /proc/cpuinfo for hardware field
            if (fs.existsSync('/proc/cpuinfo')) {
                const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
                const hardwareMatch = cpuinfo.match(/^Hardware\s*:\s*(.+)$/m);
                if (hardwareMatch) {
                    this.boardModel = hardwareMatch[1].trim();
                    console.log(`Board Detection: Found hardware: ${this.boardModel}`);
                    this.setGpioMapping(this.boardModel);
                    return;
                }
            }

            // Method 3: Check armbian-release file
            if (fs.existsSync('/etc/armbian-release')) {
                const armbianRelease = fs.readFileSync('/etc/armbian-release', 'utf8');
                const boardMatch = armbianRelease.match(/^BOARD=(.+)$/m);
                if (boardMatch) {
                    this.boardModel = boardMatch[1].trim();
                    console.log(`Board Detection: Found Armbian board: ${this.boardModel}`);
                    this.setGpioMapping(this.boardModel);
                    return;
                }
            }

            // Method 4: Check device tree compatible string
            if (fs.existsSync('/proc/device-tree/compatible')) {
                const compatible = fs.readFileSync('/proc/device-tree/compatible', 'utf8').trim().replace(/\0/g, '');
                const compatibles = compatible.split(',');
                for (const compat of compatibles) {
                    if (this.getBoardFromCompatible(compat)) {
                        this.boardModel = this.getBoardFromCompatible(compat);
                        console.log(`Board Detection: Found compatible: ${this.boardModel}`);
                        this.setGpioMapping(this.boardModel);
                        return;
                    }
                }
            }

            // Method 5: Detect generic x86/64 platforms via DMI (Ubuntu x86/64, PCs, mini PCs)
            if (fs.existsSync('/sys/devices/virtual/dmi/id/product_name')) {
                this.boardModel = 'Generic x86_64';
                console.log('Board Detection: Detected x86/64 platform via DMI, using Generic x86_64 profile');
                this.setGpioMapping(this.boardModel);
                return;
            }

            // Fallback to Orange Pi One as default
            console.log('Board Detection: No board detected, defaulting to Orange Pi One');
            this.boardModel = 'Orange Pi One';
            this.setGpioMapping(this.boardModel);

        } catch (error) {
            console.error('Board Detection Error:', error.message);
            this.boardModel = 'Orange Pi One';
            this.setGpioMapping(this.boardModel);
        }
    }

    getBoardFromCompatible(compat) {
        // Map compatible strings to board names
        const compatMap = {
            'xunlong,orangepi-one': 'Orange Pi One',
            'xunlong,orangepi-pc': 'Orange Pi PC',
            'xunlong,orangepi-pc-plus': 'Orange Pi PC Plus',
            'xunlong,orangepi-plus2e': 'Orange Pi Plus 2E',
            'xunlong,orangepi-zero': 'Orange Pi Zero',
            'xunlong,orangepi-zero2': 'Orange Pi Zero 2',
            'xunlong,orangepi-zero3': 'Orange Pi Zero 3',
            'xunlong,orangepi-3': 'Orange Pi 3',
            'xunlong,orangepi-4': 'Orange Pi 4',
            'xunlong,orangepi-5': 'Orange Pi 5',
            'xunlong,orangepi-5b': 'Orange Pi 5B',
            'xunlong,orangepi-5-plus': 'Orange Pi 5 Plus',
            'xunlong,orangepi-5-ultra': 'Orange Pi 5 Ultra',
            'friendlyarm,nanopi-neo': 'NanoPi NEO',
            'friendlyarm,nanopi-neo2': 'NanoPi NEO2',
            'friendlyarm,nanopi-m1': 'NanoPi M1',
            'raspberrypi,model-zero-w': 'Raspberry Pi Zero W',
            'raspberrypi,model-zero-2-w': 'Raspberry Pi Zero 2 W',
            'raspberrypi,3-model-b': 'Raspberry Pi 3B',
            'raspberrypi,3-model-b-plus': 'Raspberry Pi 3B+',
            'raspberrypi,4-model-b': 'Raspberry Pi 4B',
            'raspberrypi,5-model-b': 'Raspberry Pi 5'
        };
        return compatMap[compat] || null;
    }

    setGpioMapping(boardModel) {
        // Define GPIO pin mappings for different boards
        // (using sysfs / libgpiod numbers, not physical or WiringPi)
        const gpioMappings = {
            // ───────────────────────────────────────────────
            // Most H3/H5 Orange Pi boards (One, PC, PC Plus, Zero older, 3, 4, etc.)
            // Physical:  3=PA12=12    5=PA11=11    7=PA6=6
            'Orange Pi One': {
                coin_pin: 12,      // physical 3 = PA12
                relay_pin: 11,     // physical 5 = PA11
                bill_pin: 6,       // physical 7 = PA6 ← corrected
                coin_pin_edge: 'rising',
                bill_pin_edge: 'falling',
                relay_pin_active: 'HIGH'
            },
            'Orange Pi One - OP0100': {
                /* same as above */
                coin_pin: 12,
                relay_pin: 11,
                bill_pin: 6,
                coin_pin_edge: 'rising',
                bill_pin_edge: 'falling',
                relay_pin_active: 'HIGH'
            },
            'Orange Pi PC': {
                /* same */
                coin_pin: 12,
                relay_pin: 11,
                bill_pin: 6,
                coin_pin_edge: 'rising',
                bill_pin_edge: 'falling',
                relay_pin_active: 'HIGH'
            },
            'Orange Pi PC - OP0600': {
                /* same */
                coin_pin: 12,
                relay_pin: 11,
                bill_pin: 6,
                coin_pin_edge: 'rising',
                bill_pin_edge: 'falling',
                relay_pin_active: 'HIGH'
            },
            'Orange Pi PC Plus': {
                /* same */
                coin_pin: 12,
                relay_pin: 11,
                bill_pin: 6,
                coin_pin_edge: 'rising',
                bill_pin_edge: 'falling',
                relay_pin_active: 'HIGH'
            },
            'Orange Pi Plus 2E': {
                /* same */
                coin_pin: 12,
                relay_pin: 11,
                bill_pin: 6,
                coin_pin_edge: 'rising',
                bill_pin_edge: 'falling',
                relay_pin_active: 'HIGH'
            },
            'Orange Pi Zero': {
                /* same – older Zero uses same H2+/H3 layout */
                coin_pin: 12,
                relay_pin: 11,
                bill_pin: 6,
                coin_pin_edge: 'rising',
                bill_pin_edge: 'falling',
                relay_pin_active: 'HIGH'
            },
            'Orange Pi 3': {
                /* same */
                coin_pin: 12,
                relay_pin: 11,
                bill_pin: 6,
                coin_pin_edge: 'rising',
                bill_pin_edge: 'falling',
                relay_pin_active: 'HIGH'
            },
            'Orange Pi 3 - OP0300': {
                /* same */
                coin_pin: 12,
                relay_pin: 11,
                bill_pin: 6,
                coin_pin_edge: 'rising',
                bill_pin_edge: 'falling',
                relay_pin_active: 'HIGH'
            },
            'Orange Pi 4': {
                /* same */
                coin_pin: 12,
                relay_pin: 11,
                bill_pin: 6,
                coin_pin_edge: 'rising',
                bill_pin_edge: 'falling',
                relay_pin_active: 'HIGH'
            },
            // ... similarly for 4B, 5, 5B, 5 Plus, 5 Ultra if they expose same 40-pin compatible layout

            // ───────────────────────────────────────────────
            // Orange Pi Zero 3 (H616/H618 family) – different pinout!
            'Orange Pi Zero 3': {
                coin_pin: 229,      // usually physical ~3 (check your exact pinout!)
                relay_pin: 228,     // usually physical ~5
                bill_pin: 73,       // usually physical ~7 (PC9)
                coin_pin_edge: 'rising',
                bill_pin_edge: 'falling',
                relay_pin_active: 'HIGH'
            },
            'OrangePi Zero3': {
                /* same as above */
                coin_pin: 229,
                relay_pin: 228,
                bill_pin: 73,
                coin_pin_edge: 'rising',
                bill_pin_edge: 'falling',
                relay_pin_active: 'HIGH'
            },

            // ───────────────────────────────────────────────
            // Raspberry Pi family – physical 3,5,7 → BCM 2,3,4
            'Raspberry Pi Zero W': {
                coin_pin: 2,       // physical 3 = GPIO2
                relay_pin: 3,      // physical 5 = GPIO3
                bill_pin: 4,       // physical 7 = GPIO4 ← corrected
                coin_pin_edge: 'rising',
                bill_pin_edge: 'falling',
                relay_pin_active: 'HIGH'
            },
            'Raspberry Pi Zero 2 W': {
                /* same */
                coin_pin: 2,
                relay_pin: 3,
                bill_pin: 4,
                coin_pin_edge: 'rising',
                bill_pin_edge: 'falling',
                relay_pin_active: 'HIGH'
            },
            'Raspberry Pi 3B': {
                /* same */
                coin_pin: 2,
                relay_pin: 3,
                bill_pin: 4,
                coin_pin_edge: 'rising',
                bill_pin_edge: 'falling',
                relay_pin_active: 'HIGH'
            },
            'Raspberry Pi 3B+': {
                /* same */
                coin_pin: 2,
                relay_pin: 3,
                bill_pin: 4,
                coin_pin_edge: 'rising',
                bill_pin_edge: 'falling',
                relay_pin_active: 'HIGH'
            },
            'Raspberry Pi 4B': {
                /* same */
                coin_pin: 2,
                relay_pin: 3,
                bill_pin: 4,
                coin_pin_edge: 'rising',
                bill_pin_edge: 'falling',
                relay_pin_active: 'HIGH'
            },
            'Raspberry Pi 4 Model B': {
                /* same */
                coin_pin: 2,
                relay_pin: 3,
                bill_pin: 4,
                coin_pin_edge: 'rising',
                bill_pin_edge: 'falling',
                relay_pin_active: 'HIGH'
            },
            'Raspberry Pi 5': {
                /* same */
                coin_pin: 2,
                relay_pin: 3,
                bill_pin: 4,
                coin_pin_edge: 'rising',
                bill_pin_edge: 'falling',
                relay_pin_active: 'HIGH'
            },

            // NanoPi boards – usually Allwinner H3/H5 compatible → same as most Orange Pi
            'NanoPi NEO': {
                coin_pin: 12,
                relay_pin: 11,
                bill_pin: 6,
                coin_pin_edge: 'rising',
                bill_pin_edge: 'falling',
                relay_pin_active: 'HIGH'
            },
            'NanoPi NEO2': {
                /* same */
                coin_pin: 12,
                relay_pin: 11,
                bill_pin: 6,
                coin_pin_edge: 'rising',
                bill_pin_edge: 'falling',
                relay_pin_active: 'HIGH'
            },
            'NanoPi M1': {
                /* same */
                coin_pin: 12,
                relay_pin: 11,
                bill_pin: 6,
                coin_pin_edge: 'rising',
                bill_pin_edge: 'falling',
                relay_pin_active: 'HIGH'
            },
            'Generic x86_64': {
                gpio_disabled: true
            }
        };

        // Return the mapping for the requested board (or a default/fallback)
        this.gpioMapping = gpioMappings[boardModel] || gpioMappings['Orange Pi PC'];
        console.log(`Board Detection: GPIO mapping for ${boardModel}:`, this.gpioMapping);
        
        // Update config service with board-specific settings
        this.updateConfigSettings();
        
        return this.gpioMapping;
    }

    updateConfigSettings() {
        if (!this.gpioMapping) return;

        try {
            // Update GPIO enable/disable flag first (for generic x86/64, etc.)
            if (this.gpioMapping.gpio_disabled !== undefined) {
                configService.set('gpio_enabled', !this.gpioMapping.gpio_disabled, 'hardware');
            }

            // Update GPIO pin settings
            if (this.gpioMapping.coin_pin !== undefined) {
                configService.set('coin_pin', this.gpioMapping.coin_pin, 'hardware');
            }
            if (this.gpioMapping.relay_pin !== undefined) {
                configService.set('relay_pin', this.gpioMapping.relay_pin, 'hardware');
            }
            if (this.gpioMapping.bill_pin !== undefined) {
                configService.set('bill_pin', this.gpioMapping.bill_pin, 'hardware');
            }
            if (this.gpioMapping.coin_pin_edge !== undefined) {
                configService.set('coin_pin_edge', this.gpioMapping.coin_pin_edge, 'hardware');
            }
            if (this.gpioMapping.bill_pin_edge !== undefined) {
                configService.set('bill_pin_edge', this.gpioMapping.bill_pin_edge, 'hardware');
            }
            if (this.gpioMapping.relay_pin_active !== undefined) {
                configService.set('relay_pin_active', this.gpioMapping.relay_pin_active, 'hardware');
            }

            console.log('Board Detection: Updated config settings with board-specific GPIO mapping');
        } catch (error) {
            console.error('Board Detection Error updating config:', error.message);
        }
    }

    getBoardModel() {
        return this.boardModel;
    }

    getGpioMapping() {
        return this.gpioMapping;
    }

    // Method to get GPIO pins for shell scripts
    getGpioPins() {
        if (!this.gpioMapping) return [12, 11, 6]; // Default fallback
        return [
            this.gpioMapping.coin_pin || 12,
            this.gpioMapping.relay_pin || 11,
            this.gpioMapping.bill_pin || 6
        ];
    }
}

module.exports = new BoardDetectionService();
