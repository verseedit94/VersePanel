import crypto from "crypto";
import { AgentNode, listAgentNodes, saveAgentNodes, nodeRequest } from "./nodeClient.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { isIPv4, isValidDomain } from "./domain.js";

/**
 * "Add VPS" flow: the panel creates a pending node + one-time enrollment token, hands the admin an install
 * command, and the VPS registers itself by calling back with that token.
 */
export const ENROLL_TTL_MS = 60 * 60 * 1000;
export const DEFAULT_NODE_PORT = 6870;
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export const isEnrollToken = (t: any) => typeof t === "string" && /^[a-f0-9]{48}$/.test(t);

const cleanName = (n: any) => String(n ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60);

export function normalizePanelUrl(raw: any): string | null {
  try {
    const u = new URL(String(raw || "").trim());
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return null;
    return `${u.protocol}//${u.host}`;
  } catch { return null; }
}
export const isLoopbackUrl = (url: string) => /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(url);

export interface PendingResult { node: AgentNode; enrollToken: string; nodeToken: string }

export async function createPendingNode(input: { name: any; domain?: any; panelUrl: any }): Promise<PendingResult | { error: string }> {
  const name = cleanName(input.name);
  if (!name) return { error: "Give the VPS a name" };
  const panelUrl = normalizePanelUrl(input.panelUrl);
  if (!panelUrl) return { error: "Panel URL is not valid (example: https://panel.example.com or http://203.0.113.5:6767)" };
  const domain = String(input.domain || "").trim().toLowerCase();
  if (domain && !isValidDomain(domain)) return { error: "Node domain is not valid (example: node1.example.com)" };

  const agents = await listAgentNodes();
  if (agents.some(n => n.name.toLowerCase() === name.toLowerCase())) return { error: "A node with this name already exists" };

  const enrollToken = crypto.randomBytes(24).toString("hex");
  const nodeToken = crypto.randomBytes(32).toString("hex");
  const node: AgentNode = {
    id: crypto.randomUUID(), name, fqdn: "", port: DEFAULT_NODE_PORT, ssl: false,
    tokenEnc: encryptSecret(nodeToken), createdAt: new Date().toISOString(),
    pending: true, enrollHash: sha(enrollToken), enrollExpires: Date.now() + ENROLL_TTL_MS, panelUrl, domain: domain || undefined
  } as any;
  agents.push(node);
  await saveAgentNodes(agents);
  return { node, enrollToken, nodeToken };
}

/** New command for a node that is still waiting (old link stops working). */
export async function regeneratePending(id: string): Promise<PendingResult | { error: string }> {
  const agents = await listAgentNodes();
  const node: any = agents.find(n => n.id === id);
  if (!node || !node.pending) return { error: "Node not found or already connected" };
  const enrollToken = crypto.randomBytes(24).toString("hex");
  node.enrollHash = sha(enrollToken);
  node.enrollExpires = Date.now() + ENROLL_TTL_MS;
  await saveAgentNodes(agents);
  return { node, enrollToken, nodeToken: decryptSecret(node.tokenEnc) };
}

export async function findPendingByToken(token: string): Promise<any | null> {
  if (!isEnrollToken(token)) return null;
  const h = sha(token);
  const node: any = (await listAgentNodes()).find((n: any) => n.pending && n.enrollHash === h);
  return node && node.enrollExpires > Date.now() ? node : null;
}

const normIp = (ip: string) => String(ip || "").replace(/^::ffff:/, "");
const isPrivateOrLoopback = (ip: string) => /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|169\.254\.)/.test(ip);

export async function completeEnroll(token: string, body: any, sourceIp: string): Promise<{ ok: true; node: AgentNode } | { ok: false; status: number; error: string }> {
  const found = await findPendingByToken(token);
  if (!found) return { ok: false, status: 404, error: "This link is invalid or expired. Create a new one in Nodes → Add VPS." };

  const port = Number(body?.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, status: 400, error: "Invalid port" };
  const ssl = !!body?.ssl;

  // which address will the panel use to reach this VPS?
  const src = normIp(sourceIp);
  const hinted = String(body?.host || "").trim().toLowerCase();
  let fqdn = src;
  // a node behind NAT / in a container announces its free Cloudflare quick-tunnel address
  const tunnelHost = body?.tunnel === true && /^[a-z0-9-]+\.trycloudflare\.com$/.test(hinted);
  if (tunnelHost) fqdn = hinted;
  else if (found.domain) fqdn = found.domain;
  else if (isPrivateOrLoopback(src) && (isIPv4(hinted) || isValidDomain(hinted))) fqdn = hinted;
  if (!isIPv4(fqdn) && !isValidDomain(fqdn) && fqdn !== "::1") return { ok: false, status: 400, error: "Could not work out the VPS address" };

  const probe = { fqdn, port, ssl, name: found.name };
  let info: any;
  try {
    info = (await nodeRequest(probe, "GET", "/api/node/info", { token: decryptSecret(found.tokenEnc), timeout: 8000 })).data;
  } catch (e: any) {
    return { ok: false, status: 400, error: `The panel could not reach the node at ${ssl ? "https" : "http"}://${fqdn}:${port} — ${e?.message || "no answer"}. Open port ${port} in the VPS firewall / cloud security group, then run the command again.` };
  }
  if (!info?.verseNode) return { ok: false, status: 400, error: "That address answered, but it is not a Verse Node" };

  const agents = await listAgentNodes();
  const node: any = agents.find(n => n.id === found.id);
  if (!node) return { ok: false, status: 404, error: "Node was removed from the panel" };
  node.fqdn = fqdn; node.port = port; node.ssl = ssl;
  node.memoryLimitGB = Math.max(1, Math.floor((info.memTotalGB || 2) * 0.9));
  delete node.pending; delete node.enrollHash; delete node.enrollExpires; delete node.panelUrl;
  await saveAgentNodes(agents);
  return { ok: true, node };
}


/** A tunnel node got a new quick-tunnel address after a restart: it re-announces itself (authenticated by its node token). */
export async function updateNodeAddress(nodeId: any, token: any, host: any): Promise<{ ok: boolean; status: number; error?: string }> {
  const h = String(host || "").trim().toLowerCase();
  if (!/^[a-z0-9-]+\.trycloudflare\.com$/.test(h)) return { ok: false, status: 400, error: "Invalid address" };
  const agents = await listAgentNodes();
  const node: any = agents.find(n => n.id === String(nodeId) && !(n as any).pending);
  if (!node) return { ok: false, status: 404, error: "Unknown node" };
  let real = "";
  try { real = decryptSecret(node.tokenEnc); } catch { return { ok: false, status: 500, error: "Node token unreadable" }; }
  const given = Buffer.from(String(token || ""));
  const want = Buffer.from(real);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return { ok: false, status: 403, error: "Wrong token" };
  try {
    const info: any = (await nodeRequest({ fqdn: h, port: 443, ssl: true, name: node.name }, "GET", "/api/node/info", { token: real, timeout: 8000 })).data;
    if (!info?.verseNode) return { ok: false, status: 400, error: "Not a Verse Node" };
  } catch (e: any) {
    return { ok: false, status: 400, error: `Could not reach ${h}: ${e?.message || "no answer"}` };
  }
  node.fqdn = h; node.port = 443; node.ssl = true;
  await saveAgentNodes(agents);
  return { ok: true, status: 200 };
}
