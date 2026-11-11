import { readJSON, writeJSON } from "./db.js";

/**
 * Verse Panel — eggs (server blueprints) and startup variables.
 * Built-in eggs describe the variables that the bundled Docker images really understand.
 * Custom eggs can be imported from Pterodactyl egg JSON (image + startup command + variables).
 */
export interface EggVariable {
  name: string;
  description: string;
  env: string;
  default: string;
  rules: string; // Pterodactyl-style, e.g. "required|string|max:20" or "in:easy,normal,hard"
  editable: boolean;
}

export interface Egg {
  id: string;
  name: string;
  description: string;
  author?: string;
  builtin: boolean;
  /** true = env var is always set (to its default when the user left it empty). Built-ins only set what the user filled in. */
  injectDefaults: boolean;
  dockerImage?: string;
  dockerImages?: Record<string, string>;
  startup?: string; // command template, {{VAR}} placeholders
  variables: EggVariable[];
}

const v = (env: string, name: string, description: string, def: string, rules: string): EggVariable =>
  ({ env, name, description, default: def, rules, editable: true });

export const BUILTIN_EGGS: Egg[] = [
  {
    id: "minecraft-java",
    name: "Minecraft: Java Edition",
    description: "Game servers (Paper, Purpur, Spigot, Fabric, Forge, NeoForge, Quilt, Vanilla…). Values are passed to the server image on start; empty = leave the server's own setting alone.",
    builtin: true,
    injectDefaults: false,
    variables: [
      v("MAX_PLAYERS", "Max players", "Maximum players online at once.", "20", "nullable|integer|between:1,100000"),
      v("DIFFICULTY", "Difficulty", "peaceful, easy, normal or hard.", "easy", "nullable|in:peaceful,easy,normal,hard"),
      v("MODE", "Game mode", "Default game mode for new players.", "survival", "nullable|in:survival,creative,adventure,spectator"),
      v("VIEW_DISTANCE", "View distance", "Chunks sent to players (3-32).", "10", "nullable|integer|between:3,32"),
      v("SIMULATION_DISTANCE", "Simulation distance", "Chunks ticked around players (3-32).", "10", "nullable|integer|between:3,32"),
      v("SEED", "World seed", "Seed for a NEW world.", "", "nullable|string|max:64"),
      v("ONLINE_MODE", "Online mode", "TRUE checks premium accounts, FALSE allows cracked clients.", "FALSE", "nullable|in:TRUE,FALSE"),
      v("ENABLE_WHITELIST", "Whitelist", "TRUE = only whitelisted players can join.", "FALSE", "nullable|in:TRUE,FALSE"),
      v("PVP", "PVP", "Allow players to damage each other.", "TRUE", "nullable|in:TRUE,FALSE"),
      v("SPAWN_PROTECTION", "Spawn protection", "Radius in blocks (0 disables).", "16", "nullable|integer|between:0,1000"),
      v("ALLOW_NETHER", "Allow Nether", "Enable the Nether dimension.", "TRUE", "nullable|in:TRUE,FALSE"),
      v("LEVEL", "World folder name", "Name of the world folder.", "world", "nullable|string|max:64"),
      v("JVM_OPTS", "Extra JVM flags", "Added after the panel's own flags, e.g. -XX:+UseZGC.", "", "nullable|string|max:300"),
      v("TZ", "Time zone", "e.g. Asia/Kolkata", "", "nullable|string|max:64")
    ]
  },
  {
    id: "minecraft-proxy",
    name: "Minecraft: Proxy (Velocity / BungeeCord)",
    description: "Proxy servers.",
    builtin: true,
    injectDefaults: false,
    variables: [
      v("JVM_OPTS", "Extra JVM flags", "Extra Java flags.", "", "nullable|string|max:300"),
      v("TZ", "Time zone", "e.g. Asia/Kolkata", "", "nullable|string|max:64")
    ]
  },
  {
    id: "nodejs",
    name: "Node.js application",
    description: "Runs `npm start` / index.js. Variables become environment variables of your app. Startup command can be edited.",
    builtin: true,
    injectDefaults: false,
    variables: [
      v("NODE_ENV", "NODE_ENV", "production or development.", "production", "nullable|in:production,development"),
      v("TZ", "Time zone", "e.g. Asia/Kolkata", "", "nullable|string|max:64"),
      v("APP_ENV_1", "Custom variable 1 (APP_ENV_1)", "Free value your app can read.", "", "nullable|string|max:300"),
      v("APP_ENV_2", "Custom variable 2 (APP_ENV_2)", "Free value your app can read.", "", "nullable|string|max:300")
    ]
  },
  {
    id: "python",
    name: "Python application",
    description: "Runs main.py / app.py / bot.py. Variables become environment variables of your app. Startup command can be edited.",
    builtin: true,
    injectDefaults: false,
    variables: [
      v("TZ", "Time zone", "e.g. Asia/Kolkata", "", "nullable|string|max:64"),
      v("APP_ENV_1", "Custom variable 1 (APP_ENV_1)", "Free value your app can read.", "", "nullable|string|max:300"),
      v("APP_ENV_2", "Custom variable 2 (APP_ENV_2)", "Free value your app can read.", "", "nullable|string|max:300")
    ]
  }
];

const EGG_FILE = "eggs.json";
export const listCustomEggs = async (): Promise<Egg[]> => (await readJSON(EGG_FILE)) || [];
export const saveCustomEggs = (eggs: Egg[]) => writeJSON(EGG_FILE, eggs);

export async function getEggById(id: string): Promise<Egg | undefined> {
  return BUILTIN_EGGS.find(e => e.id === id) || (await listCustomEggs()).find(e => e.id === id);
}

export function builtinEggIdForType(type?: string): string {
  const t = String(type || "PAPER").toUpperCase();
  if (["NODEJS", "NODE"].includes(t)) return "nodejs";
  if (["PYTHON", "PYTHON3"].includes(t)) return "python";
  if (["VELOCITY", "BUNGEECORD", "WATERFALL"].includes(t)) return "minecraft-proxy";
  return "minecraft-java";
}

/** The egg a server currently uses. */
export async function eggForServer(server: any): Promise<Egg> {
  const wanted = server?.startup?.eggId;
  if (wanted) {
    const e = await getEggById(wanted);
    if (e) return e;
  }
  return BUILTIN_EGGS.find(e => e.id === builtinEggIdForType(server?.type))!;
}

/* ------------------------------------------------------------------ */
/* Validation (Pterodactyl-style rules subset)                         */
/* ------------------------------------------------------------------ */
export function validateVariable(variable: EggVariable, raw: string): string | null {
  const value = String(raw ?? "");
  if (/[\r\n\0]/.test(value)) return `${variable.name}: must be a single line`;
  if (value.length > 500) return `${variable.name}: too long`;
  const rules = (variable.rules || "").split("|").map(r => r.trim()).filter(Boolean);
  const nullable = rules.includes("nullable");
  const required = rules.includes("required");
  if (value === "") return required && !nullable && !variable.default ? `${variable.name} is required` : null;

  const numeric = rules.includes("numeric") || rules.includes("integer");
  if (rules.includes("integer") && !/^-?\d+$/.test(value)) return `${variable.name}: must be a whole number`;
  if (rules.includes("numeric") && isNaN(Number(value))) return `${variable.name}: must be a number`;
  if (rules.includes("boolean") && !["0", "1", "true", "false"].includes(value.toLowerCase())) return `${variable.name}: must be true/false`;

  for (const r of rules) {
    const [name, arg] = [r.split(":")[0], r.includes(":") ? r.slice(r.indexOf(":") + 1) : ""];
    const size = numeric ? Number(value) : value.length;
    if (name === "in" && !arg.split(",").includes(value)) return `${variable.name}: must be one of ${arg.split(",").join(", ")}`;
    if (name === "max" && size > Number(arg)) return `${variable.name}: ${numeric ? "max value" : "max length"} is ${arg}`;
    if (name === "min" && size < Number(arg)) return `${variable.name}: ${numeric ? "min value" : "min length"} is ${arg}`;
    if (name === "between") {
      const [lo, hi] = arg.split(",").map(Number);
      if (size < lo || size > hi) return `${variable.name}: must be between ${lo} and ${hi}`;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Runtime helpers (used by docker.ts / local.ts)                      */
/* ------------------------------------------------------------------ */
const fillTemplate = (tpl: string, vars: Record<string, string>) =>
  tpl.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_m, k) => (vars[k] !== undefined ? vars[k] : ""));

/** Effective variable values: what the user set, falling back to the default only when the egg injects defaults. */
function effectiveValues(server: any, egg: Egg): Record<string, string> {
  const set = server?.startup?.variables || {};
  const out: Record<string, string> = {};
  for (const variable of egg.variables) {
    const user = set[variable.env];
    if (user !== undefined && user !== "") out[variable.env] = String(user);
    else if (egg.injectDefaults && variable.default !== "") out[variable.env] = variable.default;
  }
  return out;
}

const customEggCache: { at: number; eggs: Egg[] } = { at: 0, eggs: [] };
/** Synchronous-friendly cache so the (sync) container builder can read custom eggs; refreshed by every startup update. */
export async function refreshEggCache() {
  customEggCache.eggs = await listCustomEggs();
  customEggCache.at = Date.now();
}
const findEggSync = (server: any): Egg => {
  const id = server?.startup?.eggId;
  return (
    BUILTIN_EGGS.find(e => e.id === id) ||
    customEggCache.eggs.find(e => e.id === id) ||
    BUILTIN_EGGS.find(e => e.id === builtinEggIdForType(server?.type))!
  );
};

/** Environment (KEY=VALUE) contributed by startup variables and, for custom eggs, Pterodactyl's standard variables. */
export function startupEnv(server: any): string[] {
  const egg = findEggSync(server);
  const values = effectiveValues(server, egg);
  const env: string[] = Object.entries(values).map(([k, val]) => `${k}=${val}`);
  if (!egg.builtin) {
    const mb = Math.round((Number(server.ram) || 1) * 1024);
    const std: Record<string, string> = {
      SERVER_MEMORY: String(mb), SERVER_PORT: String(server.port), SERVER_IP: "0.0.0.0", P_SERVER_UUID: String(server.id), TZ: values.TZ || "UTC"
    };
    for (const [k, val] of Object.entries(std)) if (!(k in values)) env.push(`${k}=${val}`);
    const cmd = resolvedStartupCommand(server);
    if (cmd) env.push(`STARTUP=${cmd}`);
  }
  return env;
}

export function startupEnvObject(server: any): Record<string, string> {
  const o: Record<string, string> = {};
  for (const kv of startupEnv(server)) { const i = kv.indexOf("="); o[kv.slice(0, i)] = kv.slice(i + 1); }
  return o;
}

export function resolvedStartupCommand(server: any): string | undefined {
  const egg = findEggSync(server);
  const custom = server?.startup?.command;
  const tpl = custom && String(custom).trim() ? String(custom) : !egg.builtin ? egg.startup : undefined;
  if (!tpl) return undefined;
  const vars = { ...effectiveValues(server, egg) } as Record<string, string>;
  vars.SERVER_MEMORY = String(Math.round((Number(server.ram) || 1) * 1024));
  vars.SERVER_PORT = String(server.port);
  vars.SERVER_IP = "0.0.0.0";
  return fillTemplate(tpl, vars);
}

/** Copy of the server with the egg's image / startup command applied (only when the server uses a custom egg or a custom command). */
export function applyEggRuntime(server: any): any {
  const egg = findEggSync(server);
  const cmd = resolvedStartupCommand(server);
  const out = { ...server };
  if (!egg.builtin) {
    const chosen = server?.startup?.image || egg.dockerImage || (egg.dockerImages ? Object.values(egg.dockerImages)[0] : undefined);
    if (chosen) out.dockerImage = chosen;
    out.eggRuntime = true;
  }
  if (cmd) out.startupCommand = cmd;
  return out;
}

/** Merge env lists: later entries replace earlier ones with the same key; keys in `concat` are joined with a space. */
export function mergeEnv(base: string[], extra: string[], concat: string[] = ["JVM_OPTS"]): string[] {
  const map = new Map<string, string>();
  for (const kv of base) { const i = kv.indexOf("="); map.set(kv.slice(0, i), kv.slice(i + 1)); }
  for (const kv of extra) {
    const i = kv.indexOf("=");
    const k = kv.slice(0, i), val = kv.slice(i + 1);
    map.set(k, concat.includes(k) && map.get(k) ? `${map.get(k)} ${val}` : val);
  }
  return [...map.entries()].map(([k, val]) => `${k}=${val}`);
}

/** Convert a Pterodactyl egg export (PTDL_v1 / v2) into our Egg. Install scripts are NOT supported. */
export function eggFromPterodactyl(json: any): Egg {
  if (!json || typeof json !== "object") throw new Error("Not a valid egg file");
  const name = String(json.name || "").trim();
  if (!name) throw new Error("Egg has no name");
  const images: Record<string, string> = {};
  if (json.docker_images && typeof json.docker_images === "object") {
    for (const [label, img] of Object.entries(json.docker_images)) if (typeof img === "string" && /^[\w./:@-]{3,200}$/.test(img)) images[String(label)] = img;
  } else if (typeof json.docker_image === "string" && /^[\w./:@-]{3,200}$/.test(json.docker_image)) {
    images.Default = json.docker_image;
  }
  if (!Object.keys(images).length) throw new Error("Egg has no usable Docker image");
  const startup = String(json.startup || "").trim();
  if (!startup) throw new Error("Egg has no startup command");

  const variables: EggVariable[] = (Array.isArray(json.variables) ? json.variables : [])
    .filter((x: any) => x && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(String(x.env_variable || "")))
    .slice(0, 60)
    .map((x: any): EggVariable => ({
      name: String(x.name || x.env_variable).slice(0, 80),
      description: String(x.description || "").slice(0, 300),
      env: String(x.env_variable),
      default: String(x.default_value ?? "").slice(0, 500),
      rules: String(x.rules || "").slice(0, 200),
      editable: x.user_editable !== false
    }));

  return {
    id: "egg-" + Math.random().toString(36).slice(2, 10),
    name: name.slice(0, 80),
    description: String(json.description || "").slice(0, 400),
    author: String(json.author || "").slice(0, 80),
    builtin: false,
    injectDefaults: true,
    dockerImage: Object.values(images)[0],
    dockerImages: images,
    startup,
    variables
  };
}
