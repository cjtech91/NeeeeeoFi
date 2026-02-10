# NeoFi Licensing System Guide

This project includes a secure licensing system that restricts access to core features until a valid license key is activated. The system uses RSA 2048-bit encryption to sign licenses and binds them to the device's Hardware ID (HWID).

## 1. Initial Setup (One-Time)

Before deploying or running the system, you must generate the RSA Key Pair. This creates a private key for your licensing server and a public key for the Piso Wifi client.

**Run the key generator:**
```bash
node generate_keys.js
```
*   **Private Key**: Saved to `neofisystem_web/keys/private.pem`. **KEEP THIS SAFE!** It is used to sign valid licenses.
*   **Public Key**: Saved to `src/config/license_public.pem`. This is distributed with the Piso Wifi software to verify licenses.

## 2. Licensing Server (neofisystem_web)

The `neofisystem_web` folder contains the code for your central licensing server (e.g., neofisystem.com).

**Start the Server:**
```bash
cd neofisystem_web
npm install
node server.js
```
The server runs on port `8080` by default.

**Generate a New License Key:**
To create a new license key (e.g., for a customer), run this script:
```bash
node neofisystem_web/generate_license.js
```
This will output a new key (e.g., `NEO-ABCD-1234-EFGH`) and save it to the `licenses.db` database.

## 3. Client Activation (Piso Wifi)

When a user installs the Piso Wifi software:
1.  They navigate to the **Admin Dashboard > Settings**.
2.  They will see a "License Required" status if not activated.
3.  They enter the License Key you provided.
4.  The system sends the Key + HWID to your Licensing Server (`http://localhost:8080/api/activate`).
5.  If valid, the server returns a **Signed License Token**.
6.  The client saves this token to `data/license.json`.
7.  The system unlocks all features.

## 4. Security Features

*   **HWID Binding**: Licenses are locked to the specific hardware (MAC Address + CPU Serial). A key cannot be reused on another device once activated.
*   **RSA Signatures**: The license file (`data/license.json`) is digitally signed. Users cannot fake a license by simply editing the JSON file; the signature verification will fail.
*   **Middleware Enforcement**: All core APIs (PPPoE, Vouchers, Network Config) are blocked at the server level for unlicensed users.

## 5. Troubleshooting

*   **"Public Key missing!"**: Run `node generate_keys.js`.
*   **"Invalid Signature"**: The license file has been tampered with or does not match the public key.
*   **"System Unlicensed"**: The user needs to activate their license in the Admin Dashboard.
