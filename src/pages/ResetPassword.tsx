// @ts-nocheck
import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { Lock, ArrowRight, Server } from "lucide-react";
import { motion } from "framer-motion";
import { useSettings } from "../context/SettingsContext";

export default function ResetPassword() {
  const { panelName, panelLogo } = useSettings();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 6) return setError("Password must be at least 6 characters");
    if (password !== confirm) return setError("Passwords do not match");
    setLoading(true);
    try {
      await axios.post("/api/auth/reset-password", { token, password, confirmPassword: confirm });
      setDone(true);
      setTimeout(() => navigate("/login"), 1800);
    } catch (err: any) {
      setError(err.response?.data?.error || "Could not reset password.");
    } finally {
      setLoading(false);
    }
  };

  const field = "w-full bg-card border border-border focus:border-theme-600 focus:ring-1 focus:ring-theme-600 rounded-xl py-3 pl-10 pr-4 outline-none";

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background text-foreground p-6">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8">
          {panelLogo ? (
            <img src={panelLogo} alt="Logo" className="w-10 h-10 rounded-xl object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-xl bg-theme-700 flex items-center justify-center text-white"><Server size={20} /></div>
          )}
          <h1 className="text-2xl font-bold">{panelName}</h1>
        </div>
        <h2 className="text-3xl font-bold mb-2">Set a new password</h2>
        <p className="text-muted-foreground mb-6">Choose a new password for your account.</p>

        {!token ? (
          <div className="p-3 bg-theme-500/10 border border-theme-500/20 text-theme-400 text-sm rounded-lg">
            This reset link is invalid. <Link to="/forgot-password" className="underline">Request a new one</Link>.
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {error && <div className="p-3 bg-theme-500/10 border border-theme-500/20 text-theme-400 text-sm rounded-lg">{error}</div>}
            {done && <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm rounded-lg">Password updated! Redirecting to sign in...</div>}
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-5 h-5" />
              <input type="password" required placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-5 h-5" />
              <input type="password" required placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={field} />
            </div>
            <button type="submit" disabled={loading || done}
              className="w-full flex items-center justify-center gap-2 bg-theme-700 text-white py-3 rounded-xl font-medium disabled:opacity-50">
              {loading ? "Saving..." : "Update password"} {!loading && <ArrowRight size={18} />}
            </button>
          </form>
        )}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link to="/login" className="text-theme-500 hover:text-theme-300 font-medium">Back to sign in</Link>
        </p>
      </motion.div>
    </div>
  );
}
