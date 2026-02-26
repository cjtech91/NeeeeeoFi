#!/bin/bash
# Idempotent Anti-ISP Detect apply/remove script
# Args:
#   ENABLE (1/0)
#   TTL_MODE (none|inc1|set64|set65)
#   MSS_CLAMP (1/0)
#   HIDE_MGMT (1/0)
#   WAN_IF (e.g., eth0, pppoe-wan)
#   LAN_BR (e.g., br0)
#
# Notes:
# - Creates custom chains to avoid rule duplication:
#     mangle table: ANTI_ISP_DETECT
#     filter table: ANTI_ISP_FILTER
# - Adds jump hooks from PREROUTING (mangle) and INPUT (filter) only if missing

set -e

ENABLE="${1:-0}"
TTL_MODE="${2:-none}"
MSS_CLAMP="${3:-1}"
HIDE_MGMT="${4:-1}"
WAN_IF="${5:-eth0}"
LAN_BR="${6:-br0}"

# Ensure iptables exists
command -v iptables >/dev/null 2>&1 || exit 0

# Convenience wrappers
has_rule() { iptables-save | grep -qE "$1"; }
ipt() { iptables "$@" || true; }

# Create chains if missing
ensure_chains() {
  ipt -t mangle -L ANTI_ISP_DETECT -n >/dev/null 2>&1 || ipt -t mangle -N ANTI_ISP_DETECT
  ipt -t filter -L ANTI_ISP_FILTER -n >/dev/null 2>&1 || ipt -t filter -N ANTI_ISP_FILTER
  # Hooks
  has_rule "^\*mangle.*-A PREROUTING -j ANTI_ISP_DETECT" || ipt -t mangle -A PREROUTING -j ANTI_ISP_DETECT
  has_rule "^\*filter.*-A INPUT -j ANTI_ISP_FILTER" || ipt -t filter -A INPUT -j ANTI_ISP_FILTER
}

flush_rules() {
  ipt -t mangle -F ANTI_ISP_DETECT 2>/dev/null || true
  ipt -t filter -F ANTI_ISP_FILTER 2>/dev/null || true
}

remove_chains() {
  # Remove hooks
  ipt -t mangle -D PREROUTING -j ANTI_ISP_DETECT 2>/dev/null || true
  ipt -t filter -D INPUT -j ANTI_ISP_FILTER 2>/dev/null || true
  # Delete chains
  ipt -t mangle -F ANTI_ISP_DETECT 2>/dev/null || true
  ipt -t mangle -X ANTI_ISP_DETECT 2>/dev/null || true
  ipt -t filter -F ANTI_ISP_FILTER 2>/dev/null || true
  ipt -t filter -X ANTI_ISP_FILTER 2>/dev/null || true
}

apply_rules() {
  # TTL normalization (hide extra hop due to router NAT)
  case "$TTL_MODE" in
    inc1)
      # Increase TTL by 1 from LAN -> any
      ipt -t mangle -A ANTI_ISP_DETECT -i "$LAN_BR" -j TTL --ttl-inc 1
      ;;
    set64)
      # Force TTL to 64 when leaving WAN
      ipt -t mangle -A ANTI_ISP_DETECT -o "$WAN_IF" -j TTL --ttl-set 64
      ;;
    set65)
      ipt -t mangle -A ANTI_ISP_DETECT -o "$WAN_IF" -j TTL --ttl-set 65
      ;;
    *)
      ;;
  esac

  # MSS clamp to PMTU (avoid odd MSS fingerprints and fragmentation)
  if [ "$MSS_CLAMP" = "1" ]; then
    ipt -t mangle -A ANTI_ISP_DETECT -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
  fi

  # Hide management from WAN: block common mgmt ports from WAN source
  if [ "$HIDE_MGMT" = "1" ]; then
    for P in 22 80 443 8291; do
      ipt -t filter -A ANTI_ISP_FILTER -i "$WAN_IF" -p tcp --dport "$P" -j DROP
    done
  fi
}

if [ "$ENABLE" = "1" ]; then
  ensure_chains
  flush_rules
  apply_rules
else
  remove_chains
fi

exit 0
