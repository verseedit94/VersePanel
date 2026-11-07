import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { ImageCropper } from "./ImageCropper";
import { Palette, Image as ImageIcon, Save, Upload, Trash2, RefreshCw, AlignCenter, CheckCircle2, AlertTriangle } from "lucide-react";

/* ---------------- Minecraft colour / format helpers ---------------- */

const COLORS: { code: string; name: string; hex: string }[] = [
  { code: "0", name: "Black", hex: "#000000" },
  { code: "1", name: "Dark Blue", hex: "#0000AA" },
  { code: "2", name: "Dark Green", hex: "#00AA00" },
  { code: "3", name: "Dark Aqua", hex: "#00AAAA" },
  { code: "4", name: "Dark Red", hex: "#AA0000" },
  { code: "5", name: "Dark Purple", hex: "#AA00AA" },
  { code: "6", name: "Gold", hex: "#FFAA00" },
  { code: "7", name: "Gray", hex: "#AAAAAA" },
  { code: "8", name: "Dark Gray", hex: "#555555" },
  { code: "9", name: "Blue", hex: "#5555FF" },
  { code: "a", name: "Green", hex: "#55FF55" },
  { code: "b", name: "Aqua", hex: "#55FFFF" },
  { code: "c", name: "Red", hex: "#FF5555" },
  { code: "d", name: "Light Purple", hex: "#FF55FF" },
  { code: "e", name: "Yellow", hex: "#FFFF55" },
  { code: "f", name: "White", hex: "#FFFFFF" }
];
const COLOR_HEX: Record<string, string> = Object.fromEntries(COLORS.map(c => [c.code, c.hex]));

const FORMATS = [
  { code: "l", label: "B", title: "Bold", cls: "font-bold" },
  { code: "o", label: "I", title: "Italic", cls: "italic" },
  { code: "n", label: "U", title: "Underline", cls: "underline" },
  { code: "m", label: "S", title: "Strikethrough", cls: "line-through" },
  { code: "k", label: "?", title: "Obfuscated (random characters)", cls: "" },
  { code: "r", label: "R", title: "Reset", cls: "" }
];

interface Span {
  text: string;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  obf: boolean;
}

/** Parses "&aHello &lWorld" / "&#ff8800Hex" into styled spans (colour codes reset formats, like Minecraft). */
function parseMotd(line: string): Span[] {
  const spans: Span[] = [];
  let st = { color: "#AAAAAA", bold: false, italic: false, underline: false, strike: false, obf: false };
  let buf = "";
  const flush = () => {
    if (buf) spans.push({ text: buf, ...st });
    buf = "";
  };
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "&") {
      const hex = line.slice(i + 1, i + 8).match(/^#([0-9a-fA-F]{6})/);
      if (hex) {
        flush();
        st = { color: "#" + hex[1], bold: false, italic: false, underline: false, strike: false, obf: false };
        i += 7;
        continue;
      }
      const c = (line[i + 1] || "").toLowerCase();
      if (COLOR_HEX[c]) {
        flush();
        st = { color: COLOR_HEX[c], bold: false, italic: false, underline: false, strike: false, obf: false };
        i++;
        continue;
      }
      if ("lonmkr".includes(c) && c) {
        flush();
        if (c === "l") st = { ...st, bold: true };
        else if (c === "o") st = { ...st, italic: true };
        else if (c === "n") st = { ...st, underline: true };
        else if (c === "m") st = { ...st, strike: true };
        else if (c === "k") st = { ...st, obf: true };
        else st = { color: "#AAAAAA", bold: false, italic: false, underline: false, strike: false, obf: false };
        i++;
        continue;
      }
    }
    buf += line[i];
  }
  flush();
  return spans;
}

const visibleLength = (line: string) => parseMotd(line).reduce((n, s) => n + s.text.length, 0);

/** server.properties value -> editable "&" text (two lines). */
function decodeMotd(raw: string): [string, string] {
  // Java .properties escapes: \uXXXX, \n, \\ (anything else after a backslash is taken literally)
  let v = raw.replace(/\\(u[0-9a-fA-F]{4}|n|\\|.)/g, (_m, g: string) =>
    g.length === 5 && g[0] === "u" ? String.fromCharCode(parseInt(g.slice(1), 16)) : g === "n" ? "\n" : g
  );
  // §x§r§r§g§g§b§b  ->  &#rrggbb
  v = v.replace(/§x((?:§[0-9a-fA-F]){6})/g, (_m, g: string) => "&#" + g.replace(/§/g, ""));
  v = v.replace(/§/g, "&");
  const parts = v.split("\n");
  return [parts[0] || "", parts[1] || ""];
}

/** "&" text -> server.properties value (all non-ASCII escaped for Java .properties). */
function encodeMotd(l1: string, l2: string): string {
  const conv = (s: string) =>
    s
      .replace(/&#([0-9a-fA-F]{6})/g, (_m, h: string) => "§x" + h.split("").map(ch => "§" + ch.toLowerCase()).join(""))
      .replace(/&([0-9a-fA-Fk-oK-OrR])/g, "§$1");
  const joined = l2.trim() ? `${conv(l1)}\n${conv(l2)}` : conv(l1);
  let out = "";
  for (const ch of joined) {
    if (ch === "\n") out += "\\n";
    else if (ch === "\\") out += "\\\\";
    else {
      const code = ch.codePointAt(0)!;
      if (code > 126) {
        if (code > 0xffff) {
          const c = code - 0x10000;
          const hi = 0xd800 + (c >> 10);
          const lo = 0xdc00 + (c & 0x3ff);
          out += "\\u" + hi.toString(16).toUpperCase().padStart(4, "0") + "\\u" + lo.toString(16).toUpperCase().padStart(4, "0");
        } else out += "\\u" + code.toString(16).toUpperCase().padStart(4, "0");
      } else out += ch;
    }
  }
  return out;
}

const PRESETS: { name: string; l1: string; l2: string }[] = [
  { name: "Classic", l1: "&a&lMy Minecraft Server", l2: "&7Survival &8| &eJoin now!" },
  { name: "Network", l1: "&6&l✦ &e&lSERVER NAME &6&l✦", l2: "&b1.21 &8» &fPlay with friends" },
  { name: "Minimal", l1: "&f&lWelcome", l2: "&8Have fun and be kind" }
];

/* ---------------- Component ---------------- */

export default function ServerCustomize({ serverId }: { serverId: string }) {
  const [line1, setLine1] = useState("&a&lMy Minecraft Server");
  const [line2, setLine2] = useState("&7Survival &8| &eJoin now!");
  const [propsExist, setPropsExist] = useState<boolean | null>(null);
  const [motdMsg, setMotdMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const active = useRef<1 | 2>(1);
  const ref1 = useRef<HTMLInputElement>(null);
  const ref2 = useRef<HTMLInputElement>(null);
  const [, tick] = useState(0);

  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [iconBusy, setIconBusy] = useState(false);
  const [iconMsg, setIconMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadMotd = async () => {
    try {
      const res = await axios.get(`/api/servers/${serverId}/files`, { params: { path: "server.properties" } });
      if (res.data?.isFile) {
        setPropsExist(true);
        const m = String(res.data.content).match(/^motd=(.*)$/m);
        if (m) {
          const [a, b] = decodeMotd(m[1].replace(/\r$/, ""));
          setLine1(a);
          setLine2(b);
        }
      } else setPropsExist(false);
    } catch {
      setPropsExist(false);
    }
  };

  const loadIcon = async () => {
    try {
      const res = await axios.get(`/api/servers/${serverId}/files/download`, { params: { path: "server-icon.png" }, responseType: "blob" });
      if (res.data && res.data.size > 0 && String(res.data.type).startsWith("image")) {
        setIconUrl(prev => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(res.data);
        });
      } else setIconUrl(null);
    } catch {
      setIconUrl(null);
    }
  };

  useEffect(() => {
    loadMotd();
    loadIcon();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  const insertCode = (code: string) => {
    const which = active.current;
    const el = which === 1 ? ref1.current : ref2.current;
    const val = which === 1 ? line1 : line2;
    const set = which === 1 ? setLine1 : setLine2;
    const start = el?.selectionStart ?? val.length;
    const end = el?.selectionEnd ?? val.length;
    const next = val.slice(0, start) + code + val.slice(end);
    set(next);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + code.length;
      el?.setSelectionRange(pos, pos);
    });
  };

  const center = (which: 1 | 2) => {
    const val = which === 1 ? line1 : line2;
    const trimmed = val.replace(/^ +/, "");
    const pad = Math.max(0, Math.floor((59 - visibleLength(trimmed)) / 2));
    (which === 1 ? setLine1 : setLine2)(" ".repeat(pad) + trimmed);
  };

  const saveMotd = async () => {
    setMotdMsg(null);
    try {
      setSaving(true);
      const res = await axios.get(`/api/servers/${serverId}/files`, { params: { path: "server.properties" } });
      if (!res.data?.isFile) {
        setMotdMsg({ text: "server.properties not found — start the server once so it gets generated, then try again.", ok: false });
        return;
      }
      const encoded = encodeMotd(line1, line2);
      let content: string = res.data.content;
      if (/^motd=.*$/m.test(content)) content = content.replace(/^motd=.*$/m, () => `motd=${encoded}`);
      else content = content.replace(/\s*$/, "\n") + `motd=${encoded}\n`;
      await axios.post(`/api/servers/${serverId}/files/save`, { filePath: "server.properties", content });
      setMotdMsg({ text: "MOTD saved. Restart the server to see it in the server list.", ok: true });
    } catch (e: any) {
      setMotdMsg({ text: e.response?.data?.error || "Failed to save MOTD.", ok: false });
    } finally {
      setSaving(false);
    }
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setIconMsg({ text: "Please choose an image file (PNG/JPG/WebP).", ok: false });
      return;
    }
    if (f.size > 8 * 1024 * 1024) {
      setIconMsg({ text: "Image is too large (max 8 MB).", ok: false });
      return;
    }
    setIconMsg(null);
    const r = new FileReader();
    r.onload = () => setCropSrc(String(r.result));
    r.readAsDataURL(f);
  };

  const uploadIcon = async (croppedDataUrl: string) => {
    setCropSrc(null);
    try {
      setIconBusy(true);
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Could not read the cropped image"));
        img.src = croppedDataUrl;
      });
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      const side = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 64, 64);
      const blob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error("PNG conversion failed"))), "image/png")
      );
      const fd = new FormData();
      fd.append("path", "/");
      fd.append("file", blob, "server-icon.png");
      await axios.post(`/api/servers/${serverId}/files/upload`, fd);
      setIconMsg({ text: "Icon uploaded (64×64 PNG). Restart the server to show it.", ok: true });
      await loadIcon();
    } catch (e: any) {
      setIconMsg({ text: e.response?.data?.error || e.message || "Icon upload failed.", ok: false });
    } finally {
      setIconBusy(false);
    }
  };

  const removeIcon = async () => {
    if (!confirm("Remove the server icon?")) return;
    try {
      setIconBusy(true);
      await axios.delete(`/api/servers/${serverId}/files`, { data: { paths: ["server-icon.png"] } });
      setIconUrl(null);
      setIconMsg({ text: "Icon removed.", ok: true });
    } catch (e: any) {
      setIconMsg({ text: e.response?.data?.error || "Failed to remove icon.", ok: false });
    } finally {
      setIconBusy(false);
    }
  };

  const Preview = ({ line }: { line: string }) => (
    <div className="whitespace-pre font-mono text-[15px] leading-5 h-5 overflow-hidden">
      {parseMotd(line).map((s, i) => (
        <span
          key={i}
          className={s.obf ? "animate-pulse" : ""}
          style={{
            color: s.color,
            fontWeight: s.bold ? 700 : 400,
            fontStyle: s.italic ? "italic" : "normal",
            textDecoration: [s.underline ? "underline" : "", s.strike ? "line-through" : ""].filter(Boolean).join(" ") || "none",
            letterSpacing: s.obf ? "0.15em" : undefined
          }}
        >
          {s.obf ? s.text.replace(/\S/g, "▒") : s.text}
        </span>
      ))}
    </div>
  );

  const Msg = ({ m }: { m: { text: string; ok: boolean } | null }) =>
    m ? (
      <div
        className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
          m.ok ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-rose-500/10 border-rose-500/30 text-rose-400"
        }`}
      >
        {m.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />} {m.text}
      </div>
    ) : null;

  const card = "bg-black/40 backdrop-blur-xl border border-border rounded-3xl p-5 md:p-6 ring-1 ring-border-subtle space-y-5";

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-8 text-foreground bg-transparent">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-foreground flex items-center">
            <Palette className="w-6 h-6 mr-2 text-theme-500" /> Customize
          </h2>
          <p className="text-[11px] font-bold text-theme-500/80 uppercase tracking-widest mt-1">MOTD maker &amp; server icon — how your server looks in the multiplayer list.</p>
        </div>

        {/* ---------------- MOTD ---------------- */}
        <div className={card}>
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <Palette className="w-4 h-4 text-theme-500" /> MOTD Maker
          </h3>

          {/* live preview (looks like the Minecraft server list entry) */}
          <div className="rounded-xl p-3 flex gap-3 items-center" style={{ background: "#1a1a1a", border: "2px solid #3a3a3a" }}>
            <div className="w-16 h-16 shrink-0 bg-black/60 flex items-center justify-center overflow-hidden" style={{ imageRendering: "pixelated" }}>
              {iconUrl ? <img src={iconUrl} alt="icon" className="w-full h-full" style={{ imageRendering: "pixelated" }} /> : <ImageIcon className="w-6 h-6 text-zinc-600" />}
            </div>
            <div className="min-w-0 flex-1 overflow-hidden">
              <Preview line={line1} />
              <Preview line={line2} />
            </div>
          </div>

          <div className="space-y-3">
            {([1, 2] as const).map(n => (
              <div key={n} className="flex gap-2 items-center">
                <input
                  ref={n === 1 ? ref1 : ref2}
                  value={n === 1 ? line1 : line2}
                  onFocus={() => {
                    active.current = n;
                    tick(x => x + 1);
                  }}
                  onChange={e => (n === 1 ? setLine1 : setLine2)(e.target.value)}
                  placeholder={n === 1 ? "Line 1 — e.g. &a&lMy Server" : "Line 2 (optional)"}
                  spellCheck={false}
                  className="flex-1 min-w-0 bg-muted-subtle border border-border rounded-lg py-2 px-3 text-sm font-mono text-foreground focus:outline-none focus:border-theme-600"
                />
                <span className={`text-[10px] w-10 text-right ${visibleLength(n === 1 ? line1 : line2) > 59 ? "text-rose-400" : "text-muted-foreground"}`}>
                  {visibleLength(n === 1 ? line1 : line2)}/59
                </span>
                <button type="button" title="Center this line" onClick={() => center(n)} className="p-2 rounded-lg bg-muted hover:bg-muted-hover text-muted-foreground hover:text-foreground">
                  <AlignCenter className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {COLORS.map(c => (
                <button
                  key={c.code}
                  type="button"
                  title={`${c.name} (&${c.code})`}
                  onClick={() => insertCode("&" + c.code)}
                  className="w-7 h-7 rounded-md border border-white/20 hover:scale-110 transition-transform"
                  style={{ background: c.hex }}
                />
              ))}
              <label title="Custom hex colour (Minecraft 1.16+)" className="w-7 h-7 rounded-md border border-white/20 overflow-hidden cursor-pointer relative bg-gradient-to-br from-pink-500 via-yellow-400 to-cyan-400">
                <input
                  type="color"
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  onChange={e => insertCode("&" + e.target.value)}
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FORMATS.map(f => (
                <button
                  key={f.code}
                  type="button"
                  title={`${f.title} (&${f.code})`}
                  onClick={() => insertCode("&" + f.code)}
                  className={`px-3 h-7 rounded-md bg-muted hover:bg-muted-hover text-xs text-foreground ${f.cls}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Presets:</span>
            {PRESETS.map(p => (
              <button
                key={p.name}
                type="button"
                onClick={() => {
                  setLine1(p.l1);
                  setLine2(p.l2);
                }}
                className="px-2.5 py-1 rounded-md bg-muted hover:bg-muted-hover text-xs text-foreground-muted"
              >
                {p.name}
              </button>
            ))}
          </div>

          <Msg m={motdMsg} />
          {propsExist === false && !motdMsg && (
            <Msg m={{ ok: false, text: "server.properties doesn't exist yet — start the server once, then save your MOTD." }} />
          )}

          <div className="flex justify-end">
            <button
              onClick={saveMotd}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-theme-600 hover:bg-theme-700 text-foreground transition-colors flex items-center disabled:opacity-50"
            >
              {saving ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />} Save MOTD
            </button>
          </div>
        </div>

        {/* ---------------- Icon ---------------- */}
        <div className={card}>
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-theme-500" /> Server Icon
          </h3>
          <div className="flex flex-col sm:flex-row gap-5 sm:items-center">
            <div className="w-24 h-24 rounded-xl bg-black/60 border border-border flex items-center justify-center overflow-hidden shrink-0">
              {iconUrl ? <img src={iconUrl} alt="Server icon" className="w-full h-full" style={{ imageRendering: "pixelated" }} /> : <ImageIcon className="w-8 h-8 text-zinc-600" />}
            </div>
            <div className="space-y-3 flex-1">
              <p className="text-xs text-muted-foreground">
                Choose any image — you can crop it square and it is converted to the required <b>64×64 PNG</b> (<code>server-icon.png</code>) automatically.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={iconBusy}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-theme-600 hover:bg-theme-700 text-foreground transition-colors flex items-center disabled:opacity-50"
                >
                  {iconBusy ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />} Upload icon
                </button>
                {iconUrl && (
                  <button
                    onClick={removeIcon}
                    disabled={iconBusy}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-muted hover:bg-rose-500/10 hover:text-rose-400 text-foreground-muted transition-colors flex items-center disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4 mr-2" /> Remove
                  </button>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
            </div>
          </div>
          <Msg m={iconMsg} />
        </div>
      </div>

      {cropSrc && <ImageCropper imageSrc={cropSrc} aspectRatio={1} title="Crop Server Icon" onCancel={() => setCropSrc(null)} onCropComplete={uploadIcon} />}
    </div>
  );
}
