#!/bin/bash

# Get the absolute path of the project root (one level up from scripts)
# src/scripts/install_service.sh -> src/scripts -> src -> root
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVICE_FILE="/etc/systemd/system/pisowifi.service"

echo "Installing Piso Wifi Service..."
echo "Project Directory: $PROJECT_DIR"

# Check for node executable
NODE_EXEC=$(which node)
if [ -z "$NODE_EXEC" ]; then
    echo "Error: Node.js not found. Please install Node.js first."
    exit 1
fi

echo "Using Node executable: $NODE_EXEC"

# Stop existing service if running
if systemctl is-active --quiet pisowifi.service; then
    echo "Stopping existing service..."
    systemctl stop pisowifi.service
fi

# Create Service File
# We will use PM2 for process management as requested
echo "Setting up PM2..."

# 1. Start the app via PM2
# We use the ecosystem file we created
pm2 start ecosystem.config.js --env production

# 2. Save the process list
pm2 save

# 3. Setup PM2 Startup System
# This detects the init system (systemd) and configures it
# We need to execute the command that 'pm2 startup' generates.
# Since we are likely root, we can try running it directly or evaluating output.
# 'pm2 startup' prints a command line to run.
echo "Generating PM2 startup script..."
PM2_STARTUP_CMD=$(pm2 startup | grep "sudo env PATH")
if [ -n "$PM2_STARTUP_CMD" ]; then
    eval "$PM2_STARTUP_CMD"
else
    # Fallback if grep failed (maybe running as root already without sudo needed in output)
    pm2 startup
fi

echo "-----------------------------------------------------"
echo "✅ Installation Complete!"
echo "The Piso Wifi system is now running via PM2."
echo ""
echo "To view logs:     pm2 logs"
echo "To monitor:       pm2 monit"
echo "To restart:       pm2 restart piso-wifi"
echo "-----------------------------------------------------"
