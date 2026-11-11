// @ts-nocheck
import React, { useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { Mail, ArrowRight, Server } from "lucide-react";
import { motion } from "framer-motion";
import { useSettings } from "../context/SettingsContext";

export default function ForgotPassword() {
  const { panelName, panelLogo } = useSettings();
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMsg("");
    setLoading(true);
    try {
      const res = await axios.post("/api/auth/forgot-password", { email });
      setMsg(res.data?.message || "If an account with that email exists, a reset link has been sent.");
    } catch (err: any) {
      setError(err.response?.data?.error || "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  };

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
        <h2 className="text-3xl font-bold mb-2">Forgot password?</h2>
        <p className="text-muted-foreground mb-6">Enter your account email and we'll send you a reset link.</p>

        <form onSubmit={submit} className="space-y-4">
          {error && <div className="p-3 bg-theme-500/10 border border-theme-500/20 text-theme-400 text-sm rounded-lg">{error}</div>}
          {msg && <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm rounded-lg">{msg}</div>}
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-5 h-5" />
            <input
              type="email" required placeholder="you@example.com" value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-card border border-border focus:border-theme-600 focus:ring-1 focus:ring-theme-600 rounded-xl py-3 pl-10 pr-4 outline-none"
            />
          </div>
          <button type="submit" disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-theme-700 text-white py-3 rounded-xl font-medium disabled:opacity-50">
            {loading ? "Sending..." : "Send reset link"} {!loading && <ArrowRight size={18} />}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link to="/login" className="text-theme-500 hover:text-theme-300 font-medium">Back to sign in</Link>
        </p>
      </motion.div>
    </div>
  );
}
