import nodemailer from "nodemailer";
import { readJSON } from "./db.js";

export async function getMailConfig() {
  const s = (await readJSON("settings.json")) || {};
  return {
    user: String(s.smtpEmail || "").trim(),
    pass: String(s.smtpAppPassword || "").replace(/\s+/g, ""), // Google shows app passwords with spaces
    host: String(s.smtpHost || "smtp.gmail.com").trim(),
    port: Number(s.smtpPort) || 465,
    fromName: String(s.panelName || "Verse Panel")
  };
}

export async function isMailConfigured() {
  const c = await getMailConfig();
  return !!(c.user && c.pass);
}

export async function sendMail(to: string, subject: string, html: string, text?: string) {
  const c = await getMailConfig();
  if (!c.user || !c.pass) throw new Error("Email is not configured. Set it in Admin Settings → Email.");
  const transporter = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.port === 465,
    auth: { user: c.user, pass: c.pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000
  });
  await transporter.sendMail({
    from: `"${c.fromName.replace(/"/g, "")}" <${c.user}>`,
    to,
    subject,
    text: text || html.replace(/<[^>]+>/g, " "),
    html
  });
}
