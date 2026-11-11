/**
 * Tiny dependency-free client for the playit.gg agent API (https://api.playit.gg).
 * Every endpoint is a JSON POST; replies look like { status: "success" | "fail" | "error", data }.
 * Authentication for an agent is the header "Authorization: Agent-Key <secret>".
 * Tunnels are created WITHOUT a game type (tunnel_type: null) so playit never asks what game the tunnel is for.
 */
export const PLAYIT_API = () => (process.env.PLAYIT_API_URL || "https://api.playit.gg").replace(/\/+$/, "");

export class PlayitError extends Error {
  kind: "fail" | "error" | "http" | "network";
  detail: string;
  constructor(kind: PlayitError["kind"], detail: string) {
    super(`playit.gg: ${detail}`);
    this.kind = kind;
    this.detail = detail;
  }
}

export async function pcall<T = any>(path: string, body: any = {}, secret?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(PLAYIT_API() + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(secret ? { Authorization: `Agent-Key ${secret}` } : {}) },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(20000)
    });
  } catch (e: any) {
    throw new PlayitError("network", `cannot reach playit.gg (${e?.cause?.code || e?.message || "network error"})`);
  }
  const text = await res.text();
  let j: any = null;
  try { j = JSON.parse(text); } catch {}
  if (!j || typeof j !== "object") throw new PlayitError("http", `unexpected answer (HTTP ${res.status})`);
  if (j.status === "success") return j.data as T;
  if (j.status === "fail") throw new PlayitError("fail", typeof j.data === "string" ? j.data : JSON.stringify(j.data));
  const d = j.data;
  throw new PlayitError("error", (d && (d.message || d.type)) ? `${d.type || "error"}: ${typeof d.message === "string" ? d.message : JSON.stringify(d.message ?? "")}` : `HTTP ${res.status}`);
}

/* ---------- claim flow (link the panel to the user's playit account) ---------- */
export const newClaimCode = (rand: (n: number) => Buffer) => rand(5).toString("hex");
export const claimUrl = (code: string) => `https://playit.gg/claim/${code}`;

export const claimSetup = (code: string) => pcall<string>("/claim/setup", { code, agent_type: "self-managed", version: "verse-panel" });

/** "secret" once the user approved, otherwise a state the caller can show. */
export async function claimExchange(code: string): Promise<{ state: "secret"; secret: string } | { state: "waiting" | "rejected" | "expired" }> {
  try {
    const r = await pcall<{ secret_key: string }>("/claim/exchange", { code });
    if (r?.secret_key) return { state: "secret", secret: r.secret_key };
    return { state: "waiting" };
  } catch (e: any) {
    if (e instanceof PlayitError && e.kind === "fail") {
      if (/UserRejected/.test(e.detail)) return { state: "rejected" };
      if (/CodeExpired|CodeNotFound/.test(e.detail)) return { state: "expired" };
      return { state: "waiting" }; // NotAccepted / NotSetup
    }
    throw e;
  }
}

/* ---------- agent + tunnels ---------- */
export interface PlayitTunnel {
  id: string; internal_id?: number; name?: string | null; ip_num?: number; region_num?: number;
  port: { from: number; to: number }; proto: "tcp" | "udp" | "both";
  local_ip: string; local_port: number; assigned_domain: string; custom_domain?: string | null; disabled?: string | null;
}
export interface PlayitRunData { agent_id: string; tunnels: PlayitTunnel[]; pending: any[]; account_status?: string }

export const agentRunData = (secret: string) => pcall<PlayitRunData>("/agents/rundata", {}, secret);

export async function createTunnel(secret: string, agentId: string, name: string, localPort: number): Promise<string> {
  const r = await pcall<{ id: string }>("/tunnels/create", {
    name: name.slice(0, 40),
    tunnel_type: null,
    port_type: "both",
    port_count: 1,
    origin: { type: "agent", data: { agent_id: agentId, local_ip: "127.0.0.1", local_port: localPort } },
    enabled: true,
    alloc: null,
    firewall_id: null,
    proxy_protocol: null
  }, secret);
  return r.id;
}

export const deleteTunnel = (secret: string, tunnelId: string) => pcall("/tunnels/delete", { tunnel_id: tunnelId }, secret);

/** Public address of a tunnel as players type it. */
export const tunnelAddress = (t: PlayitTunnel) => ({ host: (t.custom_domain || t.assigned_domain || "").toLowerCase(), port: t.port.from, ipNum: t.ip_num ?? 0 });
