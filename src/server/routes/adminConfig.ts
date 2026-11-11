import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { readJSON, writeJSON } from "../services/db.js";
import { sendMail } from "../services/mailer.js";
import { detectLocalIp, getPublicIp, isIPv4, isValidDomain, verifyDomain } from "../services/domain.js";
import { getDbConfig, saveDbConfig, testConnection } from "../services/dbhost.js";
import { defaultDocker, hasDockerSocket } from "../services/docker.js";
import { listAgentNodes, nodeRequest } from "../services/nodeClient.js";
import { decryptSecret } from "../services/crypto.js";
import { exec } from "child_process";
import os from "os";
import fs from "fs-extra";
import path from "path";

/**
 * Verse Panel — admin configuration for Email (SMTP), Discord login and the panel domain.
 * Secrets are write-only: they are never sent back to the browser.
 */
const router = express.Router();
router.use(requireAuth);
router.use((req, res, next) => {
  const u = (req as any).user;
  if (!u || (u.role !== "admin" && u.role !== "owner")) return res.status(403).json({ error: "Forbidden" });
  next();
});

const str = (v: any, max = 300) => String(v ?? "").trim().slice(0, max);

router.get("/", async (req, res) => {
  const s = (await readJSON("settings.json")) || {};
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
  const origin = s.panelDomain && s.domainVerified
    ? `${s.panelScheme === "http" ? "http" : "https"}://${s.panelDomain}`
    : `${String(proto).split(",")[0]}://${req.get("host")}`;
  res.json({
    smtpEmail: s.smtpEmail || "",
    smtpAppPasswordSet: !!s.smtpAppPassword,
    smtpHost: s.smtpHost || "smtp.gmail.com",
    smtpPort: s.smtpPort || 465,
    discordEnabled: !!s.discordEnabled,
    discordClientId: s.discordClientId || "",
    discordClientSecretSet: !!s.discordClientSecret,
    discordRedirectUri: `${origin}/api/auth/discord/callback`,
    panelDomain: s.panelDomain || "",
    panelScheme: s.panelScheme === "http" ? "http" : "https",
    domainVerified: !!s.domainVerified,
    accessMode: s.accessMode || (s.panelDomain && s.domainVerified ? "domain" : "local"),
    localIp: s.localIp || detectLocalIp() || "",
    detectedLocalIp: detectLocalIp() || "",
    serverIp: await getPublicIp()
  });
});

router.put("/", async (req, res) => {
  const b = req.body || {};
  const s = (await readJSON("settings.json")) || {};

  if (b.smtpEmail !== undefined) s.smtpEmail = str(b.smtpEmail, 200);
  if (b.smtpHost !== undefined) s.smtpHost = str(b.smtpHost, 200) || "smtp.gmail.com";
  if (b.smtpPort !== undefined) s.smtpPort = Number(b.smtpPort) || 465;
  if (typeof b.smtpAppPassword === "string" && b.smtpAppPassword.trim()) s.smtpAppPassword = b.smtpAppPassword.replace(/\s+/g, "");
  if (b.clearSmtpPassword === true) delete s.smtpAppPassword;

  if (b.discordEnabled !== undefined) s.discordEnabled = !!b.discordEnabled;
  if (b.discordClientId !== undefined) s.discordClientId = str(b.discordClientId, 40);
  if (typeof b.discordClientSecret === "string" && b.discordClientSecret.trim()) s.discordClientSecret = b.discordClientSecret.trim();

  await writeJSON("settings.json", s);
  res.json({ success: true });
});

router.post("/test-mail", async (req, res) => {
  const s = (await readJSON("settings.json")) || {};
  const to = str(req.body?.to, 200) || s.smtpEmail;
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: "Enter a valid email address" });
  try {
    await sendMail(to, `${s.panelName || "Verse Panel"} — test email`, "<p>Email is working. Password reset emails will now be delivered. ✅</p>");
    res.json({ success: true, message: `Test email sent to ${to}` });
  } catch (e: any) {
    const msg = String(e?.message || "");
    res.status(400).json({
      error: /Invalid login|535|Username and Password not accepted/i.test(msg)
        ? "Gmail rejected the login. Use a 16-character App Password (Google Account → Security → 2-Step Verification → App passwords), not your normal password."
        : "Could not send: " + msg
    });
  }
});

/** Checks the DNS A record and, when it matches this server, saves the domain as the panel domain. */
router.post("/domain/verify", async (req, res) => {
  const domain = str(req.body?.domain, 253).toLowerCase();
  if (!isValidDomain(domain)) return res.status(400).json({ ok: false, message: "Invalid domain name (example: panel.example.com)." });
  const result = await verifyDomain(domain);
  if (result.ok) {
    const s = (await readJSON("settings.json")) || {};
    s.panelDomain = domain;
    s.domainVerified = true;
    s.panelScheme = req.body?.scheme === "http" ? "http" : "https";
    s.accessMode = "domain";
    await writeJSON("settings.json", s);
    req.app.get("io")?.emit("settings_updated");
  }
  res.json(result);
});

router.delete("/domain", async (req, res) => {
  const s = (await readJSON("settings.json")) || {};
  delete s.panelDomain;
  delete s.domainVerified;
  s.accessMode = "local";
  await writeJSON("settings.json", s);
  req.app.get("io")?.emit("settings_updated");
  res.json({ success: true });
});

/** Switch to local-network mode: servers are shown as <LAN IP>:<port>; the domain (if any) is removed. */
router.post("/local-mode", async (req, res) => {
  const wanted = String(req.body?.ip || "").trim();
  const ip = wanted || detectLocalIp() || "";
  if (!isIPv4(ip)) return res.status(400).json({ error: "Enter a valid IPv4 address (e.g. 192.168.1.20)" });
  const s = (await readJSON("settings.json")) || {};
  delete s.panelDomain;
  delete s.domainVerified;
  s.accessMode = "local";
  s.localIp = ip;
  await writeJSON("settings.json", s);
  req.app.get("io")?.emit("settings_updated");
  res.json({ success: true, ip });
});

/* ---------------- Database host (MySQL / MariaDB) ---------------- */
router.get("/database", async (_req, res) => {
  const c = await getDbConfig();
  const s = (await readJSON("settings.json")) || {};
  const raw = s.dbHost || {};
  res.json({
    configured: !!c,
    host: raw.host || "", port: raw.port || 3306, adminUser: raw.adminUser || "",
    passwordSet: !!raw.adminPasswordEnc, publicHost: raw.publicHost || "", maxPerServer: raw.maxPerServer ?? 2
  });
});

router.put("/database", async (req, res) => {
  const b = req.body || {};
  if (b.port !== undefined && (!Number.isInteger(Number(b.port)) || Number(b.port) < 1 || Number(b.port) > 65535)) {
    return res.status(400).json({ error: "Invalid port" });
  }
  await saveDbConfig({
    host: b.host, port: b.port, adminUser: b.adminUser,
    adminPassword: typeof b.adminPassword === "string" ? b.adminPassword : undefined,
    publicHost: b.publicHost, maxPerServer: b.maxPerServer
  });
  res.json({ success: true });
});

router.post("/database/test", async (_req, res) => {
  const c = await getDbConfig();
  if (!c) return res.status(400).json({ error: "Save the host, user and password first" });
  try {
    const version = await testConnection(c);
    res.json({ success: true, message: `Connected — server version ${version}` });
  } catch (e: any) {
    res.status(400).json({ error: "Connection failed: " + (e?.code || e?.message || "unknown error") });
  }
});

/* ---------------- System check ---------------- */
const sh = (cmd: string) => new Promise<string>(resolve => exec(cmd, { timeout: 5000 }, (e, out, err) => resolve(e ? "" : String(out || err).trim())));

router.get("/diagnostics", async (_req, res) => {
  const checks: Array<{ name: string; ok: boolean; detail: string; hint?: string }> = [];
  const add = (name: string, ok: boolean, detail: string, hint?: string) => checks.push({ name, ok, detail, hint });
  const settings = (await readJSON("settings.json")) || {};
  const servers = (await readJSON("servers.json")) || [];

  // Docker
  let dockerOk = false, dockerDetail = "";
  try {
    await Promise.race([defaultDocker.ping(), new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 4000))]);
    dockerOk = true;
    dockerDetail = "Docker daemon answers";
  } catch (e: any) {
    dockerDetail = hasDockerSocket() ? `Docker socket found but not answering (${e?.message || "error"})` : "Docker socket not found";
  }
  const dockerServers = servers.filter((s: any) => (!s.nodeId || s.nodeId === "local") && s.runtimeType !== "local").length;
  add("Docker", dockerOk || dockerServers === 0, dockerDetail,
    dockerOk ? undefined : "Servers using the Docker runtime cannot start. Install Docker (curl -fsSL https://get.docker.com | sh) and run: sudo systemctl enable --now docker. Without Docker, create servers with the Local runtime.");

  // Java (local runtime Minecraft)
  const java = await sh("java -version 2>&1 | head -n1");
  const localServers = servers.filter((s: any) => (!s.nodeId || s.nodeId === "local") && s.runtimeType === "local").length;
  add("Java", !!java || localServers === 0, java || "not installed", java ? undefined : "Needed only for servers on the Local runtime: sudo apt install -y openjdk-21-jre-headless");

  // Data folder
  try {
    const f = path.join(process.cwd(), ".data", ".write-test");
    await fs.writeFile(f, "ok"); await fs.remove(f);
    add("Data folder writable", true, path.join(process.cwd(), ".data"));
  } catch (e: any) {
    add("Data folder writable", false, String(e?.message || e), "Check the permissions of the .data folder.");
  }

  // Disk + memory
  try {
    const st: any = await (fs as any).promises.statfs(process.cwd());
    const freeGB = (st.bavail * st.bsize) / 1024 ** 3;
    add("Free disk", freeGB > 2, `${freeGB.toFixed(1)} GB free`, freeGB > 2 ? undefined : "Very little disk space left — servers and backups will fail.");
  } catch {}
  const freeMem = os.freemem() / 1024 ** 3, totalMem = os.totalmem() / 1024 ** 3;
  add("Memory", freeMem > 0.3, `${freeMem.toFixed(1)} GB free of ${totalMem.toFixed(1)} GB`, freeMem > 0.3 ? undefined : "The VPS is almost out of RAM.");

  // Servers whose container is missing
  const noContainer = servers.filter((s: any) => (!s.nodeId || s.nodeId === "local") && !s.containerId).length;
  add("Servers prepared", noContainer === 0, noContainer ? `${noContainer} server(s) have no container yet` : "all servers have a container/process",
    noContainer ? "These never finished creating (often Docker was not ready). Delete and recreate them after Docker works." : undefined);

  add("Default runtime", true, String(settings.defaultRuntime || "docker"));

  // Nodes
  for (const n of await listAgentNodes()) {
    try {
      const info = (await nodeRequest(n, "GET", "/api/node/info", { token: decryptSecret(n.tokenEnc), timeout: 6000 })).data;
      add(`Node: ${n.name}`, !!info?.docker, info?.docker ? `online · Docker ok · ${info.memFreeGB} GB RAM free` : "online but Docker is not running on the node",
        info?.docker ? undefined : "Install/start Docker on that VPS.");
    } catch (e: any) {
      add(`Node: ${n.name}`, false, e?.message || "unreachable", "Check that the node is running (pm2 status), the port is open in the firewall, and the token matches.");
    }
  }
  res.json({ checks, ok: checks.every(c => c.ok) });
});

export default router;
