// @ts-nocheck
import React from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";

export const cardCls = "bg-card border border-border-subtle rounded-2xl p-5 md:p-6 shadow-xl";
export const inputCls = "w-full bg-background border border-border focus:border-theme-600 focus:ring-1 focus:ring-theme-600/50 rounded-xl px-3.5 py-2.5 text-foreground outline-none text-sm";
export const monoCls = inputCls + " font-mono";
export const btnPrimary = "px-4 py-2.5 rounded-xl text-sm font-medium bg-theme-700 text-white hover:opacity-90 transition-all disabled:opacity-50 inline-flex items-center justify-center gap-2";
export const btnGhost = "px-4 py-2.5 rounded-xl text-sm font-medium border border-border text-foreground hover:bg-white/5 transition-all disabled:opacity-50 inline-flex items-center justify-center gap-2";
export const btnDanger = "px-3 py-2 rounded-xl text-sm font-medium border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50 inline-flex items-center justify-center gap-2";

export const errText = (e: any, fallback = "Something went wrong") => e?.response?.data?.error || e?.message || fallback;

export const Msg = ({ m }: { m: { ok: boolean; text: string } | null }) =>
  m ? (
    <div className={`mt-3 p-3 rounded-lg text-sm flex items-start gap-2 border ${m.ok ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-red-500/10 border-red-500/20 text-red-400"}`}>
      {m.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
      <span>{m.text}</span>
    </div>
  ) : null;

export const PageTitle = ({ icon, title, sub }: any) => (
  <div className="mb-5">
    <h2 className="text-xl font-bold flex items-center gap-3 text-foreground"><span className="text-theme-500">{icon}</span>{title}</h2>
    {sub && <p className="text-sm text-muted-foreground mt-1">{sub}</p>}
  </div>
);

export const timeAgo = (ts?: number) => {
  if (!ts) return "never";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts).toLocaleString();
};
