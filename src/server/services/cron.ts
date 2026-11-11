// Minimal 5-field cron: minute hour day-of-month month day-of-week.
// Supports star, lists, ranges and steps (for example every-5-minutes or 1-10 step 2).
export interface ParsedCron {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domStar: boolean;
  dowStar: boolean;
}

function parseField(raw: string, min: number, max: number, wrap7 = false): Set<number> {
  const out = new Set<number>();
  for (const part of raw.split(",")) {
    if (!part) throw new Error("empty value");
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) throw new Error(`bad step "${part}"`);
    let lo: number, hi: number;
    if (rangePart === "*") {
      lo = min; hi = max;
    } else if (/^\d+$/.test(rangePart)) {
      lo = Number(rangePart);
      hi = stepPart === undefined ? lo : max;
    } else if (/^\d+-\d+$/.test(rangePart)) {
      [lo, hi] = rangePart.split("-").map(Number);
    } else throw new Error(`bad value "${part}"`);
    if (lo < min || hi > (wrap7 ? 7 : max) || lo > hi) throw new Error(`"${part}" is out of range (${min}-${max})`);
    for (let v = lo; v <= hi; v += step) out.add(wrap7 && v === 7 ? 0 : v);
  }
  return out;
}

export function parseCron(expr: string): ParsedCron {
  const f = String(expr || "").trim().split(/\s+/);
  if (f.length !== 5) throw new Error("Cron needs 5 fields: minute hour day-of-month month day-of-week");
  return {
    minute: parseField(f[0], 0, 59),
    hour: parseField(f[1], 0, 23),
    dom: parseField(f[2], 1, 31),
    month: parseField(f[3], 1, 12),
    dow: parseField(f[4], 0, 6, true),
    domStar: f[2] === "*" || f[2].startsWith("*/"),
    dowStar: f[4] === "*" || f[4].startsWith("*/")
  };
}

function dayMatches(c: ParsedCron, d: Date) {
  const domOk = c.dom.has(d.getDate());
  const dowOk = c.dow.has(d.getDay());
  // Standard cron: if both day fields are restricted, either may match.
  if (!c.domStar && !c.dowStar) return domOk || dowOk;
  return domOk && dowOk;
}

export function cronMatches(c: ParsedCron, d: Date) {
  return c.minute.has(d.getMinutes()) && c.hour.has(d.getHours()) && c.month.has(d.getMonth() + 1) && dayMatches(c, d);
}

/** Next run strictly after `from` (within ~1 year), or null. */
export function nextRun(c: ParsedCron, from = new Date()): Date | null {
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  for (let day = 0; day < 370; day++) {
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (c.month.has(dayStart.getMonth() + 1) && dayMatches(c, dayStart)) {
      const startH = day === 0 ? d.getHours() : 0;
      for (let h = startH; h < 24; h++) {
        if (!c.hour.has(h)) continue;
        const startM = day === 0 && h === d.getHours() ? d.getMinutes() : 0;
        for (let m = startM; m < 60; m++) {
          if (c.minute.has(m)) return new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), h, m, 0, 0);
        }
      }
    }
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
  }
  return null;
}
