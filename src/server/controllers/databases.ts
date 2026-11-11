import { Request, Response } from "express";
import crypto from "crypto";
import { loadServerForRequest } from "../services/access.js";
import { getPanelDomain } from "../services/domain.js";
import { decryptSecret, encryptSecret } from "../services/crypto.js";
import {
  createDatabaseAndUser, dropDatabaseAndUser, getDbConfig, randomPassword, readDatabases,
  setUserPassword, shortId, writeDatabases
} from "../services/dbhost.js";

const view = async (d: any, cfg: any) => {
  const dom = await getPanelDomain();
  return {
    id: d.id, name: d.name, username: d.username, password: decryptSecret(d.passwordEnc),
    host: cfg.publicHost || dom?.domain || cfg.host, port: cfg.port, createdAt: d.createdAt,
    connection: `mysql://${d.username}@${cfg.publicHost || dom?.domain || cfg.host}:${cfg.port}/${d.name}`
  };
};

export const listDatabases = async (req: Request, res: Response) => {
  const server = await loadServerForRequest(req, res);
  if (!server) return;
  const cfg = await getDbConfig();
  if (!cfg) return res.json({ configured: false, databases: [], limit: 0 });
  const mine = (await readDatabases()).filter(d => d.serverId === server.id);
  res.json({ configured: true, limit: server.databaseLimit ?? cfg.maxPerServer, databases: await Promise.all(mine.map(d => view(d, cfg))) });
};

export const createDatabase = async (req: Request, res: Response) => {
  const server = await loadServerForRequest(req, res);
  if (!server) return;
  const cfg = await getDbConfig();
  if (!cfg) return res.status(400).json({ error: "No database host is configured. Ask an administrator to set one up in Admin Settings." });

  const label = String(req.body?.label ?? "").trim().toLowerCase();
  if (label && !/^[a-z0-9_]{1,24}$/.test(label)) return res.status(400).json({ error: "Name may only contain a-z, 0-9 and _ (max 24)" });

  const all = await readDatabases();
  const mine = all.filter(d => d.serverId === server.id);
  const limit = server.databaseLimit ?? cfg.maxPerServer;
  if (mine.length >= limit) return res.status(400).json({ error: `Database limit reached (${limit})` });

  const sid = shortId(server.id);
  const suffix = label || crypto.randomBytes(3).toString("hex");
  const name = `s${sid}_${suffix}`;
  const username = `u${sid}_${crypto.randomBytes(3).toString("hex")}`;
  if (all.some(d => d.name === name)) return res.status(409).json({ error: "You already have a database with that name" });

  const password = randomPassword();
  try {
    await createDatabaseAndUser(name, username, password);
  } catch (e: any) {
    console.error("[db] create failed:", e?.message);
    return res.status(502).json({ error: "The database host refused the request: " + (e?.sqlMessage || e?.message || "unknown error") });
  }
  const rec = { id: crypto.randomBytes(5).toString("hex"), serverId: server.id, name, username, passwordEnc: encryptSecret(password), createdAt: new Date().toISOString() };
  all.push(rec);
  await writeDatabases(all);
  res.status(201).json({ database: await view(rec, cfg) });
};

export const rotateDatabasePassword = async (req: Request, res: Response) => {
  const server = await loadServerForRequest(req, res);
  if (!server) return;
  const cfg = await getDbConfig();
  if (!cfg) return res.status(400).json({ error: "No database host is configured" });
  const all = await readDatabases();
  const rec = all.find(d => d.id === req.params.dbId && d.serverId === server.id);
  if (!rec) return res.status(404).json({ error: "Database not found" });
  const password = randomPassword();
  try { await setUserPassword(rec.username, password); }
  catch (e: any) { return res.status(502).json({ error: "The database host refused the request: " + (e?.sqlMessage || e?.message) }); }
  rec.passwordEnc = encryptSecret(password);
  await writeDatabases(all);
  res.json({ database: await view(rec, cfg) });
};

export const deleteDatabase = async (req: Request, res: Response) => {
  const server = await loadServerForRequest(req, res);
  if (!server) return;
  const all = await readDatabases();
  const rec = all.find(d => d.id === req.params.dbId && d.serverId === server.id);
  if (!rec) return res.status(404).json({ error: "Database not found" });
  try { await dropDatabaseAndUser(rec.name, rec.username); }
  catch (e: any) { return res.status(502).json({ error: "Could not delete on the database host: " + (e?.sqlMessage || e?.message) }); }
  await writeDatabases(all.filter(d => d.id !== rec.id));
  res.json({ success: true });
};
