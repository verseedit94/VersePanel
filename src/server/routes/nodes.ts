import { Router } from "express";
import crypto from "crypto";
import { readJSON, writeJSON } from "../services/db.js";
import { requireAuth } from "../middleware/auth.js";
import { decryptSecret } from "../services/crypto.js";
import { NodeError, listAgentNodes, nodeRequest, saveAgentNodes } from "../services/nodeClient.js";
import { isIPv4, isValidDomain } from "../services/domain.js";
import { createPendingNode, isLoopbackUrl, regeneratePending } from "../services/nodeEnroll.js";

const router = Router();
router.use(requireAuth);

const isStaff = (u: any) => !!u && (u.role === "admin" || u.role === "owner");
const hostOk = (h: string) => isIPv4(h) || isValidDomain(h) || h === "localhost";

async function fetchInfo(n: { fqdn: string; port: number; ssl: boolean; name: string }, token: string) {
  return (await nodeRequest(n, "GET", "/api/node/info", { token, timeout: 6000 })).data;
}

const allocatedGB = (servers: any[], nodeId: string) =>
  servers.filter(s => s.nodeId === nodeId).reduce((a, s) => a + (Number(s.ram) || 0), 0);

router.get("/", async (_req, res) => {
  try {
    const servers = (await readJSON("servers.json")) || [];
    const agents = await listAgentNodes();
    const customNodes = (await readJSON("nodes.json")) || [];

    const local = {
      id: "local", name: "Built-in Node (Local)", ip: "127.0.0.1", hostname: "localhost", apiPort: 3000,
      memory: 8192, disk: 50000, isLocal: true, kind: "local", status: "online",
      servers: servers.filter(s => !s.nodeId || s.nodeId === "local").length
    };

    const agentViews = await Promise.all(agents.map(async (n: any) => {
      if (n.pending) {
        return {
          id: n.id, name: n.name, kind: "agent", status: "pending", pending: true, enrollExpires: n.enrollExpires,
          expired: n.enrollExpires < Date.now(), servers: 0, allocatedGB: 0, memoryLimitGB: 0, createdAt: n.createdAt
        };
      }
      const base: any = {
        id: n.id, name: n.name, kind: "agent", fqdn: n.fqdn, ip: n.fqdn, hostname: n.fqdn, port: n.port, ssl: n.ssl,
        location: n.location || "", memoryLimitGB: n.memoryLimitGB || 0, allocatedGB: allocatedGB(servers, n.id),
        servers: servers.filter(s => s.nodeId === n.id).length, createdAt: n.createdAt
      };
      try {
        const info = await fetchInfo(n, decryptSecret(n.tokenEnc));
        return { ...base, status: "online", info };
      } catch (e: any) {
        return { ...base, status: "offline", error: e?.message || "unreachable" };
      }
    }));

    const legacy = customNodes.map((n: any) => ({ ...n, key: undefined, kind: "legacy", status: "unknown" }));
    res.json([local, ...agentViews, ...legacy]);
  } catch (err) {
    console.error("Error loading nodes:", err);
    res.status(500).json({ error: "Failed to load nodes" });
  }
});

/** "Add VPS": create a pending node and return the command to run on the new VPS. */
const commandFor = (panelUrl: string, enrollToken: string) =>
  `curl -fsSL "${panelUrl}/api/nodes/enroll/${enrollToken}/install.sh" | sudo bash`;

router.post("/add-vps", async (req, res) => {
  if (!isStaff((req as any).user)) return res.status(403).json({ error: "Forbidden: Admin access required" });
  const r = await createPendingNode({ name: req.body?.name, domain: req.body?.domain, panelUrl: req.body?.panelUrl });
  if ("error" in r) return res.status(400).json({ error: r.error });
  const panelUrl = (r.node as any).panelUrl as string;
  res.status(201).json({
    id: r.node.id, name: r.node.name, command: commandFor(panelUrl, r.enrollToken),
    expiresAt: (r.node as any).enrollExpires,
    warning: isLoopbackUrl(panelUrl) ? "The panel address is localhost — another VPS cannot reach it. Open the panel with its public IP or domain and try again." : undefined
  });
});

router.post("/:id/regenerate", async (req, res) => {
  if (!isStaff((req as any).user)) return res.status(403).json({ error: "Forbidden" });
  const r = await regeneratePending(req.params.id);
  if ("error" in r) return res.status(404).json({ error: r.error });
  res.json({ id: r.node.id, name: r.node.name, command: commandFor((r.node as any).panelUrl, r.enrollToken), expiresAt: (r.node as any).enrollExpires });
});

router.put("/:id", async (req, res) => {
  if (!isStaff((req as any).user)) return res.status(403).json({ error: "Forbidden" });
  const agents = await listAgentNodes();
  const node = agents.find(n => n.id === req.params.id);
  if (!node) return res.status(404).json({ error: "Node not found" });
  if ((node as any).pending) return res.status(409).json({ error: "This VPS has not connected yet" });
  const b = req.body || {};
  if (b.name !== undefined) node.name = String(b.name).trim().slice(0, 60) || node.name;
  if (b.location !== undefined) node.location = String(b.location).slice(0, 60);
  if (b.memoryLimitGB !== undefined) node.memoryLimitGB = Math.max(0, Number(b.memoryLimitGB) || 0);
  if (b.fqdn !== undefined) {
    const f = String(b.fqdn).trim().toLowerCase();
    if (!hostOk(f)) return res.status(400).json({ error: "Invalid host" });
    node.fqdn = f;
  }
  if (b.port !== undefined) {
    const p = Number(b.port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) return res.status(400).json({ error: "Invalid port" });
    node.port = p;
  }
  if (b.ssl !== undefined) node.ssl = !!b.ssl;
  await saveAgentNodes(agents);

  // keep the address shown for this node's servers in sync
  const servers = (await readJSON("servers.json")) || [];
  let changed = false;
  for (const s of servers) if (s.nodeId === node.id) { s.host = node.fqdn; changed = true; }
  if (changed) await writeJSON("servers.json", servers);
  res.json({ success: true });
});

router.delete("/:id", async (req, res) => {
  if (!isStaff((req as any).user)) return res.status(403).json({ error: "Forbidden" });
  const id = req.params.id;
  const servers = (await readJSON("servers.json")) || [];
  const used = servers.filter((s: any) => s.nodeId === id).length;
  if (used) return res.status(409).json({ error: `${used} server(s) still run on this node. Delete or move them first.` });

  const agents = await listAgentNodes();
  if (agents.some(n => n.id === id)) {
    await saveAgentNodes(agents.filter(n => n.id !== id));
    return res.json({ success: true });
  }
  const legacyList = (await readJSON("nodes.json")) || [];
  if (legacyList.some((n: any) => n.id === id)) { await writeJSON("nodes.json", legacyList.filter((n: any) => n.id !== id)); return res.json({ success: true }); }
  res.status(404).json({ error: "Node not found" });
});

router.get("/:id/health", async (req, res) => {
  const node = (await listAgentNodes()).find(n => n.id === req.params.id);
  if (!node) return res.json({ status: req.params.id === "local" ? "healthy" : "unknown" });
  try {
    const info = await fetchInfo(node, decryptSecret(node.tokenEnc));
    res.json({ status: "healthy", info });
  } catch (e: any) {
    res.status(502).json({ status: "unreachable", error: e instanceof NodeError ? e.message : String(e?.message || e) });
  }
});

export default router;
