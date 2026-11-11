import React, { useEffect, useState } from "react";
import axios from "axios";
import { Bot, CheckCircle2, ExternalLink, Trash2 } from "lucide-react";
import { cardCls, inputCls, monoCls, btnPrimary, btnGhost, errText, Msg } from "./PanelBits";

/** Admin settings: Discord bot token, allowed role, Groq key — players use /register and the AI creates servers for them. */
export default function AdminAiBot() {
  const [cfg, setCfg] = useState<any>(null);
  const [f, setF] = useState<any>({ botToken: "", groqKey: "", roleId: "", model: "", nodeId: "local", maxRamGB: 8, maxDiskGB: 20, maxCores: 4, enabled: false });
  const [users, setUsers] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<any>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const apply = (d: any) => { setCfg(d); setF((p: any) => ({ ...p, roleId: d.roleId, model: d.model, nodeId: d.nodeId, maxRamGB: d.maxRamGB, maxDiskGB: d.maxDiskGB, maxCores: d.maxCores, enabled: d.enabled, botToken: "", groqKey: "" })); };
  const load = async () => {
    try { apply((await axios.get("/api/admin/aibot")).data); setUsers((await axios.get("/api/admin/aibot/users")).data); }
    catch (e: any) { setMsg({ ok: false, text: errText(e) }); }
  };
  useEffect(() => { load(); }, []);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));

  const save = async () => {
    setBusy(true); setMsg(null);
    try { apply((await axios.put("/api/admin/aibot", f)).data); setUsers((await axios.get("/api/admin/aibot/users")).data); setMsg({ ok: true, text: "Saved." }); }
    catch (e: any) { setMsg({ ok: false, text: errText(e) }); }
    setBusy(false);
  };
  const runTest = async () => { setBusy(true); setTest(null); try { setTest((await axios.post("/api/admin/aibot/test")).data); } catch (e: any) { setMsg({ ok: false, text: errText(e) }); } setBusy(false); };
  const unlink = async (id: string) => { if (!confirm("Unlink this Discord user? Their panel account stays.")) return; await axios.delete(`/api/admin/aibot/users/${id}`); load(); };
  if (!cfg) return null;
  const st = cfg.status || {};

  return (
    <div id="aibot" className={cardCls + " mt-6 space-y-4"}>
      <div className="flex items-center gap-2"><Bot className="w-5 h-5 text-theme-500" /><h3 className="text-lg font-semibold">Discord AI helper</h3></div>
      <p className="text-sm text-muted-foreground">Players type <span className="font-mono">/register</span> in Discord to get a panel account. Members with the allowed role then use <span className="font-mono">/ai</span> (for example “@user ko 4GB RAM 10GB storage 2 core Paper do”) and the AI creates the server. Players who never registered are refused.</p>

      <label className="flex items-center justify-between gap-3 rounded-xl bg-background border border-border p-3 cursor-pointer">
        <div className="text-sm font-medium">Turn the bot on</div>
        <input type="checkbox" className="w-5 h-5" checked={f.enabled} onChange={e => set("enabled", e.target.checked)} />
      </label>

      <div className="space-y-3">
        <div><div className="text-xs text-muted-foreground mb-1">Discord bot token {cfg.tokenSet && <span className="text-emerald-500">· saved</span>}</div>
          <input className={monoCls} type="password" placeholder={cfg.tokenSet ? "leave empty to keep the saved token" : "paste the bot token"} value={f.botToken} onChange={e => set("botToken", e.target.value)} /></div>
        <div><div className="text-xs text-muted-foreground mb-1">Allowed role ID (who may use /ai)</div>
          <input className={monoCls} placeholder="123456789012345678" value={f.roleId} onChange={e => set("roleId", e.target.value.replace(/\D/g, ""))} /></div>
        <div><div className="text-xs text-muted-foreground mb-1">Groq API key {cfg.groqSet && <span className="text-emerald-500">· saved</span>}</div>
          <input className={monoCls} type="password" placeholder={cfg.groqSet ? "leave empty to keep the saved key" : "gsk_..."} value={f.groqKey} onChange={e => set("groqKey", e.target.value)} /></div>
        <div className="grid grid-cols-3 gap-2">
          <div><div className="text-xs text-muted-foreground mb-1">Max RAM (GB)</div><input className={inputCls} type="number" min={1} value={f.maxRamGB} onChange={e => set("maxRamGB", e.target.value)} /></div>
          <div><div className="text-xs text-muted-foreground mb-1">Max storage (GB)</div><input className={inputCls} type="number" min={1} value={f.maxDiskGB} onChange={e => set("maxDiskGB", e.target.value)} /></div>
          <div><div className="text-xs text-muted-foreground mb-1">Max cores</div><input className={inputCls} type="number" min={0.5} step={0.5} value={f.maxCores} onChange={e => set("maxCores", e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><div className="text-xs text-muted-foreground mb-1">Groq model</div><input className={monoCls} value={f.model} onChange={e => set("model", e.target.value)} /></div>
          <div><div className="text-xs text-muted-foreground mb-1">Create servers on node</div><input className={monoCls} value={f.nodeId} onChange={e => set("nodeId", e.target.value)} placeholder="local" /></div>
        </div>
      </div>

      <div className="flex gap-2">
        <button className={btnPrimary + " flex-1"} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save & connect"}</button>
        <button className={btnGhost} disabled={busy} onClick={runTest}>Test</button>
      </div>

      <div className="rounded-xl bg-background border border-border p-3 text-sm space-y-1">
        <div className="flex items-center gap-2">
          {st.state === "online" ? <CheckCircle2 size={16} className="text-emerald-500" /> : <span className="w-2 h-2 rounded-full bg-amber-400" />}
          <span>Bot: <b>{st.state === "online" ? `online as ${st.botName}` : st.state}</b></span>
        </div>
        {st.error && <div className="text-xs text-red-400">{st.error}</div>}
        {test && <div className="text-xs text-muted-foreground">Groq: {test.groq} · Discord: {test.discord}</div>}
        {cfg.inviteUrl && <a className="inline-flex items-center gap-1 text-xs text-theme-500 underline" href={cfg.inviteUrl} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Invite the bot to your Discord server</a>}
      </div>

      <div>
        <div className="text-xs text-muted-foreground mb-1.5">Registered players ({users.length})</div>
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {users.map(u => (
            <div key={u.discordId} className="flex items-center justify-between gap-2 bg-background border border-border rounded-lg px-3 py-1.5 text-xs">
              <span className="truncate">{u.username} <span className="text-muted-foreground font-mono">· {u.discordId}</span></span>
              <button className="p-1 rounded hover:bg-red-500/10 text-red-400" onClick={() => unlink(u.discordId)}><Trash2 size={13} /></button>
            </div>
          ))}
          {!users.length && <div className="text-xs text-muted-foreground">Nobody has used /register yet.</div>}
        </div>
      </div>
      <Msg m={msg} />
    </div>
  );
}
