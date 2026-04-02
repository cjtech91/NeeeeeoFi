# How to Activate License on Ubuntu Device
(Configured for neofisystem.com)

1. **Verify API URL:**
   - The script is pre-configured to connect to: `http://neofisystem.com/api/index.php?endpoint=activate`
   - If you uploaded your website to a subfolder (e.g., neofisystem.com/neofi), please edit `activate.py` and update the URL accordingly.

2. **Transfer the Script:**
   - Copy `activate.py` to your Ubuntu machine (using USB, SSH, etc.).

4. **Install Python Requests (if not installed):**
   Run this command on Ubuntu terminal:
   ```bash
   sudo apt update
   sudo apt install python3-requests
   ```

5. **Run the Activation:**
   Run the script:
   ```bash
   python3 activate.py
   ```
   - It will ask for the License Key.
   - Enter a key (e.g., NEO-2025-ABCD-1234).
   - If successful, it will save a `license.lic` file on the device.
