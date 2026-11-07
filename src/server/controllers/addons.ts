import { Request, Response } from "express";
import axios from "axios";
import fs from "fs-extra";
import path from "path";
import { readJSON, writeJSON } from "../services/db.js";
import {
  createServerRuntime,
  deleteServerRuntime,
  getServerRuntimeStatus
} from "../services/runtime.js";
import {
  addonProfile,
  createJob,
  downloadToFile,
  getJob,
  hasRunningJob,
  installAddon,
  installMrpack,
  isSafeHangarId,
  isSafeId,
  isSafeVersionId,
  listHangarVersions,
  listModrinthVersions,
  listSpigetVersions,
  modpackRequirements,
  ModpackJob
} from "../services/addons.js";

const serverDirOf = (id: string) => path.join(process.cwd(), ".data", "servers", id);

const NON_MINECRAFT = ["NODEJS", "NODE", "PYTHON", "PYTHON3"];
const PROXIES = ["VELOCITY", "BUNGEECORD", "WATERFALL"];

/** Loads the server and checks the caller may manage it. Sends the error response itself. */
async function loadServer(req: Request, res: Response): Promise<any | null> {
  const { id } = req.params;
  const user = (req as any).user;
  const servers = (await readJSON("servers.json")) || [];
  const server = servers.find((s: any) => s.id === id);
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return null;
  }
  if (user && user.role !== "admin" && user.role !== "owner" && server.owner !== user.id) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return server;
}

/* ------------------------------------------------------------------ */
/* GET /:id/addons/versions?source=&projectId=                         */
/* ------------------------------------------------------------------ */
export const getAddonVersions = async (req: Request, res: Response) => {
  try {
    const server = await loadServer(req, res);
    if (!server) return;

    const profile = addonProfile(server);
    if (!profile.kind) {
      return res.status(400).json({ error: `${server.type} servers do not support plugins or mods.` });
    }

    const source = String(req.query.source || "modrinth");
    const projectId = String(req.query.projectId || "");

    if (profile.kind === "mod" && source !== "modrinth") {
      return res.status(400).json({ error: "Mods can only be installed from Modrinth." });
    }

    let versions: any[] = [];
    let blocked: string | undefined;

    if (source === "modrinth") {
      if (!isSafeId(projectId)) return res.status(400).json({ error: "Invalid project" });
      versions = await listModrinthVersions(projectId, profile.loaders, profile.mcVersion);
    } else if (source === "hangar") {
      if (!isSafeHangarId(projectId)) return res.status(400).json({ error: "Invalid project" });
      versions = await listHangarVersions(projectId, profile.hangarPlatform, profile.mcVersion);
    } else if (source === "spigot") {
      if (!/^\d{1,9}$/.test(projectId)) return res.status(400).json({ error: "Invalid project" });
      const r = await listSpigetVersions(projectId);
      versions = r.versions;
      blocked = r.blocked;
    } else {
      return res.status(400).json({ error: "Unknown source" });
    }

    res.json({
      kind: profile.kind,
      serverType: profile.type,
      serverVersion: profile.mcVersion || String(server.version || ""),
      versions,
      blocked
    });
  } catch (e: any) {
    console.error("[addons] version list failed:", e?.message);
    res.status(502).json({ error: "Could not fetch versions: " + (e?.message || "unknown error") });
  }
};

/* ------------------------------------------------------------------ */
/* POST /:id/addons/install  { source, projectId, versionId, name }    */
/* ------------------------------------------------------------------ */
export const installAddonVersion = async (req: Request, res: Response) => {
  try {
    const server = await loadServer(req, res);
    if (!server) return;

    const profile = addonProfile(server);
    if (!profile.kind) {
      return res.status(400).json({ error: `${server.type} servers do not support plugins or mods.` });
    }

    const { source, projectId, versionId, projectName } = req.body || {};
    if (!["modrinth", "hangar", "spigot"].includes(source)) return res.status(400).json({ error: "Unknown source" });
    if (profile.kind === "mod" && source !== "modrinth") {
      return res.status(400).json({ error: "Mods can only be installed from Modrinth." });
    }
    const idOk = source === "hangar" ? isSafeHangarId(projectId) : isSafeId(String(projectId || ""));
    if (!idOk || !isSafeVersionId(versionId)) {
      return res.status(400).json({ error: "Invalid project or version" });
    }

    const { filename } = await installAddon({
      serverDir: serverDirOf(server.id),
      kind: profile.kind,
      source,
      projectId: String(projectId),
      versionId: String(versionId),
      projectName: projectName ? String(projectName).slice(0, 80) : undefined,
      hangarPlatform: profile.hangarPlatform
    });

    res.json({
      success: true,
      filename,
      message: `${filename} installed in /${profile.kind === "plugin" ? "plugins" : "mods"}. Restart the server to apply.`
    });
  } catch (e: any) {
    console.error("[addons] install failed:", e?.message);
    res.status(500).json({ error: "Install failed: " + (e?.message || "unknown error") });
  }
};

/* ------------------------------------------------------------------ */
/* POST /:id/modpacks/install  { projectId, versionId, wipe }          */
/* ------------------------------------------------------------------ */
export const startModpackInstall = async (req: Request, res: Response) => {
  try {
    const server = await loadServer(req, res);
    if (!server) return;

    const type = String(server.type || "").toUpperCase();
    if (NON_MINECRAFT.includes(type) || PROXIES.includes(type)) {
      return res.status(400).json({ error: "Modpacks can only be installed on Minecraft game servers." });
    }

    const { projectId, versionId, wipe } = req.body || {};
    if (!isSafeId(projectId) || !isSafeId(versionId)) return res.status(400).json({ error: "Invalid modpack or version" });
    if (hasRunningJob(server.id)) return res.status(409).json({ error: "A modpack install is already running for this server." });

    if (server.containerId) {
      const status = await getServerRuntimeStatus(server);
      if (status?.State?.Running) {
        return res.status(400).json({ error: "Server must be stopped before installing a modpack. Please stop the server first." });
      }
    }

    // Validate against Modrinth *before* touching the server.
    let ver: any;
    try {
      const r = await axios.get(`https://api.modrinth.com/v2/version/${encodeURIComponent(versionId)}`, {
        timeout: 20000,
        headers: { "User-Agent": "VersePanel/2.0 (https://github.com/kidscartoonverse-dotcom/Verse-Panel)" }
      });
      ver = r.data;
    } catch {
      return res.status(502).json({ error: "Could not reach Modrinth. Try again in a moment." });
    }
    if (!ver || ver.project_id !== projectId) return res.status(400).json({ error: "Version does not belong to this modpack" });

    const file = (ver.files || []).find((f: any) => String(f.filename).toLowerCase().endsWith(".mrpack"));
    if (!file) return res.status(400).json({ error: "This version has no .mrpack file (CurseForge-only packs are not supported)." });
    try {
      const u = new URL(file.url);
      if (u.protocol !== "https:" || u.hostname !== "cdn.modrinth.com") throw new Error("host");
    } catch {
      return res.status(400).json({ error: "Modpack file is not hosted on Modrinth CDN." });
    }

    const needs = modpackRequirements(ver);
    if (!needs.loader) return res.status(400).json({ error: "Modpack has no supported loader (Fabric/Quilt/Forge/NeoForge)." });
    if (server.runtimeType === "local" && ["forge", "neoforge", "quilt"].includes(needs.loader)) {
      return res.status(400).json({
        error: `${needs.loader} modpacks need the Docker runtime. Local runtime supports Fabric packs only (Settings → Runtime Migration).`
      });
    }

    const job = createJob(server.id);
    res.json({ jobId: job.id });

    runModpackJob(job, server.id, projectId, ver, file, !!wipe).catch(() => {});
  } catch (e: any) {
    console.error("[modpack] start failed:", e?.message);
    res.status(500).json({ error: e?.message || "Failed to start modpack install" });
  }
};

async function runModpackJob(job: ModpackJob, serverId: string, projectId: string, ver: any, file: any, wipe: boolean) {
  const serverDir = serverDirOf(serverId);
  const mrpack = path.join(serverDir, `.modpack-${job.id}.mrpack`);
  const set = (p: Partial<ModpackJob>) => Object.assign(job, p);

  try {
    await fs.ensureDir(serverDir);
    set({ step: "Downloading modpack file" });
    await downloadToFile(file.url, mrpack, {
      sha512: file.hashes?.sha512,
      sha1: file.hashes?.sha1,
      maxBytes: 1024 * 1024 * 1024
    });

    if (wipe) {
      set({ step: "Cleaning old mods & configs" });
      for (const d of ["mods", "config", "defaultconfigs", "kubejs"]) {
        await fs.remove(path.join(serverDir, d)).catch(() => {});
      }
    }

    const result = await installMrpack(serverDir, mrpack, set);

    set({ step: "Configuring server software" });
    const servers = (await readJSON("servers.json")) || [];
    const server = servers.find((s: any) => s.id === serverId);
    if (!server) throw new Error("Server no longer exists");

    server.type = result.loader.toUpperCase();
    server.version = result.mcVersion;
    server.loaderVersion = result.loaderVersion;
    server.modpack = { name: result.name, projectId, versionId: ver.id, versionNumber: ver.version_number };

    if (server.runtimeType === "local") {
      await fs.remove(path.join(serverDir, "server.jar")).catch(() => {});
    }
    if (server.containerId) {
      await deleteServerRuntime(server).catch(() => {});
    }
    server.containerId = await createServerRuntime(server);
    await writeJSON("servers.json", servers);

    set({ status: "done", step: "Done", result });
  } catch (e: any) {
    console.error("[modpack] install failed:", e?.message);
    set({ status: "error", step: "Failed", error: e?.message || String(e) });
  } finally {
    await fs.remove(mrpack).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* GET /:id/modpacks/jobs/:jobId                                       */
/* ------------------------------------------------------------------ */
export const getModpackJob = async (req: Request, res: Response) => {
  const server = await loadServer(req, res);
  if (!server) return;
  const job = getJob(req.params.jobId);
  if (!job || job.serverId !== server.id) return res.status(404).json({ error: "Job not found" });
  res.json({
    status: job.status,
    step: job.step,
    done: job.done,
    total: job.total,
    error: job.error,
    result: job.result
  });
};
