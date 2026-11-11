import crypto from "crypto";
import bcrypt from "bcryptjs";
import { readJSON, writeJSON } from "./db.js";
import { encryptSecret, decryptSecret } from "./crypto.js";

/**
 * Discord AI helper for the hosting panel.
 *  /register  → modal (username, email, password) → creates the panel account for that Discord user (password is never echoed)
 *  /ai <task> → members with the allowed role describe a job ("@user ko 4GB RAM 10GB disk 2 core Paper do"); a Groq model turns it
 *               into one of a few safe tools (create server, list, power, resources). Players who never used /register make the job fail.
 * The bot connects to the Discord gateway itself (no public URL needed). Secrets are stored encrypted in aibot.json.
 */
export interface AiCfg {
  enabled?: boolean; tokenEnc?: string; groqEnc?: string; roleId?: string; model?: string; nodeId?: string;
  maxRamGB?: number; maxDiskGB?: number; maxCores?: number;
  users?: Record<string, { panelUserId: string; username: string; at: string }>;
}
const FILE = "aibot.json";
export const readAiCfg = async (): Promise<AiCfg> => (await readJSON(FILE)) || {};
export const writeAiCfg = (c: AiCfg) => writeJSON(FILE, c);
export const DEFAULT_MODEL = "llama-3.3-70b-versatile";
export const SOFTWARE = ["PAPER", "PURPUR", "FOLIA", "SPIGOT", "VANILLA", "FABRIC", "QUILT", "FORGE", "NEOFORGE", "BUNGEECORD", "VELOCITY", "NODEJS", "PYTHON"];
const limits = (c: AiCfg) => ({ ram: c.maxRamGB || 8, disk: c.maxDiskGB || 20, cores: c.maxCores || 4 });

const DISCORD = () => (process.env.DISCORD_API_URL || "https://discord.com/api/v10").replace(/\/+$/, "");
const GATEWAY = () => (process.env.DISCORD_GATEWAY_URL || "wss://gateway.discord.gg").replace(/\/+$/, "");
const GROQ = () => (process.env.GROQ_API_URL || "https://api.groq.com/openai/v1").replace(/\/+$/, "");

export const status: { state: "off" | "connecting" | "online" | "error"; error?: string; botName?: string; appId?: string } = { state: "off" };

/* ------------------------------------------------------------------ REST helpers */
async function discord(method: string, path: string, token: string | null, body?: any) {
  const r = await fetch(DISCORD() + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bot ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  const t = await r.text();
  let j: any = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error(`Discord ${r.status}: ${j?.message || t.slice(0, 120)}`);
  return j;
}
export async function groq(key: string, payload: any) {
  const r = await fetch(GROQ() + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(45000)
  });
  const j: any = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`Groq ${r.status}: ${j?.error?.message || "request failed"}`);
  return j;
}

/* ------------------------------------------------------------------ gateway */
let sock: any = null, hbTimer: any = null, seq: number | null = null, stopped = true, retry = 0, ackOk = true;

export function stopAiBot() {
  stopped = true; clearInterval(hbTimer);
  try { sock?.close(1000); } catch {}
  sock = null; status.state = "off"; delete status.error;
}

export async function startAiBot() {
  stopAiBot();
  const c = await readAiCfg();
  if (!c.enabled || !c.tokenEnc) return;
  stopped = false; retry = 0;
  connect(decryptSecret(c.tokenEnc));
}

function send(s: any, o: any) { if (s?.readyState === 1) s.send(JSON.stringify(o)); }

function connect(token: string) {
  const WS = (globalThis as any).WebSocket;
  if (!WS) { status.state = "error"; status.error = "This Node.js has no WebSocket (needs Node 22+)"; return; }
  status.state = "connecting";
  const s = new WS(`${GATEWAY()}/?v=10&encoding=json`);
  sock = s; seq = null;
  s.onmessage = (e: any) => { try { onPacket(s, token, JSON.parse(String(e.data))); } catch (err: any) { console.error("[ai-bot]", err?.message); } };
  s.onclose = (e: any) => {
    clearInterval(hbTimer);
    if (stopped || sock !== s) return;
    if (e.code === 4004) { stopped = true; status.state = "error"; status.error = "Discord refused the bot token"; return; }
    status.state = "error"; status.error = `Gateway closed (${e.code || "?"}), reconnecting…`;
    setTimeout(() => { if (!stopped) connect(token); }, Math.min(30000, 3000 * ++retry));
  };
  s.onerror = () => {};
}

function onPacket(s: any, token: string, p: any) {
  if (p.s != null) seq = p.s;
  if (p.op === 10) {
    const iv = p.d.heartbeat_interval; ackOk = true; clearInterval(hbTimer);
    setTimeout(() => send(s, { op: 1, d: seq }), iv * Math.random());
    hbTimer = setInterval(() => { if (!ackOk) { try { s.close(4000); } catch {} return; } ackOk = false; send(s, { op: 1, d: seq }); }, iv);
    send(s, { op: 2, d: { token, intents: 0, properties: { os: "linux", browser: "verse-panel", device: "verse-panel" } } });
  } else if (p.op === 11) ackOk = true;
  else if (p.op === 1) send(s, { op: 1, d: seq });
  else if (p.op === 7 || p.op === 9) { try { s.close(4000); } catch {} }
  else if (p.op === 0) {
    if (p.t === "READY") {
      retry = 0; status.state = "online"; delete status.error; status.botName = p.d.user?.username; status.appId = p.d.application?.id;
      registerCommands(token, String(p.d.application?.id)).catch(e => { status.error = "Could not register commands: " + e.message; });
    } else if (p.t === "INTERACTION_CREATE") handleInteraction(p.d).catch(e => console.error("[ai-bot] interaction:", e?.message));
  }
}

const COMMANDS = [
  { name: "register", description: "Create your hosting panel account", type: 1 },
  { name: "mcplans", description: "Post the Minecraft hosting plans with buttons in this channel", type: 1, default_member_permissions: "32", dm_permission: false },
  { name: "vpsplans", description: "Post the VPS plans in this channel", type: 1, default_member_permissions: "32", dm_permission: false },
  { name: "ai", description: "Ask the AI to do a hosting task (allowed role only)", type: 1,
    options: [{ type: 3, name: "task", description: "e.g. @user give 4GB RAM, 10GB disk, 2 cores, Paper", required: true, max_length: 500 }] }
];
const registerCommands = (token: string, appId: string) => discord("PUT", `/applications/${appId}/commands`, token, COMMANDS);

/* ------------------------------------------------------------------ interactions */
const EPHEMERAL = 64;
const cb = (i: any, type: number, data?: any) => discord("POST", `/interactions/${i.id}/${i.token}/callback`, null, { type, data });
const editReply = (i: any, content: string, extra: any = {}) => discord("PATCH", `/webhooks/${status.appId}/${i.token}/messages/@original`, null, { content: content.slice(0, 1900), allowed_mentions: { parse: [] }, ...extra });
const cooldown = new Map<string, number>();

async function handleInteraction(i: any) {
  if (i.type === 2 && i.data?.name === "register") return openRegister(i);
  if (i.type === 5 && i.data?.custom_id === "aura_register") return submitRegister(i);
  if (i.type === 2 && i.data?.name === "ai") return aiCommand(i);
  if (i.type === 2 && (i.data?.name === "mcplans" || i.data?.name === "vpsplans")) return postPlans(i, i.data.name === "vpsplans");
  if (i.type === 3 && String(i.data?.custom_id || "").startsWith("plans:")) return showPlans(i);
}
const discordId = (i: any) => String(i.member?.user?.id || i.user?.id || "");

async function openRegister(i: any) {
  const c = await readAiCfg();
  if (c.users?.[discordId(i)]) return cb(i, 4, { flags: EPHEMERAL, content: `You are already registered as **${c.users[discordId(i)].username}**.` });
  const row = (id: string, label: string, min: number, max: number) => ({ type: 1, components: [{ type: 4, custom_id: id, label, style: 1, min_length: min, max_length: max, required: true }] });
  return cb(i, 9, { custom_id: "aura_register", title: "Create your panel account", components: [row("username", "Username", 3, 32), row("email", "Email", 5, 100), row("password", "Password (min 6 characters)", 6, 64)] });
}

async function submitRegister(i: any) {
  const v: Record<string, string> = {};
  for (const r of i.data?.components || []) for (const c of r.components || []) v[c.custom_id] = String(c.value || "").trim();
  const did = discordId(i);
  const reply = (t: string) => cb(i, 4, { flags: EPHEMERAL, content: t });
  const cfg = await readAiCfg();
  if (cfg.users?.[did]) return reply(`You are already registered as **${cfg.users[did].username}**.`);
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(v.username || "")) return reply("❌ Username: 3-32 letters, numbers, `_` `.` `-` only.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email || "")) return reply("❌ That email does not look right.");
  if ((v.password || "").length < 6) return reply("❌ Password must be at least 6 characters.");
  const users = (await readJSON("users.json")) || [];
  if (users.some((u: any) => String(u.username).toLowerCase() === v.username.toLowerCase())) return reply("❌ That username is already taken. Run /register again with another one.");
  if (users.some((u: any) => u.email && String(u.email).toLowerCase() === v.email.toLowerCase())) return reply("❌ That email is already used.");
  const u = { id: "user-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7), username: v.username, email: v.email, password: await bcrypt.hash(v.password, 10), role: "user", passwordVersion: 0, discordId: did };
  users.push(u); await writeJSON("users.json", users);
  cfg.users = { ...(cfg.users || {}), [did]: { panelUserId: u.id, username: u.username, at: new Date().toISOString() } };
  await writeAiCfg(cfg);
  const s = (await readJSON("settings.json")) || {};
  const url = s.panelDomain && s.domainVerified ? `https://${s.panelDomain}` : "";
  return reply(`✅ Account created! Username: **${u.username}**${url ? `\nLogin: ${url}` : ""}\nYour password was not shown to anyone else.`);
}

async function aiCommand(i: any) {
  const cfg = await readAiCfg(); const did = discordId(i);
  const ephemeral = (t: string) => cb(i, 4, { flags: EPHEMERAL, content: t });
  if (!cfg.groqEnc) return ephemeral("❌ The AI is not configured yet (Groq key missing).");
  if (!cfg.roleId) return ephemeral("❌ The admin has not chosen an allowed role yet.");
  if (!(i.member?.roles || []).includes(cfg.roleId)) return ephemeral("❌ You do not have the role that is allowed to use the AI.");
  const last = cooldown.get(did) || 0;
  if (Date.now() - last < 6000) return ephemeral("⏳ Slow down a little, try again in a few seconds.");
  cooldown.set(did, Date.now());
  const task = String(i.data?.options?.find((o: any) => o.name === "task")?.value || "").slice(0, 500);
  await cb(i, 5);
  let text: string;
  try { text = await runAi(task, did, cfg); }
  catch (e: any) { text = `❌ AI failed: ${String(e?.message || e).slice(0, 300)}`; }
  await editReply(i, text || "❌ The AI gave no answer.");
}

/* ------------------------------------------------------------------ plan lists (/mcplans, /vpsplans) */
const CAT_COLOR: Record<string, number> = { budget: 0x2ecc71, premium: 0x9b59b6, performance: 0xe67e22, vps: 0x3498db };
const money = (n: number) => "₹" + Number(n).toLocaleString("en-IN");
const planLine = (p: any) => p.category === "vps"
  ? `${p.emoji || "🎁"} **${p.name}** — ⚙️ ${p.cpu} vCPU · 💾 ${p.ramGB} GB RAM · 💽 ${p.diskGB} GiB · 💰 **${money(p.priceINR)}/month**`
  : `${p.emoji} **${p.name}** — 💾 ${p.ramGB} GB · ⚙️ ${p.cpu}% · 💽 ${p.diskGB} GB ${p.storage || ""} · 💰 **${money(p.priceINR)}/month**`.replace(/  +/g, " ");

async function planEmbed(cat: string) {
  const Site = await import("./site.js");
  const cfg = await Site.getCfg();
  const info = (cfg.categories as any)[cat]; if (!info) return null;
  const plans = (await Site.getPlans()).filter(p => p.category === cat);
  const parts = [info.subtitle, "", ...plans.map(planLine)];
  if (info.features.length) parts.push("", "✨ " + info.features.join(" • "));
  if (info.software.length) parts.push("", "🎮 " + info.software.join(" • "));
  parts.push("", "🌐 **To order, open a ticket in this Discord server.**");
  return { title: `${cfg.brand} — ${info.title}`, description: parts.join("\n").slice(0, 4000), color: CAT_COLOR[cat] || 0x7c3aed, footer: { text: `${cfg.brand} — powered by performance` } };
}

async function canPostPlans(i: any, cfg: AiCfg) {
  const perms = BigInt(String(i.member?.permissions || "0"));
  return (perms & 0x20n) !== 0n || !!(cfg.roleId && (i.member?.roles || []).includes(cfg.roleId));
}

async function postPlans(i: any, vps: boolean) {
  const cfg = await readAiCfg();
  if (!(await canPostPlans(i, cfg))) return cb(i, 4, { flags: EPHEMERAL, content: "❌ Only server managers (or the allowed role) can post the plans." });
  await cb(i, 5);
  const Site = await import("./site.js");
  const site = await Site.getCfg();
  if (vps) { const e = await planEmbed("vps"); return editReply(i, "", { embeds: e ? [e] : [] }); }
  const plans = (await Site.getPlans()).filter(p => p.category !== "vps");
  const from = (c: string) => Math.min(...plans.filter(p => p.category === c).map(p => p.priceINR));
  let text = `🎮 **${site.brand} — Minecraft Hosting**\nPremium servers from **${money(from("budget"))}/month**! Budget, Premium and Ryzen 9 Performance plans — NVMe storage, DDoS protection, Java & Bedrock.\n👇 Press a button to see every plan and its price. To order, open a ticket!`;
  if (cfg.groqEnc) {
    try {
      const j = await groq(decryptSecret(cfg.groqEnc), { model: cfg.model || DEFAULT_MODEL, temperature: 0.8, max_tokens: 300, messages: [
        { role: "system", content: "You write short, exciting Discord announcements for a Minecraft hosting company. Max 450 characters, a few emojis, Hinglish allowed, no markdown headers, no @everyone. End by telling members to press a button below to see all plans and to open a ticket to order." },
        { role: "user", content: `Company: ${site.brand}. Plan families: Budget plans from ${money(from("budget"))}/month, Premium plans from ${money(from("premium"))}/month, Performance (AMD Ryzen 9) plans from ${money(from("performance"))}/month. Features: NVMe storage, DDoS protection, Java & Bedrock, instant reinstall, premium game panel.` }] });
      const t = String(j?.choices?.[0]?.message?.content || "").trim();
      if (t.length > 40) text = t.slice(0, 1500);
    } catch { /* fallback text */ }
  }
  const btn = (label: string, id: string, emoji: string) => ({ type: 2, style: 1, label, custom_id: id, emoji: { name: emoji } });
  const row: any[] = [btn("Budget Plans", "plans:budget", "🟢"), btn("Premium Plans", "plans:premium", "💎"), btn("Performance Plans", "plans:performance", "⚡")];
  return editReply(i, text, { components: [{ type: 1, components: row }] });
}

async function showPlans(i: any) {
  const cat = String(i.data.custom_id).split(":")[1];
  const e = await planEmbed(cat);
  return cb(i, 4, e ? { flags: EPHEMERAL, embeds: [e] } : { flags: EPHEMERAL, content: "❌ Unknown plan list." });
}

/* ------------------------------------------------------------------ the AI + tools */
const SYSTEM = `You are the hosting assistant of a game/bot hosting company. You only act through the provided tools.
Rules:
- Every user is given as a Discord id. Only act for users with registered=true. If a user has registered=false (or is not listed), do NOT call any tool for them; answer that the task failed because they must use /register first.
- "me", "mujhe", "myself" means the requester. Never invent Discord ids or servers.
- If the task names a plan (for example "Ryzen Pro", "Premium Basic", "Starter Plan"), call create_server with plan set to that name (call list_plans if unsure). Otherwise use ram_gb, disk_gb and cpu_cores.
- Software must be one of: ${SOFTWARE.join(", ")} ("node"/"nodejs" = NODEJS, "python" = PYTHON). RAM and storage are in GB, CPU in cores.
- If the request is unclear or a value is missing, ask for it instead of guessing. If a tool returns an error, report it honestly.
- Reply briefly in the same language style as the task (Hinglish is fine). Start with ✅ for success or ❌ for failure.`;

const TOOLS = [
  { type: "function", function: { name: "create_server", description: "Create a server for a registered user, either from a named plan (plan) or from explicit ram_gb, disk_gb and cpu_cores", parameters: { type: "object", properties: { discord_user_id: { type: "string" }, plan: { type: "string", description: "plan name or id, e.g. Ryzen Pro" }, ram_gb: { type: "number" }, disk_gb: { type: "number" }, cpu_cores: { type: "number" }, software: { type: "string", enum: SOFTWARE }, version: { type: "string" }, name: { type: "string" } }, required: ["discord_user_id"] } } },
  { type: "function", function: { name: "list_plans", description: "List the sellable Minecraft plans with their resources and price", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "list_servers", description: "List the servers of a registered user", parameters: { type: "object", properties: { discord_user_id: { type: "string" } }, required: ["discord_user_id"] } } },
  { type: "function", function: { name: "server_power", description: "Start, stop, restart or kill one server of a registered user", parameters: { type: "object", properties: { discord_user_id: { type: "string" }, server: { type: "string", description: "server name or id" }, action: { type: "string", enum: ["start", "stop", "restart", "kill"] } }, required: ["discord_user_id", "server", "action"] } } },
  { type: "function", function: { name: "set_resources", description: "Change RAM, storage and CPU of one server of a registered user (the server is stopped)", parameters: { type: "object", properties: { discord_user_id: { type: "string" }, server: { type: "string" }, ram_gb: { type: "number" }, disk_gb: { type: "number" }, cpu_cores: { type: "number" } }, required: ["discord_user_id", "server", "ram_gb", "disk_gb", "cpu_cores"] } } }
];

async function runAi(task: string, requesterId: string, cfg: AiCfg): Promise<string> {
  const key = decryptSecret(cfg.groqEnc!);
  const ids = [...new Set([requesterId, ...[...task.matchAll(/<@!?(\d+)>/g)].map(m => m[1])])];
  const people = ids.map(id => ({ discord_id: id, registered: !!cfg.users?.[id], panel_username: cfg.users?.[id]?.username || null, is_requester: id === requesterId }));
  const L = limits(cfg);
  const messages: any[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: JSON.stringify({ task, users: people, limits: { max_ram_gb: L.ram, max_storage_gb: L.disk, max_cpu_cores: L.cores } }) }
  ];
  for (let step = 0; step < 5; step++) {
    const j = await groq(key, { model: cfg.model || DEFAULT_MODEL, messages, tools: TOOLS, tool_choice: "auto", temperature: 0.1, max_tokens: 600 });
    const m = j?.choices?.[0]?.message;
    if (!m) throw new Error("empty answer from Groq");
    if (!m.tool_calls?.length) return String(m.content || "");
    messages.push(m);
    for (const call of m.tool_calls) {
      let args: any = {}; try { args = JSON.parse(call.function?.arguments || "{}"); } catch {}
      let out: any;
      try { out = await execTool(String(call.function?.name), args, cfg); } catch (e: any) { out = { ok: false, error: String(e?.message || e) }; }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out).slice(0, 3000) });
    }
  }
  return "❌ The task took too many steps. Please make it simpler.";
}

/* run a panel controller as a service admin and capture its answer */
const AI_ADMIN = { id: "aura-ai", username: "AURA AI", role: "admin" };
function callController(fn: any, req: { params?: any; body?: any }): Promise<{ status: number; body: any }> {
  return new Promise(resolve => {
    let code = 200; let done = false;
    const finish = (b: any) => { if (!done) { done = true; resolve({ status: code, body: b }); } };
    const res: any = { status(c: number) { code = c; return res; }, json: finish, send: finish, end: () => finish(null), setHeader() { return res; }, headersSent: false };
    const r: any = { user: AI_ADMIN, params: req.params || {}, body: req.body || {}, query: {}, headers: {}, ip: "127.0.0.1", get: () => "" };
    setTimeout(() => finish({ error: "timed out" }), 120000);
    Promise.resolve(fn(r, res)).catch(e => finish({ error: String(e?.message || e) }));
  });
}

async function resolveTarget(cfg: AiCfg, id: any) {
  const m = cfg.users?.[String(id)];
  if (!m) return { error: { ok: false, error: "NOT_REGISTERED", message: `<@${id}> has not used /register yet, so nothing can be done for them.` } };
  const users = (await readJSON("users.json")) || [];
  if (!users.some((u: any) => u.id === m.panelUserId)) return { error: { ok: false, error: "NOT_REGISTERED", message: `The panel account of <@${id}> no longer exists. They must use /register again.` } };
  return { target: m };
}
const num = (v: any) => Number(v);
const between = (v: number, lo: number, hi: number) => Number.isFinite(v) && v >= lo && v <= hi;

async function findServer(owner: string, q: any) {
  const list = ((await readJSON("servers.json")) || []).filter((s: any) => s.owner === owner);
  const s = String(q || "").toLowerCase();
  return list.find((x: any) => x.id === q) || list.find((x: any) => String(x.name).toLowerCase() === s) || list.find((x: any) => String(x.name).toLowerCase().includes(s));
}

async function freePort(nodeId: string, software: string) {
  const servers = ((await readJSON("servers.json")) || []).filter((s: any) => (s.nodeId || "local") === nodeId);
  const used = new Set<number>(); for (const s of servers) { used.add(Number(s.port)); for (const p of s.extraPorts || []) used.add(Number(p.port)); }
  let p = ["NODEJS", "PYTHON"].includes(software) ? 3001 : 25565;
  while (used.has(p) && p < 65000) p++;
  return p;
}


/** create a server for a panel user (as the service admin); the panel decides everything else exactly like in the UI */
export async function provisionServer(o: { ownerId: string; ownerName: string; name?: string; ramGB: number; diskGB: number; cpuPercent: number; software: string; version?: string; nodeId?: string }): Promise<any> {
  const SC: any = await import("../controllers/servers.js");
  const software = String(o.software || "PAPER").toUpperCase();
  if (!SOFTWARE.includes(software)) return { ok: false, error: `software must be one of ${SOFTWARE.join(", ")}` };
  const nodeId = o.nodeId || "local";
  const port = await freePort(nodeId, software);
  const name = String(o.name || `${o.ownerName}-${software.toLowerCase()}`).replace(/[^\w .-]/g, "").slice(0, 40) || "server";
  const r = await callController(SC.createServer, { body: { name, ram: Math.ceil(o.ramGB), cpu: Math.round(o.cpuPercent), disk: Math.ceil(o.diskGB), port, type: software, version: String(o.version || "latest").slice(0, 30), owner: o.ownerId, nodeId, backupLimit: 3, subdomainLimit: 0 } });
  if (r.status >= 400) return { ok: false, error: r.body?.error || `panel answered ${r.status}` };
  return { ok: true, server_id: r.body?.id, name, software, version: r.body?.version || "latest", ram_gb: Math.ceil(o.ramGB), storage_gb: Math.ceil(o.diskGB), cpu_percent: Math.round(o.cpuPercent), port };
}

export async function execTool(name: string, a: any, cfg: AiCfg): Promise<any> {
  const SC: any = await import("../controllers/servers.js");
  const L = limits(cfg);
  if (name === "list_plans") {
    const Site = await import("./site.js");
    return { ok: true, plans: (await Site.getPlans()).filter(p => p.category !== "vps").map(p => ({ category: p.category, name: p.name, ram_gb: p.ramGB, cpu_percent: p.cpu, storage_gb: p.diskGB, price_inr_month: p.priceINR })) };
  }
  const t = await resolveTarget(cfg, a.discord_user_id);
  if (t.error) return t.error;
  const owner = t.target!.panelUserId;

  if (name === "list_servers") {
    const list = ((await readJSON("servers.json")) || []).filter((s: any) => s.owner === owner);
    return { ok: true, servers: list.map((s: any) => ({ name: s.name, id: s.id, status: s.status, software: s.type, version: s.version, ram_gb: s.ram, storage_gb: s.disk, cpu_cores: Number(s.cpu) / 100, port: s.port })) };
  }

  if (name === "create_server") {
    const Site = await import("./site.js");
    const software = String(a.software || "PAPER").toUpperCase();
    if (!SOFTWARE.includes(software)) return { ok: false, error: `software must be one of ${SOFTWARE.join(", ")}` };
    let ram: number, disk: number, cpu: number, label = "";
    if (a.plan) {
      const plan = await Site.findPlan(String(a.plan));
      if (!plan) return { ok: false, error: `no Minecraft plan called "${a.plan}"`, plans: (await Site.getPlans()).filter(p => p.category !== "vps").map(p => p.name) };
      ram = plan.ramGB; disk = plan.diskGB; cpu = plan.cpu; label = plan.name;
    } else {
      ram = Math.ceil(num(a.ram_gb)); disk = Math.ceil(num(a.disk_gb)); const cores = num(a.cpu_cores);
      if (!between(ram, 1, L.ram)) return { ok: false, error: `RAM must be between 1 and ${L.ram} GB` };
      if (!between(disk, 1, L.disk)) return { ok: false, error: `storage must be between 1 and ${L.disk} GB` };
      if (!between(cores, 0.5, L.cores)) return { ok: false, error: `CPU must be between 0.5 and ${L.cores} cores` };
      cpu = Math.round(cores * 100);
    }
    const r = await provisionServer({ ownerId: owner, ownerName: t.target!.username, name: a.name || (label ? `${t.target!.username}-${label}` : ""), ramGB: ram, diskGB: disk, cpuPercent: cpu, software, version: a.version, nodeId: cfg.nodeId });
    return r.ok ? { ...r, plan: label || undefined, owner: t.target!.username, note: "The server is installing; the owner can see it in the panel." } : r;
  }

  const srv = await findServer(owner, a.server);
  if (!srv) return { ok: false, error: `no server called "${a.server}" for ${t.target!.username}` };

  if (name === "server_power") {
    const fn = ({ start: SC.startServer, stop: SC.stopServer, restart: SC.restartServer, kill: SC.killServer } as any)[String(a.action)];
    if (!fn) return { ok: false, error: "action must be start, stop, restart or kill" };
    const r = await callController(fn, { params: { id: srv.id } });
    return r.status >= 400 ? { ok: false, error: r.body?.error || `panel answered ${r.status}` } : { ok: true, server: srv.name, action: a.action };
  }

  if (name === "set_resources") {
    const ram = Math.ceil(num(a.ram_gb)), disk = Math.ceil(num(a.disk_gb)), cores = num(a.cpu_cores);
    if (!between(ram, 1, L.ram) || !between(disk, 1, L.disk) || !between(cores, 0.5, L.cores)) return { ok: false, error: `limits are RAM 1-${L.ram} GB, storage 1-${L.disk} GB, CPU 0.5-${L.cores} cores` };
    const r = await callController(SC.updateResources, { params: { id: srv.id }, body: { ram, disk, cpu: Math.round(cores * 100) } });
    return r.status >= 400 ? { ok: false, error: r.body?.error || `panel answered ${r.status}` } : { ok: true, server: srv.name, ram_gb: ram, storage_gb: disk, cpu_cores: cores, note: "The server was stopped to apply this; start it again." };
  }
  return { ok: false, error: `unknown tool ${name}` };
}
