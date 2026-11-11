/** Minimal dependency-free Cloudflare v4 API client (DNS only). Base URL can be overridden with CLOUDFLARE_API_URL (tests). */
export const CF_API = () => (process.env.CLOUDFLARE_API_URL || "https://api.cloudflare.com/client/v4").replace(/\/+$/, "");

export class CfError extends Error {
  constructor(msg: string) { super(`Cloudflare: ${msg}`); }
}

export async function cf<T = any>(method: string, path: string, token: string, body?: any): Promise<T> {
  let res: Response;
  try {
    res = await fetch(CF_API() + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000)
    });
  } catch (e: any) { throw new CfError(`cannot reach Cloudflare (${e?.cause?.code || e?.message})`); }
  let j: any = null;
  try { j = await res.json(); } catch {}
  if (!j) throw new CfError(`unexpected answer (HTTP ${res.status})`);
  if (!j.success) throw new CfError((j.errors || []).map((e: any) => e.message).join("; ") || `HTTP ${res.status}`);
  return j.result as T;
}

/** The page where an admin creates the token (pre-filled: Zone → Read, DNS → Edit). */
export const TOKEN_PAGE_URL = "https://dash.cloudflare.com/profile/api-tokens?" + new URLSearchParams({
  permissionGroupKeys: JSON.stringify([{ key: "zone", type: "read" }, { key: "dns", type: "edit" }]),
  name: "Verse Panel",
  accountId: "*",
  zoneId: "all"
}).toString();

export async function verifyToken(token: string) {
  const r = await cf<{ status: string }>("GET", "/user/tokens/verify", token);
  if (r?.status !== "active") throw new CfError("this token is not active");
}
export const listZones = async (token: string) =>
  (await cf<any[]>("GET", "/zones?per_page=50&status=active", token)).map(z => ({ id: String(z.id), name: String(z.name) }));

export type DnsRecord =
  | { type: "A" | "CNAME"; name: string; content: string }
  | { type: "SRV"; name: string; port: number; target: string };

export async function createRecord(token: string, zoneId: string, r: DnsRecord): Promise<string> {
  const body: any = r.type === "SRV"
    ? { type: "SRV", name: r.name, ttl: 1, data: { priority: 0, weight: 5, port: r.port, target: r.target } }
    : { type: r.type, name: r.name, content: r.content, ttl: 1, proxied: false };
  return (await cf<{ id: string }>("POST", `/zones/${zoneId}/dns_records`, token, body)).id;
}
export const deleteRecord = (token: string, zoneId: string, id: string) =>
  cf("DELETE", `/zones/${zoneId}/dns_records/${id}`, token).catch(() => null);

export const isIPv4 = (s: string) => /^(\d{1,3}\.){3}\d{1,3}$/.test(s);
export const validLabel = (s: string) => /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/.test(s);
