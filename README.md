# Verse Panel

## Minecraft server tools

- **Plugin / Mod installer** — search Modrinth, SpigotMC and Hangar, then pick the exact version (compatible ones first) before installing
- **Modpack installer** — one-click Modrinth modpacks (`.mrpack`) with progress; loader and Minecraft version are set automatically
- **Software & version changer** — Paper, Purpur, Folia, Spigot, Vanilla, Fabric, Quilt, Forge, NeoForge, BungeeCord, Velocity
- **Player manager, properties editor, backups, SFTP, sub-users**
- **MOTD maker** (colours, formats, hex, live preview) and **server icon uploader** (auto-cropped to 64x64)


## Accounts, login & domain

- **Email on every account** — sign up with username + email; log in with **username or email**
- **Forgot password** — emails a 30-minute reset link (Admin Settings → *Email*: Gmail address + App Password, with a "send test email" button)
- **Sign in with Discord** and **Google** — Google tokens are verified server-side; Discord uses OAuth2 (Admin Settings → *Discord Login*)
- **Install modes** — the installer asks: **1) Domain host** (domain + DNS check + HTTPS) or **2) Localhost / local network** (runs on this device's local IP, e.g. VPS private IP or phone Wi-Fi IP; servers show as `localIP:port`). Switchable later in Admin Settings → Panel Domain. Non-interactive: `PANEL_ACCESS_MODE=local|domain` (+ `PANEL_DOMAIN_PRESET=panel.example.com`)
- **Panel domain** — in domain mode the installer asks for a domain, checks that its A record points to this server, then serves the panel on it (Caddy + automatic HTTPS). It can also be set/changed later in Admin Settings → *Panel Domain*
- **Server address = `domain:port`** — there is no IP field when creating a server; the address is built from the panel domain and the port. Server IP + the same port works as well

## Multiple VPS (nodes)

**Nodes → Add VPS** → type any name → copy the command → run it on the other VPS (as root). It installs Node.js + Docker + the Verse Node, then registers itself with the panel — no tokens to copy. Pick the node when creating a server; a node whose RAM limit is reached shows as **full** and refuses new servers. Console, file manager, backups, plugin/mod installers, schedules, startup and ports all work on nodes (the panel forwards requests to the node). Optional: give the VPS a domain in *Advanced* for automatic HTTPS. Requires `npm run build` on the panel (the node is the built `dist/server.cjs`). Admin Settings → **System check** diagnoses Docker, Java, disk, memory and every node.

## Pterodactyl-style server features

- **Schedules** — cron-based tasks per server: send command, power action (start/stop/restart/kill), backup; ordered, with delays, "only when online", run-now and last-run status
- **Startup & eggs** — per-server startup variables (validated with Pterodactyl-style rules), editable startup command for Node/Python, and import of Pterodactyl egg JSON (Docker image + startup + variables)
- **Network** — extra ports per server (TCP/UDP/both), shown as `domain:port`
- **Databases** — per-server MySQL/MariaDB databases with generated users/passwords (Admin Settings → Database Host)
- **Activity** — audit log of power, commands, file changes, backups, installs, schedules, ports, databases, sign-ins and admin settings changes (per server tab + admin view)

## Quick Automated Setup (Recommended)

Run the automated management script:

```bash
bash install.sh
```

Menu Options:
1. **Install Panel** (Installs Node.js, Docker, PM2, dependencies, builds & starts on port 6767)
2. **Update Panel**
3. **Create Admin User**
4. **Restart Panel**
5. **Exit**

---

## Manual Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/kidscartoonverse-dotcom/Verse-Panel.git
   cd Verse-Panel
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the application:
   ```bash
   npm run build
   ```

4. Create an admin user:
   ```bash
   npm run createuser
   ```

5. Start the server (Port 6767):
   ```bash
   npm run start
   ```

## Development

To run the panel in development mode on port 3000:

```bash
npm run dev
```

