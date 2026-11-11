// @ts-nocheck
import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { Activity, Search } from "lucide-react";
import { cardCls, inputCls, btnGhost, errText, Msg, PageTitle } from "./PanelBits";

const CATEGORIES = [
  ["", "All activity"], ["server.power", "Power"], ["server.command", "Console commands"], ["file.", "Files"], ["backup.", "Backups"],
  ["addon.", "Plugins & mods"], ["modpack.", "Modpacks"], ["schedule.", "Schedules"], ["startup.", "Startup"], ["network.", "Network"],
  ["database.", "Databases"], ["subuser.", "Sub-users"], ["auth.", "Sign-ins"], ["settings.", "Admin settings"]
];

const pretty = (a: string) => a.replace(/\./g, " › ");

export default function ActivityLog({ serverId, embedded = false }: { serverId?: string; embedded?: boolean }) {
  const [rows, setRows] = useState<any[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [msg, setMsg] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<any>(null);

  const url = serverId ? `/api/servers/${serverId}/activity` : "/api/activity";
  const fetchPage = async (before?: number, replace = true) => {
    setLoading(true);
    try {
      const { data } = await axios.get(url, { params: { q: q || undefined, action: action || undefined, before, limit: 40 } });
      setRows(prev => (replace ? data.entries : [...prev, ...data.entries]));
      setNext(data.nextBefore);
      setMsg(null);
    } catch (e) { setMsg({ ok: false, text: errText(e) }); } finally { setLoading(false); }
  };

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fetchPage(undefined, true), q ? 350 : 0);
    return () => clearTimeout(timer.current);
  }, [serverId, q, action]);

  const body = (
    <>
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className={inputCls + " pl-9"} placeholder="Search user, action, detail, IP…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <select className={inputCls + " sm:w-52"} value={action} onChange={e => setAction(e.target.value)}>
          {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button className={btnGhost} onClick={() => fetchPage(undefined, true)}>Refresh</button>
      </div>
      <Msg m={msg} />
      <div className="space-y-2">
        {rows.map(r => (
          <div key={r.id} className="p-3 rounded-xl border border-border-subtle bg-background/40">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-2 h-2 rounded-full shrink-0 ${r.ok ? "bg-emerald-500" : "bg-red-500"}`} />
                <span className="text-sm font-medium text-foreground truncate">{r.username || "—"}</span>
                <span className="text-xs text-theme-400 font-mono">{pretty(r.action)}</span>
                {!r.ok && <span className="text-[11px] px-1.5 rounded bg-red-500/15 text-red-400">denied/failed</span>}
              </div>
              <span className="text-xs text-muted-foreground">{new Date(r.ts).toLocaleString()}</span>
            </div>
            {r.detail && <div className="mt-1 text-xs text-muted-foreground font-mono break-all">{r.detail}</div>}
            {r.ip && <div className="mt-0.5 text-[11px] text-muted-foreground/70">{r.ip}{!serverId && r.serverId ? ` · server ${r.serverId.slice(0, 8)}` : ""}</div>}
          </div>
        ))}
        {rows.length === 0 && !loading && <div className="text-sm text-muted-foreground p-4">Nothing logged yet.</div>}
      </div>
      {next && <button className={btnGhost + " mt-4"} disabled={loading} onClick={() => fetchPage(next, false)}>{loading ? "Loading…" : "Load more"}</button>}
    </>
  );

  if (embedded) return body;
  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto w-full">
      <PageTitle icon={<Activity />} title="Activity" sub="Who did what on this server, and when." />
      <div className={cardCls}>{body}</div>
    </div>
  );
}
