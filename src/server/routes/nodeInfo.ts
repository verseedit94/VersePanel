import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { getNodeInfo, isNodeMode } from "../services/nodeMode.js";
import { defaultDocker } from "../services/docker.js";
import { startAgent, stopAgent, agentStatus } from "../services/playitAgent.js";

/** /api/node/* — only meaningful (and only mounted) when this instance runs in NODE_MODE. */
const router = express.Router();
router.use(requireAuth);

router.get("/info", async (_req, res) => {
  const ping = async () => {
    await Promise.race([defaultDocker.ping(), new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 3000))]);
    return true;
  };
  res.json({ ...(await getNodeInfo(ping)), nodeMode: isNodeMode() });
});

/** playit.gg agent control (the panel sends the secret key it obtained for this node) */
const staff = (req: any) => ["admin", "owner"].includes(req.user?.role);
router.get("/playit", async (req, res) => {
  if (!staff(req)) return res.status(403).json({ error: "Forbidden" });
  res.json(await agentStatus());
});
router.post("/playit/start", async (req, res) => {
  if (!staff(req)) return res.status(403).json({ error: "Forbidden" });
  try { await startAgent(String(req.body?.secret || "")); res.json({ ok: true }); }
  catch (e: any) { res.status(400).json({ error: e?.message || "Could not start the playit agent" }); }
});
router.post("/playit/stop", async (req, res) => {
  if (!staff(req)) return res.status(403).json({ error: "Forbidden" });
  await stopAgent(true);
  res.json({ ok: true });
});

export default router;
