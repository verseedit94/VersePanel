import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import axios from "axios";
import { readJSON, writeJSON } from "../services/db.js";
import { JWT_SECRET } from "../services/secret.js";
import { isMailConfigured, sendMail } from "../services/mailer.js";
import { getPanelBaseUrl } from "../services/domain.js";
import { login as baseLogin } from "./auth.js";
import { logActivity } from "../services/activity.js";

/**
 * Verse Panel — email login, forgot/reset password, Discord OAuth and verified Google login.
 * Kept in its own file so upstream merges of auth.ts stay conflict-free.
 */

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const normEmail = (e: any) => String(e || "").trim().toLowerCase();
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const newId = (prefix: string) => `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

const signToken = (user: any) =>
  jwt.sign(
    { id: user.id, username: user.username, role: user.role || "user", passwordVersion: user.passwordVersion || 0 },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

const publicUser = (u: any) => ({
  id: u.id,
  username: u.username,
  role: u.role || "user",
  email: u.email,
  avatar: u.avatar,
  googleId: u.googleId,
  discordId: u.discordId,
  isGoogleUser: !!u.googleId
});

/** Unique username derived from a preferred name. */
function uniqueUsername(users: any[], wanted: string) {
  const base = (wanted || "user").replace(/[^a-zA-Z0-9_.]/g, "").slice(0, 24) || "user";
  let name = base.length >= 3 ? base : base + "user";
  let i = 1;
  while (users.some(u => u.username && u.username.toLowerCase() === name.toLowerCase())) {
    name = `${base}${++i}`;
  }
  return name;
}

/* ------------------------------------------------------------------ */
/* Tiny in-memory rate limiter                                         */
/* ------------------------------------------------------------------ */
const hits = new Map<string, number[]>();
function limited(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) {
    hits.set(key, arr);
    return true;
  }
  arr.push(now);
  hits.set(key, arr);
  return false;
}

/* ------------------------------------------------------------------ */
/* Register (username + email + password)                              */
/* ------------------------------------------------------------------ */
export const registerWithEmail = async (req: Request, res: Response) => {
  const settings = (await readJSON("settings.json")) || {};
  if (settings.enableRegistration === false) {
    return res.status(403).json({ error: "User registration is currently disabled by administrator." });
  }
  if (limited(`reg:${req.ip}`, 10, 60 * 60 * 1000)) {
    return res.status(429).json({ error: "Too many registrations from this address. Try again later." });
  }

  const { username, email, password, confirmPassword } = req.body || {};
  if (!username || !email || !password || !confirmPassword) {
    return res.status(400).json({ error: "Username, email, password and confirm password are required" });
  }
  const cleanUsername = String(username).trim();
  const cleanEmail = normEmail(email);
  if (cleanUsername.length < 3) return res.status(400).json({ error: "Username must be at least 3 characters" });
  if (!EMAIL_RE.test(cleanEmail)) return res.status(400).json({ error: "Please enter a valid email address" });
  if (String(password).length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
  if (password !== confirmPassword) return res.status(400).json({ error: "Passwords do not match" });

  const users = (await readJSON("users.json")) || [];
  if (users.some((u: any) => u.username && u.username.toLowerCase() === cleanUsername.toLowerCase())) {
    return res.status(400).json({ error: "Username is already taken" });
  }
  if (users.some((u: any) => u.email && normEmail(u.email) === cleanEmail)) {
    return res.status(400).json({ error: "An account with this email already exists" });
  }

  const newUser = {
    id: newId("user"),
    username: cleanUsername,
    email: cleanEmail,
    password: await bcrypt.hash(String(password), 10),
    role: "user",
    passwordVersion: 0,
    createdAt: new Date().toISOString()
  };
  users.push(newUser);
  await writeJSON("users.json", users);
  logActivity({ userId: newUser.id, username: newUser.username, action: "auth.register", ip: req.ip });
  res.status(201).json({ message: "User registered successfully", user: publicUser(newUser) });
};

/* ------------------------------------------------------------------ */
/* Login with username OR email                                        */
/* ------------------------------------------------------------------ */
export const loginWithEmailOrUsername = async (req: Request, res: Response) => {
  const ident = String(req.body?.username ?? req.body?.identifier ?? "").trim();
  if (ident.includes("@")) {
    const users = (await readJSON("users.json")) || [];
    const match = users.find((u: any) => u.email && normEmail(u.email) === normEmail(ident));
    // unknown email -> pass through unchanged so the response is the same "Invalid credentials"
    req.body = { ...req.body, username: match ? match.username : ident };
  }
  const attempted = String(req.body?.username || ident).slice(0, 80);
  res.on("finish", () => {
    logActivity({ userId: "", username: attempted, action: res.statusCode < 400 ? "auth.login" : "auth.login.failed", ip: req.ip, ok: res.statusCode < 400 });
  });
  return baseLogin(req, res);
};

/* ------------------------------------------------------------------ */
/* Forgot / reset password                                             */
/* ------------------------------------------------------------------ */
const RESET_FILE = "password_resets.json";
const RESET_TTL = 30 * 60 * 1000;

export const forgotPassword = async (req: Request, res: Response) => {
  const email = normEmail(req.body?.email);
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Please enter a valid email address" });
  if (limited(`forgot:${req.ip}`, 5, 15 * 60 * 1000) || limited(`forgot-mail:${email}`, 3, 15 * 60 * 1000)) {
    return res.status(429).json({ error: "Too many requests. Please wait a few minutes and try again." });
  }
  if (!(await isMailConfigured())) {
    return res.status(503).json({ error: "Password reset email is not set up on this panel. Ask the administrator to configure Email in Admin Settings." });
  }

  const generic = { message: "If an account with that email exists, a reset link has been sent." };
  const users = (await readJSON("users.json")) || [];
  const user = users.find((u: any) => u.email && normEmail(u.email) === email);
  if (!user) return res.json(generic);

  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  const all: any[] = ((await readJSON(RESET_FILE)) || []).filter((r: any) => r.expiresAt > now && r.userId !== user.id);
  all.push({ userId: user.id, tokenHash: sha256(token), expiresAt: now + RESET_TTL });
  await writeJSON(RESET_FILE, all);

  try {
    const base = await getPanelBaseUrl(req);
    const link = `${base}/reset-password?token=${token}`;
    const settings = (await readJSON("settings.json")) || {};
    const name = settings.panelName || "Verse Panel";
    await sendMail(
      user.email,
      `${name} — reset your password`,
      `<div style="font-family:Arial,sans-serif;max-width:480px">
        <h2>Reset your password</h2>
        <p>Hi <b>${String(user.username).replace(/[<>&"]/g, "")}</b>, we got a request to reset your ${name} password.</p>
        <p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#e11d48;color:#fff;border-radius:8px;text-decoration:none">Set a new password</a></p>
        <p style="font-size:12px;color:#666">This link works for 30 minutes. If you didn't ask for this, ignore this email — your password stays the same.</p>
      </div>`,
      `Reset your ${name} password: ${link} (valid for 30 minutes)`
    );
  } catch (e: any) {
    console.error("[auth] reset mail failed:", e?.message);
    return res.status(502).json({ error: "Could not send the email. Ask the administrator to check the Email settings." });
  }
  res.json(generic);
};

export const resetPassword = async (req: Request, res: Response) => {
  const { token, password, confirmPassword } = req.body || {};
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ error: "Invalid or expired reset link" });
  if (!password || String(password).length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
  if (confirmPassword !== undefined && password !== confirmPassword) return res.status(400).json({ error: "Passwords do not match" });

  const now = Date.now();
  const resets: any[] = ((await readJSON(RESET_FILE)) || []).filter((r: any) => r.expiresAt > now);
  const hash = sha256(token);
  const entry = resets.find(r => r.tokenHash === hash);
  if (!entry) return res.status(400).json({ error: "Invalid or expired reset link" });

  const users = (await readJSON("users.json")) || [];
  const user = users.find((u: any) => u.id === entry.userId);
  if (!user) return res.status(400).json({ error: "Invalid or expired reset link" });

  user.password = await bcrypt.hash(String(password), 10);
  user.passwordVersion = (user.passwordVersion || 0) + 1; // logs out every old session
  await writeJSON("users.json", users);
  await writeJSON(RESET_FILE, resets.filter(r => r.tokenHash !== hash));
  logActivity({ userId: user.id, username: user.username, action: "auth.password.reset", ip: req.ip });
  res.json({ success: true, message: "Password updated. You can sign in now." });
};

/* ------------------------------------------------------------------ */
/* Google (Firebase) — token is verified server-side                   */
/* ------------------------------------------------------------------ */
export const googleLoginVerified = async (req: Request, res: Response) => {
  const settings = (await readJSON("settings.json")) || {};
  if (settings.enableGoogleLogin === false || !settings.enableGoogleLogin) {
    return res.status(403).json({ error: "Google Login is disabled on this panel." });
  }
  const { idToken } = req.body || {};
  if (!idToken || typeof idToken !== "string" || !settings.firebaseApiKey) {
    return res.status(400).json({ error: "Google sign-in token is required" });
  }

  let info: any;
  try {
    const r = await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(settings.firebaseApiKey)}`,
      { idToken },
      { timeout: 10000 }
    );
    info = r.data?.users?.[0];
  } catch {
    return res.status(401).json({ error: "Google sign-in could not be verified" });
  }
  if (!info?.email || !info.localId) return res.status(401).json({ error: "Google sign-in could not be verified" });
  if (info.emailVerified === false) return res.status(401).json({ error: "Your Google email is not verified" });

  const email = normEmail(info.email);
  const users = (await readJSON("users.json")) || [];
  // Match ONLY by verified Google id / email — never by username.
  let user = users.find((u: any) => (u.googleId && u.googleId === info.localId) || (u.email && normEmail(u.email) === email));

  if (!user) {
    user = {
      id: newId("google-user"),
      username: uniqueUsername(users, email.split("@")[0]),
      email,
      googleId: info.localId,
      role: users.length === 0 ? "admin" : "user",
      avatar: info.photoUrl || "",
      passwordVersion: 0,
      createdAt: new Date().toISOString()
    };
    users.push(user);
  } else {
    if (!user.googleId) user.googleId = info.localId;
    if (!user.email) user.email = email;
    if (info.photoUrl && !user.avatar) user.avatar = info.photoUrl;
  }
  await writeJSON("users.json", users);
  res.json({ token: signToken(user), user: { ...publicUser(user), isGoogleUser: true } });
};

/* ------------------------------------------------------------------ */
/* Discord OAuth2                                                      */
/* ------------------------------------------------------------------ */
const states = new Map<string, number>();
const exchangeCodes = new Map<string, { token: string; user: any; exp: number }>();

const sweep = () => {
  const now = Date.now();
  for (const [k, t] of states) if (now - t > 10 * 60 * 1000) states.delete(k);
  for (const [k, v] of exchangeCodes) if (v.exp < now) exchangeCodes.delete(k);
};

async function discordConfig(req: Request) {
  const s = (await readJSON("settings.json")) || {};
  const base = await getPanelBaseUrl(req);
  return {
    enabled: !!(s.discordEnabled && s.discordClientId && s.discordClientSecret),
    clientId: String(s.discordClientId || ""),
    clientSecret: String(s.discordClientSecret || ""),
    redirectUri: `${base}/api/auth/discord/callback`,
    base
  };
}

export const discordStart = async (req: Request, res: Response) => {
  const c = await discordConfig(req);
  if (!c.enabled) return res.redirect("/login?derror=" + encodeURIComponent("Discord login is not enabled on this panel."));
  sweep();
  const state = crypto.randomBytes(16).toString("hex");
  states.set(state, Date.now());
  const url =
    "https://discord.com/oauth2/authorize?" +
    new URLSearchParams({
      client_id: c.clientId,
      redirect_uri: c.redirectUri,
      response_type: "code",
      scope: "identify email",
      state,
      prompt: "none"
    }).toString();
  res.redirect(url);
};

export const discordCallback = async (req: Request, res: Response) => {
  const fail = (msg: string) => res.redirect("/login?derror=" + encodeURIComponent(msg));
  try {
    const c = await discordConfig(req);
    if (!c.enabled) return fail("Discord login is not enabled on this panel.");
    const { code, state, error } = req.query as any;
    if (error) return fail("Discord login was cancelled.");
    if (!code || !state || !states.has(String(state))) return fail("Login session expired. Please try again.");
    states.delete(String(state));

    const tok = await axios.post(
      "https://discord.com/api/v10/oauth2/token",
      new URLSearchParams({
        client_id: c.clientId,
        client_secret: c.clientSecret,
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: c.redirectUri
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 15000 }
    );
    const me = await axios.get("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bearer ${tok.data.access_token}` },
      timeout: 15000
    });
    const d = me.data || {};
    if (!d.id) return fail("Could not read your Discord account.");
    if (!d.email || d.verified !== true) return fail("Your Discord email must be verified to sign in.");

    const email = normEmail(d.email);
    const users = (await readJSON("users.json")) || [];
    let user = users.find((u: any) => u.discordId && u.discordId === d.id) ||
      users.find((u: any) => u.email && normEmail(u.email) === email);

    const avatar = d.avatar ? `https://cdn.discordapp.com/avatars/${d.id}/${d.avatar}.png` : "";
    if (!user) {
      user = {
        id: newId("discord-user"),
        username: uniqueUsername(users, d.username || email.split("@")[0]),
        email,
        discordId: d.id,
        role: users.length === 0 ? "admin" : "user",
        avatar,
        passwordVersion: 0,
        createdAt: new Date().toISOString()
      };
      users.push(user);
    } else {
      if (!user.discordId) user.discordId = d.id;
      if (!user.email) user.email = email;
      if (avatar && !user.avatar) user.avatar = avatar;
    }
    await writeJSON("users.json", users);

    // One-time code, so the JWT never appears in a URL.
    const oneTime = crypto.randomBytes(24).toString("hex");
    exchangeCodes.set(oneTime, { token: signToken(user), user: publicUser(user), exp: Date.now() + 60 * 1000 });
    res.redirect("/login?dcode=" + oneTime);
  } catch (e: any) {
    console.error("[auth] discord callback failed:", e?.response?.data || e?.message);
    fail("Discord login failed. Please try again.");
  }
};

export const discordExchange = async (req: Request, res: Response) => {
  sweep();
  const code = String(req.body?.code || "");
  const entry = exchangeCodes.get(code);
  if (!entry) return res.status(400).json({ error: "Login link expired. Please try again." });
  exchangeCodes.delete(code);
  res.json({ token: entry.token, user: entry.user });
};
