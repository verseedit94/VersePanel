import React, { useState, useEffect, useRef } from "react";
import { Server, Settings, Plus, X, ServerCrash, CheckCircle2, ShieldAlert, Cpu, HardDrive, Network, Activity, Clock, Trash2, Pencil, RefreshCw, Copy, Terminal, Wifi, WifiOff, Cloud } from "lucide-react";
import axios from "axios";
import { useDashboardData } from "../hooks/useDashboardData";
import { cardCls, inputCls, monoCls, btnPrimary, btnGhost, btnDanger, errText, Msg } from "../components/PanelBits";
import NodeTunnelModal from "../components/NodeTunnelModal";

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatUptime(seconds: number) {
  if (!seconds) return '0m';
  const d = Math.floor(seconds / (3600*24));
  const h = Math.floor(seconds % (3600*24) / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function LocalNodeDashboard({ node }: { node: any }) {
  const { stats, state } = useDashboardData();
  
  const loading = state === "loading" && !stats;
  const isOnline = stats ? true : false;
  
  const cpuPercent = stats?.cpuUsage ?? 0;
  const cpuCores = stats?.cores ?? 0;
  
  const ramTotal = stats?.totalMemory ?? (node.memory * 1024 * 1024);
  const ramFree = stats?.freeMemory ?? 0;
  const ramUsed = ramTotal - ramFree;
  const ramPercent = stats?.ramUsage ?? 0;
  
  const diskTotal = stats?.diskTotal ?? (node.disk * 1024 * 1024);
  const diskUsed = stats?.diskUsed ?? 0;
  const diskPercent = stats?.diskUsage ?? 0;
  
  const netIn = stats?.netIn ?? 0;
  const netOut = stats?.netOut ?? 0;
  
  const uptime = stats?.uptime ? formatUptime(stats.uptime) : "N/A";
  const statusStr = loading ? "STARTING" : isOnline ? "ONLINE" : "OFFLINE";
  const statusColor = loading ? "text-yellow-500 bg-yellow-500/10 border-yellow-500/20" : isOnline ? "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" : "text-red-500 bg-red-500/10 border-red-500/20";
  const dotColor = loading ? "bg-yellow-500" : isOnline ? "bg-emerald-500" : "bg-red-500";

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm col-span-full mb-8 overflow-hidden relative">
      <div className="absolute inset-0 bg-gradient-to-br from-theme-600/5 to-transparent pointer-events-none" />
      <div className="p-6 md:p-8 relative z-10">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
          <div className="flex items-center gap-4">
             <div className="p-3 bg-theme-500/10 rounded-xl text-theme-500 border border-theme-500/20 shadow-[0_0_15px_rgba(var(--theme-rgb-500),0.1)]">
               <Activity className="h-6 w-6" />
             </div>
             <div>
               <h3 className="text-xl font-bold">{node.name}</h3>
               <p className="text-sm text-muted-foreground">{node.hostname || "localhost"} — Core System Node</p>
             </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex flex-col md:items-end">
              <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-widest font-bold">Node Status</div>
              <span className={`flex items-center px-3 py-1.5 rounded-full text-xs font-bold border ${statusColor}`}>
                <span className={`w-2 h-2 rounded-full mr-2 ${dotColor} ${isOnline ? 'animate-[pulseOrb_2s_ease-in-out_infinite] shadow-[0_0_8px_currentColor]' : ''}`}></span>
                {statusStr}
              </span>
            </div>
            <div className="flex flex-col md:items-end">
              <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-widest font-bold">Uptime</div>
              <div className="flex items-center text-xs font-bold bg-background px-3 py-1.5 rounded-full border border-border shadow-sm">
                <Clock className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
                {uptime}
              </div>
            </div>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          {/* CPU */}
          <div className="bg-background/80 backdrop-blur-sm rounded-xl p-5 border border-border flex flex-col justify-between shadow-sm">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center text-xs font-bold text-muted-foreground tracking-widest uppercase">
                  <Cpu className="w-4 h-4 mr-2 text-theme-500" /> CPU
                </div>
                <span className="text-sm font-black text-foreground">{cpuPercent}%</span>
              </div>
              <div className="w-full bg-border rounded-full h-2 mb-4 overflow-hidden relative">
                <div className="absolute inset-y-0 left-0 bg-theme-500 rounded-full transition-all duration-700 ease-out shadow-[0_0_10px_rgba(var(--theme-rgb-500),0.5)]" style={{ width: `${Math.min(cpuPercent, 100)}%` }}></div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground flex justify-between font-medium">
              <span>{cpuCores} Cores</span>
              <span>{cpuPercent}% Used</span>
            </div>
          </div>

          {/* RAM */}
          <div className="bg-background/80 backdrop-blur-sm rounded-xl p-5 border border-border flex flex-col justify-between shadow-sm">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center text-xs font-bold text-muted-foreground tracking-widest uppercase">
                  <Activity className="w-4 h-4 mr-2 text-theme-500" /> MEMORY
                </div>
                <span className="text-sm font-black text-foreground">{ramPercent}%</span>
              </div>
              <div className="w-full bg-border rounded-full h-2 mb-4 overflow-hidden relative">
                <div className="absolute inset-y-0 left-0 bg-theme-500 rounded-full transition-all duration-700 ease-out shadow-[0_0_10px_rgba(var(--theme-rgb-500),0.5)]" style={{ width: `${Math.min(ramPercent, 100)}%` }}></div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground flex justify-between font-medium">
              <span>{formatBytes(ramUsed)}</span>
              <span>{formatBytes(ramTotal)}</span>
            </div>
          </div>

          {/* DISK */}
          <div className="bg-background/80 backdrop-blur-sm rounded-xl p-5 border border-border flex flex-col justify-between shadow-sm">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center text-xs font-bold text-muted-foreground tracking-widest uppercase">
                  <HardDrive className="w-4 h-4 mr-2 text-theme-500" /> DISK
                </div>
                <span className="text-sm font-black text-foreground">{diskPercent}%</span>
              </div>
              <div className="w-full bg-border rounded-full h-2 mb-4 overflow-hidden relative">
                <div className="absolute inset-y-0 left-0 bg-theme-500 rounded-full transition-all duration-700 ease-out shadow-[0_0_10px_rgba(var(--theme-rgb-500),0.5)]" style={{ width: `${Math.min(diskPercent, 100)}%` }}></div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground flex justify-between font-medium">
              <span>{formatBytes(diskUsed)}</span>
              <span>{formatBytes(diskTotal)}</span>
            </div>
          </div>

          {/* NETWORK */}
          <div className="bg-background/80 backdrop-blur-sm rounded-xl p-5 border border-border flex flex-col justify-between shadow-sm">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center text-xs font-bold text-muted-foreground tracking-widest uppercase">
                  <Network className="w-4 h-4 mr-2 text-theme-500" /> NETWORK
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2 mt-auto">
               <div className="flex justify-between items-center bg-card rounded-md p-2 border border-border/50 text-xs font-medium">
                  <span className="text-muted-foreground flex items-center"><span className="text-blue-500 mr-1.5 font-bold">↓</span> Inbound</span>
                  <span className="font-mono text-foreground">{formatBytes(netIn)}</span>
               </div>
               <div className="flex justify-between items-center bg-card rounded-md p-2 border border-border/50 text-xs font-medium">
                  <span className="text-muted-foreground flex items-center"><span className="text-emerald-500 mr-1.5 font-bold">↑</span> Outbound</span>
                  <span className="font-mono text-foreground">{formatBytes(netOut)}</span>
               </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


function NodeCard({ node, onEdit, onDelete, onTunnel }: any) {
  const info = node.info;
  const online = node.status === "online";
  const limit = node.memoryLimitGB || 0;
  const pct = limit ? Math.min(100, Math.round((node.allocatedGB / limit) * 100)) : 0;
  const full = limit > 0 && node.allocatedGB >= limit;
  return (
    <div className={cardCls + " flex flex-col gap-4"}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-theme-500/10 rounded-lg text-theme-500"><Server className="h-5 w-5" /></div>
          <div className="min-w-0">
            <h3 className="font-semibold truncate">{node.name}</h3>
            <p className="text-xs text-muted-foreground font-mono truncate">{node.ssl ? "https" : "http"}://{node.fqdn}:{node.port}</p>
          </div>
        </div>
        <span className={`shrink-0 flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${online ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-red-500/10 text-red-500 border-red-500/20"}`}>
          {online ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />} {online ? "Online" : "Offline"}
        </span>
      </div>

      {!online && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2.5">{node.error || "Cannot reach the node"}</div>}

      <div>
        <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
          <span>RAM allocated to servers</span>
          <span className={full ? "text-amber-400 font-medium" : ""}>{node.allocatedGB} / {limit || "∞"} GB{full ? " · FULL" : ""}</span>
        </div>
        <div className="h-2 rounded-full bg-background border border-border overflow-hidden">
          <div className={`h-full ${full ? "bg-amber-500" : "bg-theme-600"}`} style={{ width: `${limit ? pct : 0}%` }} />
        </div>
      </div>

      {info && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-background rounded-lg p-2.5 border border-border"><div className="text-muted-foreground">CPU</div><div className="font-medium">{info.cpus} cores · load {Number(info.load1).toFixed(2)}</div></div>
          <div className="bg-background rounded-lg p-2.5 border border-border"><div className="text-muted-foreground">RAM free</div><div className="font-medium">{info.memFreeGB} / {info.memTotalGB} GB</div></div>
          <div className="bg-background rounded-lg p-2.5 border border-border"><div className="text-muted-foreground">Disk free</div><div className="font-medium">{info.diskFreeGB} / {info.diskTotalGB} GB</div></div>
          <div className="bg-background rounded-lg p-2.5 border border-border"><div className="text-muted-foreground">Docker</div><div className={`font-medium ${info.docker ? "text-emerald-500" : "text-red-400"}`}>{info.docker ? "running" : "not running"}</div></div>
        </div>
      )}
      <div className="text-xs text-muted-foreground flex justify-between items-center">
        <span>{node.servers} server{node.servers === 1 ? "" : "s"}{info?.version ? ` · v${info.version}` : ""}</span>
        <div className="flex flex-wrap justify-end gap-2">
          <button className={btnGhost + " !px-2.5 !py-1.5"} onClick={() => onTunnel(node, "playit")}><Network size={13} /> {node.provider === "playit" ? "playit ✓" : "playit"}</button>
          <button className={btnGhost + " !px-2.5 !py-1.5"} onClick={() => onTunnel(node, "cloudflare")}><Cloud size={13} /> {node.provider === "cloudflare" ? "Cloudflare ✓" : "Cloudflare"}</button>
          <button className={btnGhost + " !px-2.5 !py-1.5"} onClick={() => onEdit(node)}><Pencil size={13} /> Edit</button>
          <button className={btnDanger + " !px-2.5 !py-1.5"} onClick={() => onDelete(node)}><Trash2 size={13} /></button>
        </div>
      </div>
    </div>
  );
}


function PendingCard({ node, onRegenerate, onCancel }: any) {
  return (
    <div className={cardCls + " flex flex-col gap-3 border-dashed"}>
      <div className="flex items-center gap-3">
        <div className="p-2 bg-amber-500/10 rounded-lg text-amber-500"><Server className="h-5 w-5" /></div>
        <div className="min-w-0">
          <h3 className="font-semibold truncate">{node.name}</h3>
          <p className="text-xs text-amber-400">{node.expired ? "Command expired — create a new one" : "Waiting for the VPS to run the command…"}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <button className={btnGhost + " !px-3 !py-1.5 flex-1"} onClick={() => onRegenerate(node)}><Terminal size={13} /> Show command</button>
        <button className={btnDanger + " !px-3 !py-1.5"} onClick={() => onCancel(node)}><Trash2 size={13} /></button>
      </div>
    </div>
  );
}

export default function Nodes() {
  const [nodes, setNodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tunnelNode, setTunnelNode] = useState<any>(null);
  const [modal, setModal] = useState<null | "add" | "command" | "edit" | "done">(null);
  const [vpsName, setVpsName] = useState("");
  const [domain, setDomain] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [panelUrl, setPanelUrl] = useState("");
  const [cmd, setCmd] = useState<{ id: string; name: string; command: string; expiresAt: number; warning?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({ name: "", fqdn: "", port: 6870, ssl: false, memoryLimitGB: "" });
  const [msg, setMsg] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const cmdId = useRef<string | null>(null);

  const fetchNodes = async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await axios.get("/api/nodes");
      setNodes(res.data);
      setError("");
      // the VPS ran the command and registered itself
      if (cmdId.current) {
        const n = res.data.find((x: any) => x.id === cmdId.current);
        if (n && !n.pending) { cmdId.current = null; setModal("done"); }
      }
    } catch (err: any) {
      setError(errText(err, "Failed to load nodes"));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetchNodes(); const t = setInterval(() => fetchNodes(true), cmdId.current ? 3000 : 20000); return () => clearInterval(t); }, [modal]);

  const openAdd = () => {
    setModal("add"); setVpsName(""); setDomain(""); setAdvanced(false); setMsg(null); setCmd(null); cmdId.current = null;
    setPanelUrl(window.location.origin);
  };

  const create = async () => {
    setBusy(true); setMsg(null);
    try {
      const { data } = await axios.post("/api/nodes/add-vps", { name: vpsName, domain: domain.trim() || undefined, panelUrl });
      setCmd(data); cmdId.current = data.id; setModal("command"); fetchNodes(true);
    } catch (e) { setMsg({ ok: false, text: errText(e, "Could not create the command") }); } finally { setBusy(false); }
  };

  const showCommand = async (n: any) => {
    setMsg(null);
    try {
      const { data } = await axios.post(`/api/nodes/${n.id}/regenerate`);
      setCmd(data); cmdId.current = data.id; setModal("command");
    } catch (e) { setError(errText(e)); }
  };

  const copy = async () => {
    if (!cmd) return;
    try { await navigator.clipboard.writeText(cmd.command); } catch {
      const ta = document.createElement("textarea"); ta.value = cmd.command; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
    }
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };

  const closeModal = () => { setModal(null); cmdId.current = null; fetchNodes(true); };

  const openEdit = (n: any) => {
    setEditing(n); setModal("edit"); setMsg(null);
    setForm({ name: n.name, fqdn: n.fqdn, port: n.port, ssl: n.ssl, memoryLimitGB: n.memoryLimitGB || "" });
  };
  const submitEdit = async () => {
    setBusy(true); setMsg(null);
    try {
      await axios.put(`/api/nodes/${editing.id}`, { name: form.name, fqdn: form.fqdn, port: Number(form.port), ssl: form.ssl, memoryLimitGB: form.memoryLimitGB === "" ? 0 : Number(form.memoryLimitGB) });
      setModal(null); fetchNodes();
    } catch (e) { setMsg({ ok: false, text: errText(e) }); } finally { setBusy(false); }
  };

  const del = async (n: any) => {
    if (!confirm(n.pending ? `Cancel adding "${n.name}"?` : `Remove node "${n.name}" from the panel? (The VPS itself is not touched.)`)) return;
    try { await axios.delete(`/api/nodes/${n.id}`); fetchNodes(); }
    catch (e) { setError(errText(e)); }
  };

  const agents = nodes.filter(n => n.kind === "agent");
  const legacy = nodes.filter(n => n.kind === "legacy");
  const local = nodes.find(n => n.isLocal);
  const label = "mb-1 block text-sm font-medium text-muted-foreground";

  return (
    <div className="p-4 md:p-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Nodes</h1>
          <p className="mt-2 text-muted-foreground">Run servers on more than one VPS. When one is full, create the next server on another.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => fetchNodes()} className={btnGhost}><RefreshCw size={16} /> Refresh</button>
          <button onClick={openAdd} className={btnPrimary}><Plus className="h-5 w-5" /> Add VPS</button>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg bg-red-500/10 border border-red-500/20 p-4 text-red-500 flex items-center">
          <ShieldAlert className="w-5 h-5 mr-2 shrink-0" /> {error}
        </div>
      )}

      {loading ? <div className="text-center py-10">Loading...</div> : (
        <>
          {local && <LocalNodeDashboard node={local} />}

          <h2 className="text-lg font-semibold mb-3">VPS nodes</h2>
          {agents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center border border-dashed border-border rounded-xl">
              <ServerCrash className="h-10 w-10 text-muted-foreground mb-3" />
              <h3 className="text-base font-medium">No other VPS added yet</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">Click <b>Add VPS</b>, give it a name, and run the command you get on the other VPS.</p>
            </div>
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {agents.map(n => n.pending
                ? <PendingCard key={n.id} node={n} onRegenerate={showCommand} onCancel={del} />
                : <NodeCard key={n.id} node={n} onEdit={openEdit} onDelete={del} onTunnel={(x: any, tab: string) => setTunnelNode({ ...x, _tab: tab })} />)}
            </div>
          )}

          {legacy.length > 0 && (
            <div className="mt-8">
              <h2 className="text-lg font-semibold mb-1">Old Docker-API nodes</h2>
              <p className="text-xs text-muted-foreground mb-3">Console and file manager do not work on these. Add the VPS with <b>Add VPS</b> instead and recreate the servers there.</p>
              <div className="space-y-2">
                {legacy.map(n => (
                  <div key={n.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border bg-card text-sm">
                    <span>{n.name} <span className="text-muted-foreground font-mono text-xs">{n.hostname || n.ip}</span></span>
                    <button className={btnDanger + " !px-2"} onClick={() => del(n)}><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border p-5">
              <h2 className="text-xl font-bold">
                {modal === "add" ? "Add VPS" : modal === "command" ? `Connect “${cmd?.name}”` : modal === "done" ? "VPS connected" : `Edit ${editing?.name}`}
              </h2>
              <button onClick={closeModal} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
            </div>

            <div className="p-5 space-y-4">
              {modal === "add" && (
                <>
                  <div>
                    <label className={label}>VPS name</label>
                    <input autoFocus className={inputCls} placeholder="e.g. Mumbai VPS 1" maxLength={60} value={vpsName}
                      onChange={e => setVpsName(e.target.value)} onKeyDown={e => e.key === "Enter" && vpsName.trim() && !busy && create()} />
                    <p className="text-xs text-muted-foreground mt-1">Anything you like — it is only a label.</p>
                  </div>
                  <button className="text-xs text-theme-500 underline" onClick={() => setAdvanced(!advanced)}>{advanced ? "Hide" : "Show"} advanced options</button>
                  {advanced && (
                    <div className="space-y-3 rounded-xl border border-border bg-background p-3">
                      <div>
                        <label className={label}>Panel address the new VPS will use</label>
                        <input className={monoCls} value={panelUrl} onChange={e => setPanelUrl(e.target.value)} />
                        <p className="text-xs text-muted-foreground mt-1">Must be reachable from the other VPS (public IP or domain, not localhost).</p>
                      </div>
                      <div>
                        <label className={label}>Domain for this VPS (optional, enables HTTPS)</label>
                        <input className={monoCls} placeholder="node1.example.com" value={domain} onChange={e => setDomain(e.target.value)} />
                        <p className="text-xs text-muted-foreground mt-1">Point its A record to the new VPS first.</p>
                      </div>
                    </div>
                  )}
                  <Msg m={msg} />
                  <button className={btnPrimary + " w-full"} disabled={busy || !vpsName.trim()} onClick={create}>{busy ? "Creating…" : "Create command"}</button>
                </>
              )}

              {modal === "command" && cmd && (
                <>
                  <p className="text-sm text-muted-foreground">Run this on the VPS you want to add (as root or with sudo). It installs everything and connects itself to this panel.</p>
                  <div className="relative">
                    <pre className="rounded-xl bg-black/50 border border-border p-3 pr-12 text-xs font-mono whitespace-pre-wrap break-all select-all">{cmd.command}</pre>
                    <button onClick={copy} className="absolute top-2 right-2 p-2 rounded-lg bg-card border border-border hover:bg-white/10" title="Copy">
                      {copied ? <CheckCircle2 size={15} className="text-emerald-500" /> : <Copy size={15} />}
                    </button>
                  </div>
                  {cmd.warning && <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">{cmd.warning}</div>}
                  <div className="flex items-center gap-3 rounded-xl border border-border bg-background p-3 text-sm">
                    <RefreshCw size={16} className="animate-spin text-theme-500 shrink-0" />
                    <span>Waiting for the VPS… this window updates by itself (usually 2–5 minutes).</span>
                  </div>
                  <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-1">
                    <li>Works on Ubuntu / Debian / CentOS / Rocky / Alma (needs systemd).</li>
                    <li>The link works for 1 hour. You can close this window — the VPS shows up in the list when done.</li>
                    <li>Open the node's port (6870) in its firewall / cloud security group.</li>
                  </ul>
                </>
              )}

              {modal === "done" && (
                <div className="text-center py-4">
                  <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto mb-3" />
                  <p className="font-medium">The VPS is connected.</p>
                  <p className="text-sm text-muted-foreground mt-1">You can now pick it as the node when you create a server.</p>
                  <button className={btnPrimary + " mt-5"} onClick={closeModal}>Done</button>
                </div>
              )}

              {modal === "edit" && (
                <>
                  <div><label className={label}>Name</label><input className={inputCls} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                  <div className="grid grid-cols-[1fr_110px] gap-3">
                    <div><label className={label}>Domain or IP</label><input className={monoCls} value={form.fqdn} onChange={e => setForm({ ...form, fqdn: e.target.value })} /></div>
                    <div><label className={label}>Port</label><input type="number" className={monoCls} value={form.port} onChange={e => setForm({ ...form, port: e.target.value })} /></div>
                  </div>
                  <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={form.ssl} onChange={e => setForm({ ...form, ssl: e.target.checked })} /> Uses HTTPS</label>
                  <div><label className={label}>RAM limit for servers (GB, 0 = no limit)</label><input type="number" min={0} className={monoCls} value={form.memoryLimitGB} onChange={e => setForm({ ...form, memoryLimitGB: e.target.value })} /></div>
                  <Msg m={msg} />
                  <div className="flex gap-2 pt-1">
                    <button className={btnPrimary + " flex-1"} disabled={busy} onClick={submitEdit}>{busy ? "Saving…" : "Save"}</button>
                    <button className={btnGhost} onClick={closeModal}>Cancel</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {tunnelNode && <NodeTunnelModal initialTab={tunnelNode._tab} node={nodes.find((x: any) => x.id === tunnelNode.id) || tunnelNode} onClose={() => setTunnelNode(null)} onChanged={() => fetchNodes(true)} />}
    </div>
  );
}
