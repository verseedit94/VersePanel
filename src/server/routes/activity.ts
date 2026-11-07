import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { readActivity } from "../services/activity.js";

/** Panel-wide activity log (admins / owner only). Per-server logs live at /api/servers/:id/activity. */
const router = express.Router();
router.use(requireAuth);
router.get("/", async (req, res) => {
  const u = (req as any).user;
  if (!u || (u.role !== "admin" && u.role !== "owner")) return res.status(403).json({ error: "Forbidden" });
  const q: any = req.query;
  res.json(await readActivity({
    serverId: q.serverId ? String(q.serverId).slice(0, 80) : undefined,
    userId: q.userId ? String(q.userId).slice(0, 80) : undefined,
    action: q.action ? String(q.action).slice(0, 40) : undefined,
    q: q.q ? String(q.q).slice(0, 80) : undefined,
    limit: Number(q.limit) || 50,
    before: Number(q.before) || undefined
  }));
});
export default router;
