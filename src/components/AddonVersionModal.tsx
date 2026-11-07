import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { X, Download, RefreshCw, AlertCircle, CheckCircle2, AlertTriangle } from "lucide-react";

interface AddonVersion {
  id: string;
  name: string;
  versionNumber: string;
  versionType: "release" | "beta" | "alpha";
  gameVersions: string[];
  loaders: string[];
  datePublished: string;
  filename: string;
  size: number;
  compatible: boolean;
  note?: string;
}

interface Props {
  serverId: string;
  source: "modrinth" | "spigot" | "hangar";
  projectId: string;
  projectName: string;
  kindLabel: "plugin" | "mod";
  onClose: () => void;
  onInstalled?: (message: string) => void;
}

const typeStyle: Record<string, string> = {
  release: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  beta: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  alpha: "bg-rose-500/15 text-rose-400 border-rose-500/30"
};

const fmtSize = (b: number) => (b > 0 ? `${(b / (1024 * 1024)).toFixed(b > 10 * 1024 * 1024 ? 0 : 1)} MB` : "");
const fmtDate = (d: string) => {
  const t = new Date(d);
  return isNaN(t.getTime()) ? "" : t.toLocaleDateString();
};

export default function AddonVersionModal({ serverId, source, projectId, projectName, kindLabel, onClose, onInstalled }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [versions, setVersions] = useState<AddonVersion[]>([]);
  const [serverInfo, setServerInfo] = useState<{ type: string; version: string }>({ type: "", version: "" });
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await axios.get(`/api/servers/${serverId}/addons/versions`, { params: { source, projectId } });
        if (cancelled) return;
        const list: AddonVersion[] = res.data.versions || [];
        setVersions(list);
        setBlocked(res.data.blocked || null);
        setServerInfo({ type: res.data.serverType || "", version: res.data.serverVersion || "" });
        if (list.length && list[0].compatible) setSelected(list[0].id);
        else if (list.length) setShowAll(true);
      } catch (e: any) {
        if (!cancelled) setError(e.response?.data?.error || "Could not load versions.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverId, source, projectId]);

  const compatibleCount = useMemo(() => versions.filter(v => v.compatible).length, [versions]);
  const visible = showAll ? versions : versions.filter(v => v.compatible);

  const install = async () => {
    if (!selected) return;
    try {
      setInstalling(true);
      setError(null);
      const res = await axios.post(`/api/servers/${serverId}/addons/install`, {
        source,
        projectId,
        versionId: selected,
        projectName
      });
      const msg = res.data.message || `${projectName} installed. Restart the server to apply.`;
      setDone(msg);
      onInstalled?.(msg);
      setTimeout(onClose, 1400);
    } catch (e: any) {
      setError(e.response?.data?.error || "Install failed.");
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={installing ? undefined : onClose}>
      <div
        className="bg-card border border-border rounded-2xl overflow-hidden w-full max-w-xl shadow-2xl flex flex-col max-h-[88vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border-subtle flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-foreground truncate">Install {projectName}</h3>
            <p className="text-[11px] font-bold text-theme-500/80 uppercase tracking-widest mt-0.5">
              Choose a {kindLabel} version
              {serverInfo.type && ` · Your server: ${serverInfo.type} ${serverInfo.version}`}
            </p>
          </div>
          <button onClick={onClose} disabled={installing} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar min-h-[140px]">
          {loading ? (
            <div className="p-10 text-center text-muted-foreground flex flex-col items-center">
              <RefreshCw className="w-6 h-6 animate-spin mb-3 text-theme-600/50" /> Loading versions...
            </div>
          ) : blocked ? (
            <div className="p-6 text-sm text-amber-400 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" /> {blocked}
            </div>
          ) : versions.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground flex flex-col items-center">
              <AlertCircle className="w-8 h-8 mb-3" /> No downloadable versions found.
            </div>
          ) : (
            <>
              {compatibleCount === 0 && (
                <div className="m-4 mb-0 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs">
                  No version is marked compatible with {serverInfo.type} {serverInfo.version}. You can still pick one, but it may not load.
                </div>
              )}
              <div className="divide-y divide-border-subtle">
                {visible.map(v => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setSelected(v.id)}
                    className={`w-full text-left p-3.5 px-4 flex items-start gap-3 transition-colors ${
                      selected === v.id ? "bg-theme-600/10" : "hover:bg-muted-subtle"
                    }`}
                  >
                    <span
                      className={`mt-1 w-4 h-4 rounded-full border-2 shrink-0 ${
                        selected === v.id ? "border-theme-500 bg-theme-500" : "border-border"
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground-muted truncate">{v.versionNumber}</span>
                        <span className={`px-1.5 py-0.5 rounded border text-[10px] uppercase font-bold tracking-wider ${typeStyle[v.versionType] || typeStyle.release}`}>
                          {v.versionType}
                        </span>
                        {v.compatible ? (
                          <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> {v.note === "compat-unknown" ? "compatibility unknown" : "compatible"}
                          </span>
                        ) : (
                          <span className="text-[10px] text-amber-400 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> may not work
                          </span>
                        )}
                      </span>
                      {v.name && v.name !== v.versionNumber && <span className="block text-xs text-muted-foreground truncate mt-0.5">{v.name}</span>}
                      <span className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        {v.gameVersions.slice(0, 5).map(g => (
                          <span key={g} className="px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground font-mono">
                            {g}
                          </span>
                        ))}
                        {v.gameVersions.length > 5 && <span className="text-[10px] text-muted-foreground">+{v.gameVersions.length - 5}</span>}
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {[fmtDate(v.datePublished), fmtSize(v.size)].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {error && <div className="mx-4 mt-3 p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400 text-xs">{error}</div>}
        {done && <div className="mx-4 mt-3 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs">{done}</div>}

        <div className="p-4 border-t border-border-subtle flex flex-col-reverse sm:flex-row sm:items-center gap-3 sm:justify-between">
          {versions.length > 0 && !blocked ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
              <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
              Show all versions ({versions.length - compatibleCount} incompatible)
            </label>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={installing}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-muted hover:bg-muted-hover text-foreground transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={install}
              disabled={!selected || installing || !!done || !!blocked}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-theme-600 hover:bg-theme-700 text-foreground transition-colors flex items-center disabled:opacity-50"
            >
              {installing ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Installing...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" /> Install selected
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
