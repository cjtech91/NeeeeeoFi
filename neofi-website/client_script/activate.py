import requests
import json
import socket
import uuid
import platform
import os
import sys

# CONFIGURATION
# Using neofisystem.com as the main URL (HTTPS)
API_URL = "https://neofisystem.com/api/index.php?endpoint=activate"
# Note: If you put the files in a subfolder, use: http://neofisystem.com/subfolder/api/index.php?endpoint=activate

def get_machine_id():
    """Gets a unique machine ID for Linux/Ubuntu."""
    try:
        # Try reading from /etc/machine-id (Standard on systemd systems like Ubuntu)
        if os.path.exists('/etc/machine-id'):
            with open('/etc/machine-id', 'r') as f:
                return f.read().strip()
        
        # Fallback to DBus machine-id
        if os.path.exists('/var/lib/dbus/machine-id'):
            with open('/var/lib/dbus/machine-id', 'r') as f:
                return f.read().strip()
                
    except Exception:
        pass
        
    # Final fallback: MAC address based UUID
    return str(uuid.getnode())

def get_device_info():
    """Collects basic device info."""
    return {
        "hostname": socket.gethostname(),
        "os": platform.system() + " " + platform.release(),
        "python_version": platform.python_version()
    }

def activate_license(license_key):
    machine_id = get_machine_id()
    device_info = get_device_info()
    
    print(f"[*] Device Machine ID: {machine_id}")
    print(f"[*] Connecting to Server: {API_URL}")
    
    payload = {
        "licenseKey": license_key,
        "machineId": machine_id,
        "deviceInfo": device_info
    }
    
    try:
        response = requests.post(API_URL, json=payload, timeout=10)
        
        try:
            data = response.json()
        except json.JSONDecodeError:
            print("[-] Error: Server returned non-JSON response.")
            print(f"Response: {response.text}")
            return

        if data.get('success'):
            print("\n[+] LICENSE ACTIVATED SUCCESSFULLY!")
            print(f"    Owner: {data.get('owner')}")
            print(f"    Expiry: {data.get('expiry')}")
            
            # Save license locally
            with open('license.lic', 'w') as f:
                f.write(json.dumps({
                    "key": license_key,
                    "machine_id": machine_id,
                    "expiry": data.get('expiry')
                }))
            print("[*] License saved to 'license.lic'")
            
        else:
            print(f"\n[-] Activation Failed: {data.get('message')}")
            
    except requests.exceptions.RequestException as e:
        print(f"\n[-] Connection Error: {e}")
        print("    Please check if your Windows PC IP is correct and XAMPP is running.")

if __name__ == "__main__":
    print("--- NeoFi License Activator ---")
    if len(sys.argv) > 1:
        key = sys.argv[1]
    else:
        key = input("Enter License Key: ").strip()
    
    if key:
        activate_license(key)
    else:
        print("Error: License key cannot be empty.")
