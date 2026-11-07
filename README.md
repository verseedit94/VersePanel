# Verse Panel

**Made by Verseedit**

Verse Panel ek free web panel hai jisse tum game servers aur bots (Minecraft, Node.js, Python) browser se create aur manage kar sakte ho. Kisi bhi VPS ya Android phone (Termux) par chalta hai.

## One-Click Install

Termux (phone) par pehli baar sirf ye chalao:

    pkg update -y && pkg install curl git -y

Phir Termux ya VPS, dono me ye ek command chalao:

    curl -fsSL https://raw.githubusercontent.com/verseedit94/VersePanel/main/universal-install.sh -o i.sh && bash i.sh

## Install ke steps

1. Installer pooche to Termux ya VPS choose karo.
2. Access mode choose karo: Domain (HTTPS ke saath) ya Localhost / local network.
3. Install khatam hone par panel kholo: http://YOUR-IP:6767
4. Installer menu me Create Admin User se apna admin account banao.
5. Panel me login karke server create karo aur use karo.

## Requirements

- VPS: kam se kam 1 GB RAM (2 GB+ better), Ubuntu 20.04 / 22.04 ya Debian
- Firewall me port 6767 aur apne game server ke ports open hone chahiye
- VPS par Docker apne aap install hota hai. Termux par local Node.js mode chalta hai

## Panel manage karna

Panel folder me ye chalao:

    bash install.sh

Menu: 1 Install, 2 Update, 3 Create Admin User, 4 Restart, 5 Exit

Update: bash update.sh | Uninstall: bash uninstall.sh

## Features

**Minecraft tools**
- Plugin aur Mod installer (Modrinth, SpigotMC, Hangar), version chun sakte ho
- One-click Modrinth modpack installer
- Software changer: Paper, Purpur, Folia, Spigot, Vanilla, Fabric, Quilt, Forge, NeoForge, BungeeCord, Velocity
- Player manager, server.properties editor, backups, SFTP
- MOTD maker (live preview) aur server icon uploader

**Server management**
- Live console, file manager, start / stop / restart / kill
- Schedules (cron): command, power action, backup
- Startup variables aur Pterodactyl egg import
- Extra ports, har server ke liye MySQL / MariaDB database
- Activity log, API keys, sub-users

**Accounts aur domain**
- Username + email se signup, username ya email se login
- Forgot password email se, Discord aur Google login
- Custom domain with automatic HTTPS, ya local IP mode

## Problem aaye to

- Panel nahi khul raha: port 6767 open karo, phir bash install.sh me Restart Panel
- Admin password bhool gaye: bash install.sh me Create Admin User
- Latest version chahiye: bash install.sh me Update Panel

## Credits

Verse Panel - **Made by Verseedit**
Based on open-source JTG Panel by Jishnu (MIT License, license file repo me hai).

---
Made by **Verseedit**
