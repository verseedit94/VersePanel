import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { listEggs, importEgg, deleteEgg } from "../controllers/startup.js";
import { activityMiddleware } from "../services/activity.js";

const router = express.Router();
router.use(requireAuth);
router.use(activityMiddleware("plain", "egg"));
router.get("/", listEggs);
router.post("/import", importEgg);
router.delete("/:eggId", deleteEgg);
export default router;
