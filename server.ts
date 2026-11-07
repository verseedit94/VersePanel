import "dotenv/config";
import express from "express";
import path from "path";
import cors from "cors";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { createServer as createViteServer } from "vite";
import fs from "fs-extra";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "./src/server/services/secret.js";
import { isNodeMode, verifyNodeToken, ipAllowed } from "./src/server/services/nodeMode.js";
import { serverNode } from "./src/server/services/nodeClient.js";
import { startRelay, stopRelayIfIdle } from "./src/server/services/remoteLogRelay.js";

const app = express();
const httpServer = createServer(app);
export const io = new SocketIOServer(httpServer, {
  cors: { origin: "*" },
});
app.set("io", io);
// Node mode: only believe X-Forwarded-For from a proxy on this machine (Caddy), so the IP allow-list cannot be spoofed
app.set("trust proxy", isNodeMode() ? "loopback" : true);

// Initialize data folders
const DATA_DIR = path.join(process.cwd(), ".data");
const SERVERS_DIR = path.join(DATA_DIR, "servers");
const BACKUPS_DIR = path.join(process.cwd(), "backups");

fs.ensureDirSync(DATA_DIR);
fs.ensureDirSync(SERVERS_DIR);
fs.ensureDirSync(BACKUPS_DIR);
fs.ensureDirSync(path.join(DATA_DIR, "temp"));

if (!fs.existsSync(path.join(DATA_DIR, "users.json"))) fs.writeFileSync(path.join(DATA_DIR, "users.json"), "[]");
if (!fs.existsSync(path.join(DATA_DIR, "servers.json"))) fs.writeFileSync(path.join(DATA_DIR, "servers.json"), "[]");
if (!fs.existsSync(path.join(DATA_DIR, "settings.json"))) fs.writeFileSync(path.join(DATA_DIR, "settings.json"), "{}");

import { attachContainerSocket, getContainerLogs } from "./src/server/services/docker.js";
import { panelEvents } from "./src/server/events.js";
import { getLocalServerLogs } from "./src/server/services/local.js";

panelEvents.on("log", (serverId: string, logData: string) => {
  io.to(`server_${serverId}`).emit("log", logData);
});

io.use((socket, next) => {
  // Node mode: only the main panel (holding the node token) may connect
  if (isNodeMode()) {
    let ip = String(socket.handshake.address || "").replace(/^::ffff:/, "");
    const xff = String(socket.handshake.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if ((ip === "127.0.0.1" || ip === "::1") && xff) ip = xff; // behind Caddy on this machine
    if (ipAllowed(ip) && verifyNodeToken(socket.handshake.auth?.nodeToken)) {
      (socket as any).user = { id: "panel", username: "Panel", role: "admin" };
      return next();
    }
    return next(new Error("Authentication error"));
  }
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error("Authentication error"));
  try {
    const verified = jwt.verify(token, JWT_SECRET);
    (socket as any).user = verified;
    next();
  } catch (err) {
    next(new Error("Authentication error"));
  }
});

io.on("connection", (socket) => {
  socket.on("joinServer", async (serverId) => {
    try {
      const serversJSON = await fs.readFile(path.join(DATA_DIR, "servers.json"), "utf8");
      const servers = JSON.parse(serversJSON);
      const server = Array.isArray(servers) ? servers.find((s: any) => s.id === serverId) : null;
      const user = (socket as any).user;
      // only the owner or an admin may watch a server's console
      if (!server || !user || (user.role !== "admin" && user.role !== "owner" && server.owner !== user.id)) return;

      socket.join(`server_${serverId}`);

      // Server runs on a Verse Node: relay its console through the panel
      const remote = await serverNode(server);
      if (remote) {
        startRelay(io, serverId, remote);
        return;
      }

      // Stream initial logs whether local runtime or docker
      const localLogs = await getLocalServerLogs(serverId);
      if (localLogs) {
        socket.emit("log", localLogs.trim() + "\n");
      }

      if (server.containerId && !String(server.containerId).startsWith("local-")) {
        const logs = await getContainerLogs(server.containerId, server.nodeId);
        if (logs) {
           socket.emit("log", logs.trim() + "\n");
        }
        await attachContainerSocket(server.containerId, serverId, server.nodeId);
      }
    } catch (e) {
      console.error("Error fetching logs for server", serverId, e);
    }
  });
  socket.on("leaveServer", (serverId) => {
    socket.leave(`server_${serverId}`);
    setTimeout(() => stopRelayIfIdle(io, serverId), 500);
  });
  socket.on("disconnecting", () => {
    for (const room of socket.rooms) {
      if (room.startsWith("server_")) {
        const sid = room.slice(7);
        setTimeout(() => stopRelayIfIdle(io, sid), 1000);
      }
    }
  });
});

// STRICT ROUTING: 3000 for Admin/Dev, 6767 for Main/Prod
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : (process.env.NODE_ENV === "development" ? 3000 : 6767);
const isDev = process.env.NODE_ENV === "development" && PORT === 3000;

app.use(express.json({ limit: "50gb" }));
app.use(express.urlencoded({ extended: true, limit: "50gb" }));
app.use(cors());

import apiRoutes from "./src/server/routes/api.js";
import nodeServerRoutes from "./src/server/routes/servers.js";
import nodeInfoRoutes from "./src/server/routes/nodeInfo.js";
if (isNodeMode()) {
  // Verse Node: expose only the server API + node info, authenticated by the node token
  app.use("/api/servers", nodeServerRoutes);
  app.use("/api/node", nodeInfoRoutes);
} else {
  app.use("/api", apiRoutes);
}

import { initSFTPServer } from "./src/server/services/sftp.js";
import { startScheduler } from "./src/server/services/scheduler.js";

async function ensureOwnerFromEnv() {
  const envUser = process.env.JTG_OWNER_USER;
  const envPass = process.env.JTG_OWNER_PASS;
  if (!envUser || !envPass) return;

  try {
    const usersFile = path.join(DATA_DIR, "users.json");
    const users = (await fs.pathExists(usersFile)) ? await fs.readJson(usersFile) : [];
    const existingIndex = users.findIndex(
      (u: any) => u.username && u.username.toLowerCase() === envUser.toLowerCase()
    );
    const bcrypt = await import("bcryptjs");
    const hashedPassword = await bcrypt.default.hash(envPass, 10);

    if (existingIndex !== -1) {
      users[existingIndex].password = hashedPassword;
      users[existingIndex].role = "owner";
      users[existingIndex].passwordVersion = (users[existingIndex].passwordVersion || 0) + 1;
    } else {
      users.forEach((u: any) => {
        if (u.role === "owner") u.role = "admin";
      });
      users.push({
        id: "owner-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7),
        username: envUser,
        password: hashedPassword,
        role: "owner",
        passwordVersion: 0,
        createdAt: new Date().toISOString(),
      });
    }
    await fs.writeJson(usersFile, users, { spaces: 2 });
    console.log(`[Verse] Owner user '${envUser}' ensured in database.`);
  } catch (err) {
    console.error("[Verse] Failed to ensure owner from environment:", err);
  }
}

async function startServer() {
  if (!isNodeMode()) await ensureOwnerFromEnv();
  await initSFTPServer();

  if (isNodeMode()) {
    app.get("/", (_req, res) => res.type("text").send("Verse Node is running. Add it in your panel: Nodes → Add node."));
  } else if (isDev) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    if (isNodeMode()) {
      console.log(`Verse Node running on port ${PORT} (waiting for the panel)`);
    } else {
      console.log(`Verse Panel running on port ${PORT}`);
      startScheduler(io);
    }
  });
}

startServer();

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
  fs.writeFileSync('crash.log', String(err.stack));
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
  fs.writeFileSync('crash.log', String(reason));
});
