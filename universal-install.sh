#!/usr/bin/env bash
# Verse Panel — Universal Installer (works on both Termux/Android and VPS/Linux)
set -e

REPO_URL="https://github.com/verseedit94/VersePanel"

echo "=================================================="
echo "   Verse Panel — Universal Installer"
echo "=================================================="

# ---- Self-clone bootstrap (so this can be curled from an empty folder) ----
if [ -f "package.json" ] && [ -f "install.sh" ]; then
  : # already inside the panel folder — nothing to do
elif [ -d "verse-panel" ] && [ -f "verse-panel/package.json" ]; then
  cd verse-panel
elif [ -d "verse-panel/.git" ]; then
  echo "Existing incomplete clone found in ./verse-panel — updating it instead of re-cloning..."
  cd verse-panel
  git pull --no-edit || true
elif [ -d "verse-panel" ]; then
  echo "A 'verse-panel' folder already exists here but isn't a valid clone."
  echo "Remove or rename it first, e.g.: rm -rf verse-panel"
  exit 1
else
  echo "Panel not found here — cloning from $REPO_URL ..."
  if ! command -v git > /dev/null 2>&1; then
    if [ -d "/data/data/com.termux" ]; then pkg install -y git; else apt-get install -y git || yum install -y git || true; fi
  fi
  git clone "$REPO_URL" verse-panel
  cd verse-panel
fi

# ---- Detect environment ----
IS_TERMUX=0
if [ -d "/data/data/com.termux" ] && [ -n "$PREFIX" ] && [[ "$PREFIX" == *com.termux* ]]; then
  IS_TERMUX=1
fi

if [ "$IS_TERMUX" -eq 1 ]; then
  DETECTED_LABEL="Termux (Android)"
else
  DETECTED_LABEL="Linux server / VPS"
fi

echo "Auto-detected environment: $DETECTED_LABEL"
echo ""
echo "Confirm where you are installing:"
echo "  1) Termux (Android phone)"
echo "  2) VPS / Linux server"
read -p "Choose an option (1-2) [default: $([ "$IS_TERMUX" -eq 1 ] && echo 1 || echo 2)]: " ENV_CHOICE

if [ "$ENV_CHOICE" = "1" ]; then
  IS_TERMUX=1
elif [ "$ENV_CHOICE" = "2" ]; then
  IS_TERMUX=0
fi
# if left blank, keep the auto-detected value

# ======================================================
# TERMUX PATH — no Docker, uses built-in "Pure Local Node.js" mode
# ======================================================
if [ "$IS_TERMUX" -eq 1 ]; then

  echo "[1/6] Updating packages..."
  pkg update -y && pkg upgrade -y

  echo "[2/6] Installing Node.js, Python, Java, build tools, git..."
  pkg install -y nodejs python openjdk-17 git unzip which clang make

  echo "[3/6] Verifying installs..."
  node -v || { echo "Node install failed"; exit 1; }
  NODE_MAJOR=$(node -v | tr -d 'v' | cut -d'.' -f1)
  if [ "$NODE_MAJOR" -lt 20 ]; then
    echo "ERROR: Verse Panel needs Node.js >= 20. Termux gave you $(node -v)."
    exit 1
  fi
  python3 -V || echo "WARNING: Python not found."
  java -version || echo "WARNING: Java not found — Minecraft servers won't work until fixed."

  echo "[4/6] Setting up storage access..."
  termux-setup-storage || true

  # Android shared storage doesn't support symlinks — npm/PM2 need them.
  CURRENT_DIR="$(pwd)"
  if [[ "$CURRENT_DIR" == /storage/* || "$CURRENT_DIR" == /sdcard/* ]]; then
    echo "Moving panel out of shared storage into \$HOME/verse-panel..."
    rm -rf "$HOME/verse-panel"
    cp -r "$CURRENT_DIR" "$HOME/verse-panel"
    cd "$HOME/verse-panel"
  fi

  if [ ! -f "package.json" ] || [ ! -f "install.sh" ]; then
    echo "ERROR: Run this from inside the Verse Panel folder (where install.sh lives)."
    exit 1
  fi

  npm install -g pm2

  echo "[5/6] Admin account setup:"
  read -p "Choose an admin username (min 3 chars): " OWNER_USER
  read -s -p "Choose an admin password (min 6 chars): " OWNER_PASS
  echo ""

  echo "[6/6] Installing in 'Pure Local Node.js' mode (no Docker)..."
  RUN_CHOICE=2 JTG_OWNER_USER="$OWNER_USER" JTG_OWNER_PASS="$OWNER_PASS" bash install.sh main

  echo "=================================================="
  echo " Verse Panel should now be running at: http://localhost:6767"
  echo " pm2 logs jtg-main   /   pm2 restart jtg-main   /   pm2 list"
  echo "=================================================="

# ======================================================
# VPS / LINUX SERVER PATH — full Docker-based install (recommended)
# ======================================================
else

  if [ ! -f "package.json" ] || [ ! -f "install.sh" ]; then
    echo "ERROR: Run this from inside the Verse Panel folder (where install.sh lives)."
    exit 1
  fi

  echo "This will run Verse Panel's full installer with Docker support"
  echo "(recommended on a VPS for proper server isolation)."
  echo ""
  read -p "Admin username (min 3 chars): " OWNER_USER
  read -s -p "Admin password (min 6 chars): " OWNER_PASS
  echo ""

  # RUN_CHOICE=1 -> Node.js with PM2 + Docker for game/bot servers
  RUN_CHOICE=1 JTG_OWNER_USER="$OWNER_USER" JTG_OWNER_PASS="$OWNER_PASS" bash install.sh main

  IP=$(curl -s -m 2 ifconfig.me 2>/dev/null || curl -s -m 2 icanhazip.com 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "your-vps-ip")
  echo "=================================================="
  echo " Verse Panel should now be running at: http://$IP:6767"
  echo " pm2 logs jtg-main   /   pm2 restart jtg-main   /   pm2 list"
  echo "=================================================="

fi
