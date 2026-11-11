import { useEffect, useState } from "react";
import axios from "axios";

export type Cat = "budget" | "premium" | "performance" | "vps";
export const CATS: Cat[] = ["budget", "premium", "performance", "vps"];
export interface Plan { id: string; category: Cat; name: string; emoji: string; ramGB: number; cpu: number; diskGB: number; storage: string; priceINR: number; active: boolean; sort: number; tag?: string }
export interface PublicData {
  brand: string; tagline: string; discord: string; plans: Plan[];
  categories: Record<Cat, { title: string; subtitle: string; features: string[]; software: string[] }>;
  links: { website: string; billing: string; panel: string };
}

export const money = (n: number) => "₹" + Number(n || 0).toLocaleString("en-IN");
export const dateOf = (s?: string) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

/** "login once, use everywhere": the same JWT is handed to the other AURA NODE domains in the URL fragment (never sent to a server) */
export function applySso() {
  try {
    const m = /(?:^|[#&])sso=([\w.-]+)/.exec(window.location.hash);
    if (m) { localStorage.setItem("jtg_token", m[1]); history.replaceState(null, "", window.location.pathname + window.location.search); }
  } catch { /* ignore */ }
}
export const ssoUrl = (base: string, path = "/") => {
  if (!base) return "";
  const t = localStorage.getItem("jtg_token");
  return `${base}${path}${t ? `#sso=${t}` : ""}`;
};

export function usePublic() {
  const [data, setData] = useState<PublicData | null>(null);
  const [error, setError] = useState("");
  const load = () => axios.get("/api/site/public").then(r => setData(r.data)).catch(() => setError("Could not load the plans."));
  useEffect(() => { load(); }, []);
  return { data, error, reload: load };
}

export const cpuText = (p: Plan) => (p.category === "vps" ? `${p.cpu} vCPU` : `${p.cpu}% CPU`);
export const diskText = (p: Plan) => (p.category === "vps" ? `${p.diskGB} GiB ${p.storage}` : `${p.diskGB} GB ${p.storage}`).trim();

export const errMsg = (e: any) => e?.response?.data?.error || e?.message || "Something went wrong";

/** shared look of the billing screens */
export const ui = {
  card: "aura-card p-5",
  input: "w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-violet-500",
  label: "text-xs text-white/50 mb-1 block",
  btn: "aura-btn rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50",
  ghost: "rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white/90 hover:bg-white/10 disabled:opacity-50 inline-flex items-center justify-center gap-2",
  danger: "rounded-xl border border-red-500/30 px-3 py-2 text-sm font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50 inline-flex items-center justify-center gap-2"
};
export const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", paid: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  unpaid: "bg-amber-500/15 text-amber-300 border-amber-500/30", suspended: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  cancelled: "bg-red-500/15 text-red-300 border-red-500/30"
};
