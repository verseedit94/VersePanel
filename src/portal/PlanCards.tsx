import React, { useState } from "react";
import { Check, ExternalLink } from "lucide-react";
import { CATS, Cat, PublicData, cpuText, diskText, money } from "./portalApi";

const TAB_LABEL: Record<Cat, string> = { budget: "Budget", premium: "Premium", performance: "Performance", vps: "VPS" };

/** Plan list with category tabs. "Buy" sends the customer to the Discord server to open a ticket. */
export default function PlanCards({ data, initial = "budget" }: { data: PublicData; initial?: Cat }) {
  const [cat, setCat] = useState<Cat>(initial);
  const info = data.categories[cat];
  const plans = data.plans.filter(p => p.category === cat);
  return (
    <div>
      <div className="flex flex-wrap justify-center gap-2 mb-6">
        {CATS.map(c => (
          <button key={c} onClick={() => setCat(c)}
            className={`px-4 py-2 rounded-full text-sm font-semibold border transition ${cat === c ? "bg-gradient-to-r from-violet-600 to-fuchsia-600 border-transparent text-white shadow-lg shadow-violet-900/40" : "border-white/10 text-white/70 hover:bg-white/5"}`}>
            {TAB_LABEL[c]}
          </button>
        ))}
      </div>
      <div className="text-center mb-8">
        <h3 className="text-2xl font-bold text-white">{info.title}</h3>
        <p className="text-white/60 mt-1">{info.subtitle}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {plans.map(p => (
          <div key={p.id} className="aura-card p-5 flex flex-col">
            <div className="flex items-center justify-between">
              <div className="font-bold text-white">{p.emoji} {p.name}</div>
              {p.tag && <span className="text-[10px] px-2 py-0.5 rounded-full bg-fuchsia-500/20 text-fuchsia-300 font-semibold">{p.tag}</span>}
            </div>
            <div className="mt-3 space-y-1.5 text-sm text-white/70">
              <div className="flex justify-between"><span>RAM</span><b className="text-white">{p.ramGB} GB</b></div>
              <div className="flex justify-between"><span>CPU</span><b className="text-white">{cpuText(p)}</b></div>
              <div className="flex justify-between"><span>Storage</span><b className="text-white">{diskText(p)}</b></div>
            </div>
            <div className="mt-4 text-3xl font-extrabold text-white">{money(p.priceINR)}<span className="text-sm font-medium text-white/50"> / month</span></div>
            <a href={data.discord} target="_blank" rel="noreferrer"
              className="aura-btn mt-4 inline-flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white">
              Buy now <ExternalLink size={14} />
            </a>
          </div>
        ))}
      </div>
      {!plans.length && <div className="text-center text-white/50">No plans in this category yet.</div>}
      <div className="mt-8 grid gap-x-6 gap-y-2 sm:grid-cols-2 max-w-3xl mx-auto">
        {info.features.map(f => <div key={f} className="flex items-center gap-2 text-sm text-white/70"><Check size={15} className="text-emerald-400 shrink-0" /> {f}</div>)}
      </div>
      {info.software.length > 0 && <div className="mt-5 text-center text-sm text-white/50">Supported software: {info.software.join(" • ")}</div>}
    </div>
  );
}
