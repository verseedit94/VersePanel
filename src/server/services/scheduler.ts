import crypto from "crypto";
import { readJSON, writeJSON } from "./db.js";
import { cronMatches, parseCron } from "./cron.js";
import { logActivity } from "./activity.js";
import { getServerRuntimeStatus, sendServerRuntimeCommand } from "./runtime.js";
import { startServer, stopServer, restartServer, killServer, createBackup } from "../controllers/servers.js";
import { serverNode, nodeRequest } from "./nodeClient.js";

/**
 * Verse Panel — scheduled tasks (cron). Ticks once per minute; every schedule has an ordered list of tasks
 * (send command / power action / backup), each with an optional delay.
 */
export interface ScheduleTask {
  id: string;
  action: "command" | "power" | "backup";
  payload: string; // command text or start|stop|restart|kill
  delay: number; // seconds to wait BEFORE this task (0-900)
}

export interface Schedule {
  id: string;
  serverId: string;
  name: string;
  cron: string;
  enabled: boolean;
  onlyWhenOnline: boolean;
  tasks: ScheduleTask[];
  createdAt: string;
  createdBy: string;
  lastRun?: number;
  lastStatus?: "ok" | "error" | "skipped";
  lastMessage?: string;
}

const FILE = "schedules.json";
const running = new Set<string>();
let ioRef: any = null;
let lastMinuteKey = 0;

// serialise read-modify-write so two writers can't clobber each other
let chain: Promise<any> = Promise.resolve();
export function withSchedules<T>(fn: (all: Schedule[]) => Promise<T> | T): Promise<T> {
  const p = chain.then(async () => {
    const all: Schedule[] = (await readJSON(FILE)) || [];
    const result = await fn(all);
    await writeJSON(FILE, all);
    return result;
  });
  chain = p.catch(() => {});
  return p;
}

export const listSchedules = async (): Promise<Schedule[]> => (await readJSON(FILE)) || [];
export const isScheduleRunning = (id: string) => running.has(id);
export const newScheduleId = () => crypto.randomBytes(5).toString("hex");

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Calls an existing Express controller as the scheduler (owner role), so power/backup logic stays in one place. */
function callController(handler: any, serverId: string, waitForResponse: boolean): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Timed out after 20 minutes")), 20 * 60 * 1000);
    let settled = false;
    const finish = (err: Error | null, body?: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      err ? reject(err) : resolve(body);
    };
    const res: any = {
      headersSent: false,
      statusCode: 200,
      status(c: number) { this.statusCode = c; return this; },
      json(b: any) { this.headersSent = true; this.statusCode >= 400 ? finish(new Error(b?.error || `HTTP ${this.statusCode}`)) : finish(null, b); return this; },
      send(b: any) { return this.json(b); },
      end() { return this.json({}); },
      setHeader() {}, set() {}, download() {}
    };
    const req: any = {
      params: { id: serverId }, body: {}, query: {}, headers: {}, ip: "scheduler",
      user: { id: "scheduler", username: "Scheduler", role: "owner" },
      app: { get: (k: string) => (k === "io" ? ioRef : undefined) }
    };
    Promise.resolve(handler(req, res))
      .then(() => { if (!waitForResponse) setTimeout(() => finish(null, {}), 1500); })
      .catch((e: any) => finish(e instanceof Error ? e : new Error(String(e))));
  });
}

async function runTask(server: any, task: ScheduleTask) {
  // Server on a Verse Node: do it through the node's API instead of the local controllers
  const node = await serverNode(server);
  if (node) {
    const base = `/api/servers/${server.id}`;
    if (task.action === "command") {
      const st = await getServerRuntimeStatus(server);
      if (!st?.State?.Running) throw new Error("server is offline, command not sent");
      await nodeRequest(node, "POST", `${base}/command`, { body: { command: task.payload }, timeout: 30000 });
    } else if (task.action === "power") {
      if (!["start", "stop", "restart", "kill"].includes(task.payload)) throw new Error(`unknown power action "${task.payload}"`);
      await nodeRequest(node, "POST", `${base}/${task.payload}`, { timeout: 120000 });
    } else if (task.action === "backup") {
      await nodeRequest(node, "POST", `${base}/backups`, { timeout: 20 * 60 * 1000 });
    }
    return;
  }
  if (task.action === "command") {
    const st = await getServerRuntimeStatus(server);
    if (!st?.State?.Running) throw new Error("server is offline, command not sent");
    await sendServerRuntimeCommand(server, task.payload);
  } else if (task.action === "power") {
    const map: Record<string, any> = { start: startServer, stop: stopServer, restart: restartServer, kill: killServer };
    const handler = map[task.payload];
    if (!handler) throw new Error(`unknown power action "${task.payload}"`);
    await callController(handler, server.id, false);
  } else if (task.action === "backup") {
    await callController(createBackup, server.id, true);
  }
}

export async function runSchedule(scheduleId: string, trigger: "cron" | "manual" = "cron", by?: { id: string; username: string }) {
  if (running.has(scheduleId)) return { started: false, reason: "already running" };
  const all = await listSchedules();
  const sch = all.find(s => s.id === scheduleId);
  if (!sch) return { started: false, reason: "not found" };
  running.add(scheduleId);

  (async () => {
    let status: Schedule["lastStatus"] = "ok";
    let message = `${sch.tasks.length} task(s) completed`;
    try {
      const servers = (await readJSON("servers.json")) || [];
      const server = servers.find((s: any) => s.id === sch.serverId);
      if (!server) throw new Error("server no longer exists");

      if (sch.onlyWhenOnline && trigger === "cron") {
        const st = await getServerRuntimeStatus(server);
        if (!st?.State?.Running) {
          status = "skipped";
          message = "skipped: server is offline";
          return;
        }
      }
      for (let i = 0; i < sch.tasks.length; i++) {
        const t = sch.tasks[i];
        if (t.delay > 0) await sleep(t.delay * 1000);
        try {
          await runTask(server, t);
        } catch (e: any) {
          status = "error";
          message = `task ${i + 1} (${t.action}${t.payload ? " " + t.payload : ""}) failed: ${e?.message || e}`;
          return;
        }
      }
    } catch (e: any) {
      status = "error";
      message = String(e?.message || e);
    } finally {
      running.delete(scheduleId);
      await withSchedules(list => {
        const s = list.find(x => x.id === scheduleId);
        if (s) { s.lastRun = Date.now(); s.lastStatus = status; s.lastMessage = message.slice(0, 300); }
      }).catch(() => {});
      logActivity({
        serverId: sch.serverId,
        userId: by?.id || "scheduler",
        username: by?.username || "Scheduler",
        action: "schedule.executed",
        detail: `${sch.name}: ${message}`,
        ok: status !== "error"
      });
    }
  })();

  return { started: true };
}

async function tick() {
  const now = new Date();
  const key = Math.floor(now.getTime() / 60000);
  if (key === lastMinuteKey) return;
  lastMinuteKey = key;
  try {
    const all = await listSchedules();
    for (const s of all) {
      if (!s.enabled || running.has(s.id)) continue;
      let parsed;
      try { parsed = parseCron(s.cron); } catch { continue; }
      if (cronMatches(parsed, now)) runSchedule(s.id, "cron").catch(() => {});
    }
  } catch (e: any) {
    console.error("[scheduler] tick failed:", e?.message);
  }
}

export function startScheduler(io?: any) {
  ioRef = io;
  const loop = () => {
    tick().finally(() => setTimeout(loop, 60000 - (Date.now() % 60000) + 300));
  };
  setTimeout(loop, 60000 - (Date.now() % 60000) + 300);
  console.log("[scheduler] started");
}
