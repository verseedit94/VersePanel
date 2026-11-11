// @ts-nocheck
import React, { useEffect, useState } from "react";
import axios from "axios";
import { Mail, Globe, CheckCircle2, AlertCircle, Send, ExternalLink, Copy } from "lucide-react";

/**
 * Admin settings: Email (SMTP app password), Discord login, Panel domain (with DNS check).
 * Secrets are write-only — the server never sends them back.
 */
const input = "w-full bg-background border border-border focus:border-theme-600 focus:ring-1 focus:ring-theme-600/50 rounded-xl px-4 py-2.5 text-foreground outline-none font-mono text-sm";
const btn = "px-5 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-50";
const card = "bg-card border border-border-subtle rounded-2xl p-6 md:p-8 shadow-xl mt-8";

const Msg = ({ m }: any) =>
  m ? (
    <div className={`mt-3 p-3 rounded-lg text-sm flex items-start gap-2 border ${m.ok ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-red-500/10 border-red-500/20 text-red-400"}`}>
      {m.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
      <span>{m.text}</span>
    </div>
  ) : null;

export default function AdminAuthConfig() {
  const [cfg, setCfg] = useState<any>(null);

  const [smtpEmail, setSmtpEmail] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [testTo, setTestTo] = useState("");
  const [mailMsg, setMailMsg] = useState<any>(null);
  const [mailBusy, setMailBusy] = useState(false);

  const [dcEnabled, setDcEnabled] = useState(false);
  const [dcId, setDcId] = useState("");
  const [dcSecret, setDcSecret] = useState("");
  const [dcMsg, setDcMsg] = useState<any>(null);

  const [domain, setDomain] = useState("");
  const [scheme, setScheme] = useState("https");
  const [domMsg, setDomMsg] = useState<any>(null);
  const [domBusy, setDomBusy] = useState(false);
  const [localIp, setLocalIp] = useState("");

  const load = async () => {
    try {
      const { data } = await axios.get("/api/admin/config");
      setCfg(data);
      setSmtpEmail(data.smtpEmail || "");
      setDcEnabled(!!data.discordEnabled);
      setDcId(data.discordClientId || "");
      setDomain(data.panelDomain || "");
      setScheme(data.panelScheme || "https");
      setLocalIp(data.localIp || data.detectedLocalIp || "");
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const saveMail = async () => {
    setMailBusy(true); setMailMsg(null);
    try {
      await axios.put("/api/admin/config", { smtpEmail, smtpAppPassword: smtpPass });
      setSmtpPass("");
      setMailMsg({ ok: true, text: "Email settings saved." });
      load();
    } catch (e: any) {
      setMailMsg({ ok: false, text: e.response?.data?.error || "Failed to save" });
    } finally { setMailBusy(false); }
  };

  const testMail = async () => {
    setMailBusy(true); setMailMsg(null);
    try {
      const { data } = await axios.post("/api/admin/config/test-mail", { to: testTo || smtpEmail });
      setMailMsg({ ok: true, text: data.message });
    } catch (e: any) {
      setMailMsg({ ok: false, text: e.response?.data?.error || "Test failed" });
    } finally { setMailBusy(false); }
  };

  const saveDiscord = async () => {
    setDcMsg(null);
    try {
      await axios.put("/api/admin/config", { discordEnabled: dcEnabled, discordClientId: dcId, discordClientSecret: dcSecret });
      setDcSecret("");
      setDcMsg({ ok: true, text: "Discord settings saved." });
      load();
    } catch (e: any) {
      setDcMsg({ ok: false, text: e.response?.data?.error || "Failed to save" });
    }
  };

  const verifyDomain = async () => {
    setDomBusy(true); setDomMsg(null);
    try {
      const { data } = await axios.post("/api/admin/config/domain/verify", { domain, scheme });
      setDomMsg({ ok: data.ok, text: data.message });
      if (data.ok) load();
    } catch (e: any) {
      setDomMsg({ ok: false, text: e.response?.data?.message || e.response?.data?.error || "Verification failed" });
    } finally { setDomBusy(false); }
  };

  const useLocal = async () => {
    setDomBusy(true); setDomMsg(null);
    try {
      const { data } = await axios.post("/api/admin/config/local-mode", { ip: localIp });
      setDomMsg({ ok: true, text: `Local mode on. Servers are shown as ${data.ip}:<port>.` });
      setDomain(""); load();
    } catch (e: any) {
      setDomMsg({ ok: false, text: e.response?.data?.error || "Could not switch" });
    } finally { setDomBusy(false); }
  };

  const removeDomain = async () => {
    if (!confirm("Remove the panel domain? Servers will show the host you open the panel on instead.")) return;
    await axios.delete("/api/admin/config/domain");
    setDomain("");
    setDomMsg({ ok: true, text: "Domain removed." });
    load();
  };

  if (!cfg) return null;

  return (
    <>
      {/* ---------------- Domain ---------------- */}
      <div className={card}>
        <h2 className="text-xl font-bold flex items-center text-foreground mb-1">
          <Globe className="mr-3 text-theme-500 w-6 h-6" /> Panel Domain
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Servers are shown as <b>domain:port</b>. Point an <b>A record</b> to <span className="font-mono text-foreground">{cfg.serverIp || "this server's IP"}</span>, then verify.
          Players can also join with the server IP + the same port.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <input className={input} placeholder="panel.example.com" value={domain} onChange={e => setDomain(e.target.value)} />
          <select className={input + " sm:w-32"} value={scheme} onChange={e => setScheme(e.target.value)}>
            <option value="https">https</option>
            <option value="http">http</option>
          </select>
          <button onClick={verifyDomain} disabled={domBusy || !domain} className={btn + " bg-theme-700 text-white"}>
            {domBusy ? "Checking DNS..." : cfg.domainVerified && cfg.panelDomain === domain ? "Re-verify" : "Verify & Save"}
          </button>
        </div>
        {cfg.domainVerified && (
          <p className="mt-3 text-sm text-emerald-400 flex items-center gap-2">
            <CheckCircle2 size={16} /> Active: {cfg.panelScheme}://{cfg.panelDomain}
            <button onClick={removeDomain} className="ml-3 text-xs text-red-400 underline">remove</button>
          </p>
        )}
        <Msg m={domMsg} />
        <div className="mt-5 pt-5 border-t border-border-subtle">
          <div className="text-sm font-medium text-foreground mb-1">
            Local network mode {cfg.accessMode === "local" && <span className="ml-2 text-xs text-emerald-400">active</span>}
          </div>
          <p className="text-xs text-muted-foreground mb-3">No domain: servers are shown as <b>local IP:port</b> (VPS private IP, or your phone's Wi-Fi IP). Reachable from devices on the same network.</p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input className={input} placeholder="192.168.1.20" value={localIp} onChange={e => setLocalIp(e.target.value)} />
            <button onClick={useLocal} disabled={domBusy || !localIp} className={btn + " border border-border text-foreground"}>Use local IP</button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Note: this checks DNS and saves the domain for server addresses and email/Discord links. To serve the panel itself on 80/443 with HTTPS, use the installer's domain step (it sets up Caddy).
        </p>
      </div>

      {/* ---------------- Email ---------------- */}
      <div className={card}>
        <h2 className="text-xl font-bold flex items-center text-foreground mb-1">
          <Mail className="mr-3 text-theme-500 w-6 h-6" /> Email (Password Reset)
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Uses Gmail SMTP. Enter the sender Gmail and a 16-character <b>App Password</b> —{" "}
          <a className="text-theme-500 underline inline-flex items-center gap-1" target="_blank" rel="noreferrer" href="https://myaccount.google.com/apppasswords">
            create one <ExternalLink size={12} />
          </a>{" "}
          (needs 2-Step Verification on).
        </p>
        <div className="grid md:grid-cols-2 gap-3">
          <input className={input} type="email" placeholder="yourpanel@gmail.com" value={smtpEmail} onChange={e => setSmtpEmail(e.target.value)} />
          <input className={input} type="password" autoComplete="new-password"
            placeholder={cfg.smtpAppPasswordSet ? "•••••••• (saved — type to replace)" : "App password (16 characters)"}
            value={smtpPass} onChange={e => setSmtpPass(e.target.value)} />
        </div>
        <div className="flex flex-col sm:flex-row gap-3 mt-3">
          <button onClick={saveMail} disabled={mailBusy} className={btn + " bg-theme-700 text-white"}>Save Email Settings</button>
          <input className={input + " sm:max-w-xs"} placeholder="Send test to (optional)" value={testTo} onChange={e => setTestTo(e.target.value)} />
          <button onClick={testMail} disabled={mailBusy || !cfg.smtpAppPasswordSet} className={btn + " border border-border text-foreground flex items-center gap-2"}>
            <Send size={14} /> Send test email
          </button>
        </div>
        <Msg m={mailMsg} />
      </div>

      {/* ---------------- Discord ---------------- */}
      <div className={card}>
        <h2 className="text-xl font-bold flex items-center text-foreground mb-1">
          <svg width="24" height="24" viewBox="0 0 24 24" className="mr-3 text-theme-500" fill="currentColor"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.2.5a18.3 18.3 0 0 0-6.4 0L8.6 3a19.8 19.8 0 0 0-4.9 1.4C.6 9 0 13.5.3 18a19.9 19.9 0 0 0 6 3l1.3-2.1c-.7-.3-1.4-.6-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.9 19.9 0 0 0 6-3c.5-5.2-.8-9.7-3.8-13.6z"/></svg>
          Discord Login
        </h2>
        <ol className="text-sm text-muted-foreground mb-4 list-decimal pl-5 space-y-1">
          <li>Open <a className="text-theme-500 underline" target="_blank" rel="noreferrer" href="https://discord.com/developers/applications">Discord Developer Portal</a> → New Application.</li>
          <li>OAuth2 → add this Redirect URI exactly:
            <div className="mt-1 flex items-center gap-2 font-mono text-xs text-foreground bg-background border border-border rounded-lg px-3 py-2 select-all break-all">
              {cfg.discordRedirectUri}
              <button onClick={() => navigator.clipboard.writeText(cfg.discordRedirectUri)} title="Copy"><Copy size={14} /></button>
            </div>
          </li>
          <li>Copy the Client ID and Client Secret below.</li>
        </ol>
        <div className="grid md:grid-cols-2 gap-3">
          <input className={input} placeholder="Client ID" value={dcId} onChange={e => setDcId(e.target.value)} />
          <input className={input} type="password" autoComplete="new-password"
            placeholder={cfg.discordClientSecretSet ? "•••••••• (saved — type to replace)" : "Client Secret"}
            value={dcSecret} onChange={e => setDcSecret(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 mt-3 text-sm text-foreground">
          <input type="checkbox" checked={dcEnabled} onChange={e => setDcEnabled(e.target.checked)} /> Enable "Sign in with Discord"
        </label>
        <button onClick={saveDiscord} className={btn + " bg-theme-700 text-white mt-3"}>Save Discord Settings</button>
        <Msg m={dcMsg} />
      </div>
    </>
  );
}
