import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { CreditCard, Receipt, Layers, Users, Settings2, Server, ExternalLink, Wallet } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import PlanCards from "./PlanCards";
import { AdminOrders, PlansEditor, SiteSettings } from "./AdminBilling";
import { usePublic, money, dateOf, errMsg, ui, STATUS_STYLE } from "./portalApi";

const Badge = ({ s }: { s: string }) => <span className={`text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${STATUS_STYLE[s] || ""}`}>{s}</span>;

/** Customer billing (services + invoices + plans) and, for admins, order / plan / site management. */
export default function BillingDashboard() {
  const { user } = useAuth() as any;
  const staff = user?.role === "admin" || user?.role === "owner";
  const { data, reload } = usePublic();
  const [tab, setTab] = useState("overview");
  const [mine, setMine] = useState<{ orders: any[]; invoices: any[] } | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(() => axios.get("/api/billing/me").then(r => setMine(r.data)).catch(e => setErr(errMsg(e))), []);
  useEffect(() => { load(); }, [load]);

  const tabs = [
    { id: "overview", label: "Overview", icon: <Wallet size={16} /> },
    { id: "invoices", label: "Invoices", icon: <Receipt size={16} /> },
    { id: "plans", label: "Plans", icon: <Layers size={16} /> },
    ...(staff ? [{ id: "orders", label: "Orders", icon: <Users size={16} /> }, { id: "editor", label: "Edit plans", icon: <CreditCard size={16} /> }, { id: "site", label: "Site", icon: <Settings2 size={16} /> }] : [])
  ];
  const unpaid = (mine?.invoices || []).filter(i => i.status === "unpaid");
  const active = (mine?.orders || []).filter(o => o.status === "active");
  const owe = unpaid.reduce((a, i) => a + i.amountINR, 0);
  const next = active.map(o => o.nextDueAt).sort()[0];
  const discord = data?.discord || "https://discord.gg/xFvSnYKrDh";

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 text-white">
      <div className="aura-in flex flex-wrap items-end justify-between gap-3 mb-6">
        <div><h1 className="text-3xl font-black">Billing</h1><p className="text-white/50 text-sm">Hello {user?.username} — your services, invoices and plans.</p></div>
        <a href={discord} target="_blank" rel="noreferrer" className={ui.btn + " inline-flex items-center gap-2"}>Open a ticket <ExternalLink size={14} /></a>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 mb-6">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`shrink-0 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border transition ${tab === t.id ? "aura-btn border-transparent" : "border-white/10 text-white/70 hover:bg-white/5"}`}>{t.icon}{t.label}</button>
        ))}
      </div>
      {err && <div className="text-sm text-red-400 mb-4">{err}</div>}

      {tab === "overview" && (
        <div className="space-y-6 aura-in">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className={ui.card}><div className="text-xs text-white/50">Active services</div><div className="text-3xl font-black mt-1">{active.length}</div></div>
            <div className={ui.card}><div className="text-xs text-white/50">Unpaid invoices</div><div className="text-3xl font-black mt-1">{unpaid.length}<span className="text-sm font-semibold text-white/50"> · {money(owe)}</span></div></div>
            <div className={ui.card}><div className="text-xs text-white/50">Next due date</div><div className="text-3xl font-black mt-1">{next ? dateOf(next) : "—"}</div></div>
          </div>
          <div>
            <h2 className="font-bold text-lg mb-3">My services</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {(mine?.orders || []).map(o => (
                <div key={o.id} className={ui.card}>
                  <div className="flex items-center justify-between"><div className="font-bold">{o.planName}</div><Badge s={o.status} /></div>
                  <div className="text-sm text-white/60 mt-2 flex justify-between"><span>{money(o.priceINR)} / month</span><span>Due {dateOf(o.nextDueAt)}</span></div>
                  {o.serverId && <a href="/servers" className="mt-3 inline-flex items-center gap-2 text-sm text-violet-300 underline"><Server size={14} /> Open in the game panel</a>}
                </div>
              ))}
              {mine && !mine.orders.length && <div className={ui.card + " text-white/60 text-sm md:col-span-2"}>You have no services yet. Pick a plan and open a ticket on Discord to order.</div>}
            </div>
          </div>
          {unpaid.length > 0 && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5">
              <div className="font-bold text-amber-200">You have {unpaid.length} unpaid invoice(s) — {money(owe)}</div>
              <p className="text-sm text-amber-100/70 mt-1">Open a ticket on Discord to pay. Your service is extended as soon as we confirm the payment.</p>
              <a href={discord} target="_blank" rel="noreferrer" className={ui.btn + " inline-flex items-center gap-2 mt-3"}>Pay via Discord ticket <ExternalLink size={14} /></a>
            </div>
          )}
        </div>
      )}

      {tab === "invoices" && (
        <div className="space-y-3 aura-in">
          {(mine?.invoices || []).map(i => (
            <div key={i.id} className={ui.card + " flex flex-wrap items-center justify-between gap-3"}>
              <div><div className="font-bold">{i.planName}</div><div className="text-xs text-white/50">{i.id} · due {dateOf(i.dueAt)}{i.paidAt ? ` · paid ${dateOf(i.paidAt)}` : ""}</div></div>
              <div className="flex items-center gap-3"><div className="font-extrabold">{money(i.amountINR)}</div><Badge s={i.status} /></div>
            </div>
          ))}
          {mine && !mine.invoices.length && <div className={ui.card + " text-sm text-white/60"}>No invoices yet.</div>}
        </div>
      )}

      {tab === "plans" && data && <div className="aura-in"><PlanCards data={data} /></div>}
      {staff && tab === "orders" && <AdminOrders plans={data?.plans || []} onChanged={load} />}
      {staff && tab === "editor" && <PlansEditor onChanged={reload} />}
      {staff && tab === "site" && <SiteSettings onChanged={reload} />}
    </div>
  );
}
