// @ts-nocheck
import React, { useEffect, useState } from "react";
import axios from "axios";
import { Rocket, Save } from "lucide-react";
import { cardCls, inputCls, monoCls, btnPrimary, errText, Msg, PageTitle } from "./PanelBits";

export default function StartupManager({ serverId }: { serverId: string }) {
  const [data, setData] = useState<any>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [command, setCommand] = useState("");
  const [eggId, setEggId] = useState("");
  const [image, setImage] = useState("");
  const [msg, setMsg] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = async (keepMsg = false) => {
    try {
      const { data } = await axios.get(`/api/servers/${serverId}/startup`);
      setData(data); setEggId(data.egg.id); setCommand(data.command || ""); setImage(data.image || "");
      setVals(Object.fromEntries(data.variables.map(v => [v.env, v.value])));
      if (!keepMsg) setMsg(null);
    } catch (e) { setMsg({ ok: false, text: errText(e) }); }
  };
  useEffect(() => { load(); }, [serverId]);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const body: any = { variables: vals, eggId };
      if (data.canEditCommand) body.command = command;
      if (image) body.image = image;
      const r = await axios.put(`/api/servers/${serverId}/startup`, body);
      await load(true);
      setMsg({ ok: true, text: r.data.recreated ? "Saved. The container was rebuilt — start the server to apply." : "Saved. Restart the server to apply." });
    } catch (e) { setMsg({ ok: false, text: errText(e) }); } finally { setBusy(false); }
  };

  if (!data) return <div className="p-8 text-muted-foreground">Loading…</div>;
  const egg = data.egg;
  const switching = eggId !== egg.id;
  const selected = data.selectableEggs.find(e => e.id === eggId);

  const field = (v) => {
    const inRule = (v.rules || "").split("|").find(r => r.startsWith("in:"));
    const options = inRule ? inRule.slice(3).split(",") : null;
    return (
      <div key={v.env} className={cardCls}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <label className="font-medium text-foreground text-sm">{v.name}</label>
          <span className="font-mono text-[11px] text-muted-foreground">{v.env}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1 mb-3">{v.description}</p>
        {options ? (
          <select className={inputCls} disabled={!v.editable} value={vals[v.env] ?? ""} onChange={e => setVals({ ...vals, [v.env]: e.target.value })}>
            <option value="">{egg.builtin ? `(not set — default: ${v.default || "none"})` : `(default: ${v.default || "none"})`}</option>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input className={monoCls} disabled={!v.editable} value={vals[v.env] ?? ""} placeholder={v.default ? `default: ${v.default}` : ""} onChange={e => setVals({ ...vals, [v.env]: e.target.value })} />
        )}
        <div className="text-[11px] text-muted-foreground mt-2 font-mono opacity-70">{v.rules}</div>
      </div>
    );
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto w-full">
      <PageTitle icon={<Rocket />} title="Startup" sub={egg.description} />
      {data.note && <div className="mb-4 p-3 rounded-lg text-sm border bg-amber-500/10 border-amber-500/20 text-amber-400">{data.note}</div>}
      {data.running && data.runtimeType !== "local" && <div className="mb-4 p-3 rounded-lg text-sm border bg-amber-500/10 border-amber-500/20 text-amber-400">The server is running. Stop it before saving — the container has to be rebuilt.</div>}

      {data.selectableEggs.length > 1 && (
        <div className={cardCls + " mb-4"}>
          <label className="font-medium text-foreground text-sm">Egg</label>
          <select className={inputCls + " mt-2"} value={eggId} onChange={e => setEggId(e.target.value)}>
            {data.selectableEggs.map(e => <option key={e.id} value={e.id}>{e.name}{e.builtin ? "" : " (custom)"}</option>)}
          </select>
          {switching && <p className="text-xs text-amber-400 mt-2">Switching eggs changes the Docker image and startup command. Save, then upload the files the new egg needs.</p>}
          {selected && !selected.builtin && Object.keys(selected.dockerImages).length > 0 && (
            <>
              <label className="font-medium text-foreground text-sm block mt-4">Docker image</label>
              <select className={inputCls + " mt-2"} value={image} onChange={e => setImage(e.target.value)}>
                {Object.entries(selected.dockerImages).map(([label, img]) => <option key={img} value={img}>{label} — {img}</option>)}
              </select>
            </>
          )}
        </div>
      )}

      {data.canEditCommand && (
        <div className={cardCls + " mb-4"}>
          <label className="font-medium text-foreground text-sm">Startup command</label>
          <textarea className={monoCls + " mt-2 min-h-[80px]"} value={command} onChange={e => setCommand(e.target.value)}
            placeholder={data.commandTemplate || "Leave empty for the default (npm start / main.py …)"} />
          {!egg.builtin && <p className="text-xs text-muted-foreground mt-2">Use {"{{VARIABLE}}"} placeholders, plus {"{{SERVER_MEMORY}}"} (MB) and {"{{SERVER_PORT}}"}. Leave empty to use the egg's default.</p>}
          {data.effectiveCommand && <div className="mt-3 text-xs text-muted-foreground">Effective command: <span className="font-mono text-foreground break-all">{data.effectiveCommand}</span></div>}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">{data.variables.map(field)}</div>
      {data.variables.length === 0 && <div className={cardCls + " text-sm text-muted-foreground"}>This egg has no variables.</div>}

      <button className={btnPrimary + " mt-5"} onClick={save} disabled={busy || (data.running && data.runtimeType !== "local")}><Save size={16} /> {busy ? "Saving…" : "Save startup settings"}</button>
      <Msg m={msg} />
    </div>
  );
}
