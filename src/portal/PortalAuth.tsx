import React, { useState } from "react";
import axios from "axios";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { errMsg } from "./portalApi";

/** Login / register for the website and billing domains. The accounts are the same as in the game panel. */
export default function PortalAuth({ kind }: { kind: "login" | "register" }) {
  const { login } = useAuth() as any;
  const nav = useNavigate();
  const [f, setF] = useState({ username: "", email: "", password: "", confirm: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      if (kind === "register") {
        await axios.post("/api/auth/register", { username: f.username, email: f.email, password: f.password, confirmPassword: f.confirm });
      }
      const r = await axios.post("/api/auth/login", { username: f.username, password: f.password });
      login(r.data.token, r.data.user);
      nav("/");
    } catch (x: any) { setErr(errMsg(x)); }
    setBusy(false);
  };
  const inp = "w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-white placeholder-white/30 outline-none focus:border-violet-500";

  return (
    <div className="max-w-md mx-auto px-4 py-16">
      <form onSubmit={submit} className="rounded-3xl bg-white/5 border border-white/10 p-7 space-y-4 backdrop-blur">
        <h2 className="text-2xl font-bold text-white">{kind === "login" ? "Welcome back" : "Create your account"}</h2>
        <p className="text-sm text-white/50">One account works on the website, billing and the game panel.</p>
        <input className={inp} placeholder="Username" value={f.username} onChange={e => set("username", e.target.value)} autoComplete="username" required />
        {kind === "register" && <input className={inp} type="email" placeholder="Email" value={f.email} onChange={e => set("email", e.target.value)} autoComplete="email" required />}
        <input className={inp} type="password" placeholder="Password" value={f.password} onChange={e => set("password", e.target.value)} autoComplete={kind === "login" ? "current-password" : "new-password"} required />
        {kind === "register" && <input className={inp} type="password" placeholder="Confirm password" value={f.confirm} onChange={e => set("confirm", e.target.value)} autoComplete="new-password" required />}
        {err && <div className="text-sm text-red-400">{err}</div>}
        <button disabled={busy} className="w-full rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 py-3 font-semibold text-white disabled:opacity-50">{busy ? "Please wait…" : kind === "login" ? "Login" : "Register"}</button>
        <div className="text-center text-sm text-white/50">
          {kind === "login" ? <>No account? <Link className="text-violet-400 underline" to="/register">Register</Link></> : <>Already registered? <Link className="text-violet-400 underline" to="/login">Login</Link></>}
        </div>
      </form>
    </div>
  );
}
