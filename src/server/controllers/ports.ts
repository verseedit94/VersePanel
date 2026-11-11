import { Request, Response } from "express";
import net from "net";
import dgram from "dgram";
import crypto from "crypto";
import { loadServerForRequest } from "../services/access.js";
import { readJSON, writeJSON } from "../services/db.js";
import { isServerRunning, recreateRuntime } from "../services/runtimeApply.js";

const MAX_EXTRA = 10;

export interface ExtraPort { id: string; port: number; protocol: "tcp" | "udp" | "both"; label: string }

const reserved = () =>
  new Set<number>([Number(process.env.PORT) || 6767, 3000, 6868, 6869, 22, 80, 443]);

function tcpFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "0.0.0.0");
  });
}
function udpFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const s = dgram.createSocket("udp4");
    s.once("error", () => { try { s.close(); } catch {} resolve(false); });
    s.bind(port, "0.0.0.0", () => s.close(() => resolve(true)));
  });
}

export const getPorts = async (req: Request, res: Response) => {
  const server = await loadServerForRequest(req, res);
  if (!server) return;
  res.json({ primary: { port: server.port }, extra: server.extraPorts || [], max: MAX_EXTRA, runtimeType: server.runtimeType || "docker" });
};

export const addPort = async (req: Request, res: Response) => {
  const server0 = await loadServerForRequest(req, res);
  if (!server0) return;
  const port = Number(req.body?.port);
  const protocol = String(req.body?.protocol || "both");
  const label = String(req.body?.label || "").trim().slice(0, 40);

  if (!Number.isInteger(port) || port < 1024 || port > 65535) return res.status(400).json({ error: "Port must be between 1024 and 65535" });
  if (!["tcp", "udp", "both"].includes(protocol)) return res.status(400).json({ error: "Protocol must be tcp, udp or both" });
  if (reserved().has(port)) return res.status(400).json({ error: "That port is reserved by the panel" });

  const servers = (await readJSON("servers.json")) || [];
  const server = servers.find((s: any) => s.id === server0.id);
  if (!server) return res.status(404).json({ error: "Server not found" });
  if ((server.extraPorts || []).length >= MAX_EXTRA) return res.status(400).json({ error: `Maximum ${MAX_EXTRA} extra ports per server` });

  const taken = servers.some((s: any) => Number(s.port) === port || (s.extraPorts || []).some((p: ExtraPort) => p.port === port));
  if (taken) return res.status(409).json({ error: "That port is already assigned to a server" });

  if (server.runtimeType !== "local" && server.containerId && (await isServerRunning(server))) {
    return res.status(409).json({ error: "Stop the server first — the container must be rebuilt to publish the new port." });
  }
  if (protocol !== "udp" && !(await tcpFree(port))) return res.status(409).json({ error: "That TCP port is in use by another program on this machine" });
  if (protocol !== "tcp" && !(await udpFree(port))) return res.status(409).json({ error: "That UDP port is in use by another program on this machine" });

  server.extraPorts = [...(server.extraPorts || []), { id: crypto.randomBytes(4).toString("hex"), port, protocol, label }];
  let recreated = false;
  try { recreated = await recreateRuntime(server); }
  catch (e: any) { return res.status(500).json({ error: "Could not rebuild the container: " + (e?.message || e) }); }
  await writeJSON("servers.json", servers);
  res.status(201).json({ extra: server.extraPorts, recreated });
};

export const removePort = async (req: Request, res: Response) => {
  const server0 = await loadServerForRequest(req, res);
  if (!server0) return;
  const servers = (await readJSON("servers.json")) || [];
  const server = servers.find((s: any) => s.id === server0.id);
  if (!server) return res.status(404).json({ error: "Server not found" });
  const list: ExtraPort[] = server.extraPorts || [];
  if (!list.some(p => p.id === req.params.portId)) return res.status(404).json({ error: "Port not found" });
  if (server.runtimeType !== "local" && server.containerId && (await isServerRunning(server))) {
    return res.status(409).json({ error: "Stop the server first — the container must be rebuilt." });
  }
  server.extraPorts = list.filter(p => p.id !== req.params.portId);
  let recreated = false;
  try { recreated = await recreateRuntime(server); }
  catch (e: any) { return res.status(500).json({ error: "Could not rebuild the container: " + (e?.message || e) }); }
  await writeJSON("servers.json", servers);
  res.json({ extra: server.extraPorts, recreated });
};
