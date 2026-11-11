import React, { useEffect, useState } from "react";
import axios from "axios";
import { Globe, Copy, Trash2, CheckCircle2, Info } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { cardCls, monoCls, inputCls, btnPrimary, btnGhost, btnDanger, errText, Msg } from "./PanelBits";

/** Subdomains of one server (Cloudflare). Hidden until an admin turned subdomains on and connected Cloudflare. */
export default function ServerSubdomains({ serverId }: { serverId: string }) {
  const { user } = useAuth() as any;
  const staff = user?.role === "admin" || user?.role === "owner";
  const [d, setD] = useState<any>(null);
  const [label, setLabel] = useState("");
  const [limit, setLimit] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => { try { const r = (await axios.get(`/api/subdomains/servers/${serverId}`)).data; setD(r); setLimit(r.limit); } catch { setD(null); } };
  useEffect(() => { load(); }, [serverId]);
  const Page = ({ children }: any) => <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6 text-foreground"><div className="max-w-2xl mx-auto">{children}</div></div>;
  const Notice = ({ title, text, admin }: any) => (
    <Page><div className={cardCls + " space-y-2"}>
      <div className="flex items-center gap-2"><Info className="w-5 h-5 text-theme-500" /><h3 className="text-lg font-semibold">{title}</h3></div>
      <p className="text-sm text-muted-foreground">{text}</p>
      {admin && staff && <Link to="/admin/settings#subdomains" className="inline-block text-sm text-theme-500 underline">Open Admin settings → Subdomains</Link>}
    </div></Page>
  );
  if (!d) return <Notice title="Subdomains" text="Loading…" />;
  if (!d.enabled) return <Notice title="Subdomains are turned off" text={staff ? "Turn on “Allow subdomains” and connect your Cloudflare domain in the admin settings. After that you can create subdomains for this server here." : "The admin has not turned on subdomains yet."} admin />;
  if (!d.configured) return <Notice title="Cloudflare is not set up yet" text={staff ? "Press “Setup Cloudflare” in the admin settings and authorise your domain." : "The admin still has to connect a domain."} admin />;

  const run = async (fn: () => Promise<any>, ok?: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); if (ok) setMsg({ ok: true, text: ok }); await load(); } catch (e: any) { setMsg({ ok: false, text: errText(e) }); }
    setBusy(false);
  };
  const copy = (t: string) => { navigator.clipboard?.writeText(t); setCopied(t); setTimeout(() => setCopied(""), 1500); };
  const left = Math.max(0, d.limit - d.used);

  return (
    <Page><div className={cardCls + " space-y-4"}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2"><Globe className="w-5 h-5 text-theme-500" /><h3 className="text-lg font-semibold">Subdomains</h3></div>
        <span className="text-xs text-muted-foreground">{d.used} / {d.limit} used</span>
      </div>
      <p className="text-xs text-muted-foreground">Players join with your own name instead of an address and port. Current address: <span className="font-mono">{d.address || "—"}</span></p>

      <div className="space-y-1.5">
        {d.items.map((i: any) => (
          <div key={i.label} className="flex items-center justify-between gap-2 bg-background border border-border rounded-lg px-3 py-2">
            <span className="font-mono text-sm truncate">{i.fqdn}</span>
            <div className="flex gap-1.5 shrink-0">
              <button className="p-1.5 rounded-lg hover:bg-white/10" title="Copy" onClick={() => copy(i.fqdn)}>{copied === i.fqdn ? <CheckCircle2 size={14} className="text-emerald-500" /> : <Copy size={14} />}</button>
              <button className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400" title="Delete" disabled={busy} onClick={() => confirm(`Delete ${i.fqdn}?`) && run(() => axios.delete(`/api/subdomains/servers/${serverId}/${i.label}`), "Deleted.")}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
        {!d.items.length && <div className="text-xs text-muted-foreground">No subdomain yet.</div>}
      </div>

      {left > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input className={monoCls} placeholder="play" value={label} maxLength={32} onChange={e => setLabel(e.target.value.toLowerCase())} />
            <span className="text-sm font-mono text-muted-foreground whitespace-nowrap">.{d.zone}</span>
          </div>
          <button className={btnPrimary + " w-full"} disabled={busy || !label.trim()} onClick={() => run(async () => { await axios.post(`/api/subdomains/servers/${serverId}`, { label }); setLabel(""); }, "Subdomain created. It can take a minute to start working.")}>{busy ? "Creating…" : "Create subdomain"}</button>
        </div>
      ) : <div className="text-xs text-amber-400">{d.limit === 0 ? "This server is not allowed to have subdomains." : "You reached the subdomain limit for this server."}</div>}

      {staff && (
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <span className="text-xs text-muted-foreground">Allowed for this server</span>
          <input type="number" min={0} max={50} className={inputCls + " !w-20"} value={limit} onChange={e => setLimit(Number(e.target.value))} />
          <button className={btnGhost + " !py-2"} disabled={busy} onClick={() => run(() => axios.put(`/api/subdomains/servers/${serverId}/limit`, { limit }), "Limit saved.")}>Save</button>
        </div>
      )}
      <Msg m={msg} />
    </div></Page>
  );
}
