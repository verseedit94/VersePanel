import { readJSON, writeJSON } from "./db.js";

/**
 * AURA NODE website + billing data: plans (editable by admins), site settings (brand, Discord link, domains),
 * orders and invoices. Payment itself happens through a Discord ticket, so billing records what was sold and when it is due.
 */
export type Cat = "budget" | "premium" | "performance" | "vps";
export const CATS: Cat[] = ["budget", "premium", "performance", "vps"];
export interface Plan { id: string; category: Cat; name: string; emoji: string; ramGB: number; cpu: number; diskGB: number; storage: string; priceINR: number; active: boolean; sort: number; tag?: string }
export interface CatInfo { title: string; subtitle: string; features: string[]; software: string[] }
export interface SiteCfg { brand: string; tagline: string; discord: string; websiteDomain: string; billingDomain: string; panelDomain: string; categories: Record<Cat, CatInfo> }

const MC_SOFTWARE = ["Paper", "Purpur", "Spigot", "Fabric", "Forge", "Velocity", "Vanilla"];
export const DEFAULT_CFG: SiteCfg = {
  brand: "AURA NODE",
  tagline: "Premium Minecraft & VPS hosting — powered by performance",
  discord: "https://discord.gg/xFvSnYKrDh",
  websiteDomain: "", billingDomain: "", panelDomain: "",
  categories: {
    budget: { title: "Budget Plans", subtitle: "Premium Minecraft server hosting at budget-friendly prices", software: MC_SOFTWARE,
      features: ["High-Speed NVMe Storage", "DDoS Protection", "Java & Bedrock Support", "Instant Server Reinstall", "Multiple Server Software", "24/7 Server Availability", "Easy-to-use Game Panel", "Friendly Customer Support"] },
    premium: { title: "Premium Plans", subtitle: "Powerful hosting for serious Minecraft networks", software: MC_SOFTWARE,
      features: ["High-Speed NVMe Storage", "DDoS Protection", "Java & Bedrock Support", "High-Performance CPU Allocation", "Premium Game Panel", "Instant Reinstallation", "Multiple Server Software", "Priority Customer Support"] },
    performance: { title: "Performance Plans (Ryzen 9)", subtitle: "Next-level Minecraft hosting with premium CPU performance", software: MC_SOFTWARE,
      features: ["AMD Ryzen 9 Processor", "High-Speed NVMe Storage", "DDoS Protection", "Java & Bedrock Support", "Premium Game Panel", "Multiple Server Software", "Instant Reinstallation", "Priority Support"] },
    vps: { title: "VPS Plans (AMD EPYC)", subtitle: "High-performance AMD EPYC 7000 Series VPS — exclusive pricing", software: [],
      features: ["AMD EPYC 7000 Series", "High-Performance Resources", "Full Root Access", "Linux OS", "High-Speed Network", "Flexible Configurations"] }
  }
};

const seed = (category: Cat, rows: [string, string, number, number, number, number][], storage: string): Plan[] =>
  rows.map(([name, emoji, ramGB, cpu, diskGB, priceINR], i) => ({ id: `${category}-${i + 1}`, category, name, emoji, ramGB, cpu, diskGB, storage, priceINR, active: true, sort: i + 1 }));

export const SEED_PLANS: Plan[] = [
  ...seed("budget", [["Starter Plan", "🟢", 2, 100, 15, 49], ["Basic Plan", "🔵", 4, 150, 25, 89], ["Standard Plan", "🟣", 6, 200, 35, 159], ["Advanced Plan", "🟡", 8, 250, 50, 199], ["Pro Plan", "🔴", 12, 300, 70, 299],
    ["Ultra Plan", "🔥", 16, 400, 90, 389], ["Extreme Plan", "💎", 24, 500, 120, 499], ["Ultimate Plan", "👑", 32, 600, 160, 699], ["Titan Plan", "⚡", 48, 800, 220, 999], ["Enterprise Plan", "🚀", 64, 1000, 300, 1199]], "NVMe"),
  ...seed("premium", [["Premium Starter", "🟢", 4, 200, 40, 99], ["Premium Basic", "🔵", 8, 300, 60, 199], ["Premium Pro", "🟣", 12, 400, 80, 259], ["Premium Advanced", "🟡", 16, 500, 120, 349], ["Premium Ultra", "🔴", 24, 600, 160, 499], ["Premium Extreme", "🔥", 32, 800, 200, 899]], "NVMe"),
  ...seed("performance", [["Ryzen Starter", "🟢", 4, 100, 40, 199], ["Ryzen Basic", "🔵", 6, 150, 50, 299], ["Ryzen Pro", "🟣", 8, 200, 70, 399], ["Ryzen Advanced", "🟡", 12, 300, 100, 499], ["Ryzen Ultra", "🔴", 16, 400, 130, 599],
    ["Ryzen Extreme", "🔥", 24, 500, 180, 799], ["Ryzen Titan", "💎", 32, 600, 220, 999], ["Ryzen Enterprise", "👑", 48, 800, 300, 1399]], "NVMe"),
  ...seed("vps", [["VPS #01", "🎁", 8, 2, 80, 900], ["VPS #02", "🎁", 16, 6, 120, 2700], ["VPS #03", "🎁", 20, 8, 180, 3100], ["VPS #04", "🎁", 24, 10, 240, 3600], ["VPS #05", "🎁", 32, 16, 300, 4800],
    ["VPS #06", "🎁", 48, 18, 450, 6900], ["VPS #07", "🎁", 64, 24, 550, 7900], ["VPS #08", "🎁", 96, 32, 800, 11500]], "SSD")
];

/* ------------------------------------------------------------------ config */
export async function getCfg(): Promise<SiteCfg> {
  const s = (await readJSON("site.json")) || {};
  const cats: any = {};
  for (const c of CATS) cats[c] = { ...DEFAULT_CFG.categories[c], ...(s.categories?.[c] || {}) };
  return { ...DEFAULT_CFG, ...s, categories: cats };
}
const str = (v: any, max: number) => String(v ?? "").trim().slice(0, max);
const host = (v: any) => { const h = str(v, 253).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""); if (h && !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(h)) throw new Error(`"${h}" is not a valid domain`); return h; };
const lines = (v: any, n: number) => (Array.isArray(v) ? v : String(v ?? "").split("\n")).map(x => str(x, 80)).filter(Boolean).slice(0, n);

export async function saveCfg(p: any): Promise<SiteCfg> {
  const cur = await getCfg();
  const next: SiteCfg = { ...cur };
  if (p.brand !== undefined) next.brand = str(p.brand, 40) || cur.brand;
  if (p.tagline !== undefined) next.tagline = str(p.tagline, 160);
  if (p.discord !== undefined) { const d = str(p.discord, 200); if (d && !/^https:\/\/(discord\.gg|discord\.com)\//.test(d)) throw new Error("Discord link must start with https://discord.gg/"); next.discord = d || cur.discord; }
  if (p.websiteDomain !== undefined) next.websiteDomain = host(p.websiteDomain);
  if (p.billingDomain !== undefined) next.billingDomain = host(p.billingDomain);
  if (p.panelDomain !== undefined) next.panelDomain = host(p.panelDomain);
  const ds = [next.websiteDomain, next.billingDomain, next.panelDomain].filter(Boolean);
  if (new Set(ds).size !== ds.length) throw new Error("Website, billing and panel need three different domains");
  for (const c of CATS) {
    const x = p.categories?.[c]; if (!x) continue;
    next.categories[c] = { title: str(x.title, 60) || cur.categories[c].title, subtitle: str(x.subtitle, 160), features: lines(x.features, 12), software: lines(x.software, 12) };
  }
  await writeJSON("site.json", next);
  return next;
}

/** which app a request host should get */
export function modeFor(hostname: string, cfg: SiteCfg): "website" | "billing" | "panel" {
  const h = String(hostname || "").toLowerCase().split(":")[0];
  if (cfg.websiteDomain && h === cfg.websiteDomain) return "website";
  if (cfg.billingDomain && h === cfg.billingDomain) return "billing";
  return "panel";
}

/* ------------------------------------------------------------------ plans */
export async function getPlans(all = false): Promise<Plan[]> {
  let p: Plan[] | null = await readJSON("plans.json");
  if (!p) { p = SEED_PLANS; await writeJSON("plans.json", p); }
  return (all ? p : p.filter(x => x.active)).slice().sort((a, b) => CATS.indexOf(a.category) - CATS.indexOf(b.category) || a.sort - b.sort);
}
const int = (v: any, lo: number, hi: number, what: string) => { const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${what} must be between ${lo} and ${hi}`); return Math.round(n * 100) / 100; };
function cleanPlan(b: any, base?: Plan): Plan {
  const category = (b.category ?? base?.category) as Cat;
  if (!CATS.includes(category)) throw new Error("Unknown category");
  const name = str(b.name ?? base?.name, 60); if (!name) throw new Error("Plan name is required");
  return {
    id: base?.id || "", category, name, emoji: str(b.emoji ?? base?.emoji ?? "", 8),
    ramGB: int(b.ramGB ?? base?.ramGB, 0, 4096, "RAM"), cpu: int(b.cpu ?? base?.cpu, 0, 100000, "CPU"), diskGB: int(b.diskGB ?? base?.diskGB, 0, 100000, "Storage"),
    storage: str(b.storage ?? base?.storage ?? "", 20), priceINR: int(b.priceINR ?? base?.priceINR, 0, 10000000, "Price"),
    active: b.active === undefined ? (base?.active ?? true) : !!b.active, sort: int(b.sort ?? base?.sort ?? 99, 0, 9999, "Order"), tag: str(b.tag ?? base?.tag ?? "", 20) || undefined
  };
}
export async function addPlan(b: any): Promise<Plan> {
  const all = await getPlans(true); const p = cleanPlan(b);
  p.id = `${p.category}-${Date.now().toString(36)}`; if (b.sort === undefined) p.sort = all.filter(x => x.category === p.category).length + 1;
  await writeJSON("plans.json", [...all, p]); return p;
}
export async function updatePlan(id: string, b: any): Promise<Plan> {
  const all = await getPlans(true); const i = all.findIndex(x => x.id === id); if (i < 0) throw new Error("Plan not found");
  all[i] = cleanPlan(b, all[i]); await writeJSON("plans.json", all); return all[i];
}
export async function removePlan(id: string) {
  const all = await getPlans(true); if (!all.some(x => x.id === id)) throw new Error("Plan not found");
  await writeJSON("plans.json", all.filter(x => x.id !== id));
}
export async function findPlan(q: string, mcOnly = true): Promise<Plan | null> {
  const s = String(q || "").toLowerCase().trim(); if (!s) return null;
  const list = (await getPlans(false)).filter(p => !mcOnly || p.category !== "vps");
  return list.find(p => p.id === s) || list.find(p => p.name.toLowerCase() === s)
    || list.find(p => `${p.category} ${p.name}`.toLowerCase() === s) || list.find(p => p.name.toLowerCase().includes(s)) || null;
}

/* ------------------------------------------------------------------ orders & invoices */
export interface Order { id: string; userId: string; username: string; planId: string; planName: string; category: Cat; priceINR: number; status: "active" | "suspended" | "cancelled"; createdAt: string; nextDueAt: string; serverId?: string; note?: string }
export interface Invoice { id: string; orderId: string; userId: string; username: string; planName: string; amountINR: number; status: "unpaid" | "paid" | "cancelled"; issuedAt: string; dueAt: string; paidAt?: string }
const DAY = 86400000;
const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
export const readOrders = async (): Promise<Order[]> => (await readJSON("orders.json")) || [];
export const readInvoices = async (): Promise<Invoice[]> => (await readJSON("invoices.json")) || [];

export async function createOrder(userId: string, planId: string, note = ""): Promise<{ order: Order; invoice: Invoice }> {
  const users = (await readJSON("users.json")) || []; const u = users.find((x: any) => x.id === userId); if (!u) throw new Error("User not found");
  const plan = (await getPlans(true)).find(p => p.id === planId); if (!plan) throw new Error("Plan not found");
  const now = new Date(); const due = now.toISOString(); // unpaid until the first invoice is paid
  const order: Order = { id: uid("ord"), userId, username: u.username, planId, planName: plan.name, category: plan.category, priceINR: plan.priceINR, status: "active", createdAt: now.toISOString(), nextDueAt: due, note: str(note, 200) || undefined };
  const invoice: Invoice = { id: uid("inv"), orderId: order.id, userId, username: u.username, planName: plan.name, amountINR: plan.priceINR, status: "unpaid", issuedAt: now.toISOString(), dueAt: now.toISOString() };
  await writeJSON("orders.json", [...(await readOrders()), order]); await writeJSON("invoices.json", [...(await readInvoices()), invoice]);
  return { order, invoice };
}

/** payment confirmed (after the Discord ticket): extends the order by 30 days and queues the next invoice */
export async function markPaid(invoiceId: string): Promise<{ invoice: Invoice; order: Order }> {
  const invoices = await readInvoices(); const inv = invoices.find(x => x.id === invoiceId);
  if (!inv) throw new Error("Invoice not found"); if (inv.status === "paid") throw new Error("Already paid");
  const orders = await readOrders(); const o = orders.find(x => x.id === inv.orderId); if (!o) throw new Error("Order not found");
  const now = Date.now(); inv.status = "paid"; inv.paidAt = new Date(now).toISOString();
  // the paid period ends 30 days after the later of "now" and the previous period end
  o.nextDueAt = new Date(Math.max(now, new Date(o.nextDueAt).getTime()) + 30 * DAY).toISOString();
  if (o.status === "suspended") o.status = "active";
  invoices.push({ id: uid("inv"), orderId: o.id, userId: o.userId, username: o.username, planName: o.planName, amountINR: o.priceINR, status: "unpaid", issuedAt: new Date(now).toISOString(), dueAt: o.nextDueAt });
  await writeJSON("invoices.json", invoices); await writeJSON("orders.json", orders);
  return { invoice: inv, order: o };
}
export async function setOrderStatus(id: string, status: string) {
  if (!["active", "suspended", "cancelled"].includes(status)) throw new Error("Bad status");
  const orders = await readOrders(); const o = orders.find(x => x.id === id); if (!o) throw new Error("Order not found");
  o.status = status as any; await writeJSON("orders.json", orders);
  if (status === "cancelled") { const inv = await readInvoices(); for (const i of inv) if (i.orderId === id && i.status === "unpaid") i.status = "cancelled"; await writeJSON("invoices.json", inv); }
  return o;
}
export async function attachServer(orderId: string, serverId: string) {
  const orders = await readOrders(); const o = orders.find(x => x.id === orderId); if (o) { o.serverId = serverId; await writeJSON("orders.json", orders); }
}
