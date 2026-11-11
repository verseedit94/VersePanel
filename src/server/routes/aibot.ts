import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { encryptSecret, decryptSecret } from "../services/crypto.js";
import * as AI from "../services/aiBot.js";

/** /api/admin/aibot — admin settings of the Discord AI helper (secrets are write-only). */
const router = Router();
router.use(requireAuth);
router.use((req, res, next) => {
  const u = (req as any).user;
  if (!u || (u.role !== "admin" && u.role !== "owner")) return res.status(403).json({ error: "Forbidden" });
  next();
});
const clampNum = (v: any, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

async function view() {
  const c = await AI.readAiCfg();
  return {
    enabled: !!c.enabled, tokenSet: !!c.tokenEnc, groqSet: !!c.groqEnc,
    roleId: c.roleId || "", model: c.model || AI.DEFAULT_MODEL, nodeId: c.nodeId || "local",
    maxRamGB: c.maxRamGB || 8, maxDiskGB: c.maxDiskGB || 20, maxCores: c.maxCores || 4,
    registered: Object.keys(c.users || {}).length,
    status: AI.status,
    inviteUrl: AI.status.appId ? `https://discord.com/oauth2/authorize?client_id=${AI.status.appId}&scope=bot%20applications.commands&permissions=0` : null
  };
}

router.get("/", async (_req, res) => res.json(await view()));

router.put("/", async (req, res) => {
  const b = req.body || {};
  const c = await AI.readAiCfg();
  const token = String(b.botToken || "").trim();
  const key = String(b.groqKey || "").trim();
  if (token) { if (token.length < 30 || token.length > 200) return res.status(400).json({ error: "That does not look like a Discord bot token." }); c.tokenEnc = encryptSecret(token); }
  if (key) { if (key.length < 20 || key.length > 200) return res.status(400).json({ error: "That does not look like a Groq API key." }); c.groqEnc = encryptSecret(key); }
  const role = String(b.roleId ?? c.roleId ?? "").trim();
  if (role && !/^\d{5,25}$/.test(role)) return res.status(400).json({ error: "Role ID must be a number (Discord → role → Copy Role ID)." });
  c.roleId = role;
  c.model = String(b.model || c.model || AI.DEFAULT_MODEL).trim().slice(0, 80);
  c.nodeId = String(b.nodeId || c.nodeId || "local").trim().slice(0, 80);
  c.maxRamGB = clampNum(b.maxRamGB, 1, 256, c.maxRamGB || 8);
  c.maxDiskGB = clampNum(b.maxDiskGB, 1, 5000, c.maxDiskGB || 20);
  c.maxCores = clampNum(b.maxCores, 0.5, 64, c.maxCores || 4);
  c.enabled = !!b.enabled;
  await AI.writeAiCfg(c);
  await AI.startAiBot();
  await new Promise(r => setTimeout(r, 1500)); // let the gateway connect so the answer shows the real state
  res.json(await view());
});

/** checks the saved Groq key and Discord token */
router.post("/test", async (_req, res) => {
  const c = await AI.readAiCfg();
  const out: any = { groq: "not set", discord: "not set" };
  if (c.groqEnc) {
    try {
      const j = await AI.groq(decryptSecret(c.groqEnc), { model: c.model || AI.DEFAULT_MODEL, messages: [{ role: "user", content: "Reply with the single word: ok" }], max_tokens: 5 });
      out.groq = j?.choices?.[0]?.message ? "ok" : "no answer";
    } catch (e: any) { out.groq = "error: " + e.message; }
  }
  if (c.tokenEnc) {
    try {
      const r = await fetch((process.env.DISCORD_API_URL || "https://discord.com/api/v10") + "/users/@me", { headers: { Authorization: `Bot ${decryptSecret(c.tokenEnc)}` }, signal: AbortSignal.timeout(15000) });
      const j: any = await r.json().catch(() => ({}));
      out.discord = r.ok ? `ok (${j.username})` : `error: ${j.message || r.status}`;
    } catch (e: any) { out.discord = "error: " + e.message; }
  }
  res.json(out);
});

router.get("/users", async (_req, res) => {
  const c = await AI.readAiCfg();
  res.json(Object.entries(c.users || {}).map(([discordId, u]) => ({ discordId, username: u.username, at: u.at })));
});
/** unlink a Discord user (the panel account stays) */
router.delete("/users/:discordId", async (req, res) => {
  const c = await AI.readAiCfg();
  if (c.users) delete c.users[req.params.discordId];
  await AI.writeAiCfg(c);
  res.json({ ok: true });
});

export default router;
