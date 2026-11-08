// The library as an AI tool sees it: every save with its design read, searchable by
// facet (color, type, layout, motion…), by measured color, and by likeness to another save.
// Used by the MCP server (server/mcp.ts). Reads the same SQLite file Panel writes.

import { Database } from "bun:sqlite";
import { join } from "node:path";
import { db, newId, now, reindex, type MediaRow, type RefRow } from "./db.ts";
import { MEDIA_DIR, PORT } from "./config.ts";
import { toLab, type Swatch } from "./palette.ts";

export const FACETS = ["color", "typography", "layout", "imagery", "motion", "mood", "components"] as const;
export type Facet = (typeof FACETS)[number];
export const TYPES = ["video", "image", "site", "person", "skill", "link"] as const;
export type RefType = (typeof TYPES)[number];

/** A design read, as the reading step writes it (see PROFILE_SCHEMA in read.ts). Every field may be missing on old reads. */
export interface Profile {
  summary?: string;
  format?: string[];
  mood?: string[];
  style_references?: string[];
  color?: { summary?: string; temperature?: string; contrast?: string; saturation?: string; roles?: { hex: string; role: string }[] };
  typography?: { present?: boolean; summary?: string; classification?: string[]; likely_fonts?: string[]; case?: string; scale_contrast?: string; tracking?: string };
  layout?: { summary?: string; density?: string; whitespace?: string; notable?: string[] };
  imagery?: { summary?: string; style?: string[] };
  motion?: { present?: boolean; summary?: string; pace?: string; techniques?: string[]; confidence?: string };
  components?: string[];
  worth_taking?: string[];
  search_terms?: string[];
  limits?: string;
}

interface Visual { rel: string; label: string }

export interface Doc {
  r: RefRow;
  type: RefType;
  profile: Profile | null;
  model: string | null;
  palette: Swatch[];
  labs: [number, number, number][];
  tags: string[];
  collections: string[];
  media: MediaRow[];
  visuals: Visual[];
  video: { duration: number; cuts: number } | null;
}

// ---------- Loading, with an in-memory facet index rebuilt only when the library changes ----------

const COLUMNS = ["own", "general", ...FACETS] as const;
type Column = (typeof COLUMNS)[number];

let cache: { signature: string; docs: Map<string, Doc>; index: Database } | null = null;

function signature() {
  return db
    .query<{ s: string }, []>(
      `SELECT (SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at), '') FROM refs) || '|' ||
              (SELECT COUNT(*) || ':' || COALESCE(MAX(read_at), '') FROM reads WHERE state = 'done') || '|' ||
              (SELECT COUNT(*) FROM ref_tags) || '|' || (SELECT COUNT(*) FROM ref_collections) || '|' ||
              (SELECT COUNT(*) FROM refs WHERE hidden = 1) AS s`,
    )
    .get()!.s;
}

const hexRgb = (h: string): [number, number, number] | null => {
  let x = h.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(x)) x = x.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/.test(x)) return null;
  return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
};

function typeOf(r: RefRow, media: MediaRow[]): RefType {
  if (r.kind === "skill") return "skill";
  if (r.person) return "person";
  if (r.site) return "site";
  if (media.some((m) => m.type !== "image")) return "video";
  if (media.length) return "image";
  return "link";
}

const words = (...v: unknown[]): string => {
  const out: string[] = [];
  const walk = (x: unknown) => {
    if (typeof x === "string") out.push(x);
    else if (typeof x === "boolean") return;
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") Object.entries(x).forEach(([k, y]) => k !== "hex" && k !== "present" && k !== "confidence" && walk(y));
  };
  v.forEach(walk);
  return out.filter((w) => !["none", "n/a", ""].includes(w.toLowerCase())).join(" ");
};

/** The text each facet column is searched by. */
function columnsOf(d: Doc): Record<Column, string> {
  const p = d.profile ?? {};
  return {
    own: words(d.r.title, d.r.text, d.r.note, d.r.creator_name, d.r.creator_handle, d.tags, d.collections),
    general: words(p.summary, p.format, p.worth_taking, p.search_terms, d.type),
    mood: words(p.mood, p.style_references),
    color: words(p.color, d.palette.map((s) => s.name)),
    typography: p.typography?.present === false ? "" : words(p.typography),
    layout: words(p.layout),
    imagery: words(p.imagery),
    motion: p.motion?.present === false ? "" : words(p.motion),
    components: words(p.components),
  };
}

export function load() {
  const sig = signature();
  if (cache?.signature === sig) return cache;

  const refs = db.query<RefRow, []>("SELECT * FROM refs WHERE hidden = 0 ORDER BY created_at DESC").all();
  const media = db.query<MediaRow, []>("SELECT * FROM media ORDER BY ref_id, COALESCE(position, idx), idx").all();
  const reads = db
    .query<{ ref_id: string; profile: string | null; palette: string | null; signals: string | null; model: string | null }, []>(
      "SELECT ref_id, profile, palette, signals, model FROM reads WHERE profile IS NOT NULL",
    )
    .all();
  const tags = db.query<{ ref_id: string; name: string }, []>("SELECT rt.ref_id, t.name FROM ref_tags rt JOIN tags t ON t.id = rt.tag_id").all();
  const cols = db
    .query<{ ref_id: string; name: string }, []>("SELECT rc.ref_id, c.name FROM ref_collections rc JOIN collections c ON c.id = rc.collection_id")
    .all();

  const group = <T extends { ref_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of rows) (m.get(x.ref_id) ?? m.set(x.ref_id, []).get(x.ref_id)!).push(x);
    return m;
  };
  const mediaBy = group(media), tagsBy = group(tags), colsBy = group(cols);
  const readBy = new Map(reads.map((x) => [x.ref_id, x]));

  const docs = new Map<string, Doc>();
  for (const r of refs) {
    const own = mediaBy.get(r.id) ?? [];
    const read = readBy.get(r.id);
    let profile: Profile | null = null, palette: Swatch[] = [], visuals: Visual[] = [], video: Doc["video"] = null;
    try {
      profile = read?.profile ? (JSON.parse(read.profile) as Profile) : null;
      palette = read?.palette ? (JSON.parse(read.palette) as Swatch[]) : [];
      const s = read?.signals ? (JSON.parse(read.signals) as { visuals?: Visual[]; video?: { duration: number; cuts: number } }) : null;
      visuals = s?.visuals ?? [];
      video = s?.video ?? null;
    } catch {
      /* a damaged read: the save is still findable by its own text */
    }
    docs.set(r.id, {
      r, type: typeOf(r, own), profile, model: read?.model ?? null, palette,
      labs: palette.map((s) => toLab(hexRgb(s.hex) ?? [0, 0, 0])),
      tags: (tagsBy.get(r.id) ?? []).map((t) => t.name),
      collections: (colsBy.get(r.id) ?? []).map((c) => c.name),
      media: own, visuals, video,
    });
  }

  cache?.index.close();
  const index = new Database(":memory:");
  index.exec(`CREATE VIRTUAL TABLE idx USING fts5(ref_id UNINDEXED, ${COLUMNS.join(", ")}, tokenize = 'porter unicode61 remove_diacritics 2')`);
  const insert = index.prepare(`INSERT INTO idx (ref_id, ${COLUMNS.join(", ")}) VALUES (?${", ?".repeat(COLUMNS.length)})`);
  index.transaction(() => {
    for (const d of docs.values()) {
      const c = columnsOf(d);
      insert.run(d.r.id, ...COLUMNS.map((k) => c[k]));
    }
  })();
  cache = { signature: sig, docs, index };
  return cache;
}

// ---------- Text search ----------

const STOP = new Set(
  ("a an the and or of for to in on with without by from at as is are be been was were has have this that these those it its into onto " +
    "like some any very more most less really kind sort style feel feeling vibe look looks looking find show me give get want need " +
    "something things thing stuff design designs reference references no not one two three each then than over under between while " +
    "which who there their they them so but all only just can also out up down about across through per via both other same own off " +
    "almost slightly rather quite mostly where when what how").split(" "),
);
/** Words that name a facet: noise once the search is already inside that facet ("serif type" in typography). */
const FACET_WORDS = new Set("type typography typeface font fonts color colors colour palette layout imagery image images motion animation animations mood components".split(" "));

export function terms(q: string) {
  const t = (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => !STOP.has(w) && w.length > 1);
  return [...new Set(t)].slice(0, 40);
}

const scope = (cols: readonly Column[] | null, expr: string) => (cols ? `{${cols.join(" ")}} : (${expr})` : expr);

export interface TextHit { hits: string[]; weight: number; bm25: number }

/**
 * Every save that matches any of the words (in the given columns), with the words it
 * matched, their summed rarity (IDF: a word few saves use says more) and its BM25 score.
 * `distinctive` keeps only words that set saves apart: used by similar_to, whose "query"
 * is a whole facet of another save.
 */
function textRank(q: string, cols: readonly Column[] | null, distinctive = false): Map<string, TextHit> {
  const { index, docs } = load();
  const out = new Map<string, TextHit>();
  const n = docs.size || 1;
  const df = (t: string) => index.query<{ n: number }, [string]>("SELECT COUNT(*) n FROM idx WHERE idx MATCH ?").get(scope(cols, `"${t}"*`))!.n;
  let ts = terms(q).filter((t) => !(cols && FACET_WORDS.has(t)));
  const freq = new Map(ts.map((t) => [t, df(t)]));
  if (distinctive) ts = ts.filter((t) => freq.get(t)! >= 2 && freq.get(t)! <= Math.max(3, n * 0.35)).slice(0, 60);
  ts = ts.filter((t) => freq.get(t)! > 0);
  if (!ts.length) return out;
  const idf = (t: string) => Math.log(1 + n / freq.get(t)!);
  const weights = COLUMNS.map((c) => (cols ? (cols.includes(c) ? 1 : 0) : c === "own" ? 3 : c === "general" || c === "mood" ? 2 : 1));
  const all = index
    .query<{ ref_id: string; score: number }, [string]>(`SELECT ref_id, bm25(idx, 0, ${weights.join(", ")}) score FROM idx WHERE idx MATCH ?`)
    .all(scope(cols, ts.map((t) => `"${t}"*`).join(" OR ")));
  for (const x of all) out.set(x.ref_id, { hits: [], weight: 0, bm25: x.score });
  for (const t of ts) {
    for (const x of index.query<{ ref_id: string }, [string]>("SELECT ref_id FROM idx WHERE idx MATCH ?").all(scope(cols, `"${t}"*`))) {
      const hit = out.get(x.ref_id);
      if (hit) {
        hit.hits.push(t);
        hit.weight += idf(t);
      }
    }
  }
  return out;
}

// ---------- Color ----------

/**
 * CIEDE2000: color difference as the eye judges it. Plain Lab distance overstates how far
 * apart two saturated colors are (#e85d3a and #c85c36 read as one orange but score 13.6).
 */
function dE(l1: number[], l2: number[]) {
  const [L1, a1, b1] = l1 as [number, number, number], [L2, a2, b2] = l2 as [number, number, number];
  const rad = Math.PI / 180, deg = 180 / Math.PI;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const A1 = a1 * (1 + G), A2 = a2 * (1 + G);
  const c1 = Math.hypot(A1, b1), c2 = Math.hypot(A2, b2);
  const h = (b: number, a: number) => (a === 0 && b === 0 ? 0 : (Math.atan2(b, a) * deg + 360) % 360);
  const h1 = h(b1, A1), h2 = h(b2, A2);
  const dL = L2 - L1, dC = c2 - c1;
  let dh = c1 * c2 === 0 ? 0 : h2 - h1;
  if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(c1 * c2) * Math.sin((dh / 2) * rad);
  const Lm = (L1 + L2) / 2, cm = (c1 + c2) / 2;
  let hm = h1 + h2;
  if (c1 * c2 !== 0) hm = Math.abs(h1 - h2) > 180 ? (h1 + h2 + (h1 + h2 < 360 ? 360 : -360)) / 2 : (h1 + h2) / 2;
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const SL = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2), SC = 1 + 0.045 * cm, SH = 1 + 0.015 * cm * T;
  const RT = -2 * Math.sqrt(cm ** 7 / (cm ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hm - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}

export interface ColorHit { asked: string; hex: string; name: string; share: number; role: string | null; distance: number }

function roleOf(d: Doc, hex: string) {
  return d.profile?.color?.roles?.find((x) => x.hex?.toLowerCase() === hex.toLowerCase())?.role ?? null;
}

/**
 * How well a save's measured palette holds the asked colors. A color counts when a swatch
 * is within `maxDistance` (ΔE2000: ~2 is barely visible, ~5 a close match, ~10 the same family).
 * Names ("navy", "warm white") match the palette's own color names instead.
 */
function colorMatch(d: Doc, asked: string[], o: { maxDistance: number; minShare: number; role?: string }) {
  const hits: ColorHit[] = [];
  let score = 0;
  for (const a of asked) {
    const rgb = hexRgb(a);
    let best: ColorHit | null = null;
    d.palette.forEach((s, i) => {
      if (s.share < o.minShare) return;
      const role = roleOf(d, s.hex);
      if (o.role && !(role ?? "").toLowerCase().includes(o.role.toLowerCase())) return;
      const distance = rgb ? dE(toLab(rgb), d.labs[i]!) : s.name.toLowerCase().includes(a.toLowerCase().trim()) ? 0 : Infinity;
      if (distance <= o.maxDistance && (!best || distance < best.distance)) {
        best = { asked: a, hex: s.hex, name: s.name, share: s.share, role, distance: Math.round(distance * 10) / 10 };
      }
    });
    if (best) {
      const b = best as ColorHit;
      hits.push(b);
      score += Math.sqrt(b.share) * (1 - b.distance / (o.maxDistance + 1));
    }
  }
  return { hits, score };
}

/** Palette distance: each swatch's distance to the nearest swatch of the other, weighted by share, both ways. */
function paletteDistance(a: Doc, b: Doc) {
  if (!a.labs.length || !b.labs.length) return Infinity;
  const one = (x: Doc, y: Doc) => x.labs.reduce((s, l, i) => s + x.palette[i]!.share * Math.min(...y.labs.map((m) => dE(l, m))), 0) / x.palette.reduce((s, p) => s + p.share, 0);
  return (one(a, b) + one(b, a)) / 2;
}

// ---------- Filters ----------

export interface Filters {
  types?: RefType[];
  favorites?: boolean;
  tags?: string[];
  collection?: string;
  has_motion?: boolean;
  has_type?: boolean;
  temperature?: string;
  contrast?: string;
  saturation?: string;
  density?: string;
  whitespace?: string;
  pace?: string;
  read_only?: boolean;
}

function passes(d: Doc, f: Filters) {
  const p = d.profile;
  if (f.types?.length && !f.types.includes(d.type)) return false;
  if (f.favorites && !d.r.favorite) return false;
  if (f.tags?.length && !f.tags.every((t) => d.tags.some((x) => x.toLowerCase() === t.toLowerCase()))) return false;
  if (f.collection && !d.collections.some((c) => c.toLowerCase() === f.collection!.toLowerCase())) return false;
  if (f.read_only && !p) return false;
  if (f.has_motion !== undefined && !!p?.motion?.present !== f.has_motion) return false;
  if (f.has_type !== undefined && !!p?.typography?.present !== f.has_type) return false;
  const eq = (want: string | undefined, got: string | undefined) => !want || want === got;
  return (
    eq(f.temperature, p?.color?.temperature) && eq(f.contrast, p?.color?.contrast) && eq(f.saturation, p?.color?.saturation) &&
    eq(f.density, p?.layout?.density) && eq(f.whitespace, p?.layout?.whitespace) && eq(f.pace, p?.motion?.pace)
  );
}

// ---------- What a result looks like ----------

export const panelUrl = (id: string) => `http://127.0.0.1:${PORT}/?open=${id}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const swatchLine = (d: Doc, s: Swatch) => {
  const role = roleOf(d, s.hex);
  return `${s.hex} ${s.name} ${pct(s.share)}${role ? ` · ${role.split(/[:,;]/)[0]}` : ""}`;
};

/** What one facet of a save says, for picking it for that facet. */
export function facetView(d: Doc, facet: Facet) {
  const p = d.profile ?? {};
  switch (facet) {
    case "color":
      return { ...p.color, roles: undefined, palette: d.palette.map((s) => swatchLine(d, s)) };
    case "typography": return p.typography;
    case "layout": return p.layout;
    case "imagery": return p.imagery;
    case "motion": return p.motion;
    case "mood": return { mood: p.mood, style_references: p.style_references };
    case "components": return p.components;
  }
}

/** A short card: enough to choose from without opening every save. */
export function card(d: Doc, extra: Record<string, unknown> = {}, focus?: Facet[]) {
  const p = d.profile;
  return {
    id: d.r.id,
    title: d.r.title || p?.summary?.split(". ")[0]?.slice(0, 90) || d.r.source_url || "Untitled",
    type: d.type,
    by: [d.r.creator_name, d.r.creator_handle && `@${d.r.creator_handle}`].filter(Boolean).join(" ") || undefined,
    summary: p?.summary ?? (d.r.text?.slice(0, 280) || undefined),
    format: p?.format,
    mood: p?.mood,
    palette: d.palette.map((s) => swatchLine(d, s)),
    ...(focus?.length ? Object.fromEntries(focus.map((f) => [f, facetView(d, f)])) : {
      type_summary: p?.typography?.present ? p.typography.summary : undefined,
      motion_summary: p?.motion?.present ? p.motion.summary : undefined,
    }),
    worth_taking: p?.worth_taking,
    note: d.r.note || undefined,
    tags: d.tags.length ? d.tags : undefined,
    favorite: d.r.favorite ? true : undefined,
    unread: p ? undefined : true,
    ...extra,
    open: panelUrl(d.r.id),
  };
}

// ---------- The tools' logic ----------

export interface SearchInput extends Filters {
  query?: string;
  facets?: Facet[];
  colors?: string[];
  color_match?: "any" | "all";
  limit?: number;
  offset?: number;
}

export function search(o: SearchInput) {
  const { docs } = load();
  const cols = o.facets?.length ? (o.facets as Column[]) : null;
  const q = o.query?.trim() ?? "";
  const ranked = q ? textRank(q, cols) : null;
  const askedTerms = q ? terms(q).filter((t) => !(cols && FACET_WORDS.has(t))) : [];

  type Row = { d: Doc; hits: string[]; weight: number; bm25: number; color: ReturnType<typeof colorMatch> | null };
  const rows: Row[] = [];
  for (const d of docs.values()) {
    if (!passes(d, o)) continue;
    const t = ranked ? ranked.get(d.r.id) : { hits: [], weight: 0, bm25: 0 };
    if (!t) continue;
    let color: Row["color"] = null;
    if (o.colors?.length) {
      color = colorMatch(d, o.colors, { maxDistance: 12, minShare: 0.02 });
      const need = o.color_match === "all" ? o.colors.length : 1;
      if (color.hits.length < need) continue;
    }
    rows.push({ d, hits: t.hits, weight: t.weight, bm25: t.bm25, color });
  }
  rows.sort(
    (a, b) =>
      // Rarer words count for more: "mono" says more about type than "dark" does.
      b.weight - a.weight ||
      (b.color?.score ?? 0) - (a.color?.score ?? 0) ||
      a.bm25 - b.bm25 ||
      b.d.r.created_at.localeCompare(a.d.r.created_at),
  );
  const limit = Math.min(o.limit ?? 12, 60), offset = o.offset ?? 0;
  return {
    total: rows.length,
    showing: `${Math.min(rows.length, offset + 1)}–${Math.min(rows.length, offset + limit)} of ${rows.length}`,
    words_searched: askedTerms.length ? askedTerms : undefined,
    results: rows.slice(offset, offset + limit).map((x) =>
      card(x.d, {
        matched: askedTerms.length ? `${x.hits.length}/${askedTerms.length}: ${x.hits.join(", ")}` : undefined,
        colors_matched: x.color?.hits.map((h) => `${h.asked} → ${h.hex} ${h.name} ${pct(h.share)} (ΔE ${h.distance})`),
      }, o.facets),
    ),
  };
}

export function findByColor(o: Filters & { colors: string[]; match?: "any" | "all"; max_distance?: number; min_share?: number; role?: string; limit?: number }) {
  const { docs } = load();
  const asked = o.max_distance ?? 10, minShare = o.min_share ?? 0.03;
  const bad = o.colors.filter((c) => !hexRgb(c) && !/^[a-z -]+$/i.test(c));
  const run = (maxDistance: number) => {
    const rows: { d: Doc; m: ReturnType<typeof colorMatch> }[] = [];
    for (const d of docs.values()) {
      if (!passes(d, o)) continue;
      const m = colorMatch(d, o.colors, { maxDistance, minShare, role: o.role });
      if (m.hits.length < (o.match === "all" ? o.colors.length : 1)) continue;
      rows.push({ d, m });
    }
    return rows.sort((a, b) => b.m.hits.length - a.m.hits.length || b.m.score - a.m.score);
  };
  // Nothing that close: say so, and show the nearest the library has rather than nothing.
  let rows = run(asked), widened = false;
  for (const wider of [asked * 1.6, asked * 2.5]) {
    if (rows.length) break;
    rows = run(wider);
    widened = true;
  }
  return {
    total: rows.length,
    note: [
      bad.length ? `Couldn't read ${bad.join(", ")} as a color.` : "",
      widened && rows.length ? `Nothing within ΔE ${asked}; these are the nearest the library has.` : "",
    ].filter(Boolean).join(" ") || undefined,
    results: rows.slice(0, Math.min(o.limit ?? 12, 60)).map(({ d, m }) =>
      card(d, { colors_matched: m.hits.map((h) => `${h.asked} → ${h.hex} ${h.name} ${pct(h.share)}${h.role ? ` (${h.role})` : ""}, ΔE ${h.distance}`) }, ["color"]),
    ),
  };
}

/** Saves like this one, in the chosen facets. Each facet ranks on its own; the ranks are then fused. */
export function similar(o: Filters & { id: string; facets?: (Facet | "overall")[]; limit?: number }) {
  const { docs } = load();
  const base = docs.get(o.id);
  if (!base) throw new Error(`No save with id ${o.id}.`);
  const facets = o.facets?.length ? o.facets : ["overall" as const];
  const cols = columnsOf(base);
  const fused = new Map<string, { score: number; why: string[] }>();
  const add = (id: string, rank: number, why: string) => {
    const x = fused.get(id) ?? { score: 0, why: [] };
    x.score += 1 / (10 + rank);
    if (rank < 15) x.why.push(why);
    fused.set(id, x);
  };
  const candidates = [...docs.values()].filter((d) => d.r.id !== base.r.id && passes(d, o));
  const allowed = new Set(candidates.map((d) => d.r.id));

  for (const f of facets) {
    if (f === "color") {
      candidates
        .map((d) => ({ d, dist: paletteDistance(base, d) }))
        .filter((x) => Number.isFinite(x.dist))
        .sort((a, b) => a.dist - b.dist)
        .forEach((x, i) => add(x.d.r.id, i, `palette ΔE ${x.dist.toFixed(1)}`));
      continue;
    }
    const column: Column[] = f === "overall" ? ["general", "mood", "color", "typography", "layout", "imagery", "motion"] : [f];
    const text = column.map((c) => cols[c]).join(" ");
    const ranked = [...textRank(text, column, true).entries()]
      .filter(([id]) => allowed.has(id))
      .sort((a, b) => b[1].weight - a[1].weight || a[1].bm25 - b[1].bm25);
    ranked.forEach(([id, x], i) => add(id, i, `${f}: shares ${x.hits.slice(0, 6).join(", ")}`));
  }
  const rows = [...fused.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, Math.min(o.limit ?? 10, 40));
  return {
    like: card(base, {}, facets.filter((f): f is Facet => f !== "overall")),
    results: rows.map(([id, x]) => card(docs.get(id)!, { why: x.why }, facets.filter((f): f is Facet => f !== "overall"))),
  };
}

/**
 * For a brief ("a calm, warm, editorial banking app"), the best saves for each facet on
 * its own, so color can come from one, type from another and motion from a third.
 */
export function gather(o: Filters & { brief: string; facet_briefs?: Partial<Record<Facet, string>>; facets?: Facet[]; colors?: string[]; per_facet?: number }) {
  const facets = o.facets?.length ? o.facets : (["color", "typography", "layout", "imagery", "motion"] as Facet[]);
  // A facet's own words ("mono, tight tracking") find better type than the whole brief does.
  const briefFor = (f: Facet) => o.facet_briefs?.[f]?.trim() || o.brief;
  const per = Math.min(o.per_facet ?? 3, 8);
  const used = new Map<string, number>();
  const out: Record<string, unknown[]> = {};
  for (const f of facets) {
    const filters: Filters = { ...o, ...(f === "motion" ? { has_motion: true } : f === "typography" ? { has_type: true } : {}) };
    const found = search({ ...filters, query: briefFor(f), facets: [f], colors: f === "color" ? o.colors : undefined, limit: per * 4 }).results;
    // Prefer saves not already picked for another facet, so the mix is wider.
    const picks = [...found].sort((a, b) => (used.get(a.id) ?? 0) - (used.get(b.id) ?? 0)).slice(0, per);
    picks.forEach((p) => used.set(p.id, (used.get(p.id) ?? 0) + 1));
    out[f] = picks.map((p) => {
      const d = load().docs.get(p.id)!;
      return { id: p.id, title: p.title, type: p.type, searched: briefFor(f) === o.brief ? undefined : briefFor(f), matched: (p as { matched?: string }).matched, [f]: facetView(d, f), worth_taking: d.profile?.worth_taking, open: p.open };
    });
  }
  return {
    brief: o.brief,
    words_searched: terms(o.brief),
    picks: out,
    next: "Open the strongest picks with get_reference (images: \"all\") to look at them before combining.",
  };
}

const count = (values: (string | undefined | null)[], top = 40) => {
  const m = new Map<string, number>();
  for (const v of values) {
    const k = v?.toLowerCase().trim();
    if (k && k !== "none") m.set(k, (m.get(k) ?? 0) + 1);
  }
  return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, top));
};

export function overview() {
  const docs = [...load().docs.values()];
  const ps = docs.map((d) => d.profile).filter((p): p is Profile => !!p);
  const colorFamilies = docs.flatMap((d) => d.palette.filter((s) => s.share >= 0.05).map((s) => s.name.split(" ").pop()));
  return {
    saves: docs.length,
    read: ps.length,
    by_type: count(docs.map((d) => d.type)),
    favorites: docs.filter((d) => d.r.favorite).length,
    collections: count(docs.flatMap((d) => d.collections)),
    tags: count(docs.flatMap((d) => d.tags), 60),
    vocabulary: {
      format: count(ps.flatMap((p) => p.format ?? [])),
      mood: count(ps.flatMap((p) => p.mood ?? []), 60),
      style_references: count(ps.flatMap((p) => p.style_references ?? [])),
      type_classification: count(ps.flatMap((p) => (p.typography?.present ? p.typography.classification ?? [] : []))),
      likely_fonts: count(ps.flatMap((p) => p.typography?.likely_fonts ?? [])),
      motion_techniques: count(ps.flatMap((p) => (p.motion?.present ? p.motion.techniques ?? [] : []))),
      imagery_style: count(ps.flatMap((p) => p.imagery?.style ?? [])),
      components: count(ps.flatMap((p) => p.components ?? [])),
      color_families: count(colorFamilies, 30),
    },
    spread: {
      temperature: count(ps.map((p) => p.color?.temperature)),
      contrast: count(ps.map((p) => p.color?.contrast)),
      saturation: count(ps.map((p) => p.color?.saturation)),
      density: count(ps.map((p) => p.layout?.density)),
      whitespace: count(ps.map((p) => p.layout?.whitespace)),
      motion_pace: count(ps.map((p) => (p.motion?.present ? p.motion.pace : undefined))),
      with_motion: ps.filter((p) => p.motion?.present).length,
      with_type: ps.filter((p) => p.typography?.present).length,
    },
  };
}

const abs = (rel: string) => join(MEDIA_DIR, rel);

/** Everything about one save: the whole read, the files on disk, and the pictures the read was made from. */
export function reference(id: string) {
  const d = load().docs.get(id) ?? (() => {
    const hidden = db.query<{ id: string }, [string]>("SELECT id FROM refs WHERE id = ?").get(id);
    throw new Error(hidden ? `Save ${id} is hidden in Panel.` : `No save with id ${id}.`);
  })();
  const r = d.r;
  return {
    doc: d,
    data: {
      id: r.id,
      title: r.title || undefined,
      type: d.type,
      saved_from: r.kind,
      source_url: r.source_url || undefined,
      by: [r.creator_name, r.creator_handle && `@${r.creator_handle}`].filter(Boolean).join(" ") || undefined,
      post_text: r.text || undefined,
      note: r.note || undefined,
      tags: d.tags,
      collections: d.collections,
      favorite: !!r.favorite,
      saved_at: r.created_at,
      palette: d.palette.map((s) => ({ ...s, role: roleOf(d, s.hex) })),
      read: d.profile ? { model: d.model, ...d.profile, color: d.profile.color ? { ...d.profile.color, roles: undefined } : undefined } : null,
      video: d.video ?? undefined,
      files: d.media
        .filter((m) => m.status === "archived" && m.local_path)
        .map((m) => ({ type: m.type, path: abs(m.local_path!), width: m.width ?? undefined, height: m.height ?? undefined, seconds: m.duration ?? undefined })),
      pictures: d.visuals.map((v, i) => ({ n: i + 1, what: v.label, path: abs(v.rel) })),
      open: panelUrl(r.id),
    },
    pictures: d.visuals.map((v) => ({ path: abs(v.rel), label: v.label })),
  };
}

/** Put saves in a collection (made if it doesn't exist), so a set an AI picked shows up in Panel. */
export function saveToCollection(name: string, ids: string[]) {
  const clean = name.trim();
  if (!clean) throw new Error("The collection needs a name.");
  const { docs } = load();
  const missing = ids.filter((id) => !docs.has(id));
  let col = db.query<{ id: string }, [string]>("SELECT id FROM collections WHERE name = ? COLLATE NOCASE").get(clean);
  const created = !col;
  if (!col) {
    col = { id: newId() };
    db.run("INSERT INTO collections (id, name, created_at) VALUES (?, ?, ?)", [col.id, clean, now()]);
  }
  const added: string[] = [];
  for (const id of ids.filter((x) => docs.has(x))) {
    const res = db.run("INSERT OR IGNORE INTO ref_collections (ref_id, collection_id, added_at) VALUES (?, ?, ?)", [id, col.id, now()]);
    if (res.changes) added.push(id);
    reindex(id);
  }
  return { collection: clean, created, added: added.length, already_there: ids.length - added.length - missing.length, missing: missing.length ? missing : undefined, open: `http://127.0.0.1:${PORT}/` };
}
