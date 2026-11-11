// Ready-made parts: good, tested material that ships with Panel, so a sketch doesn't start from
// a guess. Loading animations (plain HTML and CSS versions of loading.dev), colour palettes in
// OKLCH (from oklch.fyi) and icons (Phosphor, six weights). They are files in ready/ beside
// Panel's code, not in the library: nothing here reads or writes the database.
//
// This file reads them for FRIDAY's get_ready_made tool and for the Ready-made page. Each file
// is read once, the first time it's asked for, and kept in memory (the icons are about 4 MB).
// Where each part came from, and its licence, is in ready/NOTICE.md.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const DIR = resolve(import.meta.dir, "..", "ready");

export const ICON_WEIGHTS = ["thin", "light", "regular", "bold", "fill", "duotone"] as const;
export type IconWeight = (typeof ICON_WEIGHTS)[number];
/** How many icons one answer gives at most, so an answer stays short enough to read. */
export const MAX_ICONS = 12;

export interface LoadingPart { name: string; title: string; line: string; duration_ms: number }
export interface Palette { name: string; title: string; kind: "scale" | "set"; source_url: string; light: string[]; dark: string[] }
export interface IconInfo { name: string; alias?: string; tags: string[]; categories: string[] }

const cache = new Map<string, unknown>();
function load<T>(file: string): T {
  if (!cache.has(file)) cache.set(file, JSON.parse(readFileSync(join(DIR, file), "utf8")));
  return cache.get(file) as T;
}

export const loadingParts = () => load<{ how: string; source: string; loading: LoadingPart[] }>("loading/index.json");
export const palettes = () => load<{ source: string; rights: string; steps: { step: number; for: string }[]; steps_source: string; palettes: Palette[] }>("palettes.json");
export const iconIndex = () => load<{ source: string; count: number; icons: IconInfo[] }>("icons/index.json");
/** One weight's drawings: each icon's name and the inside of its SVG, as in the package. */
export const iconDrawings = (weight: IconWeight) => load<{ version: string; weight: string; viewBox: string; icons: Record<string, string> }>(`icons/${weight}.json`).icons;

const pieces = new Map<string, string>();
/** A loading animation's piece to paste: its <style> and its markup, as in ready/loading. */
export function loadingPiece(name: string): string | null {
  if (!loadingParts().loading.some((l) => l.name === name)) return null;
  if (!pieces.has(name)) pieces.set(name, readFileSync(join(DIR, "loading", `${name}.html`), "utf8"));
  return pieces.get(name)!;
}

/** Everything the Ready-made page shows, but the drawings (it asks for one weight at a time). */
export function readyMade() {
  return {
    loading: loadingParts().loading.map((l) => ({ ...l, html: loadingPiece(l.name)! })),
    palettes: palettes(),
    icons: iconIndex(),
  };
}

/** One icon as an SVG to paste: 1em, the colour of the text around it, and silent for screen readers. */
export function iconSvg(name: string, weight: IconWeight = "regular"): string | null {
  const inner = iconDrawings(weight)[name];
  if (inner === undefined) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="1em" height="1em" fill="currentColor" aria-hidden="true">${inner}</svg>`;
}

// ---------- Finding icons by name and by the package's search words ----------

const slug = (s: string) => s.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "");

/** How well an icon answers some words: higher is better, 0 is not at all. */
function score(icon: IconInfo, words: string): number {
  const q = words.trim().toLowerCase();
  const s = slug(q);
  if (!s) return 0;
  const tokens = s.split("-").filter(Boolean);
  const parts = icon.name.split("-");
  const extra = parts.length - tokens.length;
  if (icon.name === s) return 100;
  if (icon.alias === s) return 90;
  // The package lists an icon's words most fitting first, so an earlier word counts for more.
  const at = icon.tags.indexOf(q);
  if (at >= 0) return 70 - 2 * Math.min(at, 10) - extra;
  if (tokens.every((t) => parts.includes(t))) return 60 - extra;
  if (tokens.every((t) => parts.some((p) => p.startsWith(t)))) return 45 - extra;
  const tagWords = icon.tags.flatMap((t) => t.split(/[\s-]+/));
  if (tokens.every((t) => parts.includes(t) || tagWords.includes(t))) return 35 - extra;
  if (icon.name.includes(s)) return 25 - extra;
  if (q.length >= 3 && icon.tags.some((t) => t.startsWith(q))) return 20 - extra;
  return 0;
}

/** The best icon names for some words, best first. */
export function bestIcons(words: string, count = 5): string[] {
  return iconIndex()
    .icons.map((icon) => ({ name: icon.name, s: score(icon, words) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.name.length - b.name.length || a.name.localeCompare(b.name))
    .slice(0, count)
    .map((x) => x.name);
}

/** Names that look like a mistyped one, when no words match: by how few letters differ. */
function nearNames(name: string, count = 5): string[] {
  const s = slug(name);
  const found = bestIcons(name, count);
  if (found.length) return found;
  const distance = (a: string, b: string) => {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0]!;
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const keep = row[j]!;
        row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = keep;
      }
    }
    return row[b.length]!;
  };
  return iconIndex()
    .icons.map((i) => ({ name: i.name, d: distance(s, i.name) }))
    .sort((a, b) => a.d - b.d || a.name.localeCompare(b.name))
    .slice(0, count)
    .map((x) => x.name);
}

// ---------- The answers get_ready_made gives ----------

function overview() {
  const scales = palettes().palettes;
  return [
    "Panel's ready-made parts. Paste what they give into the sketch as is: it stays one self-contained file.",
    "",
    `Loading animations (${loadingParts().loading.length}; loading: name for one):`,
    ...loadingParts().loading.map((l) => `- ${l.name}: ${l.line}`),
    "",
    `Colour scales, 12 steps in light and dark (palette: name for one): ${scales.filter((p) => p.kind === "scale").map((p) => p.name).join(", ")}.`,
    `Colour sets of 5 to 10 colours: ${scales.filter((p) => p.kind === "set").map((p) => p.name).join(", ")}.`,
    "",
    `Icons: ${iconIndex().count} (Phosphor), each in ${ICON_WEIGHTS.join(", ")}. find_icons: "trash, settings, arrow right" finds names for every icon a page needs; icons: [names] gives them.`,
  ].join("\n");
}

function loadingAnswer(name: string) {
  const piece = loadingPiece(name.trim().toLowerCase());
  if (!piece) return `There's no loading animation called "${name}". These are: ${loadingParts().loading.map((l) => l.name).join(", ")}.`;
  const part = loadingParts().loading.find((l) => l.name === name.trim().toLowerCase())!;
  return [
    `${part.title}: ${part.line}`,
    "Paste this piece as it is. Its colour is the text colour around it (color: …), its size --ld-size (1.25em when not set; e.g. --ld-size: 24px), its speed --ld-duration. It is hidden from screen readers, so put the words (Loading…) beside it. Its own @media rule keeps it still for people who ask for less motion.",
    "",
    piece.trim(),
  ].join("\n");
}

function paletteAnswer(name: string) {
  const all = palettes();
  const p = all.palettes.find((x) => x.name === slug(name) || x.title.toLowerCase() === name.trim().toLowerCase());
  if (!p) return `There's no colour palette called "${name}". These are: ${all.palettes.map((x) => x.name).join(", ")}.`;
  const same = p.light.every((c, i) => c === p.dark[i]);
  const head = `${p.title} (${p.source_url}). A starting point only when the project has no colours of its own.`;
  if (p.kind === "scale") {
    return [
      head,
      "Step: what it's for: light · dark (each mode's step plays the same role, so the CSS stays the same and only the values swap)",
      ...p.light.map((c, i) => `${i + 1}: ${all.steps[i]!.for}: ${c} · ${p.dark[i]}`),
    ].join("\n");
  }
  return [
    head,
    `A set of ${p.light.length} colours in order, with no role for each step.${same ? " The same in light and dark." : " Light · dark:"}`,
    ...p.light.map((c, i) => (same ? `${i + 1}: ${c}` : `${i + 1}: ${c} · ${p.dark[i]}`)),
  ].join("\n");
}

function findAnswer(words: string) {
  const asked = words.split(",").map((w) => w.trim()).filter(Boolean);
  if (!asked.length) return "Give the words for the icons, separated by commas: \"trash, settings, arrow right\".";
  return [
    "Icon names for each, best first (icons: [names] gives them):",
    ...asked.map((w) => {
      const found = bestIcons(w);
      return `- ${w}: ${found.length ? found.join(", ") : "nothing close; try another word"}`;
    }),
  ].join("\n");
}

function iconsAnswer(names: string[], weight: IconWeight) {
  const wanted = [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))];
  const now = wanted.slice(0, MAX_ICONS);
  const later = wanted.slice(MAX_ICONS);
  const lines = [
    `Icons in ${weight}, ready to paste. Each is 1em, so it takes its size from font-size, and its colour from the text (currentColor). They are hidden from screen readers: one that stands alone (a button with no words) needs aria-label on its button, or role="img" aria-label="…" in place of aria-hidden.`,
  ];
  for (const name of now) {
    const svg = iconSvg(name, weight);
    if (svg) lines.push(`- ${name}: ${svg}`);
    else lines.push(`- ${name}: not one of Panel's icons. Closest: ${nearNames(name).join(", ")}.`);
  }
  if (later.length) lines.push(`Only ${MAX_ICONS} at once: ask again for ${later.join(", ")}.`);
  return lines.join("\n");
}

/** The whole answer to get_ready_made: each part asked for, in turn; with nothing asked, the list. */
export function getReadyMade(a: { loading?: string; palette?: string; find_icons?: string; icons?: string[]; weight?: IconWeight }): string {
  const weight = a.weight && (ICON_WEIGHTS as readonly string[]).includes(a.weight) ? a.weight : "regular";
  const parts: string[] = [];
  if (a.loading) parts.push(loadingAnswer(a.loading));
  if (a.palette) parts.push(paletteAnswer(a.palette));
  if (a.find_icons) parts.push(findAnswer(a.find_icons));
  if (a.icons?.length) parts.push(iconsAnswer(a.icons, weight));
  return parts.length ? parts.join("\n\n") : overview();
}
