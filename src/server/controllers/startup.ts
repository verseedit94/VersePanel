import { Request, Response } from "express";
import { loadServerForRequest, isStaff } from "../services/access.js";
import { readJSON, writeJSON } from "../services/db.js";
import {
  BUILTIN_EGGS, Egg, builtinEggIdForType, eggForServer, eggFromPterodactyl, getEggById,
  listCustomEggs, refreshEggCache, resolvedStartupCommand, saveCustomEggs, validateVariable
} from "../services/eggs.js";
import { isServerRunning, recreateRuntime } from "../services/runtimeApply.js";

const isGenericApp = (type?: string) => ["NODEJS", "NODE", "PYTHON", "PYTHON3"].includes(String(type || "").toUpperCase());

const eggSummary = (e: Egg) => ({
  id: e.id, name: e.name, description: e.description, author: e.author, builtin: e.builtin,
  dockerImages: e.dockerImages || (e.dockerImage ? { Default: e.dockerImage } : {}), variableCount: e.variables.length
});

export const getStartup = async (req: Request, res: Response) => {
  const server = await loadServerForRequest(req, res);
  if (!server) return;
  await refreshEggCache();
  const egg = await eggForServer(server);
  const values = server.startup?.variables || {};
  const custom = await listCustomEggs();
  const ownBuiltin = BUILTIN_EGGS.find(e => e.id === builtinEggIdForType(server.type))!;
  res.json({
    egg: eggSummary(egg),
    variables: egg.variables.map(v => ({ ...v, value: values[v.env] ?? "" })),
    command: server.startup?.command || "",
    commandTemplate: egg.builtin ? "" : egg.startup,
    effectiveCommand: resolvedStartupCommand(server) || "",
    canEditCommand: isGenericApp(server.type) || !egg.builtin,
    image: server.startup?.image || "",
    runtimeType: server.runtimeType || "docker",
    running: await isServerRunning(server),
    selectableEggs: [ownBuiltin, ...custom].map(eggSummary),
    note: server.runtimeType === "local" && ownBuiltin.id.startsWith("minecraft")
      ? "Local runtime starts Java directly, so these variables only take effect on the Docker runtime."
      : ""
  });
};

export const updateStartup = async (req: Request, res: Response) => {
  const server0 = await loadServerForRequest(req, res);
  if (!server0) return;
  const body = req.body || {};

  const servers = (await readJSON("servers.json")) || [];
  const server = servers.find((s: any) => s.id === server0.id);
  if (!server) return res.status(404).json({ error: "Server not found" });

  const isDocker = server.runtimeType !== "local";
  if (isDocker && server.containerId && (await isServerRunning(server))) {
    return res.status(409).json({ error: "Stop the server first — changes need the container to be rebuilt." });
  }

  // 1. which egg
  const currentEgg = await eggForServer(server);
  let egg = currentEgg;
  if (typeof body.eggId === "string" && body.eggId && body.eggId !== currentEgg.id) {
    const wanted = await getEggById(body.eggId);
    if (!wanted) return res.status(400).json({ error: "Unknown egg" });
    if (wanted.builtin && wanted.id !== builtinEggIdForType(server.type)) {
      return res.status(400).json({ error: "That built-in egg does not match this server's software" });
    }
    if (!wanted.builtin && !isDocker) return res.status(400).json({ error: "Custom eggs need the Docker runtime" });
    egg = wanted;
  }

  // 2. variables
  const incoming: Record<string, any> = body.variables && typeof body.variables === "object" ? body.variables : {};
  const prevVars = egg.id === currentEgg.id ? server.startup?.variables || {} : {};
  const nextVars: Record<string, string> = {};
  for (const variable of egg.variables) {
    const has = Object.prototype.hasOwnProperty.call(incoming, variable.env);
    const val = has ? String(incoming[variable.env] ?? "").trim() : String(prevVars[variable.env] ?? "");
    if (has && !variable.editable) return res.status(403).json({ error: `${variable.name} is locked by the egg` });
    const err = validateVariable(variable, val);
    if (err) return res.status(400).json({ error: err });
    if (val !== "") nextVars[variable.env] = val;
  }
  for (const k of Object.keys(incoming)) {
    if (!egg.variables.some(v => v.env === k)) return res.status(400).json({ error: `Unknown variable ${k}` });
  }

  // 3. command / image
  let command = egg.id === currentEgg.id ? server.startup?.command || "" : "";
  if (body.command !== undefined) {
    command = String(body.command || "").trim();
    if (command && !(isGenericApp(server.type) || !egg.builtin)) {
      return res.status(400).json({ error: "This server type manages its own startup command" });
    }
    if (command.length > 1500 || /\0/.test(command)) return res.status(400).json({ error: "Startup command is too long or invalid" });
  }
  let image = egg.id === currentEgg.id ? server.startup?.image || "" : "";
  if (body.image !== undefined) {
    image = String(body.image || "").trim();
    if (image && !Object.values(egg.dockerImages || {}).includes(image)) return res.status(400).json({ error: "Image is not one of the egg's images" });
  }

  // 4. remember / restore the original docker settings when moving to or from a custom egg
  const prev = server.startup?.prev;
  if (!egg.builtin && currentEgg.builtin) {
    server.startup = { prev: { dockerImage: server.dockerImage || null, startupCommand: server.startupCommand || null } };
  } else if (egg.builtin && !currentEgg.builtin && prev) {
    server.dockerImage = prev.dockerImage || undefined;
    server.startupCommand = prev.startupCommand || undefined;
    server.startup = {};
  }
  server.startup = { ...(server.startup || {}), eggId: egg.id, variables: nextVars, command, image };
  if (egg.builtin && !command && !isGenericApp(server.type)) delete server.startup.command;

  await refreshEggCache();
  let recreated = false;
  try {
    recreated = await recreateRuntime(server);
  } catch (e: any) {
    return res.status(500).json({ error: "Saved, but rebuilding the container failed: " + (e?.message || e) });
  }
  if (!egg.builtin) { server.dockerImage = image || egg.dockerImage; }
  await writeJSON("servers.json", servers);
  res.json({ success: true, recreated });
};

/* -------------------------- Egg library -------------------------- */
export const listEggs = async (_req: Request, res: Response) => {
  res.json({ eggs: [...BUILTIN_EGGS, ...(await listCustomEggs())].map(eggSummary) });
};

export const importEgg = async (req: Request, res: Response) => {
  if (!isStaff((req as any).user)) return res.status(403).json({ error: "Forbidden" });
  let json = req.body?.egg ?? req.body;
  if (typeof json === "string") { try { json = JSON.parse(json); } catch { return res.status(400).json({ error: "That is not valid JSON" }); } }
  let egg: Egg;
  try { egg = eggFromPterodactyl(json); } catch (e: any) { return res.status(400).json({ error: e.message }); }
  const all = await listCustomEggs();
  if (all.length >= 100) return res.status(400).json({ error: "Egg limit reached (100)" });
  all.push(egg);
  await saveCustomEggs(all);
  await refreshEggCache();
  res.status(201).json({ egg: eggSummary(egg), note: "Install scripts in the egg are not run — upload the server files yourself after creating the server." });
};

export const deleteEgg = async (req: Request, res: Response) => {
  if (!isStaff((req as any).user)) return res.status(403).json({ error: "Forbidden" });
  const all = await listCustomEggs();
  const i = all.findIndex(e => e.id === req.params.eggId);
  if (i === -1) return res.status(404).json({ error: "Egg not found" });
  const servers = (await readJSON("servers.json")) || [];
  const using = servers.filter((s: any) => s.startup?.eggId === req.params.eggId).length;
  if (using) return res.status(409).json({ error: `${using} server(s) still use this egg` });
  all.splice(i, 1);
  await saveCustomEggs(all);
  await refreshEggCache();
  res.json({ success: true });
};
