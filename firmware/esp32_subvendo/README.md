# ESP32 Sub Vendo Firmware

This firmware allows an ESP32 to function as a Sub Vendo device for the NeoFi system.

## Features
- **WiFi Management**: Connects to the main NeoFi network.
- **Coin Acceptor Interface**: Handles coin pulses via interrupt.
- **Relay Control**: Activates the vending machine relay.
- **Web Interface**: Captive portal for initial configuration.
- **Admin Integration**: Managed via the NeoFi Admin Panel.

## Hardware Requirements
- ESP32 Development Board (e.g., ESP32 DevKit V1)
- Coin Acceptor (configured for pulse output)
- Relay Module (active high/low configurable)
- Power Supply (5V/12V depending on setup)

## Pin Configuration (Default)
- **Coin Signal Pin**: GPIO 13 (Input, Pull-up)
- **Relay Control Pin**: GPIO 12 (Output)
- **Bill Acceptor Pin**: GPIO 16 (Input, Pull-up)
- **Standby LED**: GPIO 18 (Output, Active High)
- **Insert LED**: GPIO 5 (Output, Active High)
- **Status LED**: GPIO 2 (Built-in LED)
- **Reset Button**: Flash Button (GPIO 0) - Hold 10s to reset WiFi/Config

*Note: Pins are configurable via the Admin Panel after initial setup.*

## Installation
1. **Install Arduino IDE**: Download and install the latest Arduino IDE.
2. **Install ESP32 Board Support**:
   - Open Arduino IDE > File > Preferences.
   - Add `https://dl.espressif.com/dl/package_esp32_index.json` to "Additional Boards Manager URLs".
   - Go to Tools > Board > Boards Manager, search for "esp32", and install "esp32 by Espressif Systems".
3. **Select Board**: Tools > Board > ESP32 Arduino > DOIT ESP32 DEVKIT V1 (or your specific board).
4. **Open Firmware**: Open `esp32_subvendo.ino` in Arduino IDE.
5. **Compile & Upload**: Connect your ESP32 via USB and click the Upload button.

## Setup
1. Power on the ESP32.
2. Connect to the WiFi network named `SubVendo_Setup_XXXXXX`.
3. A configuration portal should open automatically (or visit `192.168.4.1`).
4. Enter the **Sub Vendo Key** (found in NeoFi Admin Panel > Sub Vendo).
5. Configure WiFi credentials for the main network.
6. Save and Reboot.
7. The device should appear in the NeoFi Admin Panel "Waiting List" for approval.
