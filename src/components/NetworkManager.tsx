// @ts-nocheck
import React, { useEffect, useState } from "react";
import axios from "axios";
import { Share2, Plus, Trash2, Copy, Check } from "lucide-react";
import { useSettings } from "../context/SettingsContext";
import { serverHost } from "../utils/serverAddress";
import { cardCls, inputCls, monoCls, btnPrimary, btnDanger, errText, Msg, PageTitle } from "./PanelBits";

export default function NetworkManager({ serverId }: { serverId: string }) {
  const { panelDomain } = useSettings();
  const [data, setData] = useState<any>(null);
  const [port, setPort] = useState("");
  const [protocol, setProtocol] = useState("both");
  const [label, setLabel] = useState("");
  const [msg, setMsg] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const [nodeHost, setNodeHost] = useState("");

  const load = async () => {
    try { setData((await axios.get(`/api/servers/${serverId}/ports`)).data); }
    catch (e) { setMsg({ ok: false, text: errText(e) }); }
  };
  useEffect(() => { load(); axios.get(`/api/servers/${serverId}`).then(r => setNodeHost(r.data?.host || "")).catch(() => {}); }, [serverId]);

  const add = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await axios.post(`/api/servers/${serverId}/ports`, { port: Number(port), protocol, label });
      setPort(""); setLabel(""); await load();
      setMsg({ ok: true, text: r.data.recreated ? "Port added. The container was rebuilt — start the server to use it." : "Port added." });
    } catch (e) { setMsg({ ok: false, text: errText(e) }); } finally { setBusy(false); }
  };
  const remove = async (p) => {
    if (!confirm(`Remove port ${p.port}?`)) return;
    try { await axios.delete(`/api/servers/${serverId}/ports/${p.id}`); await load(); setMsg({ ok: true, text: "Port removed." }); }
    catch (e) { setMsg({ ok: false, text: errText(e) }); }
  };
  const copy = (text) => { navigator.clipboard.writeText(text); setCopied(text); setTimeout(() => setCopied(""), 1500); };

  if (!data) return <div className="p-8 text-muted-foreground">Loading…</div>;
  const host = serverHost(nodeHost || panelDomain);
  const row = (p, primary) => {
    const addr = `${host}:${p.port}`;
    return (
      <div key={primary ? "main" : p.id} className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl border border-border-subtle bg-background/40">
        <div className="min-w-0">
          <div className="font-mono text-foreground text-sm">{addr}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{primary ? "Primary port" : `${p.protocol.toUpperCase()}${p.label ? " · " + p.label : ""}`}</div>
        </div>
        <div className="flex gap-2">
          <button className="p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground" onClick={() => copy(addr)} title="Copy">
            {copied === addr ? <Check size={14} /> : <Copy size={14} />}
          </button>
          {!primary && <button className={btnDanger + " !px-2"} onClick={() => remove(p)}><Trash2 size={14} /></button>}
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto w-full">
      <PageTitle icon={<Share2 />} title="Network" sub="Extra ports for query, voice chat, dynmap, RCON, web panels… Players can use the domain or the server IP with the same port." />
      <div className={cardCls}>
        <div className="space-y-2">
          {row({ port: data.primary.port }, true)}
          {data.extra.map(p => row(p, false))}
        </div>
        {data.runtimeType === "local" && <p className="text-xs text-amber-400 mt-3">Local runtime: the port is reserved for this server, but your app must bind to it itself.</p>}
      </div>

      <div className={cardCls + " mt-4"}>
        <h3 className="font-semibold text-foreground mb-3">Add a port <span className="text-xs text-muted-foreground font-normal">({data.extra.length}/{data.max})</span></h3>
        <div className="grid sm:grid-cols-[1fr_130px_1fr_auto] gap-2">
          <input className={monoCls} type="number" min={1024} max={65535} placeholder="e.g. 25566" value={port} onChange={e => setPort(e.target.value)} />
          <select className={inputCls} value={protocol} onChange={e => setProtocol(e.target.value)}>
            <option value="both">TCP + UDP</option><option value="tcp">TCP</option><option value="udp">UDP</option>
          </select>
          <input className={inputCls} placeholder="Label (e.g. Voice chat)" maxLength={40} value={label} onChange={e => setLabel(e.target.value)} />
          <button className={btnPrimary} disabled={busy || !port} onClick={add}><Plus size={16} /> Add</button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">Ports 1024–65535. The server must be stopped (the container is rebuilt to publish the port). Remember to open the port in your firewall.</p>
        <Msg m={msg} />
      </div>
    </div>
  );
}
