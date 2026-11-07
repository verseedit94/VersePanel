import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { getNodeInfo, isNodeMode } from "../services/nodeMode.js";
import { defaultDocker } from "../services/docker.js";

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

export default router;
