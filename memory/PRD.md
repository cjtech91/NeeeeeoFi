# NeoFi Piso WiFi System - PRD

## Original Problem Statement
User requested to sync the countdown timer for "Insert Coin" modal with the relay control:
- Relay should stay ON while countdown is active
- Relay should NOT turn OFF until countdown is done
- Relay should turn OFF when: user clicks "Done Payment", closes modal, or countdown expires (60s without coin insertion)

User Choices:
- Relay Control: GPIO via ESP8266 firmware API
- Countdown Duration: 60 seconds

## Architecture
- **Backend**: Node.js/Express server (`/app/src/app.js`)
- **Frontend**: Vanilla JS portal (`/app/public/portal.html`)
- **Hardware**: ESP8266 Sub-Vendo devices with relay control
- **Real-time Communication**: Socket.io for coin pulse events

## Core Requirements (Static)
1. Countdown timer must be synced with relay state
2. Relay ON = Countdown active
3. Relay OFF only when: Done Payment clicked, Modal closed, or 60s timeout without coins

## What's Been Implemented

### January 2026
- **Fixed**: Countdown timer sync with relay
  - Added `startCoinCountdown(60, 60)` call in `coin_pulse` socket event handler
  - Ensures countdown resets every time a coin is inserted
  - Keeps relay ON while user is actively inserting coins
  - File modified: `/app/public/portal.html` (around line 1649)

## User Personas
1. **End Users (Clients)**: WiFi customers who insert coins to get internet time
2. **Admin**: Manages vendo machines, rates, and system settings

## Technical Flow
1. User clicks "Insert Coins" -> `/api/coin/start` called -> Relay ON -> 60s countdown starts
2. Coin inserted -> Backend emits `coin_pulse` event -> Frontend resets countdown to 60s -> Backend resets timeout
3. No coin for 60s -> Countdown reaches 0 -> `closeCoinModal()` called -> `/api/coin/done` -> Relay OFF
4. User clicks "I'm Done" or closes modal -> `closeCoinModal()` -> `/api/coin/done` -> Relay OFF

## Prioritized Backlog
- P0: (Completed) Countdown timer sync with relay
- P1: None
- P2: Minor timing issue (countdown shows 59s briefly after 60s)

## Next Tasks
- Monitor for any edge cases in coin insertion flow
- Consider adding visual feedback when relay state changes
