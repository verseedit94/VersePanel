// @ts-nocheck
import React, { useEffect, useState } from "react";
import axios from "axios";
import { Database, Plus, Trash2, RefreshCw, Eye, EyeOff, Copy } from "lucide-react";
import { cardCls, inputCls, monoCls, btnPrimary, btnGhost, btnDanger, errText, Msg, PageTitle } from "./PanelBits";

export default function DatabasesManager({ serverId }: { serverId: string }) {
  const [data, setData] = useState<any>(null);
  const [label, setLabel] = useState("");
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { setData((await axios.get(`/api/servers/${serverId}/databases`)).data); }
    catch (e) { setMsg({ ok: false, text: errText(e) }); }
  };
  useEffect(() => { load(); }, [serverId]);

  const create = async () => {
    setBusy(true); setMsg(null);
    try { await axios.post(`/api/servers/${serverId}/databases`, { label }); setLabel(""); await load(); }
    catch (e) { setMsg({ ok: false, text: errText(e) }); } finally { setBusy(false); }
  };
  const rotate = async (d) => {
    if (!confirm("Generate a new password? Anything using the old one will stop working.")) return;
    try { await axios.post(`/api/servers/${serverId}/databases/${d.id}/rotate-password`); await load(); setMsg({ ok: true, text: "Password changed." }); }
    catch (e) { setMsg({ ok: false, text: errText(e) }); }
  };
  const del = async (d) => {
    if (!confirm(`Delete database ${d.name}? All its data is lost.`)) return;
    try { await axios.delete(`/api/servers/${serverId}/databases/${d.id}`); await load(); }
    catch (e) { setMsg({ ok: false, text: errText(e) }); }
  };

  if (!data) return <div className="p-8 text-muted-foreground">Loading…</div>;
  const line = (k, v, secret = false, id = "") => (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-border-subtle last:border-0">
      <span className="text-xs text-muted-foreground w-20 shrink-0">{k}</span>
      <span className="font-mono text-sm text-foreground truncate flex-1 text-right select-all">{secret && !shown[id] ? "••••••••••••" : v}</span>
      {secret && <button onClick={() => setShown({ ...shown, [id]: !shown[id] })} className="text-muted-foreground hover:text-foreground">{shown[id] ? <EyeOff size={14} /> : <Eye size={14} />}</button>}
      <button onClick={() => navigator.clipboard.writeText(String(v))} className="text-muted-foreground hover:text-foreground"><Copy size={14} /></button>
    </div>
  );

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto w-full">
      <PageTitle icon={<Database />} title="Databases" sub="MySQL/MariaDB databases for plugins like LuckPerms, CoreProtect or your own app." />
      {!data.configured ? (
        <div className={cardCls + " text-sm text-muted-foreground"}>No database host is set up yet. An administrator can add one in <b>Admin Settings → Database Host</b>.</div>
      ) : (
        <>
          <div className={cardCls + " mb-4"}>
            <div className="flex flex-col sm:flex-row gap-2">
              <input className={inputCls} placeholder="Name (optional, e.g. perms)" maxLength={24} value={label} onChange={e => setLabel(e.target.value.toLowerCase())} />
              <button className={btnPrimary} disabled={busy || data.databases.length >= data.limit} onClick={create}><Plus size={16} /> {busy ? "Creating…" : "Create database"}</button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">{data.databases.length} of {data.limit} used.</p>
            <Msg m={msg} />
          </div>
          <div className="space-y-3">
            {data.databases.map(d => (
              <div key={d.id} className={cardCls}>
                {line("Database", d.name)}
                {line("Username", d.username)}
                {line("Password", d.password, true, d.id)}
                {line("Host", d.host)}
                {line("Port", d.port)}
                {line("URL", d.connection)}
                <div className="mt-3 flex gap-2">
                  <button className={btnGhost} onClick={() => rotate(d)}><RefreshCw size={14} /> New password</button>
                  <button className={btnDanger} onClick={() => del(d)}><Trash2 size={14} /> Delete</button>
                </div>
              </div>
            ))}
            {data.databases.length === 0 && <div className={cardCls + " text-sm text-muted-foreground"}>No databases yet.</div>}
          </div>
        </>
      )}
    </div>
  );
}
