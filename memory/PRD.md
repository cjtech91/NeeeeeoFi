# NeoFi Piso WiFi System - PRD

## Original Problem Statement
User requested to sync the countdown timer for "Insert Coin" modal with the relay control:
- Relay should stay ON while countdown is active
- Relay should NOT turn OFF until countdown is done
- Relay should turn OFF when: user clicks "Done Payment", closes modal, or countdown expires (60s without coin insertion)

User Choices:
- Relay Control: GPIO via ESP8266 firmware API
- Countdown Duration: 60 seconds

## Second Issue: Pulse Detection Problems
User reported that coin pulse detection is inconsistent on both main device and sub-vendo ESP8266:
- Sometimes reads fewer pulses than actual coins inserted (5, 10, 20 peso)
- Rapid successive coin insertions cause missed pulses
- Coin corrector already set but still has issues

## Architecture
- **Backend**: Node.js/Express server (`/app/src/app.js`)
- **Frontend**: Vanilla JS portal (`/app/public/portal.html`)
- **Hardware**: ESP8266 Sub-Vendo devices with relay control
- **Real-time Communication**: Socket.io for coin pulse events

## Core Requirements (Static)
1. Countdown timer must be synced with relay state
2. Relay ON = Countdown active
3. Relay OFF only when: Done Payment clicked, Modal closed, or 60s timeout without coins
4. Accurate pulse detection for all coin denominations

## What's Been Implemented

### January 2026 - Session 1
- **Fixed**: Countdown timer sync with relay
  - Added `startCoinCountdown(60, 60)` call in `coin_pulse` socket event handler
  - Ensures countdown resets every time a coin is inserted
  - Applied to ALL 7 portal themes

### January 2026 - Session 2: Pulse Detection Improvements
- **ESP8266 Firmware (v1.5)**:
  - Debounce: **50ms** (50000 microseconds) - filters mechanical bounce
  - Pulse accumulation wait: **350ms** (reduced from 800ms for faster response)
  - Send interval: **300ms** (reduced from 500ms)
  - File: `/app/firmware/esp8266_subvendo/esp8266_subvendo.ino`

- **Main Device coinService.js**:
  - Default debounce: **50ms**
  - commit_time_base: **400ms** (reduced from 800ms)
  - commit_time_large: **600ms** (reduced from 2000ms)
  - Improved pulse snapping with wider tolerance ranges
  - File: `/app/src/services/coinService.js`

- **Backend app.js - Relay Control Fix**:
  - Added comprehensive session tracking with `relayOwner` flag
  - Added detailed logging for pulse events and session creation
  - Improved check for other active sessions before turning off relay
  - Added debug logs to trace relay state changes
  - File: `/app/src/app.js`

## Config Options for Fine-Tuning
Admins can adjust these in the config if needed:
- `coin_debounce`: Debounce time in ms (default: 15)
- `coin_commit_time_base`: Wait time for small coins (default: 500ms)
- `coin_commit_time_large`: Wait time for large coins (default: 1500ms)
- `coin_pulse_snap_enabled`: Enable/disable pulse snapping (default: true)
- `coin_single_coin_mode`: Single coin detection mode (default: true)
- `coin_single_coin_max_gap_ms`: Max gap between pulses (default: 800ms)
- `coin_pulse_map`: Custom pulse-to-peso mapping object

## User Personas
1. **End Users (Clients)**: WiFi customers who insert coins to get internet time
2. **Admin**: Manages vendo machines, rates, and system settings

## Prioritized Backlog
- P0: (Completed) Countdown timer sync with relay
- P0: (Completed) Improved pulse detection accuracy
- P1: Hardware testing on actual devices
- P2: Add diagnostic logging for pulse detection issues

## Next Tasks
- Flash updated firmware (v1.3) to all ESP8266 sub-vendo devices
- Test pulse detection with 5, 10, and 20 peso coins
- Monitor and adjust timing values if needed
- Consider adding pulse detection diagnostic mode in admin panel
