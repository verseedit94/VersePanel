import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { readJSON } from "../services/db.js";
import * as Site from "../services/site.js";

/** /api/site (public site data + admin editing) and /api/billing (customer view + admin orders). */
export const siteRouter = Router();
export const billingRouter = Router();

const isStaff = (u: any) => !!u && (u.role === "admin" || u.role === "owner");
const staffOnly = (req: any, res: any, next: any) => isStaff(req.user) ? next() : res.status(403).json({ error: "Forbidden" });
const fail = (res: any, e: any) => res.status(400).json({ error: e?.message || String(e) });
const hostOf = (req: any) => String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim().split(":")[0].toLowerCase();

/* ---------------- public ---------------- */
siteRouter.get("/mode", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const cfg = await Site.getCfg();
  const preview = String(req.query.preview || "");
  const mode = ["website", "billing", "panel"].includes(preview) ? preview : Site.modeFor(hostOf(req), cfg);
  res.json({ mode, brand: cfg.brand });
});

siteRouter.get("/public", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const cfg = await Site.getCfg();
  const s = (await readJSON("settings.json")) || {};
  const url = (d: string) => (d ? `https://${d}` : "");
  res.json({
    brand: cfg.brand, tagline: cfg.tagline, discord: cfg.discord, categories: cfg.categories, plans: await Site.getPlans(),
    links: { website: url(cfg.websiteDomain), billing: url(cfg.billingDomain), panel: cfg.panelDomain ? url(cfg.panelDomain) : (s.panelDomain && s.domainVerified ? url(s.panelDomain) : "") }
  });
});

/* ---------------- admin: site + plans ---------------- */
siteRouter.use(requireAuth);
siteRouter.get("/config", staffOnly, async (_req, res) => res.json(await Site.getCfg()));
siteRouter.put("/config", staffOnly, async (req, res) => { try { res.json(await Site.saveCfg(req.body || {})); } catch (e) { fail(res, e); } });
siteRouter.get("/plans", staffOnly, async (_req, res) => res.json(await Site.getPlans(true)));
siteRouter.post("/plans", staffOnly, async (req, res) => { try { res.json(await Site.addPlan(req.body || {})); } catch (e) { fail(res, e); } });
siteRouter.put("/plans/:id", staffOnly, async (req, res) => { try { res.json(await Site.updatePlan(req.params.id, req.body || {})); } catch (e) { fail(res, e); } });
siteRouter.delete("/plans/:id", staffOnly, async (req, res) => { try { await Site.removePlan(req.params.id); res.json({ ok: true }); } catch (e) { fail(res, e); } });

/* ---------------- billing ---------------- */
billingRouter.use(requireAuth);
billingRouter.get("/me", async (req: any, res) => {
  const id = req.user.id;
  res.json({
    orders: (await Site.readOrders()).filter(o => o.userId === id).reverse(),
    invoices: (await Site.readInvoices()).filter(i => i.userId === id).reverse()
  });
});

billingRouter.get("/admin/overview", staffOnly, async (_req, res) => {
  const users = ((await readJSON("users.json")) || []).map((u: any) => ({ id: u.id, username: u.username, email: u.email || "", role: u.role, discordId: u.discordId || "" }));
  res.json({ orders: (await Site.readOrders()).reverse(), invoices: (await Site.readInvoices()).reverse(), users });
});
billingRouter.post("/admin/orders", staffOnly, async (req, res) => { try { res.json(await Site.createOrder(String(req.body?.userId || ""), String(req.body?.planId || ""), req.body?.note)); } catch (e) { fail(res, e); } });
billingRouter.post("/admin/invoices/:id/paid", staffOnly, async (req, res) => { try { res.json(await Site.markPaid(req.params.id)); } catch (e) { fail(res, e); } });
billingRouter.post("/admin/orders/:id/status", staffOnly, async (req, res) => { try { res.json(await Site.setOrderStatus(req.params.id, String(req.body?.status || ""))); } catch (e) { fail(res, e); } });

/** create the game server for a sold Minecraft plan (admin) */
billingRouter.post("/admin/orders/:id/provision", staffOnly, async (req, res) => {
  try {
    const order = (await Site.readOrders()).find(o => o.id === req.params.id);
    if (!order) throw new Error("Order not found");
    if (order.category === "vps") throw new Error("VPS plans are set up by hand — only Minecraft plans create a panel server");
    if (order.serverId) throw new Error("A server was already created for this order");
    const plan = (await Site.getPlans(true)).find(p => p.id === order.planId);
    if (!plan) throw new Error("The plan of this order no longer exists");
    const AI = await import("../services/aiBot.js");
    const cfg = await AI.readAiCfg();
    const r = await AI.provisionServer({ ownerId: order.userId, ownerName: order.username, name: req.body?.name || `${order.username}-${plan.name}`, ramGB: plan.ramGB, diskGB: plan.diskGB, cpuPercent: plan.cpu, software: String(req.body?.software || "PAPER"), version: req.body?.version, nodeId: String(req.body?.nodeId || cfg.nodeId || "local") });
    if (!r.ok) throw new Error(r.error);
    await Site.attachServer(order.id, r.server_id);
    res.json(r);
  } catch (e) { fail(res, e); }
});
