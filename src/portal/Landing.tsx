import React from "react";
import { Zap, Shield, Gamepad2, HardDrive, Rocket, Cpu, ExternalLink, Sparkles, MessageCircle } from "lucide-react";
import PlanCards from "./PlanCards";
import { PublicData, money } from "./portalApi";

const PERKS = [
  { icon: <Cpu size={22} />, t: "Ryzen 9 & EPYC power", d: "Fast CPUs so your server never lags." },
  { icon: <HardDrive size={22} />, t: "NVMe storage", d: "Quick world loading and fast backups." },
  { icon: <Shield size={22} />, t: "DDoS protection", d: "Your server stays online." },
  { icon: <Gamepad2 size={22} />, t: "Java & Bedrock", d: "Paper, Purpur, Fabric, Forge and more." },
  { icon: <Rocket size={22} />, t: "Instant reinstall", d: "Switch software in a few clicks." },
  { icon: <Zap size={22} />, t: "Premium game panel", d: "Console, files, backups and subdomains." }
];
const STEPS = [
  { n: "01", t: "Pick a plan", d: "Choose Budget, Premium, Performance or a VPS." },
  { n: "02", t: "Open a ticket", d: "Press Buy — it takes you straight to our Discord." },
  { n: "03", t: "Play", d: "We set up your server and your panel account." }
];
const FAQ = [
  ["How do I buy?", "Press “Buy now” on any plan. It opens our Discord server — create a ticket there and our team will help you order."],
  ["Which software can I run?", "Paper, Purpur, Spigot, Fabric, Forge, Velocity and Vanilla, for Java and Bedrock players."],
  ["Is there one login for everything?", "Yes. The same account works on the website, the billing portal and the game panel."],
  ["Can I change my plan later?", "Open a ticket on Discord and we will upgrade or change your plan."]
];

export default function Landing({ data }: { data: PublicData }) {
  const mc = data.plans.filter(p => p.category !== "vps");
  const from = mc.length ? Math.min(...mc.map(p => p.priceINR)) : 0;
  const software = Array.from(new Set(Object.values(data.categories).flatMap(c => c.software)));
  const marquee = [...software, ...software, ...software, ...software];
  return (
    <div>
      <section className="relative overflow-hidden">
        <div className="aura-grid" /><div className="aura-orb o1" /><div className="aura-orb o2" /><div className="aura-orb o3" />
        <div className="relative max-w-5xl mx-auto px-4 pt-24 pb-20 text-center">
          <div className="aura-in inline-flex items-center gap-2 rounded-full border border-violet-400/40 bg-violet-500/10 px-4 py-1.5 text-xs font-bold tracking-wider text-violet-200 aura-pulse"><Sparkles size={13} /> POWERED BY PERFORMANCE</div>
          <h1 className="aura-in mt-6 text-5xl sm:text-7xl font-black leading-[1.05] text-white" style={{ animationDelay: ".08s" }}>{data.brand}
            <span className="block aura-shimmer pb-2">Hosting that flies.</span></h1>
          <p className="aura-in mt-6 text-lg sm:text-xl text-white/65 max-w-2xl mx-auto" style={{ animationDelay: ".16s" }}>{data.tagline}</p>
          <div className="aura-in mt-9 flex flex-wrap justify-center gap-3" style={{ animationDelay: ".24s" }}>
            <a href="#plans" className="aura-btn rounded-2xl px-8 py-3.5 font-bold text-white">See plans — from {money(from)}</a>
            <a href={data.discord} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/5 px-8 py-3.5 font-bold text-white hover:bg-white/10"><MessageCircle size={17} /> Join Discord</a>
          </div>
          <div className="aura-in mt-14 grid grid-cols-3 gap-3 max-w-2xl mx-auto" style={{ animationDelay: ".32s" }}>
            {[[String(data.plans.length), "plans"], [money(from), "starting price"], ["Java + Bedrock", "supported"]].map(([a, b]) => (
              <div key={b} className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur px-3 py-4"><div className="text-xl sm:text-2xl font-extrabold text-white">{a}</div><div className="text-xs text-white/50 mt-0.5">{b}</div></div>
            ))}
          </div>
        </div>
      </section>

      <div className="border-y border-white/10 bg-white/[0.02] py-4 overflow-hidden">
        <div className="aura-marquee">{marquee.map((s, i) => <span key={i} className="text-sm font-semibold uppercase tracking-widest text-white/35 whitespace-nowrap">{s}</span>)}</div>
      </div>

      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="text-3xl sm:text-4xl font-black text-center text-white">Built for <span className="aura-shimmer">serious servers</span></h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PERKS.map(p => (
            <div key={p.t} className="aura-card p-6">
              <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-violet-600/40 to-fuchsia-600/30 flex items-center justify-center text-violet-200">{p.icon}</div>
              <div className="mt-4 font-bold text-white text-lg">{p.t}</div>
              <div className="text-sm text-white/60 mt-1">{p.d}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="plans" className="max-w-6xl mx-auto px-4 py-14 scroll-mt-20">
        <h2 className="text-3xl sm:text-4xl font-black text-white text-center mb-2">Choose your <span className="aura-shimmer">plan</span></h2>
        <p className="text-center text-white/50 mb-10">Pick a family, then press Buy now to open a ticket on Discord.</p>
        <PlanCards data={data} />
      </section>

      <section className="max-w-5xl mx-auto px-4 py-14">
        <div className="grid gap-4 md:grid-cols-3">
          {STEPS.map(s => (
            <div key={s.n} className="aura-card p-6">
              <div className="text-5xl font-black text-white/10">{s.n}</div>
              <div className="mt-2 font-bold text-white text-lg">{s.t}</div>
              <div className="text-sm text-white/60 mt-1">{s.d}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 py-10">
        <h2 className="text-2xl font-black text-white text-center mb-6">Questions</h2>
        <div className="space-y-3">
          {FAQ.map(([q, a]) => (
            <details key={q} className="aura-card p-4 group">
              <summary className="cursor-pointer font-semibold text-white list-none flex justify-between items-center">{q}<span className="text-violet-300 group-open:rotate-45 transition text-xl leading-none">+</span></summary>
              <p className="text-sm text-white/65 mt-3">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-4 pb-24 pt-10">
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-violet-600/40 via-fuchsia-600/25 to-blue-600/20 p-10 sm:p-14 text-center">
          <div className="aura-orb o2" style={{ top: -160, right: -100, opacity: 0.35 }} />
          <h2 className="relative text-3xl sm:text-4xl font-black text-white">Ready to level up?</h2>
          <p className="relative text-white/75 mt-3">Open a ticket in our Discord server and we will get your server running.</p>
          <a href={data.discord} target="_blank" rel="noreferrer" className="relative mt-8 inline-flex items-center gap-2 rounded-2xl bg-white px-8 py-3.5 font-bold text-violet-700 hover:scale-[1.03] transition">Open a ticket <ExternalLink size={16} /></a>
        </div>
      </section>
    </div>
  );
}
