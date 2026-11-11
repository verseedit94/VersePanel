import fs from "fs-extra";
import path from "path";
import crypto from "crypto";

/**
 * JWT secret: uses JWT_SECRET from .env; if missing, generates a random one once and
 * stores it in .data/jwt.secret (never falls back to a hardcoded public string).
 */
function loadSecret(): string {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET !== "your-secure-random-jwt-secret-here") {
    return process.env.JWT_SECRET;
  }
  const file = path.join(process.cwd(), ".data", "jwt.secret");
  try {
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
    fs.ensureDirSync(path.dirname(file));
    const s = crypto.randomBytes(48).toString("hex");
    fs.writeFileSync(file, s, { mode: 0o600 });
    return s;
  } catch {
    return crypto.randomBytes(48).toString("hex");
  }
}

export const JWT_SECRET = loadSecret();
