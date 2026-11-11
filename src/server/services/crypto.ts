import crypto from "crypto";
import { JWT_SECRET } from "./secret.js";

/** AES-256-GCM for secrets stored in JSON files (database passwords). Key is derived from the panel's JWT secret. */
const key = crypto.createHash("sha256").update("verse-panel:secrets:" + JWT_SECRET).digest();

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function decryptSecret(blob: string): string {
  const [v, iv, tag, data] = String(blob || "").split(":");
  if (v !== "v1") return "";
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch {
    return "";
  }
}
