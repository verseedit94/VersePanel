import crypto from "crypto";
import { readJSON, writeJSON } from "./db.js";
import { decryptSecret, encryptSecret } from "./crypto.js";

/**
 * Verse Panel — database host (MySQL / MariaDB) used to give every server its own databases.
 * The admin account's password is stored encrypted in settings.json and is never sent to the browser.
 */
export interface DbHostConfig {
  host: string;
  port: number;
  adminUser: string;
  adminPasswordEnc: string;
  publicHost: string; // host shown to users (defaults to the panel domain / host)
  maxPerServer: number;
}

export interface DatabaseRecord {
  id: string;
  serverId: string;
  name: string;
  username: string;
  passwordEnc: string;
  createdAt: string;
}

const DB_FILE = "databases.json";
const NAME_RE = /^[a-z0-9_]{1,64}$/;

export async function getDbConfig(): Promise<DbHostConfig | null> {
  const s = (await readJSON("settings.json")) || {};
  const c = s.dbHost;
  if (!c || !c.host || !c.adminUser || !c.adminPasswordEnc) return null;
  return { host: c.host, port: Number(c.port) || 3306, adminUser: c.adminUser, adminPasswordEnc: c.adminPasswordEnc, publicHost: c.publicHost || "", maxPerServer: Number(c.maxPerServer) || 2 };
}

export async function saveDbConfig(input: { host?: string; port?: number; adminUser?: string; adminPassword?: string; publicHost?: string; maxPerServer?: number }) {
  const s = (await readJSON("settings.json")) || {};
  const cur = s.dbHost || {};
  const next = { ...cur };
  if (input.host !== undefined) next.host = String(input.host).trim().slice(0, 253);
  if (input.port !== undefined) next.port = Number(input.port) || 3306;
  if (input.adminUser !== undefined) next.adminUser = String(input.adminUser).trim().slice(0, 80);
  if (input.adminPassword) next.adminPasswordEnc = encryptSecret(input.adminPassword);
  if (input.publicHost !== undefined) next.publicHost = String(input.publicHost).trim().slice(0, 253);
  if (input.maxPerServer !== undefined) next.maxPerServer = Math.min(Math.max(Number(input.maxPerServer) || 2, 0), 50);
  s.dbHost = next;
  await writeJSON("settings.json", s);
}

export const readDatabases = async (): Promise<DatabaseRecord[]> => (await readJSON(DB_FILE)) || [];
export const writeDatabases = (all: DatabaseRecord[]) => writeJSON(DB_FILE, all);

export const randomPassword = (len = 24) => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, b => chars[b % chars.length]).join("");
};

export function shortId(serverId: string) {
  return serverId.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase();
}

async function connect(cfg: DbHostConfig) {
  const mysql: any = await import("mysql2/promise");
  return mysql.createConnection({
    host: cfg.host, port: cfg.port, user: cfg.adminUser, password: decryptSecret(cfg.adminPasswordEnc),
    connectTimeout: 8000, multipleStatements: false
  });
}

export async function testConnection(cfg: DbHostConfig): Promise<string> {
  const conn = await connect(cfg);
  try {
    const [rows]: any = await conn.query("SELECT VERSION() AS v");
    return String(rows?.[0]?.v || "connected");
  } finally { await conn.end().catch(() => {}); }
}

const escapeLike = (name: string) => name.replace(/_/g, "\\_"); // `_` is a wildcard in GRANT patterns

export async function createDatabaseAndUser(name: string, username: string, password: string) {
  if (!NAME_RE.test(name) || !NAME_RE.test(username)) throw new Error("invalid identifier");
  const cfg = await getDbConfig();
  if (!cfg) throw new Error("Database host is not configured");
  const conn = await connect(cfg);
  try {
    await conn.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    try {
      await conn.query("CREATE USER ?@'%' IDENTIFIED BY ?", [username, password]);
      await conn.query(`GRANT ALL PRIVILEGES ON \`${escapeLike(name)}\`.* TO ?@'%'`, [username]);
      await conn.query("FLUSH PRIVILEGES");
    } catch (e) {
      await conn.query(`DROP DATABASE IF EXISTS \`${name}\``).catch(() => {});
      await conn.query("DROP USER IF EXISTS ?@'%'", [username]).catch(() => {});
      throw e;
    }
  } finally { await conn.end().catch(() => {}); }
}

export async function setUserPassword(username: string, password: string) {
  if (!NAME_RE.test(username)) throw new Error("invalid identifier");
  const cfg = await getDbConfig();
  if (!cfg) throw new Error("Database host is not configured");
  const conn = await connect(cfg);
  try {
    await conn.query("ALTER USER ?@'%' IDENTIFIED BY ?", [username, password]);
    await conn.query("FLUSH PRIVILEGES");
  } finally { await conn.end().catch(() => {}); }
}

export async function dropDatabaseAndUser(name: string, username: string) {
  if (!NAME_RE.test(name) || !NAME_RE.test(username)) throw new Error("invalid identifier");
  const cfg = await getDbConfig();
  if (!cfg) throw new Error("Database host is not configured");
  const conn = await connect(cfg);
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${name}\``);
    await conn.query("DROP USER IF EXISTS ?@'%'", [username]);
    await conn.query("FLUSH PRIVILEGES");
  } finally { await conn.end().catch(() => {}); }
}

/** Called when a server is deleted: drop its databases on the host (best effort) and forget the records. */
export async function purgeServerDatabases(serverId: string) {
  const all = await readDatabases();
  const mine = all.filter(d => d.serverId === serverId);
  if (!mine.length) return;
  for (const d of mine) await dropDatabaseAndUser(d.name, d.username).catch(e => console.warn("[db] purge failed:", e?.message));
  await writeDatabases(all.filter(d => d.serverId !== serverId));
}
