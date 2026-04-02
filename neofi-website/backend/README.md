# NeoFi License API Server

This is the backend server that handles license generation, activation, and device binding.

## Setup

1. Make sure you have Node.js installed.
2. Open a terminal in this `backend` folder.
3. Install dependencies:
   ```bash
   npm install
   ```

## Running the Server

Start the server with:
```bash
npm start
```
The server will run on `http://localhost:5000`.

## API Endpoints

### For Devices (Peso Wifi Machines)

**1. Activate License**
- **URL**: `POST http://localhost:5000/api/license/activate`
- **Body**:
  ```json
  {
    "licenseKey": "PW-2024-ABC12345",
    "machineId": "AA:BB:CC:DD:EE:FF",
    "deviceInfo": {
      "ip": "192.168.1.5",
      "firmware": "v1.0.2"
    }
  }
  ```
- **Response**: Returns success and expiry date if valid.

**2. Validate License (Heartbeat)**
- **URL**: `POST http://localhost:5000/api/license/validate`
- **Body**:
  ```json
  {
    "licenseKey": "PW-2024-ABC12345",
    "machineId": "AA:BB:CC:DD:EE:FF"
  }
  ```

### For Dashboard (Frontend)

**1. Generate License**
- **URL**: `POST http://localhost:5000/api/license/generate`
- **Body**: `{ "owner": "John Doe", "duration": "12", "name": "Station 1" }`

**2. Get All Licenses**
- **URL**: `GET http://localhost:5000/api/licenses`
