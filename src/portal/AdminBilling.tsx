import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { Plus, Trash2, Save, Check } from "lucide-react";
import { CATS, Cat, Plan, money, dateOf, errMsg, ui, STATUS_STYLE } from "./portalApi";

const Note = ({ m }: { m: { ok: boolean; t: string } | null }) => m ? <div className={`text-sm mt-3 ${m.ok ? "text-emerald-400" : "text-red-400"}`}>{m.t}</div> : null;
const LABEL: Record<Cat, string> = { budget: "Budget", premium: "Premium", performance: "Performance (Ryzen 9)", vps: "VPS (EPYC)" };

/* ------------------------------------------------------------------ plans: change prices and specs */
export function PlansEditor({ onChanged }: { onChanged: () => void }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [fresh, setFresh] = useState<any>({ category: "budget", name: "", emoji: "🟢", ramGB: 4, cpu: 100, diskGB: 20, storage: "NVMe", priceINR: 99 });
  const load = useCallback(() => axios.get("/api/site/plans").then(r => setPlans(r.data)).catch(e => setMsg({ ok: false, t: errMsg(e) })), []);
  useEffect(() => { load(); }, [load]);

  const edit = (id: string, k: string, v: any) => setPlans(ps => ps.map(p => p.id === id ? { ...p, [k]: v } : p));
  const save = async (p: Plan) => { try { await axios.put(`/api/site/plans/${p.id}`, p); setMsg({ ok: true, t: `${p.name} saved.` }); onChanged(); } catch (e) { setMsg({ ok: false, t: errMsg(e) }); } };
  const del = async (p: Plan) => { if (!confirm(`Delete ${p.name}? Existing orders keep their saved price.`)) return; try { await axios.delete(`/api/site/plans/${p.id}`); await load(); onChanged(); } catch (e) { setMsg({ ok: false, t: errMsg(e) }); } };
  const add = async () => { try { await axios.post("/api/site/plans", fresh); setFresh({ ...fresh, name: "" }); await load(); onChanged(); setMsg({ ok: true, t: "Plan added." }); } catch (e) { setMsg({ ok: false, t: errMsg(e) }); } };
  const num = (v: string) => (v === "" ? 0 : Number(v));

  return (
    <div className="space-y-8 aura-in">
      <div className={ui.card}>
        <div className="font-bold mb-3">Add a plan</div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
          <select className={ui.input} value={fresh.category} onChange={e => setFresh({ ...fresh, category: e.target.value })}>{CATS.map(c => <option key={c} value={c} className="bg-black">{LABEL[c]}</option>)}</select>
          <input className={ui.input} placeholder="Emoji" value={fresh.emoji} onChange={e => setFresh({ ...fresh, emoji: e.target.value })} />
          <input className={ui.input + " col-span-2"} placeholder="Plan name" value={fresh.name} onChange={e => setFresh({ ...fresh, name: e.target.value })} />
          <input className={ui.input} type="number" placeholder="RAM GB" value={fresh.ramGB} onChange={e => setFresh({ ...fresh, ramGB: num(e.target.value) })} />
          <input className={ui.input} type="number" placeholder="CPU" value={fresh.cpu} onChange={e => setFresh({ ...fresh, cpu: num(e.target.value) })} />
          <input className={ui.input} type="number" placeholder="Storage GB" value={fresh.diskGB} onChange={e => setFresh({ ...fresh, diskGB: num(e.target.value) })} />
          <input className={ui.input} type="number" placeholder="₹ / month" value={fresh.priceINR} onChange={e => setFresh({ ...fresh, priceINR: num(e.target.value) })} />
        </div>
        <button className={ui.btn + " mt-3 inline-flex items-center gap-2"} onClick={add} disabled={!fresh.name.trim()}><Plus size={15} /> Add plan</button>
        <div className="text-xs text-white/40 mt-2">CPU is a percent (100 = 1 core) for Minecraft plans and a vCPU count for VPS plans.</div>
      </div>

      {CATS.map(c => (
        <div key={c}>
          <div className="font-bold text-lg mb-3">{LABEL[c]}</div>
          <div className="space-y-2">
            {plans.filter(p => p.category === c).map(p => (
              <div key={p.id} className={ui.card + " !p-3"}>
                <div className="grid grid-cols-2 md:grid-cols-8 gap-2 items-end">
                  <div><span className={ui.label}>Emoji</span><input className={ui.input} value={p.emoji} onChange={e => edit(p.id, "emoji", e.target.value)} /></div>
                  <div className="col-span-2"><span className={ui.label}>Name</span><input className={ui.input} value={p.name} onChange={e => edit(p.id, "name", e.target.value)} /></div>
                  <div><span className={ui.label}>RAM GB</span><input className={ui.input} type="number" value={p.ramGB} onChange={e => edit(p.id, "ramGB", num(e.target.value))} /></div>
                  <div><span className={ui.label}>{c === "vps" ? "vCPU" : "CPU %"}</span><input className={ui.input} type="number" value={p.cpu} onChange={e => edit(p.id, "cpu", num(e.target.value))} /></div>
                  <div><span className={ui.label}>Storage GB</span><input className={ui.input} type="number" value={p.diskGB} onChange={e => edit(p.id, "diskGB", num(e.target.value))} /></div>
                  <div><span className={ui.label}>₹ / month</span><input className={ui.input + " !border-violet-500/40"} type="number" value={p.priceINR} onChange={e => edit(p.id, "priceINR", num(e.target.value))} /></div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-white/60 flex items-center gap-1"><input type="checkbox" checked={p.active} onChange={e => edit(p.id, "active", e.target.checked)} /> Show</label>
                    <button className={ui.btn + " !px-3 !py-2"} title="Save" onClick={() => save(p)}><Save size={15} /></button>
                    <button className={ui.danger} title="Delete" onClick={() => del(p)}><Trash2 size={15} /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      <Note m={msg} />
    </div>
  );
}

/* ------------------------------------------------------------------ orders & invoices */
export function AdminOrders({ plans, onChanged }: { plans: Plan[]; onChanged: () => void }) {
  const [d, setD] = useState<{ orders: any[]; invoices: any[]; users: any[] } | null>(null);
  const [f, setF] = useState({ userId: "", planId: "", note: "" });
  const [sw, setSw] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => axios.get("/api/billing/admin/overview").then(r => setD(r.data)).catch(e => setMsg({ ok: false, t: errMsg(e) })), []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<any>, ok: string) => { setBusy(true); setMsg(null); try { await fn(); setMsg({ ok: true, t: ok }); await load(); onChanged(); } catch (e) { setMsg({ ok: false, t: errMsg(e) }); } setBusy(false); };
  if (!d) return <div className="text-white/50">Loading…</div>;

  return (
    <div className="space-y-6 aura-in">
      <div className={ui.card}>
        <div className="font-bold mb-3">New order <span className="text-xs text-white/40 font-normal">— after the customer paid in the Discord ticket</span></div>
        <div className="grid md:grid-cols-4 gap-2">
          <select className={ui.input} value={f.userId} onChange={e => setF({ ...f, userId: e.target.value })}><option value="" className="bg-black">Customer…</option>{d.users.map(u => <option key={u.id} value={u.id} className="bg-black">{u.username}{u.email ? ` (${u.email})` : ""}</option>)}</select>
          <select className={ui.input} value={f.planId} onChange={e => setF({ ...f, planId: e.target.value })}><option value="" className="bg-black">Plan…</option>{plans.map(p => <option key={p.id} value={p.id} className="bg-black">{p.name} — {money(p.priceINR)}</option>)}</select>
          <input className={ui.input} placeholder="Note (optional)" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} />
          <button className={ui.btn} disabled={busy || !f.userId || !f.planId} onClick={() => run(async () => { await axios.post("/api/billing/admin/orders", f); setF({ userId: "", planId: "", note: "" }); }, "Order created with its first invoice.")}>Create order</button>
        </div>
      </div>

      <div className="space-y-3">
        {d.orders.map(o => {
          const invs = d.invoices.filter(i => i.orderId === o.id);
          const open = invs.find(i => i.status === "unpaid");
          return (
            <div key={o.id} className={ui.card}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><div className="font-bold">{o.username} — {o.planName}</div><div className="text-xs text-white/50">{money(o.priceINR)} / month · next due {dateOf(o.nextDueAt)} · {o.id}</div></div>
                <span className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded-full border ${STATUS_STYLE[o.status]}`}>{o.status}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {open && o.status !== "cancelled" && <button className={ui.btn + " inline-flex items-center gap-1.5"} disabled={busy} onClick={() => run(() => axios.post(`/api/billing/admin/invoices/${open.id}/paid`), "Payment recorded, service extended 30 days.")}><Check size={14} /> Mark {money(open.amountINR)} paid</button>}
                {o.status === "active" && <button className={ui.ghost} disabled={busy} onClick={() => run(() => axios.post(`/api/billing/admin/orders/${o.id}/status`, { status: "suspended" }), "Suspended.")}>Suspend</button>}
                {o.status === "suspended" && <button className={ui.ghost} disabled={busy} onClick={() => run(() => axios.post(`/api/billing/admin/orders/${o.id}/status`, { status: "active" }), "Activated.")}>Activate</button>}
                {o.status !== "cancelled" && <button className={ui.danger} disabled={busy} onClick={() => confirm("Cancel this order and its unpaid invoices?") && run(() => axios.post(`/api/billing/admin/orders/${o.id}/status`, { status: "cancelled" }), "Cancelled.")}>Cancel</button>}
                {o.category !== "vps" && !o.serverId && o.status !== "cancelled" && (
                  <span className="inline-flex gap-2">
                    <select className={ui.input + " !w-auto"} value={sw[o.id] || "PAPER"} onChange={e => setSw({ ...sw, [o.id]: e.target.value })}>{["PAPER", "PURPUR", "SPIGOT", "FABRIC", "FORGE", "VANILLA", "VELOCITY"].map(s => <option key={s} className="bg-black">{s}</option>)}</select>
                    <button className={ui.ghost} disabled={busy} onClick={() => run(() => axios.post(`/api/billing/admin/orders/${o.id}/provision`, { software: sw[o.id] || "PAPER" }), "Server created in the panel.")}>Create server</button>
                  </span>
                )}
                {o.serverId && <span className="text-xs text-emerald-300 self-center">Server created ✓</span>}
              </div>
            </div>
          );
        })}
        {!d.orders.length && <div className={ui.card + " text-sm text-white/60"}>No orders yet.</div>}
      </div>
      <Note m={msg} />
    </div>
  );
}

/* ------------------------------------------------------------------ site settings */
export function SiteSettings({ onChanged }: { onChanged: () => void }) {
  const [c, setC] = useState<any>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  useEffect(() => { axios.get("/api/site/config").then(r => setC(r.data)).catch(e => setMsg({ ok: false, t: errMsg(e) })); }, []);
  if (!c) return <Note m={msg} />;
  const set = (k: string, v: any) => setC({ ...c, [k]: v });
  const setCat = (cat: string, k: string, v: any) => setC({ ...c, categories: { ...c.categories, [cat]: { ...c.categories[cat], [k]: v } } });
  const save = async () => {
    try {
      const body = { ...c, categories: Object.fromEntries(CATS.map(k => [k, { ...c.categories[k], features: String(c.categories[k].features).split("\n"), software: String(c.categories[k].software).split("\n") }])) };
      setC((await axios.put("/api/site/config", body)).data); setMsg({ ok: true, t: "Saved." }); onChanged();
    } catch (e) { setMsg({ ok: false, t: errMsg(e) }); }
  };
  const asText = (v: any) => (Array.isArray(v) ? v.join("\n") : v);
  return (
    <div className="space-y-6 aura-in">
      <div className={ui.card + " space-y-3"}>
        <div className="font-bold">Brand & Discord</div>
        <div className="grid md:grid-cols-2 gap-3">
          <div><span className={ui.label}>Brand name</span><input className={ui.input} value={c.brand} onChange={e => set("brand", e.target.value)} /></div>
          <div><span className={ui.label}>Discord invite (Buy buttons go here)</span><input className={ui.input} value={c.discord} onChange={e => set("discord", e.target.value)} /></div>
        </div>
        <div><span className={ui.label}>Tagline</span><input className={ui.input} value={c.tagline} onChange={e => set("tagline", e.target.value)} /></div>
      </div>
      <div className={ui.card + " space-y-3"}>
        <div className="font-bold">Domains</div>
        <p className="text-xs text-white/50">Point each domain to this panel (same server and port). The page shown depends on the domain: website, billing, or the game panel for every other domain. The game panel domain is only used for the “Panel” button.</p>
        <div className="grid md:grid-cols-3 gap-3">
          <div><span className={ui.label}>Website domain</span><input className={ui.input} placeholder="auranode.in" value={c.websiteDomain} onChange={e => set("websiteDomain", e.target.value)} /></div>
          <div><span className={ui.label}>Billing domain</span><input className={ui.input} placeholder="billing.auranode.in" value={c.billingDomain} onChange={e => set("billingDomain", e.target.value)} /></div>
          <div><span className={ui.label}>Game panel domain</span><input className={ui.input} placeholder="panel.auranode.in" value={c.panelDomain || ""} onChange={e => set("panelDomain", e.target.value)} /></div>
        </div>
      </div>
      {CATS.map(k => (
        <div key={k} className={ui.card + " space-y-3"}>
          <div className="font-bold">{LABEL[k]} — text shown on the website and in Discord</div>
          <div className="grid md:grid-cols-2 gap-3">
            <div><span className={ui.label}>Title</span><input className={ui.input} value={c.categories[k].title} onChange={e => setCat(k, "title", e.target.value)} /></div>
            <div><span className={ui.label}>Subtitle</span><input className={ui.input} value={c.categories[k].subtitle} onChange={e => setCat(k, "subtitle", e.target.value)} /></div>
            <div><span className={ui.label}>Features (one per line)</span><textarea className={ui.input} rows={6} value={asText(c.categories[k].features)} onChange={e => setCat(k, "features", e.target.value)} /></div>
            <div><span className={ui.label}>Supported software (one per line)</span><textarea className={ui.input} rows={6} value={asText(c.categories[k].software)} onChange={e => setCat(k, "software", e.target.value)} /></div>
          </div>
        </div>
      ))}
      <button className={ui.btn + " inline-flex items-center gap-2"} onClick={save}><Save size={15} /> Save site settings</button>
      <Note m={msg} />
    </div>
  );
}
