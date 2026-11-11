import React, { useEffect, useState } from "react";
import axios from "axios";
import { Cloud, CheckCircle2, ExternalLink, Trash2 } from "lucide-react";
import { cardCls, inputCls, monoCls, btnPrimary, btnGhost, btnDanger, errText, Msg } from "./PanelBits";

/** Admin settings: allow subdomains + authorise a Cloudflare domain. */
export default function AdminSubdomains() {
  const [cfg, setCfg] = useState<any>(null);
  const [token, setToken] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => { try { setCfg((await axios.get("/api/subdomains/config")).data); } catch (e: any) { setMsg({ ok: false, text: errText(e) }); } };
  useEffect(() => { load(); }, []);
  const run = async (fn: () => Promise<any>, ok?: string) => {
    setBusy(true); setMsg(null);
    try { const r = await fn(); if (r?.data) setCfg(r.data); if (ok) setMsg({ ok: true, text: ok }); } catch (e: any) { setMsg({ ok: false, text: errText(e) }); }
    setBusy(false);
  };
  if (!cfg) return null;
  const authorize = () => { window.open(cfg.tokenUrl, "_blank"); setAsking(true); };

  return (
    <div id="subdomains" className={cardCls + " mt-6 space-y-4"}>
      <div className="flex items-center gap-2"><Cloud className="w-5 h-5 text-theme-500" /><h3 className="text-lg font-semibold">Subdomains (Cloudflare)</h3></div>
      <p className="text-sm text-muted-foreground">Let servers get names like <span className="font-mono">play.yourdomain.com</span> and give nodes one shared address. Your domain must use Cloudflare DNS.</p>

      <label className="flex items-center justify-between gap-3 rounded-xl bg-background border border-border p-3 cursor-pointer">
        <div><div className="text-sm font-medium">Allow subdomains</div><div className="text-xs text-muted-foreground">Server owners can create subdomains up to the limit set when the server was created.</div></div>
        <input type="checkbox" className="w-5 h-5 accent-[var(--theme-600,#7c3aed)]" checked={!!cfg.enabled} disabled={busy} onChange={e => run(() => axios.put("/api/subdomains/config", { enabled: e.target.checked }))} />
      </label>

      {cfg.hasToken ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-emerald-500 font-medium"><CheckCircle2 size={16} /> Cloudflare connected</div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Domain used for subdomains</div>
            <select className={inputCls} value={cfg.zone?.id || ""} disabled={busy} onChange={e => run(() => axios.post("/api/subdomains/config/zone", { zoneId: e.target.value }), "Domain saved.")}>
              <option value="" disabled>Choose a domain…</option>
              {(cfg.zones || []).map((z: any) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button className={btnGhost + " flex-1"} onClick={authorize}><ExternalLink size={14} /> Authorise again</button>
            <button className={btnDanger} disabled={busy} onClick={() => confirm("Disconnect Cloudflare? Existing DNS records stay in Cloudflare.") && run(() => axios.delete("/api/subdomains/config"), "Disconnected.")}><Trash2 size={14} /></button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <button className={btnPrimary + " w-full"} onClick={authorize}><Cloud size={16} /> Setup Cloudflare</button>
          {asking && (
            <div className="space-y-2 rounded-xl bg-background border border-border p-3">
              <ol className="text-xs text-muted-foreground list-decimal pl-4 space-y-1">
                <li>On the Cloudflare page that opened, pick your domain and press <b>Continue to summary</b>, then <b>Create Token</b>.</li>
                <li>Copy the token and paste it here.</li>
              </ol>
              <input className={monoCls} type="password" placeholder="Paste the Cloudflare token" value={token} onChange={e => setToken(e.target.value)} />
              <button className={btnPrimary + " w-full"} disabled={busy || token.trim().length < 20} onClick={() => run(async () => { const r = await axios.post("/api/subdomains/config/token", { token }); setToken(""); return r; }, "Cloudflare connected.")}>{busy ? "Checking…" : "Verify & save"}</button>
            </div>
          )}
        </div>
      )}
      <Msg m={msg} />
    </div>
  );
}
