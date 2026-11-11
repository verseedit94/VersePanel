import http from "http";
import https from "https";
import axios from "axios";
import { Request, Response, NextFunction } from "express";
import { readJSON, writeJSON } from "./db.js";
import { decryptSecret } from "./crypto.js";
import { encodeActingUser } from "./nodeMode.js";

/**
 * Main-panel side of Verse Nodes: registry, authenticated requests, and a streaming reverse proxy that forwards
 * /api/servers/:id/* to the node that actually runs the server.
 */
export interface AgentNode {
  id: string;
  name: string;
  fqdn: string;
  port: number;
  ssl: boolean;
  tokenEnc: string;
  memoryLimitGB?: number;
  location?: string;
  createdAt: string;
  /** "Add VPS" flow: waiting for the VPS to run the install command */
  pending?: boolean;
  enrollHash?: string;
  enrollExpires?: number;
  panelUrl?: string;
  domain?: string;
  /** playit.gg link for this node (see services/playit.ts) */
  playit?: any;
}

const FILE = "agent_nodes.json";
export const listAgentNodes = async (): Promise<AgentNode[]> => (await readJSON(FILE)) || [];
export const saveAgentNodes = (n: AgentNode[]) => writeJSON(FILE, n);
export const getAgentNode = async (id?: string): Promise<AgentNode | null> =>
  id && id !== "local" ? (await listAgentNodes()).find(n => n.id === id) || null : null;

/** The node running this server (null for local / legacy-Docker servers). */
export const serverNode = async (server: any): Promise<AgentNode | null> =>
  server?.nodeId && server.nodeId !== "local" ? getAgentNode(server.nodeId) : null;

export const nodeBaseUrl = (n: Pick<AgentNode, "ssl" | "fqdn" | "port">) => `${n.ssl ? "https" : "http"}://${n.fqdn}:${n.port}`;
export const nodeTokenOf = (n: AgentNode) => decryptSecret(n.tokenEnc);

export const SYSTEM_USER = { id: "panel", username: "Panel", role: "admin" };

export class NodeError extends Error {
  status: number;
  constructor(message: string, status = 502) { super(message); this.status = status; }
}

export interface NodeRequestOpts { body?: any; params?: any; user?: any; timeout?: number; token?: string }

/** JSON request to a node. Throws NodeError with a readable message on failure. */
export async function nodeRequest(node: Pick<AgentNode, "ssl" | "fqdn" | "port" | "name"> & { tokenEnc?: string }, method: string, path: string, opts: NodeRequestOpts = {}) {
  const token = opts.token || (node.tokenEnc ? decryptSecret(node.tokenEnc) : "");
  try {
    return await axios.request({
      method: method as any,
      url: nodeBaseUrl(node) + path,
      data: opts.body,
      params: opts.params,
      timeout: opts.timeout ?? 15000,
      maxBodyLength: Infinity,
      headers: { "X-Node-Token": token, "X-Acting-User": encodeActingUser(opts.user || SYSTEM_USER) }
    });
  } catch (e: any) {
    if (e.response) {
      throw new NodeError(e.response.data?.error || `Node answered HTTP ${e.response.status}`, e.response.status);
    }
    const code = e.code || e.message;
    const hint = code === "ECONNREFUSED" ? "connection refused (is the node running and the port open?)"
      : code === "ECONNABORTED" || code === "ETIMEDOUT" ? "timed out (firewall?)"
      : code === "ENOTFOUND" ? "host name not found"
      : String(code);
    throw new NodeError(`Node "${node.name}" is unreachable: ${hint}`);
  }
}

/* ------------------------------------------------------------------ */
/* Streaming reverse proxy                                             */
/* ------------------------------------------------------------------ */
const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers", "upgrade", "host", "content-length", "transfer-encoding"]);

export function proxyToNode(req: Request, res: Response, node: AgentNode, targetPath: string, user: any, after?: (status: number) => void) {
  const lib: typeof http = node.ssl ? (https as any) : http;
  const headers: Record<string, any> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    const lk = k.toLowerCase();
    if (["authorization", "host", "connection", "x-node-token", "x-acting-user", "cookie"].includes(lk)) continue;
    headers[lk] = v;
  }
  headers["host"] = `${node.fqdn}:${node.port}`;
  headers["x-node-token"] = nodeTokenOf(node);
  headers["x-acting-user"] = encodeActingUser(user);

  // express.json()/urlencoded() may already have consumed the stream -> re-serialise; everything else is piped untouched
  const ct = String(req.headers["content-type"] || "");
  const hasBody = !["GET", "HEAD"].includes(req.method) &&
    (Number(req.headers["content-length"] || 0) > 0 || /chunked/i.test(String(req.headers["transfer-encoding"] || "")));
  let bodyBuf: Buffer | null = null;
  if (hasBody && /^application\/json/i.test(ct) && (req as any).body !== undefined) bodyBuf = Buffer.from(JSON.stringify((req as any).body));
  else if (hasBody && /^application\/x-www-form-urlencoded/i.test(ct) && (req as any).body) bodyBuf = Buffer.from(new URLSearchParams((req as any).body).toString());
  delete headers["content-length"];
  delete headers["transfer-encoding"];
  if (bodyBuf) headers["content-length"] = String(bodyBuf.length);
  else if (hasBody) {
    if (req.headers["content-length"]) headers["content-length"] = req.headers["content-length"];
    else headers["transfer-encoding"] = "chunked";
  }

  const pr = lib.request(
    { hostname: node.fqdn, port: node.port, path: targetPath, method: req.method, headers, timeout: 30 * 60 * 1000 },
    nres => {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(nres.headers)) if (!HOP.has(k.toLowerCase()) && v !== undefined) out[k] = v;
      res.writeHead(nres.statusCode || 502, out);
      nres.pipe(res);
      nres.on("end", () => after?.(nres.statusCode || 0));
    }
  );
  pr.on("timeout", () => pr.destroy(new Error("ETIMEDOUT")));
  pr.on("error", (err: any) => {
    if (!res.headersSent) {
      const code = err.code || err.message;
      res.status(502).json({ error: `Node "${node.name}" is unreachable: ${code === "ECONNREFUSED" ? "connection refused" : code}` });
    } else res.destroy();
  });
  res.on("close", () => { if (!res.writableFinished) pr.destroy(); });

  if (bodyBuf) pr.end(bodyBuf);
  else if (hasBody) req.pipe(pr);
  else pr.end();
}

/* ------------------------------------------------------------------ */
/* Router-level middleware for /api/servers/:id/*                      */
/* ------------------------------------------------------------------ */
// These live on the main panel's own data even for remote servers.
const MAIN_SIDE = new Set(["schedules", "databases", "activity", "subusers"]);

/** Copy fresh fields of the node's record into the main record (owner / nodeId / host stay as the main panel has them). */
export async function resyncServerRecord(serverId: string, node: AgentNode) {
  try {
    const { data } = await nodeRequest(node, "GET", `/api/servers/${serverId}`, { timeout: 15000 });
    const all = (await readJSON("servers.json")) || [];
    const rec = all.find((s: any) => s.id === serverId);
    if (!rec || !data) return;
    const keep = { id: rec.id, owner: rec.owner, nodeId: rec.nodeId, host: rec.host, remote: true, subUsers: rec.subUsers };
    Object.assign(rec, data, keep);
    await writeJSON("servers.json", all);
  } catch { /* best effort */ }
}

export async function remoteServerProxy(req: Request, res: Response, next: NextFunction) {
  try {
    const id = (req.params as any).id;
    const rest = req.url === "/" ? "" : req.url; // "/files?path=/"
    if (!id) return next();
    const first = rest.split("?")[0].split("/")[1] || "";
    if (MAIN_SIDE.has(first)) return next();
    if (rest === "" && req.method === "GET") return next(); // record + live status are served by the main panel

    const servers = (await readJSON("servers.json")) || [];
    const server = servers.find((s: any) => s.id === id);
    if (!server || !server.nodeId || server.nodeId === "local") return next();
    const node = await getAgentNode(server.nodeId);
    if (!node) {
      if (server.remote) return res.status(502).json({ error: "The node this server runs on was removed from the panel" });
      return next(); // legacy docker node
    }

    const user = (req as any).user;
    const staff = user?.role === "admin" || user?.role === "owner";
    if (!staff && server.owner !== user?.id) return res.status(403).json({ error: "Forbidden" });

    const target = `/api/servers/${encodeURIComponent(id)}${rest}`;
    const isDelete = req.method === "DELETE" && rest === "";
    proxyToNode(req, res, node, target, { id: user.id, username: user.username, role: staff ? user.role : "user" }, status => {
      if (status >= 200 && status < 300) {
        if (isDelete) {
          readJSON("servers.json").then(async (all: any[]) => {
            try { await (await import("./subdomains.js")).deleteAllSubdomains(id); } catch {}
            all = (await readJSON("servers.json")) || all;
            await writeJSON("servers.json", (all || []).filter(s => s.id !== id));
            try { await (await import("./cleanup.js")).cleanupServerData(id); } catch {}
            try { await (await import("./playit.js")).removeServerTunnel(node, id); } catch {}
          });
        } else if (req.method !== "GET") resyncServerRecord(id, node);
      }
    });
  } catch (e: any) {
    if (!res.headersSent) res.status(500).json({ error: e?.message || "Proxy error" });
  }
}
