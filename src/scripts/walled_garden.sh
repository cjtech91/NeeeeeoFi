#!/bin/bash

# Configuration
LAN_IF="br0"
IPSET_ACCEPT4="wg_accept"
IPSET_DROP4="wg_drop"
IPSET_ACCEPT6="wg_accept6"
IPSET_DROP6="wg_drop6"
DNSMASQ_DIR="/etc/dnsmasq.d"
WG_CHAIN="WG_DOMAIN"
WG_NAT_CHAIN="WG_DOMAIN_NAT"

command=$1
domain=$2
type=$3
iplist=$4

init() {
    # Create IP sets if they don't exist
    ipset create $IPSET_ACCEPT4 hash:ip -exist
    ipset create $IPSET_DROP4 hash:ip -exist
    ipset create $IPSET_ACCEPT6 hash:ip family inet6 -exist 2>/dev/null || true
    ipset create $IPSET_DROP6 hash:ip family inet6 -exist 2>/dev/null || true

    # DOMAIN-BASED approach:
    # - DROP and ALLOW are applied per-domain using dnsmasq ipset tagging.
    # - This chain must run BEFORE the "mark!=99 DROP" captive portal wall.

    # 1) Filter chain (FORWARD)
    iptables -N $WG_CHAIN 2>/dev/null || true
    iptables -F $WG_CHAIN 2>/dev/null || true
    # Always enforce deny (even for authorized users)
    iptables -A $WG_CHAIN -m set --match-set $IPSET_DROP4 dst -j DROP
    # Allowlist for unauthenticated users (still blocked by mark wall otherwise)
    iptables -A $WG_CHAIN -m set --match-set $IPSET_ACCEPT4 dst -j ACCEPT
    iptables -A $WG_CHAIN -j RETURN

    # Ensure our chain is evaluated first (remove duplicates then insert at top)
    while iptables -C FORWARD -j $WG_CHAIN 2>/dev/null; do
        iptables -D FORWARD -j $WG_CHAIN 2>/dev/null || break
    done
    iptables -I FORWARD 1 -j $WG_CHAIN

    # 2) NAT chain (PREROUTING) to bypass captive portal redirect for allowlisted domains
    iptables -t nat -N $WG_NAT_CHAIN 2>/dev/null || true
    iptables -t nat -F $WG_NAT_CHAIN 2>/dev/null || true
    # Only bypass portal redirect for unauthenticated users (mark!=99)
    iptables -t nat -A $WG_NAT_CHAIN -m mark ! --mark 99 -m set --match-set $IPSET_ACCEPT4 dst -j ACCEPT
    iptables -t nat -A $WG_NAT_CHAIN -j RETURN

    while iptables -t nat -C PREROUTING -j $WG_NAT_CHAIN 2>/dev/null; do
        iptables -t nat -D PREROUTING -j $WG_NAT_CHAIN 2>/dev/null || break
    done
    iptables -t nat -I PREROUTING 1 -j $WG_NAT_CHAIN

    # 3) IPv6 filter chain (FORWARD) if available
    if command -v ip6tables >/dev/null; then
        ip6tables -N $WG_CHAIN 2>/dev/null || true
        ip6tables -F $WG_CHAIN 2>/dev/null || true
        ip6tables -A $WG_CHAIN -m set --match-set $IPSET_DROP6 dst -j DROP 2>/dev/null || true
        ip6tables -A $WG_CHAIN -m set --match-set $IPSET_ACCEPT6 dst -j ACCEPT 2>/dev/null || true
        ip6tables -A $WG_CHAIN -j RETURN 2>/dev/null || true

        while ip6tables -C FORWARD -j $WG_CHAIN 2>/dev/null; do
            ip6tables -D FORWARD -j $WG_CHAIN 2>/dev/null || break
        done
        ip6tables -I FORWARD 1 -j $WG_CHAIN 2>/dev/null || true
    fi

    echo "Walled Garden initialized."
}

add() {
    if [ -z "$domain" ] || [ -z "$type" ]; then
        echo "Usage: add <domain> <type> [iplist]"
        exit 1
    fi

    local set_name=""
    local set_name_v4=""
    local set_name_v6=""
    if [ "$type" == "ACCEPT" ]; then
        set_name_v4=$IPSET_ACCEPT4
        set_name_v6=$IPSET_ACCEPT6
    elif [ "$type" == "DROP" ]; then
        set_name_v4=$IPSET_DROP4
        set_name_v6=$IPSET_DROP6
    else
        echo "Invalid type. Use ACCEPT or DROP."
        exit 1
    fi

    # Create dnsmasq config for this domain
    # ipset=/domain.com/wg_accept
    # For DROP, also return 0.0.0.0/:: to block resolution (helps even if ipset tagging is slow)
    cfg="$DNSMASQ_DIR/wg_$domain.conf"
    echo "ipset=/$domain/$set_name_v4,$set_name_v6" > "$cfg"
    if [ "$type" == "DROP" ]; then
        echo "address=/$domain/0.0.0.0" >> "$cfg"
        echo "address=/$domain/::" >> "$cfg"
    fi

    # Reload dnsmasq to apply
    systemctl reload dnsmasq 2>/dev/null || systemctl restart dnsmasq 2>/dev/null || /etc/init.d/dnsmasq restart 2>/dev/null || service dnsmasq restart 2>/dev/null || true

    # Also enforce DROP by matching domain in HTTP Host header and TLS SNI (best-effort).
    # This blocks even when clients use DoH/alternate DNS (since the domain is still in the request/ClientHello).
    if [ "$type" == "DROP" ]; then
        # HTTP (Host header)
        iptables -C $WG_CHAIN -p tcp --dport 80 -m string --algo bm --string "$domain" --to 1024 -m comment --comment "wg_sni:$domain" -j DROP 2>/dev/null || \
            iptables -I $WG_CHAIN 1 -p tcp --dport 80 -m string --algo bm --string "$domain" --to 1024 -m comment --comment "wg_sni:$domain" -j DROP 2>/dev/null || true

        # HTTPS (TLS ClientHello SNI is plaintext)
        iptables -C $WG_CHAIN -p tcp --dport 443 -m string --algo bm --string "$domain" --to 1024 -m comment --comment "wg_sni:$domain" -j DROP 2>/dev/null || \
            iptables -I $WG_CHAIN 1 -p tcp --dport 443 -m string --algo bm --string "$domain" --to 1024 -m comment --comment "wg_sni:$domain" -j DROP 2>/dev/null || true
    fi
    
    # Resolve and add immediately for instant effect
    # We use 'dig' or 'nslookup' or 'getent' or 'ping' to find IPs
    echo "Resolving $domain..." >> /var/log/walled_garden.log
    
    # Try using getent ahosts first (usually standard)
    if command -v getent >/dev/null; then
        getent ahosts "$domain" | awk '{print $1}' | sort -u | while read -r ip; do
             if [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
                 echo "Adding $ip to $set_name_v4 (getent)" >> /var/log/walled_garden.log
                 ipset add $set_name_v4 $ip -exist
             elif [[ "$ip" =~ : ]]; then
                 echo "Adding $ip to $set_name_v6 (getent)" >> /var/log/walled_garden.log
                 ipset add $set_name_v6 $ip -exist 2>/dev/null || true
             fi
        done
    fi

    # Try nslookup (Standard & BusyBox support)
    if command -v nslookup >/dev/null; then
         # Matches "Address: 1.2.3.4" and "Address 1: 1.2.3.4"
         nslookup "$domain" | awk '/^Address/ { print $NF }' | while read -r ip; do
             if [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
                 echo "Adding $ip to $set_name_v4 (nslookup)" >> /var/log/walled_garden.log
                 ipset add $set_name_v4 $ip -exist
             elif [[ "$ip" =~ : ]]; then
                 echo "Adding $ip to $set_name_v6 (nslookup)" >> /var/log/walled_garden.log
                 ipset add $set_name_v6 $ip -exist 2>/dev/null || true
             fi
         done
    fi

    # Try dig (Best if available)
    if command -v dig >/dev/null; then
         dig +short "$domain" | while read -r ip; do
             if [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
                 echo "Adding $ip to $set_name_v4 (dig)" >> /var/log/walled_garden.log
                 ipset add $set_name_v4 $ip -exist
             elif [[ "$ip" =~ : ]]; then
                 echo "Adding $ip to $set_name_v6 (dig)" >> /var/log/walled_garden.log
                 ipset add $set_name_v6 $ip -exist 2>/dev/null || true
             fi
         done
    fi

    # If the API already resolved IPs, apply them too (static drop helps even when clients bypass DNS)
    if [ -n "$iplist" ]; then
        IFS=',' read -ra IPS <<< "$iplist"
        for raw in "${IPS[@]}"; do
            ip="$(echo "$raw" | xargs)"
            if [ -z "$ip" ]; then
                continue
            fi
            if [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
                ipset add $set_name_v4 $ip -exist 2>/dev/null || true
                if [ "$type" == "DROP" ]; then
                    iptables -C $WG_CHAIN -d $ip -m comment --comment "wg:$domain" -j DROP 2>/dev/null || \
                        iptables -I $WG_CHAIN 1 -d $ip -m comment --comment "wg:$domain" -j DROP
                fi
            elif [[ "$ip" =~ : ]]; then
                ipset add $set_name_v6 $ip -exist 2>/dev/null || true
                if [ "$type" == "DROP" ] && command -v ip6tables >/dev/null; then
                    ip6tables -C $WG_CHAIN -d $ip -m comment --comment "wg:$domain" -j DROP 2>/dev/null || \
                        ip6tables -I $WG_CHAIN 1 -d $ip -m comment --comment "wg:$domain" -j DROP 2>/dev/null || true
                fi
            fi
        done
    fi
    
    echo "Added $domain to $type list."
}

remove() {
    if [ -z "$domain" ]; then
        echo "Usage: remove <domain>"
        exit 1
    fi

    # Remove any static rules we inserted for this domain
    while iptables -S $WG_CHAIN 2>/dev/null | grep -q "wg:$domain"; do
        rule=$(iptables -S $WG_CHAIN 2>/dev/null | grep "wg:$domain" | head -n 1)
        if [ -n "$rule" ]; then
            iptables -D $WG_CHAIN ${rule#-A $WG_CHAIN } 2>/dev/null || break
        else
            break
        fi
    done
    if command -v ip6tables >/dev/null; then
        while ip6tables -S $WG_CHAIN 2>/dev/null | grep -q "wg:$domain"; do
            rule=$(ip6tables -S $WG_CHAIN 2>/dev/null | grep "wg:$domain" | head -n 1)
            if [ -n "$rule" ]; then
                ip6tables -D $WG_CHAIN ${rule#-A $WG_CHAIN } 2>/dev/null || break
            else
                break
            fi
        done
    fi

    # Remove any SNI/Host-based drops
    while iptables -S $WG_CHAIN 2>/dev/null | grep -q "wg_sni:$domain"; do
        rule=$(iptables -S $WG_CHAIN 2>/dev/null | grep "wg_sni:$domain" | head -n 1)
        if [ -n "$rule" ]; then
            iptables -D $WG_CHAIN ${rule#-A $WG_CHAIN } 2>/dev/null || break
        else
            break
        fi
    done

    # Remove config file
    rm -f "$DNSMASQ_DIR/wg_$domain.conf"

    # Reload dnsmasq
    systemctl reload dnsmasq 2>/dev/null || systemctl restart dnsmasq 2>/dev/null || /etc/init.d/dnsmasq restart 2>/dev/null || service dnsmasq restart 2>/dev/null || true

    echo "Removed $domain."
}

flush() {
    # Remove all wg config files
    rm -f $DNSMASQ_DIR/wg_*.conf
    
    # Flush ipsets
    ipset flush $IPSET_ACCEPT4
    ipset flush $IPSET_DROP4
    ipset flush $IPSET_ACCEPT6 2>/dev/null || true
    ipset flush $IPSET_DROP6 2>/dev/null || true
    
    # Reload dnsmasq
    systemctl reload dnsmasq 2>/dev/null || systemctl restart dnsmasq 2>/dev/null || /etc/init.d/dnsmasq restart 2>/dev/null || service dnsmasq restart 2>/dev/null || true
    
    echo "Flushed all entries."
}

case $command in
    init)
        init
        ;;
    add)
        add
        ;;
    remove)
        remove
        ;;
    flush)
        flush
        ;;
    *)
        echo "Usage: $0 {init|add|remove|flush}"
        exit 1
        ;;
esac
