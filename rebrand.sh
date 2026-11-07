#!/usr/bin/env bash
# rebrand.sh — Reapplies Verse Panel branding on top of upstream JTG Panel code.
# Run this automatically after every upstream sync (see .github/workflows/sync-upstream.yml)
# and it's safe to run multiple times (idempotent seds).

set -e
cd "$(dirname "$0")"

REPO_URL="https://github.com/kidscartoonverse-dotcom/Verse-Panel"

echo "==> Applying Verse Panel branding..."

# UI default panel name text
sed -i "s/'JTG PANEL'/'VERSE PANEL'/g" src/components/Layout.tsx src/pages/Dashboard.tsx 2>/dev/null || true

# Notification welcome text
sed -i 's/Welcome to JTG Panel/Welcome to Verse Panel/g' src/components/NotificationsDropdown.tsx 2>/dev/null || true

# Generated-app comments/descriptions written into hosted apps
sed -i 's/on JTG Panel/on Verse Panel/g; s/hosted on JTG Panel/hosted on Verse Panel/g; s/app on JTG Panel/app on Verse Panel/g; s/Server on JTG Panel/Server on Verse Panel/g' \
  src/server/controllers/servers.ts src/server/services/docker.ts src/server/services/local.ts 2>/dev/null || true

# User-Agent string
sed -i "s#JTG-Panel/2.0 (https://github.com/jtg-panel; admin@jtgpanel.internal)#VersePanel/2.0 (${REPO_URL})#g" src/server/services/jarDownloader.ts 2>/dev/null || true


# API/system route panel name defaults
sed -i 's/"JTG Panel"/"Verse Panel"/g' src/server/routes/api.ts src/server/routes/system.ts 2>/dev/null || true

# CreateServer.tsx hardcoded JSX brand text
sed -i 's/JTG <span className="text-\[#8f8f8f\] font-medium">PANEL<\/span>/VERSE <span className="text-[#8f8f8f] font-medium">PANEL<\/span>/g' src/pages/CreateServer.tsx 2>/dev/null || true

# public/node.sh banner + description
sed -i 's/JTG Panel/Verse Panel/g' public/node.sh 2>/dev/null || true

# createuser.ts console banner
sed -i 's/=== JTG Panel Owner User Creation ===/=== Verse Panel Owner User Creation ===/g' scripts/createuser.ts 2>/dev/null || true

# server.ts console log tags + startup banner
sed -i 's/\[JTG\] Owner user/[Verse] Owner user/g; s/\[JTG\] Failed/[Verse] Failed/g' server.ts 2>/dev/null || true
grep -q "Verse Panel (based on JTG Panel" server.ts 2>/dev/null || \
  sed -i "s#console.log(\`.*running on port \${PORT}\`);#console.log(\`Verse Panel (based on JTG Panel by Jishnu, modified by Verseedit) running on port \${PORT}\`);#" server.ts 2>/dev/null || true

# CRITICAL: install.sh / update.sh health checks must match the renamed API text
sed -i 's/grep -q "JTG Panel"/grep -q "Verse Panel"/g' install.sh update.sh 2>/dev/null || true

# Remove the JTG block-letter ASCII art banner in install.sh (visible during install, not caught by text search)
python3 - <<'PYEOF' 2>/dev/null || true
import re
try:
    with open("install.sh") as f:
        content = f.read()
    pattern = re.compile(
        r'    echo "║     ██╗████████╗ ██████╗.*?\n'
        r'    echo "║     ╚═╝   ╚═╝    ╚═════╝.*?\n',
        re.DOTALL
    )
    new_banner = (
        '    echo "║               V E R S E   P A N E L          ║"\n'
        '    echo "║               INSTALLER                      ║"\n'
    )
    content2 = pattern.sub(new_banner, content)
    if content2 != content:
        with open("install.sh", "w") as f:
            f.write(content2)
        print("  [ok] Removed JTG ASCII art banner")
except FileNotFoundError:
    pass
PYEOF

# CRITICAL: Termux has no real /tmp (root fs is read-only there) — ensure SAFE_TMP shim exists
if ! grep -q "SAFE_TMP=" install.sh 2>/dev/null; then
  python3 - <<'PYEOF' 2>/dev/null || true
import re
try:
    with open("install.sh") as f:
        content = f.read()
    shim = (
        "\n# Termux doesn't have a real /tmp (root filesystem is read-only there) —\n"
        "# use $PREFIX/tmp instead when running under Termux.\n"
        'if [ -n "$PREFIX" ] && [ -d "$PREFIX" ]; then\n'
        '    SAFE_TMP="$PREFIX/tmp"\n'
        "else\n"
        '    SAFE_TMP="/tmp"\n'
        "fi\n"
        'mkdir -p "$SAFE_TMP" 2>/dev/null || true\n'
    )
    content = content.replace("\nRED='\\033[0;31m'", shim + "\nRED='\\033[0;31m'", 1)
    content = re.sub(r'"/tmp/(\$\{step_id\}\.log)"', r'"${SAFE_TMP}/\1"', content)
    content = content.replace('-o /tmp/node22.tar.xz', '-o "${SAFE_TMP}/node22.tar.xz"')
    content = content.replace('if [ -f "/tmp/node22.tar.xz" ]', 'if [ -f "${SAFE_TMP}/node22.tar.xz" ]')
    content = content.replace('-xJf /tmp/node22.tar.xz', '-xJf "${SAFE_TMP}/node22.tar.xz"')
    content = content.replace('rm -f /tmp/node22.tar.xz', 'rm -f "${SAFE_TMP}/node22.tar.xz"')
    with open("install.sh", "w") as f:
        f.write(content)
    print("  [ok] Applied Termux SAFE_TMP shim")
except FileNotFoundError:
    pass
PYEOF
fi

# CRITICAL: Repo URL placeholders must always point to our own repo, never upstream/placeholder
sed -i 's#https://github.com/<your-username>/<your-repo>#https://github.com/kidscartoonverse-dotcom/Verse-Panel#g' install.sh universal-install.sh 2>/dev/null || true
sed -i 's#git clone https://github.com/JishnuTheGamer/Jtg Jtg#git clone https://github.com/kidscartoonverse-dotcom/Verse-Panel Jtg#g' install.sh 2>/dev/null || true

# Sidebar footer credit (kept — required by MIT attribution clause)
grep -q "Modified by Verseedit" src/components/Sidebar.tsx 2>/dev/null || \
  echo "  [!] Sidebar.tsx credit line missing — check manually" 

# index.html title
sed -i 's#<title>.*</title>#<title>Verse Panel</title>#' index.html 2>/dev/null || true

# metadata.json / package.json name fields
sed -i 's/"name": *"[Jj]tg[^"]*"/"name": "verse-panel"/' package.json 2>/dev/null || true

# README manual-install clone target -> our own repo
sed -i "s#git clone https://github.com/JishnuTheGamer/Jtg.git#git clone ${REPO_URL}.git#" README.md 2>/dev/null || true
sed -i '/git clone.*Verse-Panel.git/{n;s/cd Jtg/cd Verse-Panel/}' README.md 2>/dev/null || true

# install.sh self-clone placeholder -> our own repo (in case upstream resets it)
sed -i "s#git clone https://github.com/<your-username>/<your-repo> Jtg#git clone ${REPO_URL} Jtg#" install.sh 2>/dev/null || true
sed -i "s#git clone https://github.com/JishnuTheGamer/Jtg Jtg#git clone ${REPO_URL} Jtg#" install.sh 2>/dev/null || true

echo "==> Rebrand pass complete."
