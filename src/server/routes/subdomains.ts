import { Router } from "express";
import { readJSON } from "../services/db.js";
import { requireAuth } from "../middleware/auth.js";
import { listAgentNodes } from "../services/nodeClient.js";
import * as S from "../services/subdomains.js";

/** /api/subdomains — Cloudflare setup (admin), node addresses (admin) and per-server subdomains (owner / admin). */
const router = Router();
router.use(requireAuth);
const isStaff = (u: any) => !!u && (u.role === "admin" || u.role === "owner");
const fail = (res: any, e: any) => res.status(e?.status && e.status < 500 ? e.status : 400).json({ error: e?.message || String(e) });
const staffOnly = (req: any, res: any, next: any) => isStaff(req.user) ? next() : res.status(403).json({ error: "Forbidden" });

router.get("/config", async (_req, res) => { try { res.json(await S.publicConfig()); } catch (e) { fail(res, e); } });
router.put("/config", staffOnly, async (req, res) => { try { await S.setEnabled(!!req.body?.enabled); res.json(await S.publicConfig()); } catch (e) { fail(res, e); } });
router.post("/config/token", staffOnly, async (req, res) => { try { await S.saveToken(req.body?.token); res.json(await S.publicConfig()); } catch (e) { fail(res, e); } });
router.post("/config/zone", staffOnly, async (req, res) => { try { await S.chooseZone(String(req.body?.zoneId || "")); res.json(await S.publicConfig()); } catch (e) { fail(res, e); } });
router.delete("/config", staffOnly, async (_req, res) => { try { await S.disconnectCloudflare(); res.json(await S.publicConfig()); } catch (e) { fail(res, e); } });

const nodeOf = async (id: string) => (await listAgentNodes()).find(n => n.id === id && !(n as any).pending);
router.post("/nodes/:id", staffOnly, async (req, res) => {
  try { const n = await nodeOf(req.params.id); if (!n) return res.status(404).json({ error: "Node not found" }); res.json({ host: await S.setNodeAddress(n, req.body?.label) }); } catch (e) { fail(res, e); }
});
router.delete("/nodes/:id", staffOnly, async (req, res) => {
  try { const n = await nodeOf(req.params.id); if (!n) return res.status(404).json({ error: "Node not found" }); await S.removeNodeAddress(n); res.json({ ok: true }); } catch (e) { fail(res, e); }
});

async function mayUse(req: any, res: any): Promise<boolean> {
  const s = ((await readJSON("servers.json")) || []).find((x: any) => x.id === req.params.id);
  if (!s) { res.status(404).json({ error: "Server not found" }); return false; }
  if (!isStaff(req.user) && s.owner !== req.user?.id) { res.status(403).json({ error: "Forbidden" }); return false; }
  return true;
}
router.get("/servers/:id", async (req, res) => { if (!(await mayUse(req, res))) return; try { res.json(await S.listSubdomains(req.params.id)); } catch (e) { fail(res, e); } });
router.post("/servers/:id", async (req, res) => { if (!(await mayUse(req, res))) return; try { res.json({ fqdn: await S.addSubdomain(req.params.id, req.body?.label) }); } catch (e) { fail(res, e); } });
router.delete("/servers/:id/:label", async (req, res) => { if (!(await mayUse(req, res))) return; try { await S.removeSubdomain(req.params.id, req.params.label); res.json({ ok: true }); } catch (e) { fail(res, e); } });
router.put("/servers/:id/limit", staffOnly, async (req, res) => { try { await S.setLimit(req.params.id, req.body?.limit); res.json({ ok: true }); } catch (e) { fail(res, e); } });

export default router;
