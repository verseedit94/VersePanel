import dns from "dns";
import os from "os";
import axios from "axios";
import { readJSON } from "./db.js";

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
export const isValidDomain = (d: any) => typeof d === "string" && DOMAIN_RE.test(d.trim());

let cachedIp: { ip: string; at: number } | null = null;

/** The public IPv4 of this host (env PANEL_PUBLIC_IP wins; otherwise asked from public echo services). */
export async function getPublicIp(): Promise<string | null> {
  if (process.env.PANEL_PUBLIC_IP) return process.env.PANEL_PUBLIC_IP.trim();
  if (cachedIp && Date.now() - cachedIp.at < 10 * 60 * 1000) return cachedIp.ip;
  for (const url of ["https://api.ipify.org", "https://ifconfig.me/ip", "https://icanhazip.com"]) {
    try {
      const r = await axios.get(url, { timeout: 5000, responseType: "text" });
      const ip = String(r.data).trim();
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
        cachedIp = { ip, at: Date.now() };
        return ip;
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

export interface DomainCheck {
  ok: boolean;
  domain: string;
  serverIp: string | null;
  resolved: string[];
  message: string;
}

/** Checks that an A record for `domain` points to this server's public IP (asks public resolvers, not the local cache). */
export async function verifyDomain(domainRaw: string): Promise<DomainCheck> {
  const domain = String(domainRaw || "").trim().toLowerCase();
  if (!isValidDomain(domain)) {
    return { ok: false, domain, serverIp: null, resolved: [], message: "Invalid domain name (example: panel.example.com)." };
  }
  const serverIp = await getPublicIp();
  if (!serverIp) {
    return { ok: false, domain, serverIp: null, resolved: [], message: "Could not detect this server's public IP. Set PANEL_PUBLIC_IP in .env and retry." };
  }

  const resolver = new dns.promises.Resolver();
  resolver.setServers(["1.1.1.1", "8.8.8.8"]);
  let resolved: string[] = [];
  try {
    resolved = await resolver.resolve4(domain);
  } catch {
    try {
      resolved = await dns.promises.resolve4(domain);
    } catch {
      return {
        ok: false, domain, serverIp, resolved: [],
        message: `No A record found for ${domain}. Create an A record pointing to ${serverIp} and wait a few minutes for DNS to update.`
      };
    }
  }

  if (resolved.includes(serverIp)) {
    return { ok: true, domain, serverIp, resolved, message: `${domain} correctly points to ${serverIp}.` };
  }
  return {
    ok: false, domain, serverIp, resolved,
    message: `${domain} points to ${resolved.join(", ")}, but this server is ${serverIp}. Update the A record (turn off Cloudflare proxy / orange cloud if you use it) and try again.`
  };
}

/** Verified panel domain + scheme, or null when none is configured. */
export async function getPanelDomain(): Promise<{ domain: string; scheme: "http" | "https" } | null> {
  const s = (await readJSON("settings.json")) || {};
  if (s.panelDomain && s.domainVerified) {
    return { domain: String(s.panelDomain), scheme: s.panelScheme === "http" ? "http" : "https" };
  }
  return null;
}

/** Base URL used in e-mails and OAuth redirects. */
export async function getPanelBaseUrl(req?: any): Promise<string> {
  const d = await getPanelDomain();
  if (d) return `${d.scheme}://${d.domain}`;
  if (req) {
    const proto = (req.headers?.["x-forwarded-proto"] as string) || req.protocol || "http";
    return `${String(proto).split(",")[0]}://${req.get ? req.get("host") : req.headers?.host}`;
  }
  return `http://localhost:${process.env.PORT || 6767}`;
}

const PRIVATE_V4 = /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/;
export const isIPv4 = (v: any) => typeof v === "string" && /^(\d{1,3}\.){3}\d{1,3}$/.test(v) && v.split(".").every(n => Number(n) <= 255);

/** This machine's LAN address (192.168.x.x / 10.x / 172.16-31.x preferred). Returns null when it can't be read (some phones block it). */
export function detectLocalIp(): string | null {
  try {
    const all: string[] = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const i of list || []) if (i.family === "IPv4" && !i.internal) all.push(i.address);
    }
    return all.find(a => PRIVATE_V4.test(a)) || all[0] || null;
  } catch {
    return null;
  }
}

/** Host players should use: the verified domain, else (local mode) the LAN IP, else "" (browser falls back to its own hostname). */
export async function getServerHost(): Promise<string> {
  const s = (await readJSON("settings.json")) || {};
  if (s.panelDomain && s.domainVerified) return String(s.panelDomain);
  if (s.accessMode === "local") return String(s.localIp || detectLocalIp() || "");
  return "";
}
