import express from "express";
import { spawn } from "child_process";
import fs from "fs-extra";
import path from "path";
import { completeEnroll, findPendingByToken, isEnrollToken, updateNodeAddress } from "../services/nodeEnroll.js";
import { buildInstallScript } from "../services/nodeInstallScript.js";
import { decryptSecret } from "../services/crypto.js";

/**
 * PUBLIC endpoints used by a new VPS during "Add VPS". The URL token is the credential:
 * 48 random hex chars, one hour lifetime, single use for registration.
 */
const router = express.Router();

const hits = new Map<string, number[]>();
const limited = (key: string, max: number, windowMs: number) => {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  return arr.length > max;
};

router.use((req, res, next) => {
  if (limited(`enroll:${req.ip}`, 60, 10 * 60 * 1000)) return res.status(429).type("text").send("Too many requests");
  next();
});

/** A tunnel node announces its new address (auth: node token). Must stay above the "/:token" routes. */
router.post("/address", async (req, res) => {
  const r = await updateNodeAddress(req.body?.nodeId, req.body?.token, req.body?.host);
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  res.json({ ok: true });
});

router.get("/:token/install.sh", async (req, res) => {
  const node = await findPendingByToken(req.params.token);
  if (!node) return res.status(404).type("text").send("echo 'This link is invalid or expired. Create a new one in the panel: Nodes -> Add VPS.'; exit 1\n");
  res.type("text/x-shellscript").send(
    buildInstallScript({
      panelUrl: node.panelUrl,
      enrollToken: req.params.token,
      nodeToken: decryptSecret(node.tokenEnc),
      port: node.port,
      domain: node.domain,
      name: node.name
    })
  );
});

/** tar.gz of what a node needs: the built server bundle + package manifests. */
router.get("/:token/package.tgz", async (req, res) => {
  if (!isEnrollToken(req.params.token) || !(await findPendingByToken(req.params.token))) {
    return res.status(404).json({ error: "Invalid or expired link" });
  }
  const root = process.cwd();
  if (!(await fs.pathExists(path.join(root, "dist", "server.cjs")))) {
    return res.status(503).json({ error: "This panel has no production build (dist/server.cjs). Run `npm run build` on the panel first." });
  }
  const files = ["dist/server.cjs", "package.json"];
  if (await fs.pathExists(path.join(root, "package-lock.json"))) files.push("package-lock.json");

  res.setHeader("Content-Type", "application/gzip");
  res.setHeader("Content-Disposition", 'attachment; filename="verse-node.tgz"');
  const tar = spawn("tar", ["-czf", "-", "-C", root, ...files], { stdio: ["ignore", "pipe", "pipe"] });
  tar.stdout.pipe(res);
  tar.on("error", () => { if (!res.headersSent) res.status(500).json({ error: "tar is not available on the panel server" }); else res.destroy(); });
  res.on("close", () => tar.kill());
});

router.post("/:token", async (req, res) => {
  const r = await completeEnroll(req.params.token, req.body, req.ip || "");
  if (r.ok === false) return res.status(r.status).json({ error: r.error });
  res.json({ ok: true, nodeId: r.node.id, name: r.node.name });
});

export default router;
