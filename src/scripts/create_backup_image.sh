#!/bin/bash

# ==============================================================================
# 📦 PisoWifi Image Backup & Shrink Tool
# ==============================================================================
# This script creates a full backup of your SD card/eMMC and shrinks it
# to the smallest possible size. The resulting .img file is ready to be
# flashed using Balena Etcher.
#
# ⚠️  WARNING: 
# 1. You CANNOT save the backup to the same drive you are backing up.
#    You must plug in an External USB Drive.
# 2. Run this script as ROOT.
# ==============================================================================

if [ "$EUID" -ne 0 ]; then 
  echo "❌  Please run as root (sudo ./create_backup_image.sh)"
  exit 1
fi

# Default Device (Try to detect)
DEFAULT_DEVICE="/dev/mmcblk0"
if [ ! -b "$DEFAULT_DEVICE" ]; then
    DEFAULT_DEVICE="/dev/sda"
fi

echo "========================================================"
echo "   💾  Create Flashable Backup Image (Auto-Shrink)"
echo "========================================================"
echo ""

# 0. Pre-Check: Look for External Drives
echo "🔍  Checking for external drives..."
EXTERNAL_DRIVES=$(lsblk -d -o NAME | grep -E "^sd|^nvme")

if [ -z "$EXTERNAL_DRIVES" ]; then
    echo ""
    echo "⚠️  WARNING: No external drives (USB/SSD) detected!"
    echo "    I only see the internal storage (mmcblk/zram)."
    echo "    You CANNOT save the backup to the same disk you are running from."
    echo ""
    echo "    Possible solutions:"
    echo "    1. Plug in your USB drive."
    echo "    2. If plugged in, try a different port."
    echo "    3. Run 'dmesg | tail' to check for errors."
    echo ""
    read -p "    Press ENTER to exit and fix this (or type 'force' to continue anyway): " PRECHECK
    if [ "$PRECHECK" != "force" ]; then
        exit 1
    fi
else
    echo "✅  External drive(s) detected: $(echo $EXTERNAL_DRIVES | tr '\n' ' ')"
fi

# 1. Select Source Device
echo ""
echo "Step 1: Select the source device (your current OS drive):"
lsblk -d -o NAME,SIZE,MODEL | grep -v "loop"
echo ""
read -p "Enter source device (default: $DEFAULT_DEVICE): " SOURCE_DEV
SOURCE_DEV=${SOURCE_DEV:-$DEFAULT_DEVICE}

# Validate that Source is a Disk, not a Partition
DEV_TYPE=$(lsblk -d -n -o TYPE "$SOURCE_DEV" 2>/dev/null)
if [ "$DEV_TYPE" != "disk" ]; then
    echo "❌  ERROR: $SOURCE_DEV seems to be a '$DEV_TYPE', not a physical disk!"
    echo "    You must select the Drive itself (e.g., /dev/mmcblk0), not a partition (e.g., /dev/mmcblk0p1)."
    echo "    Backing up a partition will result in a NON-BOOTABLE image."
    exit 1
fi

if [ ! -b "$SOURCE_DEV" ]; then
    echo "❌  Error: Device $SOURCE_DEV not found!"
    exit 1
fi

# 2. Select Destination
echo ""
echo "Select where to save the backup image."
echo "⚠️  This MUST be a different drive (e.g., External USB)."
echo "Available mount points:"
df -h | grep -v "tmpfs" | grep -v "udev" | grep -v "overlay"
echo ""
read -p "Enter path to save image (e.g., /mnt/usb/my_backup.img): " DEST_IMG

if [ -z "$DEST_IMG" ]; then
    echo "❌  Destination path required."
    exit 1
fi

# Check if directory exists
DEST_DIR=$(dirname "$DEST_IMG")
if [ ! -d "$DEST_DIR" ]; then
    echo "❌  Directory $DEST_DIR does not exist. Please mount your USB drive first."
    exit 1
fi

# Check if destination is on the same device as source (Basic check)
SOURCE_BASE=$(basename "$SOURCE_DEV")
DEST_DEVICE=$(df "$DEST_DIR" | tail -1 | awk '{print $1}')

if [[ "$DEST_DEVICE" == *"$SOURCE_BASE"* ]]; then
    echo "⚠️  WARNING: It looks like you are trying to save the backup to the same device ($SOURCE_DEV)."
    echo "    This will fail because the image will grow until the disk is full."
    echo "    Please mount an External USB drive and save it there."
    read -p "Are you ABSOLUTELY sure you want to proceed? (yes/no): " CONFIRM
    if [ "$CONFIRM" != "yes" ]; then
        exit 1
    fi
fi

# 3. Install Dependencies
echo ""
echo "📦  Installing dependencies (parted, wget)..."
apt-get update > /dev/null
apt-get install -y parted wget gzip > /dev/null

# Ask for Shrinking
echo ""
echo "Do you want to auto-shrink the image? (Recommended for smaller file size)"
echo "⚠️  NOTE: If you have a custom partition layout or non-standard bootloader, choose NO."
read -p "Shrink Image? (y/n, default: y): " DO_SHRINK
DO_SHRINK=${DO_SHRINK:-y}

# 4. Download PiShrink
if [[ "$DO_SHRINK" =~ ^[Yy]$ ]]; then
    echo "⬇️   Downloading PiShrink tool..."
    if [ ! -f "pishrink.sh" ]; then
        wget -q https://raw.githubusercontent.com/Drewsif/PiShrink/master/pishrink.sh
        if [ $? -ne 0 ]; then
             echo "⚠️  Failed to download PiShrink. Internet connection required."
             echo "    Continuing without shrinking..."
             DO_SHRINK="n"
        else
             chmod +x pishrink.sh
        fi
    fi
fi

# 5. Create the Image
echo ""
echo "🚀  Step 1/2: Creating raw image from $SOURCE_DEV..."
echo "    This may take a while depending on the disk size."
echo "    Writing to: $DEST_IMG"
echo ""

dd if="$SOURCE_DEV" of="$DEST_IMG" status=progress bs=4M conv=fsync

if [ $? -ne 0 ]; then
    echo "❌  Image creation failed!"
    exit 1
fi

# 6. Shrink the Image
if [[ "$DO_SHRINK" =~ ^[Yy]$ ]]; then
    echo ""
    echo "📉  Step 2/2: Shrinking image with PiShrink..."
    echo "    Removing empty space to make it flash-ready..."
    echo ""

    ./pishrink.sh -s "$DEST_IMG"

    if [ $? -eq 0 ]; then
        echo ""
        echo "✅  SUCCESS! Backup created and shrunk."
    else
        echo "⚠️  PiShrink reported an error, but the raw image might still be valid (just large)."
    fi
else
    echo ""
    echo "⏭️  Skipping Shrink process (Safe Mode)."
    echo "✅  SUCCESS! Raw Backup created."
fi

echo "    File: $DEST_IMG"
echo "    You can now flash this file using Balena Etcher."

