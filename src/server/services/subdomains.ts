import { readJSON, writeJSON } from "./db.js";
import { encryptSecret, decryptSecret } from "./crypto.js";
import { listAgentNodes, saveAgentNodes } from "./nodeClient.js";
import type { AgentNode } from "./nodeClient.js";
import { getPublicIp } from "./domain.js";
import * as cf from "./cloudflareApi.js";

/**
 * Cloudflare DNS for game addresses.
 *  - one admin-authorised Cloudflare zone (token stored encrypted in cloudflare.json)
 *  - node address: <label>.<zone> → the node (all servers of the node then show that host, only the port differs)
 *  - server subdomains: <label>.<zone> → the server's current address (+ a Minecraft SRV record so players need no port)
 */
export interface CfConfig { tokenEnc?: string; zoneId?: string; zoneName?: string; zones?: { id: string; name: string }[]; allowSubdomains?: boolean }
const FILE = "cloudflare.json";
export const readCfg = async (): Promise<CfConfig> => (await readJSON(FILE)) || {};
const writeCfg = (c: CfConfig) => writeJSON(FILE, c);
const tokenOf = (c: CfConfig) => { if (!c.tokenEnc) throw new cf.CfError("Cloudflare is not set up (Admin settings → Subdomains)"); return decryptSecret(c.tokenEnc); };

export async function publicConfig() {
  const c = await readCfg();
  return { enabled: !!c.allowSubdomains, configured: !!(c.tokenEnc && c.zoneId), hasToken: !!c.tokenEnc, zone: c.zoneId ? { id: c.zoneId, name: c.zoneName } : null, zones: c.zones || [], tokenUrl: cf.TOKEN_PAGE_URL };
}
export async function setEnabled(v: boolean) { const c = await readCfg(); c.allowSubdomains = !!v; await writeCfg(c); }

export async function saveToken(token: string) {
  token = String(token || "").trim();
  if (token.length < 20 || token.length > 200) throw new cf.CfError("that does not look like an API token");
  await cf.verifyToken(token);
  const zones = await cf.listZones(token);
  if (!zones.length) throw new cf.CfError("the token works but sees no domain — give it access to your domain (Zone → Read, DNS → Edit)");
  const c = await readCfg();
  c.tokenEnc = encryptSecret(token); c.zones = zones;
  if (!zones.some(z => z.id === c.zoneId)) { c.zoneId = zones.length === 1 ? zones[0].id : undefined; c.zoneName = zones.length === 1 ? zones[0].name : undefined; }
  await writeCfg(c);
}
export async function chooseZone(zoneId: string) {
  const c = await readCfg();
  const z = (c.zones || []).find(x => x.id === zoneId);
  if (!z) throw new cf.CfError("unknown domain");
  c.zoneId = z.id; c.zoneName = z.name; await writeCfg(c);
}
export async function disconnectCloudflare() { const c = await readCfg(); await writeCfg({ allowSubdomains: c.allowSubdomains }); }

/* ---------------------------------------------------------------- helpers */
async function saveNode(node: AgentNode) {
  const all = await listAgentNodes(); const i = all.findIndex(n => n.id === node.id);
  if (i >= 0) { all[i] = node; await saveAgentNodes(all); }
}
async function patchServers(fn: (servers: any[]) => boolean) {
  const servers = (await readJSON("servers.json")) || [];
  if (fn(servers)) await writeJSON("servers.json", servers);
}

/** where a record for this server must point */
async function serverTarget(server: any): Promise<{ host: string; port: number }> {
  const port = Number(server.publicPort || server.port);
  let host = String(server.publicHost || server.host || "");
  if (!host || host === "localhost" || host === "127.0.0.1") {
    const s = (await readJSON("settings.json")) || {};
    host = (s.panelDomain && s.domainVerified ? String(s.panelDomain) : "") || (await getPublicIp()) || "";
  }
  if (!host || !port) throw new cf.CfError("this server has no public address yet");
  return { host, port };
}
const recordFor = (name: string, host: string): cf.DnsRecord => cf.isIPv4(host) ? { type: "A", name, content: host } : { type: "CNAME", name, content: host };
const isGameType = (t: any) => !/^(NODE|NODEJS|PYTHON|PYTHON3)$/i.test(String(t || ""));

/* ---------------------------------------------------------------- node address */
export async function setNodeAddress(node: AgentNode, label: string) {
  const c = await readCfg(); const token = tokenOf(c);
  if (!c.zoneId) throw new cf.CfError("choose a domain first (Admin settings → Subdomains)");
  label = String(label || "").trim().toLowerCase();
  if (!cf.validLabel(label)) throw new cf.CfError("subdomain: use letters, numbers and dashes (max 32)");
  if ((node as any).playit?.secretEnc) throw new cf.CfError("this node already uses a playit tunnel — disconnect it first");
  const target = node.fqdn;
  if (/\.trycloudflare\.com$/i.test(target)) throw new cf.CfError("this node is reached through a temporary tunnel, so game ports are not public. Use playit.gg for this node");
  const fqdn = `${label}.${c.zoneName}`;
  await removeNodeAddress(node, false);
  const id = await cf.createRecord(token, c.zoneId, recordFor(fqdn, target));
  (node as any).cf = { host: fqdn, recordId: id, zoneId: c.zoneId, label };
  await saveNode(node);
  await applyNodeHost(node);
  return fqdn;
}
export async function removeNodeAddress(node: AgentNode, clear = true) {
  const cur = (node as any).cf; if (!cur) return;
  try { await cf.deleteRecord(tokenOf(await readCfg()), cur.zoneId, cur.recordId); } catch {}
  delete (node as any).cf; await saveNode(node);
  if (clear) await patchServers(list => { let ch = false; for (const s of list) if (s.nodeId === node.id && s.publicHost) { delete s.publicHost; delete s.publicPort; ch = true; } return ch; });
}
export async function applyNodeHost(node: AgentNode) {
  const cur = (node as any).cf; if (!cur) return;
  await patchServers(list => { let ch = false; for (const s of list) if (s.nodeId === node.id) { s.publicHost = cur.host; s.publicPort = Number(s.port); ch = true; } return ch; });
}

/* ---------------------------------------------------------------- server subdomains */
export interface SubItem { label: string; fqdn: string; recordIds: string[] }
const findServer = async (id: string) => ((await readJSON("servers.json")) || []).find((s: any) => s.id === id);

export async function listSubdomains(serverId: string) {
  const c = await readCfg(); const s = await findServer(serverId);
  if (!s) throw new cf.CfError("server not found");
  const items: SubItem[] = s.subdomains || [];
  return { enabled: !!c.allowSubdomains, configured: !!(c.tokenEnc && c.zoneId), zone: c.zoneName || null, limit: Number(s.subdomainLimit || 0), used: items.length, items: items.map(i => ({ label: i.label, fqdn: i.fqdn })), address: s.publicHost && s.publicPort ? `${s.publicHost}:${s.publicPort}` : null };
}

async function makeRecords(c: CfConfig, server: any, label: string): Promise<SubItem> {
  const token = tokenOf(c); const fqdn = `${label}.${c.zoneName}`;
  const { host, port } = await serverTarget(server);
  const ids: string[] = [];
  try {
    ids.push(await cf.createRecord(token, c.zoneId!, recordFor(fqdn, host)));
    if (isGameType(server.type)) ids.push(await cf.createRecord(token, c.zoneId!, { type: "SRV", name: `_minecraft._tcp.${fqdn}`, port, target: host }));
  } catch (e) { for (const id of ids) await cf.deleteRecord(token, c.zoneId!, id); throw e; }
  return { label, fqdn, recordIds: ids };
}

export async function addSubdomain(serverId: string, label: string) {
  const c = await readCfg();
  if (!c.allowSubdomains) throw new cf.CfError("subdomains are turned off by the admin");
  if (!c.tokenEnc || !c.zoneId) throw new cf.CfError("Cloudflare is not set up yet");
  label = String(label || "").trim().toLowerCase();
  if (!cf.validLabel(label)) throw new cf.CfError("subdomain: use letters, numbers and dashes (max 32)");
  if (["www", "mail", "ftp", "panel", "admin", "api", "ns1", "ns2"].includes(label)) throw new cf.CfError("that name is reserved");
  const servers = (await readJSON("servers.json")) || [];
  const s = servers.find((x: any) => x.id === serverId);
  if (!s) throw new cf.CfError("server not found");
  const items: SubItem[] = (s.subdomains ||= []);
  if (items.length >= Number(s.subdomainLimit || 0)) throw new cf.CfError(`this server may have ${Number(s.subdomainLimit || 0)} subdomain(s)`);
  if (servers.some((x: any) => (x.subdomains || []).some((i: SubItem) => i.label === label))) throw new cf.CfError("that subdomain is already taken");
  const item = await makeRecords(c, s, label);
  items.push(item);
  await writeJSON("servers.json", servers);
  return item.fqdn;
}

export async function removeSubdomain(serverId: string, label: string) {
  const c = await readCfg();
  const servers = (await readJSON("servers.json")) || [];
  const s = servers.find((x: any) => x.id === serverId);
  const it = s?.subdomains?.find((i: SubItem) => i.label === label);
  if (!it) throw new cf.CfError("subdomain not found");
  if (c.tokenEnc && c.zoneId) for (const id of it.recordIds) await cf.deleteRecord(tokenOf(c), c.zoneId, id);
  s.subdomains = s.subdomains.filter((i: SubItem) => i.label !== label);
  await writeJSON("servers.json", servers);
}

export async function setLimit(serverId: string, limit: number) {
  const n = Math.max(0, Math.min(50, Math.floor(Number(limit) || 0)));
  await patchServers(list => { const s = list.find(x => x.id === serverId); if (!s) return false; s.subdomainLimit = n; return true; });
}

/** the server's address changed (new tunnel / new node address): repoint its subdomains */
export async function refreshSubdomains(serverIds: string[]) {
  const c = await readCfg(); if (!c.tokenEnc || !c.zoneId) return;
  const servers = (await readJSON("servers.json")) || []; let ch = false;
  for (const s of servers) {
    if (!serverIds.includes(s.id) || !(s.subdomains || []).length) continue;
    const next: SubItem[] = [];
    for (const it of s.subdomains as SubItem[]) {
      try { for (const id of it.recordIds) await cf.deleteRecord(tokenOf(c), c.zoneId, id); next.push(await makeRecords(c, s, it.label)); ch = true; }
      catch { next.push(it); }
    }
    s.subdomains = next;
  }
  if (ch) await writeJSON("servers.json", servers);
}
export async function deleteAllSubdomains(serverId: string) {
  const s = await findServer(serverId);
  for (const it of (s?.subdomains || []) as SubItem[]) { try { await removeSubdomain(serverId, it.label); } catch {} }
}
