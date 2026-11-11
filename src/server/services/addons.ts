import axios from "axios";
import fs from "fs-extra";
import path from "path";
import crypto from "crypto";
import AdmZip from "adm-zip";

/**
 * Verse Panel — addon installer service.
 * Lives in its own file (instead of servers.ts) so upstream merges stay conflict-free.
 *
 * Covers: version listing (Modrinth / Hangar / Spigot), safe jar download,
 * and Modrinth (.mrpack) modpack installation with a background job tracker.
 */

const UA = "VersePanel/2.0 (https://github.com/kidscartoonverse-dotcom/Verse-Panel)";
const api = axios.create({ timeout: 20000, headers: { "User-Agent": UA, Accept: "application/json" } });

export type AddonKind = "plugin" | "mod";
export type AddonSource = "modrinth" | "spigot" | "hangar";

export interface AddonVersion {
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

/* ------------------------------------------------------------------ */
/* Server software -> addon kind / loaders                             */
/* ------------------------------------------------------------------ */

const LOADER_MAP: Record<string, { kind: AddonKind; loaders: string[]; hangar?: string }> = {
  PAPER: { kind: "plugin", loaders: ["paper", "spigot", "bukkit"], hangar: "PAPER" },
  PURPUR: { kind: "plugin", loaders: ["purpur", "paper", "spigot", "bukkit"], hangar: "PAPER" },
  SPIGOT: { kind: "plugin", loaders: ["spigot", "bukkit"], hangar: "PAPER" },
  FOLIA: { kind: "plugin", loaders: ["folia"], hangar: "PAPER" },
  VELOCITY: { kind: "plugin", loaders: ["velocity"], hangar: "VELOCITY" },
  BUNGEECORD: { kind: "plugin", loaders: ["bungeecord", "waterfall"], hangar: "WATERFALL" },
  WATERFALL: { kind: "plugin", loaders: ["waterfall", "bungeecord"], hangar: "WATERFALL" },
  FABRIC: { kind: "mod", loaders: ["fabric"] },
  QUILT: { kind: "mod", loaders: ["quilt", "fabric"] },
  FORGE: { kind: "mod", loaders: ["forge"] },
  NEOFORGE: { kind: "mod", loaders: ["neoforge"] }
};

export const MOD_LOADER_TYPES = ["FABRIC", "QUILT", "FORGE", "NEOFORGE"];

export function addonProfile(server: any) {
  const type = String(server?.type || "").toUpperCase();
  const entry = LOADER_MAP[type];
  const v = String(server?.version || "");
  const mcVersion = /^\d+\.\d+(\.\d+)?$/.test(v) ? v : undefined;
  return {
    type,
    kind: entry?.kind ?? null,
    loaders: entry?.loaders ?? [],
    hangarPlatform: entry?.hangar ?? "PAPER",
    mcVersion
  };
}

/* ------------------------------------------------------------------ */
/* Validation + safety helpers                                         */
/* ------------------------------------------------------------------ */

export const isSafeId = (s: any) => typeof s === "string" && /^[A-Za-z0-9_.\-]{1,80}$/.test(s);
export const isSafeVersionId = (s: any) => typeof s === "string" && /^[A-Za-z0-9_.\-+() ]{1,100}$/.test(s);
export const isSafeHangarId = (s: any) =>
  typeof s === "string" && /^[A-Za-z0-9_.\-]{1,60}\/[A-Za-z0-9_.\-]{1,60}$/.test(s);

const ADDON_HOSTS = [
  "cdn.modrinth.com",
  "hangarcdn.papermc.io",
  "hangar.papermc.io",
  "api.spiget.org",
  "cdn.spiget.org",
  "spigotmc.org",
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "raw.githubusercontent.com"
];

// Hosts allowed by the Modrinth modpack (.mrpack) specification.
const MODPACK_HOSTS = ["cdn.modrinth.com", "github.com", "raw.githubusercontent.com", "gitlab.com"];

const hostAllowed = (url: string, hosts: string[]) => {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return hosts.some(h => u.hostname === h || u.hostname.endsWith("." + h));
  } catch {
    return false;
  }
};

const isPrivateHost = (host: string) =>
  /^(localhost|127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?fe80:|\[?fc|\[?fd)/i.test(host);

export const safeJarName = (name: string, fallback: string) => {
  let n = path.basename(String(name || fallback)).replace(/[^A-Za-z0-9._+\-() ]/g, "_").replace(/\s+/g, "_");
  if (!n.toLowerCase().endsWith(".jar")) n += ".jar";
  return n.slice(0, 120);
};

/** Download `url` to `dest` (atomic via .part file), optionally verifying sha512 / sha1. */
export async function downloadToFile(
  url: string,
  dest: string,
  opts: { maxBytes?: number; sha512?: string; sha1?: string } = {}
): Promise<void> {
  const maxBytes = opts.maxBytes ?? 512 * 1024 * 1024;
  const tmp = `${dest}.part-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await fs.ensureDir(path.dirname(dest));

  const res = await axios({
    url,
    method: "GET",
    responseType: "stream",
    timeout: 60000,
    maxRedirects: 5,
    headers: { "User-Agent": UA },
    beforeRedirect: (o: any) => {
      if (isPrivateHost(String(o.hostname || ""))) throw new Error("Blocked redirect to private address");
    }
  });

  const h512 = crypto.createHash("sha512");
  const h1 = crypto.createHash("sha1");
  let size = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      const w = fs.createWriteStream(tmp);
      res.data.on("data", (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) {
          res.data.destroy(new Error("File is too large"));
          return;
        }
        h512.update(c);
        h1.update(c);
      });
      res.data.on("error", reject);
      w.on("error", reject);
      w.on("finish", () => resolve());
      res.data.pipe(w);
    });

    if (opts.sha512 && h512.digest("hex").toLowerCase() !== opts.sha512.toLowerCase()) {
      throw new Error("Checksum (sha512) mismatch — download is corrupted");
    }
    if (!opts.sha512 && opts.sha1 && h1.digest("hex").toLowerCase() !== opts.sha1.toLowerCase()) {
      throw new Error("Checksum (sha1) mismatch — download is corrupted");
    }
    await fs.move(tmp, dest, { overwrite: true });
  } catch (e) {
    await fs.remove(tmp).catch(() => {});
    throw e;
  }
}

/** Jars are zip files — reject HTML error pages that were saved as .jar */
async function assertZipMagic(file: string) {
  const fd = await fs.open(file, "r");
  try {
    const buf = Buffer.alloc(2);
    await fs.read(fd, buf, 0, 2, 0);
    if (buf[0] !== 0x50 || buf[1] !== 0x4b) {
      await fs.remove(file).catch(() => {});
      throw new Error("Downloaded file is not a valid .jar (the source returned a web page instead)");
    }
  } finally {
    await fs.close(fd);
  }
}

/* ------------------------------------------------------------------ */
/* Version listing                                                     */
/* ------------------------------------------------------------------ */

const typeRank = (t: string) => (t === "release" ? 0 : t === "beta" ? 1 : 2);

const sortVersions = (list: AddonVersion[]) =>
  list.sort((a, b) => {
    if (a.compatible !== b.compatible) return a.compatible ? -1 : 1;
    if (a.versionType !== b.versionType) return typeRank(a.versionType) - typeRank(b.versionType);
    return new Date(b.datePublished).getTime() - new Date(a.datePublished).getTime();
  });

export async function listModrinthVersions(projectId: string, loaders: string[], mcVersion?: string): Promise<AddonVersion[]> {
  const res = await api.get(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version`);
  const list: any[] = Array.isArray(res.data) ? res.data : [];
  const out: AddonVersion[] = [];
  for (const v of list) {
    const files: any[] = v.files || [];
    const file = files.find(f => f.primary) || files[0];
    if (!file) continue;
    const loaderOk = !loaders.length || (v.loaders || []).some((l: string) => loaders.includes(l));
    const verOk = !mcVersion || (v.game_versions || []).includes(mcVersion);
    out.push({
      id: v.id,
      name: v.name || v.version_number,
      versionNumber: v.version_number,
      versionType: (v.version_type as any) || "release",
      gameVersions: v.game_versions || [],
      loaders: v.loaders || [],
      datePublished: v.date_published,
      filename: file.filename,
      size: file.size || 0,
      compatible: loaderOk && verOk
    });
  }
  return sortVersions(out);
}

const hangarCompat = (deps: string[] | undefined, mc?: string) => {
  if (!mc) return true;
  if (!deps || !deps.length) return true;
  const [maj, min] = mc.split(".");
  return deps.some(d => d === mc || d === `${maj}.${min}` || d === `${maj}.${min}.x` || d === `${maj}.x`);
};

export async function listHangarVersions(projectId: string, platform: string, mcVersion?: string): Promise<AddonVersion[]> {
  const [owner, slug] = projectId.split("/");
  const res = await api.get(`https://hangar.papermc.io/api/v1/projects/${owner}/${slug}/versions`, {
    params: { limit: 30, offset: 0 }
  });
  const list: any[] = res.data?.result || [];
  const out: AddonVersion[] = [];
  for (const v of list) {
    const dl = v.downloads?.[platform] || Object.values(v.downloads || {})[0];
    if (!dl) continue;
    const deps: string[] | undefined = v.platformDependencies?.[platform];
    const ch = String(v.channel?.name || "Release").toLowerCase();
    out.push({
      id: v.name,
      name: v.name,
      versionNumber: v.name,
      versionType: ch.includes("snapshot") || ch.includes("alpha") ? "alpha" : ch.includes("beta") ? "beta" : "release",
      gameVersions: deps || [],
      loaders: [platform.toLowerCase()],
      datePublished: v.createdAt,
      filename: (dl as any).fileInfo?.name || `${slug}-${v.name}.jar`,
      size: (dl as any).fileInfo?.sizeBytes || 0,
      compatible: hangarCompat(deps, mcVersion),
      note: (dl as any).externalUrl && !(dl as any).downloadUrl ? "external-download" : undefined
    });
  }
  return sortVersions(out);
}

export async function listSpigetVersions(resourceId: string): Promise<{ versions: AddonVersion[]; blocked?: string }> {
  const info = await api.get(`https://api.spiget.org/v2/resources/${resourceId}`);
  const r = info.data || {};
  if (r.premium) return { versions: [], blocked: "Premium resource — buy & upload it manually via File Manager." };
  if (r.file?.type === "external") {
    return { versions: [], blocked: "Is plugin ka download external site pe hai (SpigotMC se direct install nahi ho sakta)." };
  }
  const res = await api.get(`https://api.spiget.org/v2/resources/${resourceId}/versions`, {
    params: { size: 30, sort: "-releaseDate" }
  });
  const list: any[] = Array.isArray(res.data) ? res.data : [];
  const base = String(r.name || `spigot-${resourceId}`);
  const versions = list.map(v => ({
    id: String(v.id),
    name: String(v.name || v.id),
    versionNumber: String(v.name || v.id),
    versionType: "release" as const,
    gameVersions: (r.testedVersions || []) as string[],
    loaders: ["spigot"],
    datePublished: v.releaseDate ? new Date(v.releaseDate * 1000).toISOString() : "",
    filename: safeJarName(`${base}-${v.name || v.id}`, `spigot-${resourceId}.jar`),
    size: 0,
    compatible: true,
    note: "compat-unknown"
  }));
  return { versions: sortVersions(versions) };
}

/* ------------------------------------------------------------------ */
/* Single addon install                                                */
/* ------------------------------------------------------------------ */

const resolveGithubRelease = async (extUrl: string): Promise<{ url: string; filename: string } | null> => {
  const tag = extUrl.match(/github\.com\/([^/]+)\/([^/]+)\/releases\/tag\/([^/?#]+)/);
  const latest = extUrl.match(/github\.com\/([^/]+)\/([^/]+)\/releases\/latest/);
  const apiUrl = tag
    ? `https://api.github.com/repos/${tag[1]}/${tag[2]}/releases/tags/${tag[3]}`
    : latest
    ? `https://api.github.com/repos/${latest[1]}/${latest[2]}/releases/latest`
    : null;
  if (!apiUrl) return null;
  try {
    const r = await api.get(apiUrl);
    const asset = (r.data?.assets || []).find((a: any) => String(a.name).endsWith(".jar"));
    return asset ? { url: asset.browser_download_url, filename: asset.name } : null;
  } catch {
    return null;
  }
};

export async function installAddon(opts: {
  serverDir: string;
  kind: AddonKind;
  source: AddonSource;
  projectId: string;
  versionId: string;
  projectName?: string;
  hangarPlatform?: string;
}): Promise<{ filename: string }> {
  const { serverDir, kind, source, projectId, versionId } = opts;
  const targetDir = path.join(serverDir, kind === "plugin" ? "plugins" : "mods");
  await fs.ensureDir(targetDir);

  let url = "";
  let filename = "";
  const fallbackName = `${(opts.projectName || projectId).replace(/[^A-Za-z0-9]/g, "_")}.jar`;

  if (source === "modrinth") {
    const r = await api.get(`https://api.modrinth.com/v2/version/${encodeURIComponent(versionId)}`);
    const v = r.data;
    if (!v || (v.project_id && v.project_id !== projectId)) throw new Error("Version does not belong to this project");
    const file = (v.files || []).find((f: any) => f.primary) || (v.files || [])[0];
    if (!file) throw new Error("This version has no downloadable file");
    url = file.url;
    filename = file.filename;
  } else if (source === "hangar") {
    const platform = opts.hangarPlatform || "PAPER";
    const [owner, slug] = projectId.split("/");
    const r = await api.get(`https://hangar.papermc.io/api/v1/projects/${owner}/${slug}/versions/${encodeURIComponent(versionId)}`);
    const dl = r.data?.downloads?.[platform] || Object.values(r.data?.downloads || {})[0];
    if (!dl) throw new Error("No download found for this version");
    if ((dl as any).downloadUrl) {
      url = (dl as any).downloadUrl;
      filename = (dl as any).fileInfo?.name || "";
    } else if ((dl as any).externalUrl) {
      const gh = await resolveGithubRelease((dl as any).externalUrl);
      if (!gh) throw new Error("Is version ka download external site pe hai: " + (dl as any).externalUrl);
      url = gh.url;
      filename = gh.filename;
    }
  } else if (source === "spigot") {
    url = `https://api.spiget.org/v2/resources/${projectId}/versions/${encodeURIComponent(versionId)}/download`;
    filename = "";
  } else {
    throw new Error("Unknown source");
  }

  if (!url || !hostAllowed(url, ADDON_HOSTS)) throw new Error("Download source is not allowed");

  const finalName = safeJarName(filename, fallbackName);
  const dest = path.join(targetDir, finalName);
  if (!path.resolve(dest).startsWith(path.resolve(targetDir) + path.sep)) throw new Error("Invalid file name");

  await downloadToFile(url, dest, { maxBytes: 256 * 1024 * 1024 });
  await assertZipMagic(dest);
  return { filename: finalName };
}

/* ------------------------------------------------------------------ */
/* Modpack (.mrpack) installer + job tracker                           */
/* ------------------------------------------------------------------ */

export interface ModpackJob {
  id: string;
  serverId: string;
  status: "running" | "done" | "error";
  step: string;
  done: number;
  total: number;
  error?: string;
  result?: any;
  startedAt: number;
}

const jobs = new Map<string, ModpackJob>();

export function createJob(serverId: string): ModpackJob {
  const now = Date.now();
  for (const [k, j] of jobs) if (now - j.startedAt > 60 * 60 * 1000) jobs.delete(k);
  const job: ModpackJob = {
    id: crypto.randomBytes(8).toString("hex"),
    serverId,
    status: "running",
    step: "Starting",
    done: 0,
    total: 0,
    startedAt: now
  };
  jobs.set(job.id, job);
  return job;
}

export const getJob = (id: string) => jobs.get(id);
export const hasRunningJob = (serverId: string) =>
  [...jobs.values()].some(j => j.serverId === serverId && j.status === "running");

/** Reads the loader/MC requirements from a Modrinth version object (before downloading anything). */
export function modpackRequirements(v: any) {
  const loaders: string[] = v?.loaders || [];
  const loader = ["neoforge", "forge", "quilt", "fabric"].find(l => loaders.includes(l)) || null;
  return { loader, mcVersion: (v?.game_versions || [])[0] as string | undefined };
}

export async function installMrpack(
  serverDir: string,
  mrpackPath: string,
  update: (p: Partial<ModpackJob>) => void
) {
  const zip = new AdmZip(mrpackPath);
  const idxEntry = zip.getEntry("modrinth.index.json");
  if (!idxEntry) throw new Error("Invalid .mrpack: modrinth.index.json missing");
  const index = JSON.parse(idxEntry.getData().toString("utf-8"));
  if (index.game && index.game !== "minecraft") throw new Error("Only Minecraft modpacks are supported");

  const deps = index.dependencies || {};
  const mcVersion: string | undefined = deps.minecraft;
  const loaderKeys: Array<[string, string]> = [
    ["fabric-loader", "fabric"],
    ["quilt-loader", "quilt"],
    ["neoforge", "neoforge"],
    ["forge", "forge"]
  ];
  let loader: string | null = null;
  let loaderVersion: string | null = null;
  for (const [key, name] of loaderKeys) {
    if (deps[key]) {
      loader = name;
      loaderVersion = String(deps[key]);
      break;
    }
  }
  if (!mcVersion || !loader) throw new Error("Modpack needs Minecraft + a supported loader (Fabric/Quilt/Forge/NeoForge)");

  const root = path.resolve(serverDir);
  const files: any[] = (index.files || []).filter((f: any) => f?.env?.server !== "unsupported");

  const plan = files.map(f => {
    const rel = path.posix.normalize(String(f.path || "").replace(/\\/g, "/"));
    if (!rel || rel.startsWith("/") || rel === ".." || rel.startsWith("../") || /^[A-Za-z]:/.test(rel)) {
      throw new Error(`Unsafe file path inside modpack: ${f.path}`);
    }
    const dest = path.resolve(root, rel);
    if (!dest.startsWith(root + path.sep)) throw new Error(`Unsafe file path inside modpack: ${f.path}`);
    return { f, dest };
  });

  update({ step: "Downloading mods", total: plan.length, done: 0 });

  let next = 0;
  let done = 0;
  let failed: Error | null = null;
  const worker = async () => {
    while (!failed) {
      const i = next++;
      if (i >= plan.length) return;
      const { f, dest } = plan[i];
      let ok = false;
      let lastErr: any = null;
      for (const url of f.downloads || []) {
        if (!hostAllowed(url, MODPACK_HOSTS)) {
          lastErr = new Error("Blocked download host");
          continue;
        }
        try {
          await downloadToFile(url, dest, {
            sha512: f.hashes?.sha512,
            sha1: f.hashes?.sha1,
            maxBytes: 1024 * 1024 * 1024
          });
          ok = true;
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (!ok) {
        failed = new Error(`Failed to download ${path.basename(dest)}: ${lastErr?.message || "unknown error"}`);
        return;
      }
      done++;
      update({ done });
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, Math.max(1, plan.length)) }, worker));
  if (failed) throw failed;

  update({ step: "Applying configs & overrides" });
  const entries = zip.getEntries();
  for (const prefix of ["overrides/", "server-overrides/"]) {
    for (const e of entries) {
      if (e.isDirectory || !e.entryName.startsWith(prefix)) continue;
      const rel = path.posix.normalize(e.entryName.slice(prefix.length));
      if (!rel || rel === ".." || rel.startsWith("../") || rel.startsWith("/")) continue;
      const dest = path.resolve(root, rel);
      if (!dest.startsWith(root + path.sep)) continue;
      await fs.ensureDir(path.dirname(dest));
      await fs.writeFile(dest, e.getData());
    }
  }

  return {
    name: String(index.name || "Modpack"),
    mcVersion,
    loader,
    loaderVersion,
    fileCount: plan.length
  };
}
