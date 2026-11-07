import crypto from "crypto";
import fs from "fs-extra";
import path from "path";
import os from "os";

/**
 * Verse Node mode — this same app can run as a "node": it runs servers on this VPS and
 * is controlled by the main panel over an authenticated HTTP API. Enabled with NODE_MODE=true.
 *
 * The main panel authenticates users; the node only trusts requests that carry the node token
 * (X-Node-Token) and — optionally — come from NODE_ALLOWED_IPS.
 */
export const isNodeMode = () => /^(1|true|yes)$/i.test(String(process.env.NODE_MODE || ""));

let cachedToken: string | null = null;
export function getNodeToken(): string {
  if (cachedToken) return cachedToken;
  if (process.env.NODE_TOKEN && process.env.NODE_TOKEN.length >= 24) return (cachedToken = process.env.NODE_TOKEN);
  const file = path.join(process.cwd(), ".data", "node.token");
  try {
    if (fs.existsSync(file)) return (cachedToken = fs.readFileSync(file, "utf8").trim());
    fs.ensureDirSync(path.dirname(file));
    const t = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(file, t, { mode: 0o600 });
    return (cachedToken = t);
  } catch {
    return (cachedToken = crypto.randomBytes(32).toString("hex"));
  }
}

const sha = (s: string) => crypto.createHash("sha256").update(s).digest();
export const verifyNodeToken = (provided?: string | string[]) =>
  typeof provided === "string" && provided.length > 0 && crypto.timingSafeEqual(sha(provided), sha(getNodeToken()));

const normIp = (ip: string) => String(ip || "").replace(/^::ffff:/, "");
export function ipAllowed(ip: string): boolean {
  const list = String(process.env.NODE_ALLOWED_IPS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!list.length) return true;
  return list.includes(normIp(ip));
}

// brute-force guard: 20 bad tokens per minute per IP
const fails = new Map<string, number[]>();
function tooManyFails(ip: string) {
  const now = Date.now();
  const arr = (fails.get(ip) || []).filter(t => now - t < 60_000);
  fails.set(ip, arr);
  return arr.length >= 20;
}

export interface ActingUser { id: string; username: string; role: string }

export const encodeActingUser = (u: Partial<ActingUser> | undefined) =>
  Buffer.from(JSON.stringify({ id: String(u?.id || "panel"), username: String(u?.username || "Panel"), role: String(u?.role || "admin") })).toString("base64url");

export function decodeActingUser(header?: string | string[]): ActingUser {
  const fallback = { id: "panel", username: "Panel", role: "admin" };
  if (typeof header !== "string" || !header || header.length > 2000) return fallback;
  try {
    const o = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
    const role = ["owner", "admin", "user"].includes(o.role) ? o.role : "user";
    return { id: String(o.id || "panel").slice(0, 100), username: String(o.username || "Panel").slice(0, 100), role };
  } catch {
    return fallback;
  }
}

/** Node-mode request authentication used by requireAuth / requireAdmin / socket.io. */
export function authenticateNodeRequest(req: any): { ok: true; user: ActingUser } | { ok: false; status: number; error: string } {
  const ip = normIp(req.ip || req.socket?.remoteAddress || "");
  if (!ipAllowed(ip)) return { ok: false, status: 403, error: "This node only accepts requests from the panel's IP" };
  if (tooManyFails(ip)) return { ok: false, status: 429, error: "Too many failed attempts" };
  if (!verifyNodeToken(req.headers?.["x-node-token"])) {
    const arr = fails.get(ip) || [];
    arr.push(Date.now());
    fails.set(ip, arr);
    return { ok: false, status: 401, error: "Invalid node token" };
  }
  return { ok: true, user: decodeActingUser(req.headers?.["x-acting-user"]) };
}

/** Data shown in the panel's Nodes page. */
export async function getNodeInfo(dockerPing?: () => Promise<boolean>) {
  const root = process.cwd();
  let diskTotal = 0, diskFree = 0;
  try {
    const st: any = await (fs as any).promises.statfs(root);
    diskTotal = st.blocks * st.bsize;
    diskFree = st.bavail * st.bsize;
  } catch {}
  let version = "";
  try { version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version || ""; } catch {}
  let serverCount = 0;
  try { serverCount = (fs.readJsonSync(path.join(root, ".data", "servers.json")) || []).length; } catch {}
  let docker = false;
  try { docker = dockerPing ? await dockerPing() : false; } catch {}
  const GB = 1024 ** 3;
  return {
    verseNode: true,
    version,
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    cpus: os.cpus().length,
    load1: os.loadavg()[0],
    memTotalGB: +(os.totalmem() / GB).toFixed(2),
    memFreeGB: +(os.freemem() / GB).toFixed(2),
    diskTotalGB: +(diskTotal / GB).toFixed(1),
    diskFreeGB: +(diskFree / GB).toFixed(1),
    docker,
    serverCount,
    uptime: os.uptime()
  };
}
