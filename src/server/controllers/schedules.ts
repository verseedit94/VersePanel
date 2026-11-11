import { Request, Response } from "express";
import { loadServerForRequest } from "../services/access.js";
import { nextRun, parseCron } from "../services/cron.js";
import {
  Schedule, ScheduleTask, isScheduleRunning, listSchedules, newScheduleId, runSchedule, withSchedules
} from "../services/scheduler.js";

const MAX_PER_SERVER = 20;
const POWER = ["start", "stop", "restart", "kill"];

function validate(body: any): { value: Pick<Schedule, "name" | "cron" | "enabled" | "onlyWhenOnline" | "tasks"> } | { error: string } {
  const name = String(body?.name ?? "").trim();
  if (!name || name.length > 60) return { error: "Name is required (max 60 characters)" };
  const cron = String(body?.cron ?? "").trim().replace(/\s+/g, " ");
  try { parseCron(cron); } catch (e: any) { return { error: "Invalid cron: " + e.message }; }

  const rawTasks = Array.isArray(body?.tasks) ? body.tasks : [];
  if (rawTasks.length < 1 || rawTasks.length > 10) return { error: "A schedule needs 1 to 10 tasks" };
  const tasks: ScheduleTask[] = [];
  for (let i = 0; i < rawTasks.length; i++) {
    const t = rawTasks[i] || {};
    const action = String(t.action);
    const delay = Number(t.delay ?? 0);
    if (!["command", "power", "backup"].includes(action)) return { error: `Task ${i + 1}: unknown action` };
    if (!Number.isInteger(delay) || delay < 0 || delay > 900) return { error: `Task ${i + 1}: delay must be 0-900 seconds` };
    let payload = String(t.payload ?? "").trim();
    if (action === "command") {
      if (!payload || payload.length > 300 || /[\r\n]/.test(payload)) return { error: `Task ${i + 1}: enter a single-line command (max 300 chars)` };
    } else if (action === "power") {
      if (!POWER.includes(payload)) return { error: `Task ${i + 1}: power action must be ${POWER.join("/")}` };
    } else payload = "";
    tasks.push({ id: String(t.id || newScheduleId()).slice(0, 20), action: action as any, payload, delay });
  }
  return { value: { name, cron, enabled: body?.enabled !== false, onlyWhenOnline: !!body?.onlyWhenOnline, tasks } };
}

const view = (s: Schedule) => {
  let next: number | null = null;
  try { next = s.enabled ? nextRun(parseCron(s.cron))?.getTime() ?? null : null; } catch {}
  return { ...s, nextRun: next, running: isScheduleRunning(s.id) };
};

export const getSchedules = async (req: Request, res: Response) => {
  const server = await loadServerForRequest(req, res);
  if (!server) return;
  const all = await listSchedules();
  res.json({ schedules: all.filter(s => s.serverId === server.id).map(view), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
};

export const createSchedule = async (req: Request, res: Response) => {
  const server = await loadServerForRequest(req, res);
  if (!server) return;
  const v = validate(req.body);
  if ("error" in v) return res.status(400).json({ error: v.error });
  const user = (req as any).user;
  try {
    const created = await withSchedules(all => {
      if (all.filter(s => s.serverId === server.id).length >= MAX_PER_SERVER) throw new Error(`Limit reached (${MAX_PER_SERVER} schedules per server)`);
      const s: Schedule = { id: newScheduleId(), serverId: server.id, ...v.value, createdAt: new Date().toISOString(), createdBy: user?.id || "" };
      all.push(s);
      return s;
    });
    res.status(201).json({ schedule: view(created) });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
};

export const updateSchedule = async (req: Request, res: Response) => {
  const server = await loadServerForRequest(req, res);
  if (!server) return;
  const v = validate({ ...req.body, enabled: req.body?.enabled });
  if ("error" in v) return res.status(400).json({ error: v.error });
  const updated = await withSchedules(all => {
    const s = all.find(x => x.id === req.params.scheduleId && x.serverId === server.id);
    if (s) Object.assign(s, v.value);
    return s;
  });
  if (!updated) return res.status(404).json({ error: "Schedule not found" });
  res.json({ schedule: view(updated) });
};

export const deleteSchedule = async (req: Request, res: Response) => {
  const server = await loadServerForRequest(req, res);
  if (!server) return;
  const removed = await withSchedules(all => {
    const i = all.findIndex(x => x.id === req.params.scheduleId && x.serverId === server.id);
    if (i === -1) return false;
    all.splice(i, 1);
    return true;
  });
  if (!removed) return res.status(404).json({ error: "Schedule not found" });
  res.json({ success: true });
};

export const runScheduleNow = async (req: Request, res: Response) => {
  const server = await loadServerForRequest(req, res);
  if (!server) return;
  const all = await listSchedules();
  const s = all.find(x => x.id === req.params.scheduleId && x.serverId === server.id);
  if (!s) return res.status(404).json({ error: "Schedule not found" });
  const user = (req as any).user;
  const r = await runSchedule(s.id, "manual", { id: user.id, username: user.username });
  if (!r.started) return res.status(409).json({ error: "This schedule is already running" });
  res.json({ success: true, message: "Schedule started" });
};
