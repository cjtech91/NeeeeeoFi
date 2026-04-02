# Raspberry Pi 3 (Ubuntu) Connection Guide

I cannot directly access your Raspberry Pi remotely, but I have prepared the **exact commands** you need to run on your Raspberry Pi to connect it to the NeoFi System.

## Option 1: Quick Activation Test (Using Python)
Use this if you just want to verify the license system works on the Pi.

1.  **Open Terminal** on your Raspberry Pi.
2.  **Install Python Requests:**
    ```bash
    sudo apt update
    sudo apt install python3-requests -y
    ```
3.  **Create the Activation Script:**
    ```bash
    nano activate.py
    ```
4.  **Paste the Code:**
    (Copy the code from `client_script/activate.py` in your project folder and paste it here. It is already configured for `neofisystem.com`).
    *Press `Ctrl+X`, then `Y`, then `Enter` to save.*

5.  **Run Activation:**
    ```bash
    python3 activate.py
    ```
    *Enter a license key when prompted.*

---

## Option 2: Full Integration (If running the Node.js App)
If your Raspberry Pi is running the `neofi_pisowifi` Node.js application, follow these steps to update it with the new licensing features.

1.  **Transfer Files:**
    You need to copy the modified files from your computer to the Raspberry Pi inside the `neofi_pisowifi` folder:
    *   `src/services/licenseService.js`  -> to  `/path/to/neofi_pisowifi/src/services/`
    *   `src/app.js`                      -> to  `/path/to/neofi_pisowifi/src/`
    *   `public/activation.html`          -> to  `/path/to/neofi_pisowifi/public/`

2.  **Restart the App:**
    ```bash
    # Example command (adjust depending on how you run your app)
    pm2 restart all
    # OR
    node src/app.js
    ```

3.  **Verify:**
    Open the browser on the Pi (or a device connected to its Wifi) and try to access the dashboard. It should redirect you to the **Activation Page**.
