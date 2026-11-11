import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { X, CheckCircle2, ExternalLink, RefreshCw, Trash2, Cloud, Globe } from "lucide-react";
import { Link } from "react-router-dom";
import { cardCls, inputCls, monoCls, btnPrimary, btnGhost, btnDanger, errText, Msg } from "./PanelBits";

/** Per-node public address: playit.gg tunnel OR a Cloudflare (DNS) address. Only one of them is active at a time. */
export default function NodeTunnelModal({ node, onClose, onChanged, initialTab }: { node: any; onClose: () => void; onChanged: () => void; initialTab?: "playit" | "cloudflare" }) {
  const [tab, setTab] = useState<"playit" | "cloudflare">(initialTab || (node.provider === "cloudflare" ? "cloudflare" : "playit"));
  const [pl, setPl] = useState<any>(null);
  const [cfg, setCfg] = useState<any>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const timer = useRef<any>(null);

  const loadPlayit = async () => { try { setPl((await axios.get(`/api/nodes/${node.id}/playit`)).data); } catch (e: any) { setMsg({ ok: false, text: errText(e) }); } };
  const loadCf = async () => { try { setCfg((await axios.get("/api/subdomains/config")).data); } catch {} };
  useEffect(() => { loadPlayit(); loadCf(); return () => clearInterval(timer.current); }, []);

  const poll = () => {
    clearInterval(timer.current);
    timer.current = setInterval(async () => {
      try {
        const r = (await axios.post(`/api/nodes/${node.id}/playit/check`)).data;
        if (r.state === "connected") { clearInterval(timer.current); setMsg(r.warning ? { ok: false, text: r.warning } : { ok: true, text: "Connected! Tunnels are being created for your servers." }); await loadPlayit(); onChanged(); }
        else if (r.state === "rejected" || r.state === "expired") { clearInterval(timer.current); setMsg({ ok: false, text: r.state === "rejected" ? "You rejected the request on playit.gg." : "The link expired. Start again." }); await loadPlayit(); }
      } catch (e: any) { clearInterval(timer.current); setMsg({ ok: false, text: errText(e) }); }
    }, 3000);
  };
  useEffect(() => { if (pl?.claiming && !pl?.connected) poll(); }, [pl?.claiming, pl?.connected]);

  const run = async (fn: () => Promise<any>, okText?: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); if (okText) setMsg({ ok: true, text: okText }); } catch (e: any) { setMsg({ ok: false, text: errText(e) }); }
    setBusy(false);
  };
  const startClaim = () => run(async () => {
    const r = (await axios.post(`/api/nodes/${node.id}/playit/claim`)).data;
    window.open(r.url, "_blank");
    await loadPlayit();
  });
  const sync = () => run(async () => { const r = (await axios.post(`/api/nodes/${node.id}/playit/sync`)).data; await loadPlayit(); onChanged(); if (r.errors?.length) throw new Error(r.errors[0]); }, "Tunnels updated.");
  const disconnect = () => { if (!confirm("Remove the playit tunnel from this node? Server addresses go back to the node's own address.")) return; run(async () => { await axios.post(`/api/nodes/${node.id}/playit/disconnect`); await loadPlayit(); onChanged(); }, "Disconnected."); };
  const setCf = () => run(async () => { await axios.post(`/api/subdomains/nodes/${node.id}`, { label }); setLabel(""); onChanged(); }, "Address set. All servers on this node now show it.");
  const removeCf = () => { if (!confirm("Remove the Cloudflare address from this node?")) return; run(async () => { await axios.delete(`/api/subdomains/nodes/${node.id}`); onChanged(); }, "Removed."); };

  const tabCls = (t: string) => `flex-1 px-3 py-2 rounded-xl text-sm font-medium border ${tab === t ? "bg-theme-700 text-white border-theme-700" : "border-border text-foreground hover:bg-white/5"}`;
  const isCf = node.provider === "cloudflare";
  const isPlayit = node.provider === "playit" || !!pl?.connected;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className={cardCls + " w-full max-w-lg max-h-[90vh] overflow-y-auto"} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Public address · {node.name}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10"><X size={18} /></button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">Pick how players reach the servers of this node. All servers of the node show the same address — only the port differs.</p>
        <div className="flex gap-2 mb-4">
          <button className={tabCls("playit")} onClick={() => setTab("playit")}><Globe size={14} className="inline mr-1.5" />playit.gg</button>
          <button className={tabCls("cloudflare")} onClick={() => setTab("cloudflare")}><Cloud size={14} className="inline mr-1.5" />Cloudflare</button>
        </div>

        {tab === "playit" && (
          <div className="space-y-3">
            {isCf && <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">This node uses a Cloudflare address ({node.tunnelHost}). Remove it in the Cloudflare tab to use playit.gg instead.</div>}
            {!isCf && pl && !pl.connected && (
              <>
                <p className="text-sm text-muted-foreground">Link this node to your free playit.gg account once. No game type is asked — every server on the node gets its own port on the same address.</p>
                {pl.claiming && pl.claimUrl ? (
                  <div className="space-y-2">
                    <div className="text-sm flex items-center gap-2"><RefreshCw size={14} className="animate-spin" /> Waiting for you to approve on playit.gg…</div>
                    <a className={btnGhost + " w-full"} href={pl.claimUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open the approval page again</a>
                  </div>
                ) : <button className={btnPrimary + " w-full"} disabled={busy} onClick={startClaim}>{busy ? "Starting…" : "Setup playit tunnel"}</button>}
              </>
            )}
            {pl?.connected && (
              <>
                <div className="flex items-center gap-2 text-emerald-500 text-sm font-medium"><CheckCircle2 size={16} /> Playit tunnel connected</div>
                <div className="rounded-xl bg-background border border-border p-3 text-sm">
                  <div className="text-xs text-muted-foreground mb-1">Node address</div>
                  <div className="font-mono break-all">{pl.host || "waiting for the first tunnel…"}</div>
                  <div className="text-xs text-muted-foreground mt-2">Agent: {pl.agent?.error ? <span className="text-red-400">{pl.agent.error}</span> : pl.agent?.running ? <span className="text-emerald-500">running</span> : <span className="text-amber-400">not running</span>}</div>
                  {pl.agent && !pl.agent.running && pl.agent.log?.length > 0 && <pre className="mt-2 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap break-all max-h-28 overflow-auto">{pl.agent.log.join("\n")}</pre>}
                </div>
                <div className="space-y-1.5">
                  {(pl.servers || []).map((s: any) => (
                    <div key={s.id} className="flex justify-between gap-2 text-xs bg-background border border-border rounded-lg px-3 py-2">
                      <span className="truncate">{s.name}</span><span className="font-mono">{s.address || (s.tunnel ? "waiting…" : "no tunnel yet")}</span>
                    </div>
                  ))}
                  {!(pl.servers || []).length && <div className="text-xs text-muted-foreground">No servers on this node yet. New servers get a tunnel automatically.</div>}
                </div>
                <div className="flex gap-2">
                  <button className={btnGhost + " flex-1"} disabled={busy} onClick={sync}><RefreshCw size={14} /> Update tunnels</button>
                  <button className={btnDanger} disabled={busy} onClick={disconnect}><Trash2 size={14} /></button>
                </div>
              </>
            )}
          </div>
        )}

        {tab === "cloudflare" && (
          <div className="space-y-3">
            {isPlayit && <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">This node uses a playit.gg tunnel. Disconnect it in the playit tab to use Cloudflare instead.</div>}
            {!isPlayit && cfg && !cfg.configured && (
              <div className="text-sm text-muted-foreground">An admin must set up Cloudflare first (authorise a domain). <Link to="/admin/settings" className="text-theme-500 underline" onClick={onClose}>Open admin settings → Subdomains</Link></div>
            )}
            {!isPlayit && cfg?.configured && isCf && (
              <>
                <div className="flex items-center gap-2 text-emerald-500 text-sm font-medium"><CheckCircle2 size={16} /> Cloudflare address active</div>
                <div className="rounded-xl bg-background border border-border p-3 font-mono text-sm break-all">{node.tunnelHost}</div>
                <button className={btnDanger + " w-full"} disabled={busy} onClick={removeCf}><Trash2 size={14} /> Remove address</button>
              </>
            )}
            {!isPlayit && cfg?.configured && !isCf && (
              <>
                <p className="text-sm text-muted-foreground">Choose a name on your domain. It points to this node ({node.fqdn}) and every server here shows it.</p>
                <div className="flex items-center gap-2">
                  <input className={monoCls} placeholder="node1" value={label} onChange={e => setLabel(e.target.value.toLowerCase())} maxLength={32} />
                  <span className="text-sm font-mono text-muted-foreground whitespace-nowrap">.{cfg.zone?.name}</span>
                </div>
                <p className="text-xs text-muted-foreground">Needs this node to be reachable directly (public IP, game ports open). A node behind a tunnel cannot use this.</p>
                <button className={btnPrimary + " w-full"} disabled={busy || !label.trim()} onClick={setCf}>{busy ? "Saving…" : "Set address"}</button>
              </>
            )}
          </div>
        )}
        <div className="mt-3"><Msg m={msg} /></div>
      </div>
    </div>
  );
}
