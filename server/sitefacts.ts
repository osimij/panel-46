// What a saved website is really made of, measured in the page rather than guessed from a
// screenshot: the fonts its text is set in (and whether they have Cyrillic and Tajik
// letters), its type sizes, its colors as the CSS has them, and its corner radii.
//
// Taken once when a site is saved (desktop size), and in the background for sites saved
// before this existed. Kept on the save as JSON (refs.measured); search, the AI tools and the
// design read all use it, so "which font is this" has a real answer.

import { db, now, reindex } from "./db.ts";

export interface MeasuredFont {
  family: string;
  /** Where it's used: the big lines, the running text, or both. */
  role: "headings" | "text" | "both";
  weights: number[];
  /** Share of the page's text set in it, by size on screen (0–1). */
  share: number;
  cyrillic: boolean;
  /** Has all of Ғ ғ Ӣ ӣ Қ қ Ӯ ӯ Ҳ ҳ Ҷ ҷ. */
  tajik: boolean;
  /** Its name in the page's CSS, only while measuring (to ask Chrome about its letters). */
  css?: string;
}

export interface Measured {
  fonts: MeasuredFont[];
  /** Text sizes in px, most used first. */
  sizes: number[];
  colors: { backgrounds: string[]; text: string[]; accents: string[] };
  /** Corner radii in px, most used first. */
  radii: number[];
  /** True when the site smooths its corners (corner-shape). */
  smooth_corners: boolean;
  /** Where its font files come from (hosts), when the page says. */
  font_hosts: string[];
  at: string;
}

/** Runs inside the page. Kept as one function so it can be sent to Chrome as text. */
function measurePage(): Omit<Measured, "at"> {
  const ctx = document.createElement("canvas").getContext("2d")!;
  const width = (ch: string, fam: string, fallback: string) => {
    ctx.font = `400 48px "${fam}", ${fallback}`;
    return ctx.measureText(ch).width;
  };
  // A letter the font doesn't have is drawn by the fallback, and two fallbacks give two widths.
  const lacks = (ch: string, fam: string) => Math.abs(width(ch, fam, "monospace") - width(ch, fam, "serif")) > 0.01;
  const generic = /^(system-ui|-apple-system|blinkmacsystemfont|sans-serif|serif|monospace|ui-sans-serif|ui-serif|ui-monospace|ui-rounded|cursive|fantasy|emoji|math)$/i;
  const real = new Map<string, string | null>();
  /** The first font in the list that's really there to draw with. */
  const drawnWith = (stack: string) => {
    if (real.has(stack)) return real.get(stack)!;
    let found: string | null = null;
    for (const raw of stack.split(",")) {
      const fam = raw.replace(/["']/g, "").trim();
      if (!fam) continue;
      if (generic.test(fam)) {
        found = /mono/i.test(fam) ? "System mono" : /serif/i.test(fam) && !/sans/i.test(fam) ? "System serif" : "System UI";
        break;
      }
      if (!lacks("a", fam) || !lacks("Ж", fam)) {
        found = fam;
        break;
      }
    }
    real.set(stack, found);
    return found;
  };
  /** Build tools rename fonts ("__Inter_a1b2c3", "Inter Fallback"); give back the name a person knows. */
  const tidy = (fam: string) => fam.replace(/^_+/, "").replace(/_(Fallback_)?[0-9a-f]{6}$/i, "").replace(/_/g, " ").replace(/\s+(Fallback|Variable|VF|Var)$/i, "").trim() || fam;
  const px = (v: string) => parseFloat(v) || 0;
  const hex = (color: string): string | null => {
    const m = color.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1]!.split(/[,/ ]+/).filter(Boolean).map(Number);
    if (p.length > 3 && p[3]! < 0.5) return null;
    return "#" + p.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  };
  const sat = (h: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    return max === 0 ? 0 : (max - min) / max;
  };
  const top = <K,>(m: Map<K, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
  const add = <K,>(m: Map<K, number>, k: K, v: number) => m.set(k, (m.get(k) ?? 0) + v);

  const fonts = new Map<string, { head: number; text: number; weights: Set<number> }>();
  const sizes = new Map<number, number>(), bgs = new Map<string, number>(), inks = new Map<string, number>(), accents = new Map<string, number>(), radii = new Map<number, number>();
  let smooth = false;
  const els = [...document.querySelectorAll<HTMLElement>("body, body *")].slice(0, 6000);
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const c = getComputedStyle(el);
    if (c.visibility === "hidden" || c.display === "none" || Number(c.opacity) < 0.05) continue;

    const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? "").join("").replace(/\s+/g, " ").trim();
    if (text) {
      const size = px(c.fontSize) || 16;
      // How much of the page this text is, to the eye: letters times their area.
      const weight = Math.min(text.length, 400) * size * size;
      const fam = drawnWith(c.fontFamily);
      if (fam) {
        const f = fonts.get(fam) ?? fonts.set(fam, { head: 0, text: 0, weights: new Set() }).get(fam)!;
        if (size >= 26 || /^H[1-3]$/.test(el.tagName)) f.head += weight;
        else f.text += weight;
        f.weights.add(Math.round((Number(c.fontWeight) || 400) / 100) * 100);
      }
      add(sizes, Math.round(size), Math.min(text.length, 400));
      const ink = hex(c.color);
      if (ink) add(inks, ink, weight);
    }
    const bg = hex(c.backgroundColor);
    if (bg) {
      const area = Math.min(r.width, innerWidth) * Math.min(r.height, innerHeight * 3);
      add(bgs, bg, area);
      // A filled button or link is where a site puts its accent.
      if (el.closest("a, button, [role=button]") && sat(bg) > 0.35 && r.height < 90) add(accents, bg, area);
    }
    if (text && el.closest("a, button") && c.color && hex(c.color) && sat(hex(c.color)!) > 0.45) add(accents, hex(c.color)!, text.length * 40);
    const radius = Math.max(px(c.borderTopLeftRadius), px(c.borderTopRightRadius));
    if (radius >= 2 && r.width >= 24 && r.height >= 24 && radius < Math.min(r.width, r.height) / 2 - 0.5 && (bg || px(c.borderTopWidth) > 0 || c.overflow !== "visible")) {
      add(radii, Math.round(radius), 1);
      const shape = c.getPropertyValue("corner-top-left-shape").trim();
      if (shape && shape !== "round" && shape !== "superellipse(1)") smooth = true;
    }
  }

  const all = [...fonts.values()].reduce((s, f) => s + f.head + f.text, 0) || 1;
  const list = [...fonts.entries()]
    .map(([fam, f]) => {
      const system = fam.startsWith("System ");
      return {
        family: system ? fam : tidy(fam),
        role: (f.head > 0 && f.text > 0 ? (f.head > f.text * 8 ? "headings" : f.text > f.head * 8 ? "text" : "both") : f.head > 0 ? "headings" : "text") as "headings" | "text" | "both",
        weights: [...f.weights].sort((a, b) => a - b),
        share: Math.round(((f.head + f.text) / all) * 100) / 100,
        // Filled in afterwards, by asking Chrome which font draws each letter (site.ts glyphCoverage).
        cyrillic: system,
        tajik: system,
        css: system ? undefined : fam,
      };
    })
    .filter((f) => f.share >= 0.01)
    .sort((a, b) => b.share - a.share)
    .slice(0, 6);

  const hosts = new Set<string>();
  for (const e of performance.getEntriesByType("resource")) {
    if (/\.(woff2?|otf|ttf)(\?|$)/i.test(e.name)) {
      try {
        hosts.add(new URL(e.name).host);
      } catch {
        /* not a URL */
      }
    }
  }
  return {
    fonts: list,
    sizes: top(sizes, 8),
    colors: { backgrounds: top(bgs, 3), text: top(inks, 3), accents: top(accents, 3) },
    radii: top(radii, 4),
    smooth_corners: smooth,
    font_hosts: [...hosts].slice(0, 4),
  };
}

export const FACTS_SCRIPT = `(${measurePage.toString()})()`;

export function parseMeasured(json: string | null | undefined): Measured | null {
  if (!json) return null;
  try {
    const m = JSON.parse(json) as Measured;
    return Array.isArray(m.fonts) && m.fonts.length ? m : null;
  } catch {
    return null;
  }
}

export function measuredOf(refId: string): Measured | null {
  return parseMeasured(db.query<{ measured: string | null }, [string]>("SELECT measured FROM refs WHERE id = ?").get(refId)?.measured);
}

/** Keep what was measured with the save. An empty result is kept too ('{}'), so the site isn't visited again and again. */
export function saveMeasured(refId: string, facts: Omit<Measured, "at"> | null) {
  const value = facts?.fonts?.length ? JSON.stringify({ ...facts, at: now() }) : "{}";
  db.run("UPDATE refs SET measured = ?, updated_at = ? WHERE id = ?", [value, now(), refId]);
  reindex(refId);
}

/** A font as a short line: "Söhne (headings, 500–700)". */
export function fontLine(f: MeasuredFont) {
  const w = f.weights.length > 1 ? `${f.weights[0]}–${f.weights.at(-1)}` : String(f.weights[0] ?? "");
  const letters = f.tajik ? "has Cyrillic and Tajik letters" : f.cyrillic ? "has Cyrillic, no Tajik letters" : "Latin only";
  return `${f.family} (${[f.role === "both" ? "headings and text" : f.role, w].filter(Boolean).join(", ")}; ${letters})`;
}
