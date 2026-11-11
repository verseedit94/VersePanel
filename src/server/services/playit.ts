import crypto from "crypto";
import { listAgentNodes, saveAgentNodes, nodeRequest } from "./nodeClient.js";
import type { AgentNode } from "./nodeClient.js";
import { encryptSecret, decryptSecret } from "./crypto.js";
import { readJSON, writeJSON } from "./db.js";
import * as api from "./playitApi.js";

/**
 * Per-node playit.gg tunnel. A node is linked to a playit account once (claim link); after that every server created on
 * the node gets its own tunnel (no game type is asked) and shows <node tunnel address>:<its own public port>.
 */
export interface PlayitState {
  secretEnc?: string;
  agentId?: string;
  claimCode?: string;
  claimStarted?: number;
  /** address shown for all servers of this node (the first tunnel's domain) */
  host?: string;
  ipNum?: number;
  tunnels: Record<string, { tunnelId: string; localPort: number }>;
}
const state = (n: AgentNode): PlayitState => ((n as any).playit ||= { tunnels: {} });

async function saveNode(node: AgentNode) {
  const all = await listAgentNodes();
  const i = all.findIndex(n => n.id === node.id);
  if (i >= 0) { all[i] = node; await saveAgentNodes(all); }
}
export const getNodeById = async (id: string) => (await listAgentNodes()).find(n => n.id === id && !(n as any).pending) || null;

async function setServerAddresses(map: Record<string, { host: string; port: number } | null>) {
  const servers = (await readJSON("servers.json")) || [];
  let changed = false;
  for (const s of servers) {
    if (!(s.id in map)) continue;
    const v = map[s.id];
    if (v) { if (s.publicHost !== v.host || s.publicPort !== v.port) { s.publicHost = v.host; s.publicPort = v.port; changed = true; } }
    else if (s.publicHost || s.publicPort) { delete s.publicHost; delete s.publicPort; changed = true; }
  }
  if (changed) await writeJSON("servers.json", servers);
}

/** Make every server of this node show host:port from its tunnel; all use the first tunnel's address when playit gave the same IP. */
async function applyAddresses(node: AgentNode, rd: api.PlayitRunData) {
  const pl = state(node);
  const byId = new Map(rd.tunnels.map(t => [t.id, t]));
  const entries = Object.entries(pl.tunnels).map(([serverId, v]) => ({ serverId, t: byId.get(v.tunnelId) })).filter(x => x.t) as { serverId: string; t: api.PlayitTunnel }[];
  const out: Record<string, { host: string; port: number } | null> = {};
  for (const sid of Object.keys(pl.tunnels)) out[sid] = null;
  if (entries.length) {
    const anchor = api.tunnelAddress(entries[0].t);
    pl.host = anchor.host; pl.ipNum = anchor.ipNum;
    for (const { serverId, t } of entries) {
      const a = api.tunnelAddress(t);
      out[serverId] = { host: a.ipNum === anchor.ipNum ? anchor.host : a.host, port: a.port };
    }
  } else { delete pl.host; delete pl.ipNum; }
  await saveNode(node);
  await setServerAddresses(out);
  try { await (await import("./subdomains.js")).refreshSubdomains(Object.keys(out)); } catch { /* best effort */ }
}

/* ------------------------------------------------------------------ link the node to a playit account */
export async function startClaim(node: AgentNode) {
  const pl = state(node);
  const code = api.newClaimCode(crypto.randomBytes);
  await api.claimSetup(code);
  pl.claimCode = code; pl.claimStarted = Date.now();
  await saveNode(node);
  return { url: api.claimUrl(code), code };
}

export async function pushAgent(node: AgentNode) {
  const pl = state(node);
  if (!pl.secretEnc) return;
  await nodeRequest(node, "POST", "/api/node/playit/start", { body: { secret: decryptSecret(pl.secretEnc) }, timeout: 150000 });
}

export async function checkClaim(node: AgentNode): Promise<{ state: "connected" | "waiting" | "rejected" | "expired" | "none"; warning?: string }> {
  const pl = state(node);
  if (pl.secretEnc) return { state: "connected" };
  if (!pl.claimCode) return { state: "none" };
  if (pl.claimStarted && Date.now() - pl.claimStarted > 30 * 60 * 1000) return { state: "expired" };
  const r = await api.claimExchange(pl.claimCode);
  if (r.state !== "secret") return { state: r.state };
  const rd = await api.agentRunData(r.secret);
  pl.secretEnc = encryptSecret(r.secret);
  pl.agentId = rd.agent_id;
  delete pl.claimCode; delete pl.claimStarted;
  pl.tunnels ||= {};
  await saveNode(node);
  let warning: string | undefined;
  try { await pushAgent(node); } catch (e: any) { warning = `Linked, but the agent could not be started on the node: ${e?.message || e}`; }
  return { state: "connected", warning };
}

/* ------------------------------------------------------------------ tunnels */
async function findOrCreate(node: AgentNode, secret: string, server: any): Promise<string> {
  const pl = state(node);
  const rd = await api.agentRunData(secret);
  const port = Number(server.port);
  const known = pl.tunnels[server.id];
  if (known && rd.tunnels.some(t => t.id === known.tunnelId) || known && rd.pending.some((p: any) => p.id === known.tunnelId)) return known.tunnelId;
  const same = rd.tunnels.find(t => t.local_port === port && ["127.0.0.1", "::1", "0.0.0.0"].includes(t.local_ip));
  const id = same ? same.id : await api.createTunnel(secret, pl.agentId || rd.agent_id, String(server.name || server.id), port);
  pl.tunnels[server.id] = { tunnelId: id, localPort: port };
  return id;
}

async function waitForTunnel(secret: string, id: string, tries = 8): Promise<api.PlayitRunData | null> {
  for (let i = 0; i < tries; i++) {
    const rd = await api.agentRunData(secret);
    if (rd.tunnels.some(t => t.id === id && t.assigned_domain)) return rd;
    await new Promise(r => setTimeout(r, 1500));
  }
  return null;
}

/** Called right after a server is created on a node (non-fatal: returns what it could do). */
export async function ensureServerTunnel(node: AgentNode, server: any): Promise<{ host: string; port: number } | null> {
  const pl = state(node);
  if (!pl.secretEnc || !server?.port) return null;
  const secret = decryptSecret(pl.secretEnc);
  const id = await findOrCreate(node, secret, server);
  await saveNode(node);
  const rd = await waitForTunnel(secret, id);
  if (!rd) return null;
  await applyAddresses(node, rd);
  const t = rd.tunnels.find(x => x.id === id)!;
  const a = api.tunnelAddress(t);
  return { host: a.ipNum === pl.ipNum && pl.host ? pl.host : a.host, port: a.port };
}

/** Create missing tunnels for every server on the node and refresh the shown addresses. */
export async function syncNode(node: AgentNode): Promise<{ created: number; pending: number; errors: string[] }> {
  const pl = state(node);
  if (!pl.secretEnc) throw new api.PlayitError("fail", "This node is not linked to playit.gg yet");
  const secret = decryptSecret(pl.secretEnc);
  const servers = ((await readJSON("servers.json")) || []).filter((s: any) => s.nodeId === node.id && s.port);
  let created = 0; const errors: string[] = []; const ids: string[] = [];
  for (const s of servers) {
    try {
      const had = !!pl.tunnels[s.id];
      ids.push(await findOrCreate(node, secret, s));
      if (!had) created++;
    } catch (e: any) { errors.push(`${s.name || s.id}: ${e?.message || e}`); }
  }
  await saveNode(node);
  let rd = await api.agentRunData(secret);
  if (ids.some(id => !rd.tunnels.some(t => t.id === id))) rd = (await waitForTunnel(secret, ids.find(id => !rd.tunnels.some(t => t.id === id))!, 6)) || rd;
  await applyAddresses(node, rd);
  return { created, pending: ids.filter(id => !rd.tunnels.some(t => t.id === id)).length, errors };
}

export async function removeServerTunnel(node: AgentNode, serverId: string) {
  const pl = state(node);
  const v = pl.tunnels[serverId];
  if (!v) return;
  delete pl.tunnels[serverId];
  if (pl.secretEnc) {
    try { await api.deleteTunnel(decryptSecret(pl.secretEnc), v.tunnelId); } catch { /* already gone */ }
  }
  await saveNode(node);
  if (pl.secretEnc) { try { await applyAddresses(node, await api.agentRunData(decryptSecret(pl.secretEnc))); } catch {} }
}

export async function disconnect(node: AgentNode) {
  const pl = state(node);
  const secret = pl.secretEnc ? decryptSecret(pl.secretEnc) : "";
  const ids = Object.keys(pl.tunnels);
  if (secret) for (const sid of ids) { try { await api.deleteTunnel(secret, pl.tunnels[sid].tunnelId); } catch {} }
  const out: Record<string, null> = {};
  for (const sid of ids) out[sid] = null;
  try { await nodeRequest(node, "POST", "/api/node/playit/stop", { timeout: 15000 }); } catch {}
  (node as any).playit = { tunnels: {} };
  await saveNode(node);
  await setServerAddresses(out);
}

/** What the Nodes page shows. */
export async function describe(node: AgentNode) {
  const pl = state(node);
  const servers = ((await readJSON("servers.json")) || []).filter((s: any) => s.nodeId === node.id);
  let agent: any = null;
  if (pl.secretEnc) { try { agent = (await nodeRequest(node, "GET", "/api/node/playit", { timeout: 8000 })).data; } catch (e: any) { agent = { error: e?.message || String(e) }; } }
  return {
    connected: !!pl.secretEnc,
    claiming: !!pl.claimCode,
    claimUrl: pl.claimCode ? api.claimUrl(pl.claimCode) : null,
    host: pl.host || null,
    agent,
    servers: servers.map((s: any) => ({ id: s.id, name: s.name, port: s.port, tunnel: !!pl.tunnels[s.id], address: s.publicHost && s.publicPort ? `${s.publicHost}:${s.publicPort}` : null }))
  };
}
