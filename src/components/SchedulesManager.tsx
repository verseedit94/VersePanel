// @ts-nocheck
import React, { useEffect, useState } from "react";
import axios from "axios";
import { Clock, Play, Pencil, Trash2, Plus, ArrowUp, ArrowDown, X } from "lucide-react";
import { cardCls, inputCls, monoCls, btnPrimary, btnGhost, btnDanger, errText, Msg, PageTitle, timeAgo } from "./PanelBits";

const PRESETS = [
  { label: "Every 5 minutes", cron: "*/5 * * * *" },
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Every 6 hours", cron: "0 */6 * * *" },
  { label: "Daily at 04:00", cron: "0 4 * * *" },
  { label: "Weekly, Sunday 04:00", cron: "0 4 * * 0" }
];
const blank = () => ({ name: "", cron: "0 4 * * *", enabled: true, onlyWhenOnline: false, tasks: [{ action: "command", payload: "", delay: 0 }] });

export default function SchedulesManager({ serverId }: { serverId: string }) {
  const [list, setList] = useState<any[]>([]);
  const [tz, setTz] = useState("");
  const [edit, setEdit] = useState<any>(null); // schedule being edited (id === undefined -> new)
  const [msg, setMsg] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const { data } = await axios.get(`/api/servers/${serverId}/schedules`);
      setList(data.schedules); setTz(data.timezone);
    } catch (e) { setMsg({ ok: false, text: errText(e) }); }
  };
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [serverId]);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const body = { name: edit.name, cron: edit.cron, enabled: edit.enabled, onlyWhenOnline: edit.onlyWhenOnline,
        tasks: edit.tasks.map(t => ({ ...t, delay: Number(t.delay) || 0, payload: t.action === "backup" ? "" : t.payload })) };
      if (edit.id) await axios.put(`/api/servers/${serverId}/schedules/${edit.id}`, body);
      else await axios.post(`/api/servers/${serverId}/schedules`, body);
      setEdit(null); load();
    } catch (e) { setMsg({ ok: false, text: errText(e) }); } finally { setBusy(false); }
  };
  const toggle = async (s) => {
    try { await axios.put(`/api/servers/${serverId}/schedules/${s.id}`, { ...s, enabled: !s.enabled }); load(); }
    catch (e) { setMsg({ ok: false, text: errText(e) }); }
  };
  const run = async (s) => {
    try { await axios.post(`/api/servers/${serverId}/schedules/${s.id}/run`); setMsg({ ok: true, text: `"${s.name}" started` }); setTimeout(load, 1500); }
    catch (e) { setMsg({ ok: false, text: errText(e) }); }
  };
  const del = async (s) => {
    if (!confirm(`Delete schedule "${s.name}"?`)) return;
    try { await axios.delete(`/api/servers/${serverId}/schedules/${s.id}`); load(); }
    catch (e) { setMsg({ ok: false, text: errText(e) }); }
  };

  const setTask = (i, patch) => setEdit({ ...edit, tasks: edit.tasks.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const moveTask = (i, d) => {
    const a = [...edit.tasks]; const j = i + d; if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]]; setEdit({ ...edit, tasks: a });
  };

  const taskText = (t) => t.action === "backup" ? "Create backup" : t.action === "power" ? `Power: ${t.payload}` : `Command: ${t.payload}`;

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto w-full">
      <PageTitle icon={<Clock />} title="Schedules" sub={`Run commands, power actions and backups automatically. Server time zone: ${tz || "…"}`} />
      <Msg m={msg} />

      {!edit && (
        <>
          <button className={btnPrimary + " mb-4"} onClick={() => setEdit(blank())}><Plus size={16} /> New schedule</button>
          {list.length === 0 && <div className={cardCls + " text-muted-foreground text-sm"}>No schedules yet. Try a daily restart at 04:00 or an hourly backup.</div>}
          <div className="space-y-3">
            {list.map(s => (
              <div key={s.id} className={cardCls}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-foreground flex items-center gap-2">
                      {s.name}
                      {s.running && <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400">running…</span>}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground mt-1">{s.cron}{s.onlyWhenOnline ? " · only when online" : ""}</div>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                    <input type="checkbox" checked={s.enabled} onChange={() => toggle(s)} /> Enabled
                  </label>
                </div>
                <ol className="mt-3 text-sm text-muted-foreground list-decimal pl-5 space-y-0.5">
                  {s.tasks.map(t => <li key={t.id}>{taskText(t)}{t.delay ? ` (after ${t.delay}s)` : ""}</li>)}
                </ol>
                <div className="mt-3 text-xs text-muted-foreground flex flex-wrap gap-x-5 gap-y-1">
                  <span>Next: {s.enabled && s.nextRun ? new Date(s.nextRun).toLocaleString() : "—"}</span>
                  <span>Last: {timeAgo(s.lastRun)}{s.lastStatus ? ` · ${s.lastStatus}` : ""}</span>
                </div>
                {s.lastStatus === "error" && <div className="mt-2 text-xs text-red-400">{s.lastMessage}</div>}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button className={btnGhost} onClick={() => run(s)} disabled={s.running}><Play size={14} /> Run now</button>
                  <button className={btnGhost} onClick={() => setEdit({ ...s, tasks: s.tasks.map(t => ({ ...t })) })}><Pencil size={14} /> Edit</button>
                  <button className={btnDanger} onClick={() => del(s)}><Trash2 size={14} /> Delete</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {edit && (
        <div className={cardCls}>
          <h3 className="font-semibold text-foreground mb-4">{edit.id ? "Edit schedule" : "New schedule"}</h3>
          <label className="text-sm text-muted-foreground">Name</label>
          <input className={inputCls + " mb-4"} value={edit.name} maxLength={60} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder="Daily restart" />

          <label className="text-sm text-muted-foreground">When</label>
          <div className="flex flex-col sm:flex-row gap-2 mb-1">
            <select className={inputCls + " sm:w-56"} value={PRESETS.some(p => p.cron === edit.cron) ? edit.cron : ""} onChange={e => e.target.value && setEdit({ ...edit, cron: e.target.value })}>
              <option value="">Custom…</option>
              {PRESETS.map(p => <option key={p.cron} value={p.cron}>{p.label}</option>)}
            </select>
            <input className={monoCls} value={edit.cron} onChange={e => setEdit({ ...edit, cron: e.target.value })} placeholder="minute hour day month weekday" />
          </div>
          <p className="text-xs text-muted-foreground mb-4">Format: <span className="font-mono">minute hour day-of-month month day-of-week</span> — e.g. <span className="font-mono">30 3 * * 1-5</span> = 03:30 on weekdays.</p>

          <label className="flex items-center gap-2 text-sm text-foreground mb-1"><input type="checkbox" checked={edit.enabled} onChange={e => setEdit({ ...edit, enabled: e.target.checked })} /> Enabled</label>
          <label className="flex items-center gap-2 text-sm text-foreground mb-5"><input type="checkbox" checked={edit.onlyWhenOnline} onChange={e => setEdit({ ...edit, onlyWhenOnline: e.target.checked })} /> Only run when the server is online</label>

          <div className="text-sm text-muted-foreground mb-2">Tasks (run in order)</div>
          <div className="space-y-2">
            {edit.tasks.map((t, i) => (
              <div key={i} className="flex flex-col md:flex-row gap-2 p-3 rounded-xl border border-border-subtle bg-background/40">
                <select className={inputCls + " md:w-40"} value={t.action} onChange={e => setTask(i, { action: e.target.value, payload: e.target.value === "power" ? "restart" : "" })}>
                  <option value="command">Send command</option>
                  <option value="power">Power action</option>
                  <option value="backup">Create backup</option>
                </select>
                {t.action === "command" && <input className={monoCls} value={t.payload} onChange={e => setTask(i, { payload: e.target.value })} placeholder="say Restarting in 1 minute" />}
                {t.action === "power" && (
                  <select className={inputCls} value={t.payload} onChange={e => setTask(i, { payload: e.target.value })}>
                    {["start", "stop", "restart", "kill"].map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                )}
                {t.action === "backup" && <div className="flex-1 text-sm text-muted-foreground self-center">Zips the server folder into Backups</div>}
                <input type="number" min={0} max={900} className={inputCls + " md:w-28"} value={t.delay} onChange={e => setTask(i, { delay: e.target.value })} title="Seconds to wait before this task" placeholder="delay s" />
                <div className="flex gap-1">
                  <button className={btnGhost + " !px-2"} onClick={() => moveTask(i, -1)}><ArrowUp size={14} /></button>
                  <button className={btnGhost + " !px-2"} onClick={() => moveTask(i, 1)}><ArrowDown size={14} /></button>
                  <button className={btnDanger + " !px-2"} disabled={edit.tasks.length === 1} onClick={() => setEdit({ ...edit, tasks: edit.tasks.filter((_, j) => j !== i) })}><X size={14} /></button>
                </div>
              </div>
            ))}
          </div>
          {edit.tasks.length < 10 && <button className={btnGhost + " mt-3"} onClick={() => setEdit({ ...edit, tasks: [...edit.tasks, { action: "command", payload: "", delay: 0 }] })}><Plus size={14} /> Add task</button>}

          <div className="mt-6 flex gap-2">
            <button className={btnPrimary} onClick={save} disabled={busy}>{busy ? "Saving…" : "Save schedule"}</button>
            <button className={btnGhost} onClick={() => { setEdit(null); setMsg(null); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
