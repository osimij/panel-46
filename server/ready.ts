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

/**
 * Panel's own words for the icons asked for most, best first. The package files some everyday
 * words under others ("close" is x, tagged "closed"; a "menu" is list), so these come before
 * what its search words find.
 */
export const OWN_WORDS: Record<string, string[]> = {
  close: ["x", "x-circle"],
  menu: ["list", "dots-three"],
  settings: ["gear", "gear-six", "sliders-horizontal"],
  search: ["magnifying-glass"],
  delete: ["trash", "trash-simple"],
  edit: ["pencil-simple", "pencil"],
  add: ["plus", "plus-circle"],
  back: ["arrow-left", "caret-left"],
  more: ["dots-three", "dots-three-vertical"],
  home: ["house", "house-simple"],
  user: ["user", "user-circle"],
  download: ["download-simple", "download"],
  upload: ["upload-simple", "upload"],
  share: ["share-network", "export"],
  copy: ["copy", "copy-simple"],
  link: ["link", "link-simple"],
  info: ["info"],
  warning: ["warning", "warning-circle"],
  success: ["check-circle", "check"],
  error: ["x-circle", "warning-circle"],
};

/** The best icon names for some words, best first. */
export function bestIcons(words: string, count = 5): string[] {
  const own = OWN_WORDS[words.trim().toLowerCase()] ?? [];
  const found = iconIndex()
    .icons.map((icon) => ({ name: icon.name, s: score(icon, words) }))
    .filter((x) => x.s > 0 && !own.includes(x.name))
    .sort((a, b) => b.s - a.s || a.name.length - b.name.length || a.name.localeCompare(b.name))
    .map((x) => x.name);
  return [...own, ...found].slice(0, count);
}

/** How many letters to change, add, take away or swap with the next one to turn one word into another. */
function distance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const row = d[i]!;
      row[j] = Math.min(d[i - 1]![j]! + 1, row[j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

/** Closest first; between equally close, the one as long as what was written, then by name. */
const nearest = (s: string, names: string[], count: number) =>
  names
    .map((name) => ({ name, d: distance(s, name), l: Math.abs(name.length - s.length) }))
    .sort((a, b) => a.d - b.d || a.l - b.l || a.name.localeCompare(b.name))
    .slice(0, count)
    .map((x) => x.name);

/** The loading animations whose names are nearest to a mistyped one. */
export function nearLoading(name: string, count = 3): string[] {
  return nearest(slug(name), loadingParts().loading.map((l) => l.name), count);
}

/** Names that look like a mistyped one, when no words match: by how few letters differ. */
export function nearNames(name: string, count = 5): string[] {
  const s = slug(name);
  const found = bestIcons(name, count);
  if (found.length) return found;
  return nearest(s, iconIndex().icons.map((i) => i.name), count);
}

// ---------- The answers get_ready_made gives ----------

function overview() {
  const scales = palettes().palettes;
  return [
    "Panel's ready-made parts. In a sketch, write each as a tag and Panel puts the drawing in when it saves the page: <panel-icon name=\"trash\"></panel-icon>, <panel-loading name=\"ring\"></panel-loading>. Never paste or type a drawing.",
    "",
    `Loading animations (${loadingParts().loading.length}; loading: name for one):`,
    ...loadingParts().loading.map((l) => `- ${l.name}: ${l.line}`),
    "",
    "Palettes only when the designer asks for one, then used exactly as they are.",
    `Colour scales, 12 steps in light and dark (palette: name for one): ${scales.filter((p) => p.kind === "scale").map((p) => p.name).join(", ")}.`,
    `Colour sets of 5 to 10 colours: ${scales.filter((p) => p.kind === "set").map((p) => p.name).join(", ")}.`,
    "",
    `Icons: ${iconIndex().count} (Phosphor), each in ${ICON_WEIGHTS.join(", ")}. find_icons: "trash, settings, arrow right" finds names for every icon a page needs. icons: [names] gives the drawings themselves, only for building for real.`,
  ].join("\n");
}

function loadingAnswer(name: string) {
  const piece = loadingPiece(name.trim().toLowerCase());
  if (!piece) return `There's no loading animation called "${name}". These are: ${loadingParts().loading.map((l) => l.name).join(", ")}.`;
  const part = loadingParts().loading.find((l) => l.name === name.trim().toLowerCase())!;
  return [
    `${part.title}: ${part.line}`,
    `In a sketch, write <panel-loading name="${part.name}"></panel-loading> and Panel puts this in; the code below is for building for real.`,
    "Its colour is the text colour around it (color: …), its size --ld-size (1.25em when not set; e.g. --ld-size: 24px), its speed --ld-duration. It is hidden from screen readers, so put the words (Loading…) beside it. Its own @media rule keeps it still for people who ask for less motion.",
    "",
    piece.trim(),
  ].join("\n");
}

function paletteAnswer(name: string) {
  const all = palettes();
  const p = all.palettes.find((x) => x.name === slug(name) || x.title.toLowerCase() === name.trim().toLowerCase());
  if (!p) return `There's no colour palette called "${name}". These are: ${all.palettes.map((x) => x.name).join(", ")}.`;
  const same = p.light.every((c, i) => c === p.dark[i]);
  const head = `${p.title} (${p.source_url}). Only because the designer asked for a palette: use these values exactly as they are, and add a colour of your own only for something it doesn't have (say which).`;
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
    "Icon names for each, best first. In a sketch, write each as <panel-icon name=\"…\"></panel-icon> (weight=\"bold\" for another weight):",
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
    `Icons in ${weight}, for building for real (in a sketch, write <panel-icon name="…"></panel-icon> instead). Each is 1em, so it takes its size from font-size, and its colour from the text (currentColor). They are hidden from screen readers: one that stands alone (a button with no words) needs aria-label on its button, or role="img" aria-label="…" in place of aria-hidden.`,
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
