#!/bin/bash
# PPPoE IP-UP Script
# Executed by pppd when a link is established
# Arguments:
# $1: Interface name (e.g., ppp0)
# $2: TTY device
# $3: Link speed
# $4: Local IP address
# $5: Remote IP address (Client IP)
# $6: ipparam

IFACE=$1
CLIENT_IP=$5
USERNAME=$PEERNAME
MAC=$MAC_REMOTE

# Debug: Dump all environment variables to verify MAC_REMOTE availability
# echo "--- IP-UP Environment Start ---" >> /var/log/pisowifi/pppoe-env.log
# env >> /var/log/pisowifi/pppoe-env.log
# echo "--- IP-UP Environment End ---" >> /var/log/pisowifi/pppoe-env.log

# Log for debugging
echo "[$(date)] IP-UP: Interface=$IFACE IP=$CLIENT_IP User=$USERNAME MAC=$MAC" >> /var/log/pisowifi/pppoe-ip-up.log

# Notify Node.js Application
# Using curl to send a POST request
# Assuming API is running on localhost:3000

curl -X POST http://127.0.0.1:3000/api/internal/pppoe-connected \
     -H "Content-Type: application/json" \
     -d "{\"interface\": \"$IFACE\", \"ip\": \"$CLIENT_IP\", \"username\": \"$USERNAME\", \"mac\": \"$MAC\"}" \
     --connect-timeout 5 \
     >> /var/log/pisowifi/pppoe-ip-up.log 2>&1

# Exit successfully
exit 0
