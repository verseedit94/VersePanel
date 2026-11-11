import React from "react";
import { BrowserRouter, Routes, Route, Link, Navigate, useNavigate } from "react-router-dom";
import { LogOut, CreditCard, Gamepad2, ExternalLink } from "lucide-react";
import { AuthProvider, useAuth } from "../context/AuthContext";
import Landing from "./Landing";
import PlanCards from "./PlanCards";
import PortalAuth from "./PortalAuth";
import BillingDashboard from "./BillingDashboard";
import { usePublic, ssoUrl } from "./portalApi";
import "./portal.css";

type Mode = "website" | "billing";

function Shell({ mode }: { mode: Mode }) {
  const { user, loading, logout } = useAuth() as any;
  const { data, error } = usePublic();
  const nav = useNavigate();
  if (error) return <div className="aura-root flex items-center justify-center p-8 text-white/70">{error}</div>;
  if (!data || loading) return <div className="aura-root flex items-center justify-center"><div className="h-12 w-12 rounded-full border-4 border-violet-500 border-t-transparent animate-spin" /></div>;

  const out = () => { logout(); nav("/"); };
  const billingLink = mode === "website" ? ssoUrl(data.links.billing) : "";
  const panelLink = ssoUrl(data.links.panel);
  const websiteLink = mode === "billing" ? data.links.website : "";
  const pill = "inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3.5 py-1.5 text-sm font-semibold text-white/90 hover:bg-white/10";

  return (
    <div className="aura-root">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#06040d]/75 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2 font-black text-xl tracking-tight"><span className="h-8 w-8 rounded-lg aura-btn inline-flex items-center justify-center text-sm">⚡</span><span className="aura-shimmer">{data.brand}</span></Link>
          <nav className="flex items-center gap-2 flex-wrap justify-end">
            {mode === "website" && <a href="/#plans" className="hidden sm:inline text-sm font-semibold text-white/70 hover:text-white px-2">Plans</a>}
            {websiteLink && <a href={websiteLink} className="hidden sm:inline text-sm font-semibold text-white/70 hover:text-white px-2">Website</a>}
            <a href={data.discord} target="_blank" rel="noreferrer" className="hidden sm:inline-flex items-center gap-1 text-sm font-semibold text-white/70 hover:text-white px-2">Discord <ExternalLink size={12} /></a>
            {user ? (
              <>
                {mode === "billing" && <Link to="/" className={pill}><CreditCard size={14} /> Billing</Link>}
                {billingLink && <a href={billingLink} className={pill}><CreditCard size={14} /> Billing</a>}
                {panelLink && <a href={panelLink} className={pill}><Gamepad2 size={14} /> Panel</a>}
                <span className="hidden md:inline text-sm text-white/50 px-1">{user.username}</span>
                <button onClick={out} className={pill} title="Logout"><LogOut size={14} /></button>
              </>
            ) : (
              <>
                <Link to="/login" className={pill}>Login</Link>
                <Link to="/register" className="aura-btn rounded-full px-4 py-1.5 text-sm font-bold text-white">Register</Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="relative">
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/" /> : <PortalAuth kind="login" />} />
          <Route path="/register" element={user ? <Navigate to="/" /> : <PortalAuth kind="register" />} />
          {mode === "website" ? (
            <Route path="*" element={<Landing data={data} />} />
          ) : (
            <>
              <Route path="/" element={user ? <BillingDashboard /> : <Navigate to="/login" />} />
              <Route path="/plans" element={<div className="max-w-6xl mx-auto px-4 py-12"><PlanCards data={data} /></div>} />
              <Route path="*" element={<Navigate to="/" />} />
            </>
          )}
        </Routes>
      </main>

      <footer className="border-t border-white/10 mt-10 py-8 text-center text-sm text-white/40">
        © {new Date().getFullYear()} {data.brand} — powered by performance ⚡
      </footer>
    </div>
  );
}

export default function PortalApp({ mode }: { mode: Mode }) {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Shell mode={mode} />
      </BrowserRouter>
    </AuthProvider>
  );
}
