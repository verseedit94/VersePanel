import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { Search, Download, RefreshCw, AlertCircle, Package, X, CheckCircle2, AlertTriangle } from "lucide-react";

interface Pack {
  id: string;
  name: string;
  tag: string;
  downloads: number;
  icon: string | null;
  loaders: string[];
}

interface PackVersion {
  id: string;
  name: string;
  version_number: string;
  version_type: string;
  game_versions: string[];
  loaders: string[];
  date_published: string;
  files: { filename: string }[];
}

interface JobState {
  status: "running" | "done" | "error";
  step: string;
  done: number;
  total: number;
  error?: string;
  result?: { name: string; mcVersion: string; loader: string; loaderVersion: string; fileCount: number };
}

const LOADERS = ["neoforge", "forge", "fabric", "quilt"];

export default function ModpackManager({ serverId }: { serverId: string }) {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [loaderFilter, setLoaderFilter] = useState<string>("all");

  const [pick, setPick] = useState<Pack | null>(null);
  const [versions, setVersions] = useState<PackVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [wipe, setWipe] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const [job, setJob] = useState<JobState | null>(null);
  const [jobName, setJobName] = useState("");
  const pollRef = useRef<any>(null);

  const external = () => {
    const x = axios.create();
    delete x.defaults.headers.common["Authorization"];
    return x;
  };

  const search = async (q: string = "") => {
    try {
      setLoading(true);
      const facets: string[][] = [['project_type:modpack']];
      if (loaderFilter !== "all") facets.push([`categories:${loaderFilter}`]);
      const res = await external().get("https://api.modrinth.com/v2/search", {
        params: { query: q.trim(), facets: JSON.stringify(facets), limit: 20, index: q.trim() ? "relevance" : "downloads" }
      });
      setPacks(
        (res.data.hits || []).map((h: any) => ({
          id: h.project_id,
          name: h.title,
          tag: h.description,
          downloads: h.downloads,
          icon: h.icon_url,
          loaders: (h.categories || []).filter((c: string) => LOADERS.includes(c))
        }))
      );
    } catch {
      setPacks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    search(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaderFilter]);

  useEffect(() => () => clearInterval(pollRef.current), []);

  const openPack = async (p: Pack) => {
    setPick(p);
    setVersions([]);
    setSelected(null);
    setFormError(null);
    setVersionsLoading(true);
    try {
      const res = await external().get(`https://api.modrinth.com/v2/project/${p.id}/version`);
      const list: PackVersion[] = (res.data || []).filter((v: PackVersion) =>
        (v.files || []).some(f => f.filename.toLowerCase().endsWith(".mrpack"))
      );
      setVersions(list);
      if (list.length) setSelected(list[0].id);
    } catch {
      setFormError("Could not load versions from Modrinth.");
    } finally {
      setVersionsLoading(false);
    }
  };

  const startInstall = async () => {
    if (!pick || !selected) return;
    setFormError(null);
    try {
      const res = await axios.post(`/api/servers/${serverId}/modpacks/install`, {
        projectId: pick.id,
        versionId: selected,
        wipe
      });
      setJobName(pick.name);
      setPick(null);
      setJob({ status: "running", step: "Starting", done: 0, total: 0 });
      clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const r = await axios.get(`/api/servers/${serverId}/modpacks/jobs/${res.data.jobId}`);
          setJob(r.data);
          if (r.data.status !== "running") clearInterval(pollRef.current);
        } catch {
          clearInterval(pollRef.current);
          setJob({ status: "error", step: "Failed", done: 0, total: 0, error: "Lost connection to the panel while installing." });
        }
      }, 1500);
    } catch (e: any) {
      setFormError(e.response?.data?.error || "Failed to start install.");
    }
  };

  const pct = job && job.total > 0 ? Math.round((job.done / job.total) * 100) : 0;

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-8 text-foreground bg-transparent">
      <div className="max-w-4xl mx-auto space-y-6 md:space-y-8">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-foreground mb-1 flex items-center">
            <Package className="w-6 h-6 mr-2 text-theme-500" /> Modpack Installer
          </h2>
          <p className="text-[11px] font-bold text-theme-500/80 uppercase tracking-widest mt-1">
            Pick a Modrinth modpack and version — mods, configs and the right loader are set up automatically.
          </p>
        </div>

        {job && (
          <div
            className={`p-4 rounded-2xl border ${
              job.status === "error"
                ? "bg-rose-500/10 border-rose-500/30 text-rose-400"
                : job.status === "done"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : "bg-theme-600/10 border-theme-600/30 text-foreground"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium text-sm flex items-center gap-2 min-w-0">
                {job.status === "running" && <RefreshCw className="w-4 h-4 animate-spin shrink-0" />}
                {job.status === "done" && <CheckCircle2 className="w-4 h-4 shrink-0" />}
                {job.status === "error" && <AlertTriangle className="w-4 h-4 shrink-0" />}
                <span className="truncate">
                  {job.status === "done" ? `${jobName} installed` : job.status === "error" ? `${jobName} failed` : `Installing ${jobName}`}
                </span>
              </div>
              {job.status !== "running" && (
                <button onClick={() => setJob(null)} className="text-xs opacity-70 hover:opacity-100">
                  Dismiss
                </button>
              )}
            </div>
            {job.status === "running" && (
              <>
                <p className="text-xs text-muted-foreground mt-2">
                  {job.step}
                  {job.total > 0 && ` — ${job.done}/${job.total} files`}
                </p>
                <div className="h-2 rounded-full bg-muted mt-2 overflow-hidden">
                  <div className="h-full bg-theme-500 transition-all duration-500" style={{ width: `${job.total > 0 ? pct : 5}%` }} />
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">Large packs can take several minutes — keep this page open.</p>
              </>
            )}
            {job.status === "done" && job.result && (
              <p className="text-xs mt-2">
                {job.result.fileCount} files installed · Minecraft {job.result.mcVersion} · {job.result.loader} {job.result.loaderVersion}. Server software was
                switched automatically — start the server to finish setup (first start downloads the loader).
              </p>
            )}
            {job.status === "error" && <p className="text-xs mt-2">{job.error}</p>}
          </div>
        )}

        <div className="bg-black/40 backdrop-blur-xl border border-border rounded-3xl overflow-hidden ring-1 ring-border-subtle">
          <div className="p-4 border-b border-border-subtle space-y-4">
            <form
              onSubmit={e => {
                e.preventDefault();
                search(query);
              }}
              className="flex flex-col sm:flex-row gap-2"
            >
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search modpacks (e.g. Fabulously Optimized, All the Mods...)"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  className="w-full bg-muted-subtle border border-border rounded-lg py-2 pl-9 pr-4 text-sm text-foreground placeholder-zinc-500 focus:outline-none focus:border-theme-600 transition-colors"
                />
              </div>
              <button type="submit" className="px-4 py-2 bg-theme-600 hover:bg-theme-700 text-foreground rounded-lg text-sm font-medium transition-colors shrink-0">
                Search
              </button>
            </form>
            <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1">
              {["all", ...LOADERS].map(l => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLoaderFilter(l)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize whitespace-nowrap transition-colors ${
                    loaderFilter === l ? "bg-theme-600 text-foreground" : "bg-muted text-muted-foreground hover:bg-muted-hover hover:text-foreground"
                  }`}
                >
                  {l === "all" ? "All loaders" : l}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-border-subtle">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground flex flex-col items-center">
                <RefreshCw className="w-6 h-6 animate-spin mb-3 text-theme-600/50" /> Searching Modrinth...
              </div>
            ) : packs.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground flex flex-col items-center">
                <AlertCircle className="w-8 h-8 mb-3" /> No modpacks found.
              </div>
            ) : (
              packs.map(p => (
                <div key={p.id} className="p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 hover:bg-muted-subtle transition-colors">
                  <div className="flex items-start gap-4 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0 overflow-hidden border border-border-subtle">
                      {p.icon ? <img src={p.icon} alt={p.name} className="w-full h-full object-cover" /> : <Package className="w-5 h-5 text-muted-foreground" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-medium text-foreground-muted truncate">{p.name}</h4>
                        {p.loaders.map(l => (
                          <span key={l} className="px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider bg-muted text-muted-foreground">
                            {l}
                          </span>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{p.tag}</p>
                      {p.downloads > 0 && (
                        <span className="flex items-center gap-1 mt-2 text-[11px] text-muted-foreground">
                          <Download className="w-3.5 h-3.5" /> {p.downloads.toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => openPack(p)}
                    disabled={job?.status === "running"}
                    className="w-full md:w-auto px-4 py-2 bg-muted hover:bg-theme-600/10 border border-border hover:border-theme-600/30 text-foreground-muted hover:text-theme-500 rounded-lg text-sm font-medium transition-all flex items-center justify-center shrink-0 disabled:opacity-50"
                  >
                    <Download className="w-4 h-4 mr-2" /> Install
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {pick && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setPick(null)}>
          <div className="bg-card border border-border rounded-2xl overflow-hidden w-full max-w-xl shadow-2xl flex flex-col max-h-[88vh]" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-border-subtle flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-foreground truncate">Install {pick.name}</h3>
                <p className="text-[11px] font-bold text-theme-500/80 uppercase tracking-widest mt-0.5">Choose a modpack version</p>
              </div>
              <button onClick={() => setPick(null)} className="text-muted-foreground hover:text-foreground shrink-0">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar min-h-[120px]">
              {versionsLoading ? (
                <div className="p-10 text-center text-muted-foreground flex flex-col items-center">
                  <RefreshCw className="w-6 h-6 animate-spin mb-3 text-theme-600/50" /> Loading versions...
                </div>
              ) : versions.length === 0 ? (
                <div className="p-10 text-center text-muted-foreground flex flex-col items-center">
                  <AlertCircle className="w-8 h-8 mb-3" /> No installable (.mrpack) versions for this pack.
                </div>
              ) : (
                <div className="divide-y divide-border-subtle">
                  {versions.map(v => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setSelected(v.id)}
                      className={`w-full text-left p-3.5 px-4 flex items-start gap-3 transition-colors ${selected === v.id ? "bg-theme-600/10" : "hover:bg-muted-subtle"}`}
                    >
                      <span className={`mt-1 w-4 h-4 rounded-full border-2 shrink-0 ${selected === v.id ? "border-theme-500 bg-theme-500" : "border-border"}`} />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground-muted truncate">{v.version_number}</span>
                          <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] uppercase font-bold text-muted-foreground">{v.version_type}</span>
                          {v.loaders.map(l => (
                            <span key={l} className="text-[10px] uppercase text-theme-500">
                              {l}
                            </span>
                          ))}
                        </span>
                        <span className="flex flex-wrap items-center gap-1.5 mt-1.5">
                          {v.game_versions.slice(0, 4).map(g => (
                            <span key={g} className="px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground font-mono">
                              {g}
                            </span>
                          ))}
                          <span className="text-[10px] text-muted-foreground ml-auto">{new Date(v.date_published).toLocaleDateString()}</span>
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {formError && <div className="mx-4 mt-3 p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400 text-xs">{formError}</div>}

            <div className="p-4 border-t border-border-subtle space-y-3">
              <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                <input type="checkbox" className="mt-0.5" checked={wipe} onChange={e => setWipe(e.target.checked)} />
                <span>
                  Delete existing <code>mods</code>, <code>config</code> and <code>kubejs</code> first (recommended — world is never touched).
                </span>
              </label>
              <p className="text-[11px] text-amber-400">
                The server must be stopped. Its software and Minecraft version will be switched to match the pack.
              </p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setPick(null)} className="px-4 py-2 rounded-lg text-sm font-medium bg-muted hover:bg-muted-hover text-foreground transition-colors">
                  Cancel
                </button>
                <button
                  onClick={startInstall}
                  disabled={!selected}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-theme-600 hover:bg-theme-700 text-foreground transition-colors flex items-center disabled:opacity-50"
                >
                  <Download className="w-4 h-4 mr-2" /> Install modpack
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
