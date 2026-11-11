import fs from "fs-extra";
import path from "path";
import crypto from "crypto";
import { NextFunction, Request, Response } from "express";

/**
 * Verse Panel — activity log (who did what, when, from where).
 * Append-only JSON-lines file, rotated at ~8 MB (keeps one previous file).
 */
const FILE = path.join(process.cwd(), ".data", "activity.jsonl");
const MAX_BYTES = 8 * 1024 * 1024;

export interface ActivityEntry {
  id: string;
  ts: number;
  serverId?: string;
  userId: string;
  username: string;
  action: string;
  detail?: string;
  ip?: string;
  ok: boolean;
}

let writing: Promise<void> = Promise.resolve();

export function logActivity(e: Omit<ActivityEntry, "id" | "ts" | "ok"> & { ok?: boolean }) {
  const entry: ActivityEntry = {
    id: crypto.randomBytes(6).toString("hex"),
    ts: Date.now(),
    ok: e.ok !== false,
    serverId: e.serverId,
    userId: e.userId,
    username: e.username,
    action: e.action,
    detail: e.detail ? String(e.detail).slice(0, 300) : undefined,
    ip: e.ip
  };
  writing = writing
    .then(async () => {
      await fs.ensureDir(path.dirname(FILE));
      try {
        const st = await fs.stat(FILE);
        if (st.size > MAX_BYTES) await fs.move(FILE, FILE + ".1", { overwrite: true });
      } catch {}
      await fs.appendFile(FILE, JSON.stringify(entry) + "\n");
    })
    .catch(() => {});
}

export interface ActivityQuery {
  serverId?: string;
  userId?: string;
  action?: string; // prefix, e.g. "file." or "server.power"
  q?: string;
  limit?: number;
  before?: number; // ts cursor: only entries older than this
}

export async function readActivity(query: ActivityQuery) {
  const limit = Math.min(Math.max(query.limit || 50, 1), 200);
  const lines: string[] = [];
  for (const f of [FILE, FILE + ".1"]) {
    try {
      const txt = await fs.readFile(f, "utf8");
      lines.push(...txt.split("\n").filter(Boolean).reverse()); // newest first within each file
    } catch {}
  }
  const q = query.q?.toLowerCase();
  const out: ActivityEntry[] = [];
  for (const line of lines) {
    let e: ActivityEntry;
    try { e = JSON.parse(line); } catch { continue; }
    if (query.before && e.ts >= query.before) continue;
    if (query.serverId && e.serverId !== query.serverId) continue;
    if (query.userId && e.userId !== query.userId) continue;
    if (query.action && !e.action.startsWith(query.action)) continue;
    if (q && !`${e.username} ${e.action} ${e.detail || ""} ${e.ip || ""}`.toLowerCase().includes(q)) continue;
    out.push(e);
    if (out.length >= limit + 1) break;
  }
  const hasMore = out.length > limit;
  const entries = out.slice(0, limit);
  return { entries, nextBefore: hasMore ? entries[entries.length - 1].ts : null };
}

/* ------------------------------------------------------------------ */
/* Automatic request logging                                           */
/* ------------------------------------------------------------------ */

// Pattern (relative to the mount point, after /:id) -> action label. First match wins.
const RULES: Array<[string, RegExp, string]> = [
  ["POST", /^\/start$/, "server.power.start"],
  ["POST", /^\/stop$/, "server.power.stop"],
  ["POST", /^\/restart$/, "server.power.restart"],
  ["POST", /^\/kill$/, "server.power.kill"],
  ["POST", /^\/command$/, "server.command"],
  ["PUT", /^\/version$/, "server.version.change"],
  ["PUT", /^\/resources$/, "server.resources.update"],
  ["PUT", /^\/suspend$/, "server.suspend"],
  ["PUT", /^\/owner$/, "server.owner.change"],
  ["PUT", /^\/migrate-runtime$/, "server.runtime.migrate"],
  ["POST", /^\/files\/save$/, "file.write"],
  ["POST", /^\/files\/create$/, "file.create"],
  ["POST", /^\/files\/mkdir$/, "file.mkdir"],
  ["POST", /^\/files\/rename$/, "file.rename"],
  ["POST", /^\/files\/unzip$/, "file.unzip"],
  ["POST", /^\/files\/zip$/, "file.zip"],
  ["POST", /^\/files\/upload(-complete)?$/, "file.upload"],
  ["DELETE", /^\/files$/, "file.delete"],
  ["POST", /^\/backups$/, "backup.create"],
  ["POST", /^\/backups\/[^/]+\/restore$/, "backup.restore"],
  ["DELETE", /^\/backups\/[^/]+$/, "backup.delete"],
  ["POST", /^\/(plugins|mods)\/install$/, "addon.install"],
  ["POST", /^\/addons\/install$/, "addon.install"],
  ["POST", /^\/modpacks\/install$/, "modpack.install"],
  ["POST", /^\/subusers$/, "subuser.add"],
  ["DELETE", /^\/subusers\/[^/]+$/, "subuser.remove"],
  ["POST", /^\/sftp\/create$/, "sftp.create"],
  ["POST", /^\/sftp\/reset-password$/, "sftp.password.reset"],
  ["DELETE", /^\/sftp$/, "sftp.delete"],
  ["POST", /^\/schedules$/, "schedule.create"],
  ["PUT", /^\/schedules\/[^/]+$/, "schedule.update"],
  ["DELETE", /^\/schedules\/[^/]+$/, "schedule.delete"],
  ["POST", /^\/schedules\/[^/]+\/run$/, "schedule.run"],
  ["PUT", /^\/startup$/, "startup.update"],
  ["POST", /^\/ports$/, "network.port.add"],
  ["DELETE", /^\/ports\/[^/]+$/, "network.port.remove"],
  ["POST", /^\/databases$/, "database.create"],
  ["POST", /^\/databases\/[^/]+\/rotate-password$/, "database.password.rotate"],
  ["DELETE", /^\/databases\/[^/]+$/, "database.delete"],
  ["POST", /^\/world\/import$/, "world.import"]
];

const DETAIL_KEYS = [
  "command", "filePath", "path", "name", "oldPath", "newPath", "from", "to", "filename", "files",
  "version", "type", "source", "projectId", "versionId", "port", "protocol", "action", "cron",
  "eggId", "username", "userId", "suspendDuration", "label", "database"
];

function describe(req: Request): string {
  const bits: string[] = [];
  const b: any = req.body && typeof req.body === "object" ? req.body : {};
  for (const k of DETAIL_KEYS) {
    const v = b[k] ?? (req.query as any)?.[k];
    if (v === undefined || v === null || typeof v === "object") continue;
    bits.push(k === "command" ? String(v) : `${k}=${String(v)}`);
  }
  return bits.join(" ").slice(0, 300);
}

/**
 * Router-level middleware: logs every successful (or forbidden) state-changing request.
 * `mode: "server"` → path starts with /:id/..., `mode: "plain"` → no server id in the path.
 * Secrets are never logged: only a whitelist of body fields is read.
 */
export function activityMiddleware(mode: "server" | "plain" = "server", plainPrefix = "admin") {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    res.on("finish", () => {
      try {
        const user = (req as any).user;
        if (!user) return;
        const ok = res.statusCode < 400;
        if (!ok && res.statusCode !== 403) return;

        let serverId: string | undefined;
        let action: string | undefined;
        const p = req.path.replace(/\/+$/, "") || "/";

        if (mode === "server") {
          if (req.method === "POST" && p === "/") action = "server.create";
          else {
            const m = p.match(/^\/([^/]+)(\/.*)?$/);
            if (m && m[1] !== "check-port") {
              serverId = m[1];
              const rest = m[2] || "";
              if (!rest && req.method === "DELETE") action = "server.delete";
              else for (const [method, re, label] of RULES) if (method === req.method && re.test(rest)) { action = label; break; }
            }
          }
        } else {
          action = `${plainPrefix}.${req.method.toLowerCase()}${p === "/" ? "" : "." + p.slice(1).replace(/\//g, ".")}`;
        }
        if (!action) return;

        logActivity({
          serverId,
          userId: user.id,
          username: user.username || user.id,
          action,
          detail: describe(req) || (action === "server.create" ? String((req.body as any)?.name || "") : undefined),
          ip: req.ip,
          ok
        });
      } catch {}
    });
    next();
  };
}
