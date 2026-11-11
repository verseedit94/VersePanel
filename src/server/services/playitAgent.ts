import { spawn, ChildProcess } from "child_process";
import fs from "fs-extra";
import path from "path";
import os from "os";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

/**
 * Runs the official playit.gg agent on this node (NODE_MODE only). The panel sends the agent's secret key;
 * the node downloads the agent binary once, keeps it running (restarts it if it dies) and starts it again after a reboot.
 */
const dir = () => path.join(process.cwd(), ".data", "playit");
const binPath = () => path.join(dir(), "playit");
const secretFile = () => path.join(dir(), "secret.json");

let child: ChildProcess | null = null;
let wanted = false;
let restartTimer: NodeJS.Timeout | null = null;
const logTail: string[] = [];
const pushLog = (s: string) => {
  for (const l of String(s).split(/\r?\n/)) {
    const t = l.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim();
    if (t) logTail.push(t.slice(0, 300));
  }
  while (logTail.length > 60) logTail.shift();
};

function assetName(): string | null {
  const a = os.arch();
  if (a === "x64") return "playit-linux-amd64";
  if (a === "arm64") return "playit-linux-aarch64";
  if (a === "arm") return "playit-linux-armv7";
  return null;
}

async function ensureBinary(): Promise<void> {
  if (await fs.pathExists(binPath())) return;
  const name = assetName();
  if (!name || os.platform() !== "linux") throw new Error(`playit agent is not available for ${os.platform()}/${os.arch()}`);
  await fs.ensureDir(dir());
  const url = `https://github.com/playit-cloud/playit-agent/releases/latest/download/${name}`;
  pushLog(`downloading ${url}`);
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120000) });
  if (!res.ok || !res.body) throw new Error(`could not download the playit agent (HTTP ${res.status})`);
  const tmp = binPath() + ".part";
  await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(tmp));
  await fs.chmod(tmp, 0o755);
  await fs.move(tmp, binPath(), { overwrite: true });
}

function launch(secret: string, attempt = 0) {
  // attempt 0: documented docker style (env only). Later attempts try CLI flags used by other agent versions.
  const variants: string[][] = [[], ["--stdout"], ["--secret", secret, "--stdout"]];
  const args = variants[Math.min(attempt, variants.length - 1)];
  const started = Date.now();
  const p = spawn(binPath(), args, { cwd: dir(), env: { ...process.env, SECRET_KEY: secret }, stdio: ["ignore", "pipe", "pipe"] });
  child = p;
  p.stdout?.on("data", d => pushLog(d.toString()));
  p.stderr?.on("data", d => pushLog(d.toString()));
  p.on("error", e => pushLog(`spawn error: ${e.message}`));
  p.on("exit", code => {
    pushLog(`agent exited (code ${code})`);
    if (child === p) child = null;
    if (!wanted) return;
    const quick = Date.now() - started < 5000;
    restartTimer = setTimeout(() => { if (wanted && !child) launch(secret, quick ? attempt + 1 : 0); }, quick ? 2000 : 5000);
  });
}

export async function startAgent(secret: string) {
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(secret)) throw new Error("Invalid secret");
  await ensureBinary();
  await fs.ensureDir(dir());
  await fs.writeFile(secretFile(), JSON.stringify({ secret }), { mode: 0o600 });
  await stopProcess();
  wanted = true;
  logTail.length = 0;
  launch(secret);
}

async function stopProcess() {
  wanted = false;
  if (restartTimer) clearTimeout(restartTimer);
  const p = child;
  child = null;
  if (p) { try { p.kill("SIGTERM"); } catch {} await new Promise(r => setTimeout(r, 300)); try { p.kill("SIGKILL"); } catch {} }
}

export async function stopAgent(forget = true) {
  await stopProcess();
  if (forget) await fs.remove(secretFile()).catch(() => {});
}

/** called when the node boots */
export async function autoStartAgent() {
  try {
    if (!(await fs.pathExists(secretFile()))) return;
    const { secret } = await fs.readJson(secretFile());
    if (secret) await startAgent(secret);
  } catch (e: any) { pushLog(`autostart failed: ${e?.message}`); }
}

export async function agentStatus() {
  return {
    installed: await fs.pathExists(binPath()),
    configured: await fs.pathExists(secretFile()),
    running: !!child && child.exitCode === null,
    log: logTail.slice(-12)
  };
}
