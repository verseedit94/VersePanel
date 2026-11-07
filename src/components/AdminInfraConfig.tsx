// @ts-nocheck
import React, { useEffect, useState } from "react";
import axios from "axios";
import { Database, Boxes, Activity, Trash2, Upload, Stethoscope, CheckCircle2, AlertTriangle } from "lucide-react";
import { inputCls, monoCls, btnPrimary, btnGhost, btnDanger, errText, Msg } from "./PanelBits";
import ActivityLog from "./ActivityLog";

const card = "bg-card border border-border-subtle rounded-2xl p-6 md:p-8 shadow-xl mt-8";

/** Admin settings: database host, egg library, panel-wide activity log. */
export default function AdminInfraConfig() {
  // ---- database host
  const [db, setDb] = useState<any>(null);
  const [f, setF] = useState<any>({ host: "", port: 3306, adminUser: "", adminPassword: "", publicHost: "", maxPerServer: 2 });
  const [dbMsg, setDbMsg] = useState<any>(null);
  // ---- system check
  const [diag, setDiag] = useState<any>(null);
  const [diagBusy, setDiagBusy] = useState(false);
  const runDiag = async () => {
    setDiagBusy(true);
    try { setDiag((await axios.get("/api/admin/config/diagnostics")).data); }
    catch (e) { setDiag({ checks: [{ name: "System check", ok: false, detail: errText(e) }], ok: false }); }
    finally { setDiagBusy(false); }
  };
  // ---- eggs
  const [eggs, setEggs] = useState<any[]>([]);
  const [eggJson, setEggJson] = useState("");
  const [eggMsg, setEggMsg] = useState<any>(null);

  const loadDb = async () => {
    try {
      const { data } = await axios.get("/api/admin/config/database");
      setDb(data);
      setF({ host: data.host, port: data.port, adminUser: data.adminUser, adminPassword: "", publicHost: data.publicHost, maxPerServer: data.maxPerServer });
    } catch {}
  };
  const loadEggs = async () => { try { setEggs((await axios.get("/api/eggs")).data.eggs); } catch {} };
  useEffect(() => { loadDb(); loadEggs(); }, []);

  const saveDb = async () => {
    setDbMsg(null);
    try { await axios.put("/api/admin/config/database", f); setDbMsg({ ok: true, text: "Saved." }); loadDb(); }
    catch (e) { setDbMsg({ ok: false, text: errText(e) }); }
  };
  const testDb = async () => {
    setDbMsg(null);
    try { setDbMsg({ ok: true, text: (await axios.post("/api/admin/config/database/test")).data.message }); }
    catch (e) { setDbMsg({ ok: false, text: errText(e) }); }
  };

  const importEgg = async () => {
    setEggMsg(null);
    try {
      const r = await axios.post("/api/eggs/import", { egg: eggJson });
      setEggJson(""); loadEggs();
      setEggMsg({ ok: true, text: `Imported "${r.data.egg.name}". ${r.data.note}` });
    } catch (e) { setEggMsg({ ok: false, text: errText(e) }); }
  };
  const onFile = (file?: File) => { if (file) file.text().then(setEggJson); };
  const delEgg = async (e) => {
    if (!confirm(`Delete egg "${e.name}"?`)) return;
    try { await axios.delete(`/api/eggs/${e.id}`); loadEggs(); }
    catch (err) { setEggMsg({ ok: false, text: errText(err) }); }
  };

  if (!db) return null;
  return (
    <>
      <div className={card} id="system-check">
        <h2 className="text-xl font-bold flex items-center text-foreground mb-1"><Stethoscope className="mr-3 text-theme-500 w-6 h-6" /> System check</h2>
        <p className="text-sm text-muted-foreground mb-4">Servers not starting or the console staying empty? Run this first — it checks Docker, Java, disk, memory and every node.</p>
        <button className={btnPrimary} onClick={runDiag} disabled={diagBusy}>{diagBusy ? "Checking…" : "Run check"}</button>
        {diag && (
          <div className="mt-4 space-y-2">
            {diag.checks.map((c: any, i: number) => (
              <div key={i} className={`p-3 rounded-xl border text-sm ${c.ok ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/30 bg-red-500/10"}`}>
                <div className="flex items-center gap-2 font-medium text-foreground">
                  {c.ok ? <CheckCircle2 size={15} className="text-emerald-500" /> : <AlertTriangle size={15} className="text-red-400" />} {c.name}
                  <span className="font-normal text-muted-foreground">— {c.detail}</span>
                </div>
                {!c.ok && c.hint && <div className="mt-1 text-xs text-red-300">{c.hint}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={card} id="database-host">
        <h2 className="text-xl font-bold flex items-center text-foreground mb-1"><Database className="mr-3 text-theme-500 w-6 h-6" /> Database Host</h2>
        <p className="text-sm text-muted-foreground mb-4">
          A MySQL / MariaDB server the panel can create per-server databases on. Use an account that may create databases and users (with GRANT OPTION).
        </p>
        <div className="grid md:grid-cols-2 gap-3">
          <input className={monoCls} placeholder="Host (e.g. 127.0.0.1)" value={f.host} onChange={e => setF({ ...f, host: e.target.value })} />
          <input className={monoCls} type="number" placeholder="Port" value={f.port} onChange={e => setF({ ...f, port: e.target.value })} />
          <input className={monoCls} placeholder="Admin user" value={f.adminUser} onChange={e => setF({ ...f, adminUser: e.target.value })} />
          <input className={monoCls} type="password" autoComplete="new-password" placeholder={db.passwordSet ? "•••••••• (saved — type to replace)" : "Admin password"} value={f.adminPassword} onChange={e => setF({ ...f, adminPassword: e.target.value })} />
          <input className={monoCls} placeholder="Public host shown to users (optional)" value={f.publicHost} onChange={e => setF({ ...f, publicHost: e.target.value })} />
          <input className={monoCls} type="number" min={0} max={50} placeholder="Databases per server" value={f.maxPerServer} onChange={e => setF({ ...f, maxPerServer: e.target.value })} />
        </div>
        <div className="flex gap-2 mt-3">
          <button className={btnPrimary} onClick={saveDb}>Save</button>
          <button className={btnGhost} onClick={testDb} disabled={!db.configured}>Test connection</button>
        </div>
        <Msg m={dbMsg} />
        <details className="mt-4 text-sm text-muted-foreground">
          <summary className="cursor-pointer text-foreground">Don't have a database server? Run MariaDB in Docker</summary>
          <pre className="mt-2 p-3 rounded-lg bg-background border border-border text-xs overflow-x-auto select-all">{`docker run -d --name verse-mariadb --restart unless-stopped \\
  -e MARIADB_ROOT_PASSWORD='CHANGE_ME' \\
  -p 3306:3306 -v verse-mariadb:/var/lib/mysql mariadb:11`}</pre>
          <p className="mt-2">Then use host <span className="font-mono">127.0.0.1</span>, user <span className="font-mono">root</span> and that password. Game-server databases are reachable on port 3306 — firewall it to what you need, since root on this instance is the panel's key to the database server.</p>
        </details>
      </div>

      <div className={card} id="eggs">
        <h2 className="text-xl font-bold flex items-center text-foreground mb-1"><Boxes className="mr-3 text-theme-500 w-6 h-6" /> Eggs</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Import Pterodactyl egg files (.json). The Docker image, startup command and variables are used. Install scripts are <b>not</b> run, so upload the server files yourself.
        </p>
        <div className="space-y-2 mb-4">
          {eggs.map(e => (
            <div key={e.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border-subtle bg-background/40">
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">{e.name} {e.builtin && <span className="text-[11px] text-muted-foreground">built-in</span>}</div>
                <div className="text-xs text-muted-foreground truncate">{e.variableCount} variables{!e.builtin && Object.values(e.dockerImages)[0] ? ` · ${Object.values(e.dockerImages)[0]}` : ""}</div>
              </div>
              {!e.builtin && <button className={btnDanger + " !px-2"} onClick={() => delEgg(e)}><Trash2 size={14} /></button>}
            </div>
          ))}
        </div>
        <textarea className={monoCls + " min-h-[100px]"} placeholder="Paste egg JSON here…" value={eggJson} onChange={e => setEggJson(e.target.value)} />
        <div className="flex flex-wrap gap-2 mt-2">
          <label className={btnGhost + " cursor-pointer"}><Upload size={14} /> Choose file<input type="file" accept=".json,application/json" className="hidden" onChange={e => onFile(e.target.files?.[0])} /></label>
          <button className={btnPrimary} disabled={!eggJson.trim()} onClick={importEgg}>Import egg</button>
        </div>
        <Msg m={eggMsg} />
      </div>

      <div className={card} id="activity">
        <h2 className="text-xl font-bold flex items-center text-foreground mb-4"><Activity className="mr-3 text-theme-500 w-6 h-6" /> Activity Log</h2>
        <ActivityLog embedded />
      </div>
    </>
  );
}
