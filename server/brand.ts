// Brand assets: the logos, icons, pictures, patterns and brand books of the brands the designer
// works on, kept per project (or for no project in particular, like the designer's own brand).
// They're the real files, to be used, not references to look at: a sketch puts the client's
// actual logo in its navbar, a build ships the real SVG.
//
// The files live in <library>/brand/<id>.<ext>. Each is served at /brand/<id>.<ext>, the same
// way fonts are, so a sketch only has to write <img src="/brand/….svg"> and it works in the
// canvas, the studio, its own tab and the pictures Claude looks at.
//
// Each asset has a kind (logo, icon, image, pattern, guide, other), guessed from its name and
// format when it arrives and changed by the designer when the guess is wrong. The app shows
// them grouped by project, then by kind. FRIDAY gets them through @ (one asset, or a project's
// whole kit) and the get_brand_assets tool.
//
// Pictures Claude can look at are made once, when a file arrives: a smaller PNG for big
// rasters (sips, which keeps transparency), and a Quick Look picture for what a browser can't
// show by itself (PDF, Illustrator, EPS, Photoshop) and for SVG, which Claude can't open.

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { db, newId, now } from "./db.ts";
import { LIBRARY_DIR } from "./config.ts";
import { run } from "./media.ts";

export const BRAND_DIR = join(LIBRARY_DIR, "brand");
const MAX_FILE = 100 * 1024 * 1024;
/** A raster bigger than this on its long side (or heavier than VIEW_BYTES) gets a smaller copy to show. */
const VIEW_SIDE = 800;
const VIEW_BYTES = 1.5 * 1024 * 1024;
/** Where a removed asset's file goes. The tests point it at a folder of their own. */
const TRASH = process.env.PANEL_TRASH_DIR ?? join(homedir(), ".Trash");

// A new table, so the app still on older code keeps working beside it. A project deleted
// leaves its assets behind, under "Not in a project", rather than taking them with it.
db.exec(`CREATE TABLE IF NOT EXISTS brand_assets (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  -- logo · icon · image · pattern · guide · other
  kind TEXT NOT NULL DEFAULT 'other',
  name TEXT NOT NULL DEFAULT '',
  file TEXT NOT NULL,
  original_name TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  -- A PNG to show and to give Claude, when the file itself won't do. Inside BRAND_DIR.
  view TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS brand_assets_project ON brand_assets(project_id, kind);`);

export const BRAND_KINDS = ["logo", "icon", "image", "pattern", "guide", "other"] as const;
export type BrandKind = (typeof BRAND_KINDS)[number];
/** How each kind is named where they're listed. */
export const KIND_LABEL: Record<BrandKind, string> = {
  logo: "Logos", icon: "Icons", image: "Images", pattern: "Patterns", guide: "Guidelines", other: "Other files",
};

const RASTER = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif"]);
/** Formats a browser shows in an <img> by itself. */
const SHOWABLE = new Set([...RASTER, "svg"]);
/** Formats Quick Look can make a picture of. */
const LOOKABLE = new Set(["svg", "pdf", "ai", "eps", "psd", "tif", "tiff", "heic", "sketch", "fig"]);
const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif",
  svg: "image/svg+xml", pdf: "application/pdf", ico: "image/x-icon",
};

interface Row {
  id: string;
  project_id: string | null;
  kind: string;
  name: string;
  file: string;
  original_name: string;
  format: string;
  size: number;
  width: number | null;
  height: number | null;
  view: string | null;
  created_at: string;
}

export interface BrandAsset {
  id: string;
  project_id: string | null;
  project_name: string | null;
  kind: BrandKind;
  name: string;
  format: string;
  size: number;
  width: number | null;
  height: number | null;
  original_name: string;
  /** The file itself; also what a sketch writes in src. */
  url: string;
  /** A picture to show in the app: the file when a browser can show it, its smaller copy, or null. */
  thumb_url: string | null;
  created_at: string;
}

const kindOf = (k: string): BrandKind => ((BRAND_KINDS as readonly string[]).includes(k) ? (k as BrandKind) : "other");

function asset(r: Row & { project_name?: string | null }): BrandAsset {
  return {
    id: r.id,
    project_id: r.project_id,
    project_name: r.project_name ?? null,
    kind: kindOf(r.kind),
    name: r.name,
    format: r.format,
    size: r.size,
    width: r.width,
    height: r.height,
    original_name: r.original_name,
    url: `/brand/${r.file}`,
    // An SVG shows as itself (sharp at any size); a big raster or a PDF shows its picture.
    thumb_url: r.format === "svg" ? `/brand/${r.file}` : r.view ? `/brand/${r.view}` : SHOWABLE.has(r.format) ? `/brand/${r.file}` : null,
    created_at: r.created_at,
  };
}

const SELECT = `SELECT a.*, p.name AS project_name FROM brand_assets a LEFT JOIN projects p ON p.id = a.project_id`;
const ORDER = `ORDER BY a.project_id IS NULL, p.name COLLATE NOCASE, CASE a.kind ${BRAND_KINDS.map((k, i) => `WHEN '${k}' THEN ${i}`).join(" ")} ELSE 9 END, a.created_at`;

/** Every asset, or one project's ("none" for those in no project), grouped by project then kind. */
export function listBrand(project?: string | null): BrandAsset[] {
  if (project === undefined) return db.query<Row, []>(`${SELECT} ${ORDER}`).all().map(asset);
  if (project === null || project === "none") return db.query<Row, []>(`${SELECT} WHERE a.project_id IS NULL ${ORDER}`).all().map(asset);
  return db.query<Row, [string]>(`${SELECT} WHERE a.project_id = ? ${ORDER}`).all(project).map(asset);
}

export function getBrandAsset(id: string) {
  const r = db.query<Row, [string]>(`${SELECT} WHERE a.id = ?`).get(id);
  return r ? asset(r) : null;
}

/** A first guess at what a file is, from its name and format. The designer changes it when it's wrong. */
export function guessKind(fileName: string): BrandKind {
  const n = fileName.toLowerCase();
  const ext = extname(n).slice(1);
  if (/logo|wordmark|logotype|lockup|brandmark|monogram|emblem|лого/.test(n)) return "logo";
  if (/icon|favicon|glyph|pictogram|иконк/.test(n) || ext === "ico") return "icon";
  if (/pattern|texture|ornament|паттерн|узор/.test(n)) return "pattern";
  if (/guide|brandbook|brand.?book|manual|гайд|брендбук/.test(n) || ext === "pdf") return "guide";
  if (RASTER.has(ext) || ["heic", "tif", "tiff", "psd"].includes(ext)) return "image";
  if (["svg", "ai", "eps"].includes(ext)) return "logo";
  return "other";
}

/** "navtech-logo_white@2x.png" → "navtech logo white". */
const nameFrom = (fileName: string) =>
  fileName.replace(/\.[a-z0-9]+$/i, "").replace(/@\dx$/i, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Untitled";

/** Width and height: from the file for a raster (sips), from the drawing's own numbers for an SVG. */
async function sizeOf(path: string, format: string): Promise<{ width: number | null; height: number | null }> {
  if (format === "svg") {
    const text = await Bun.file(path).text().catch(() => "");
    const tag = text.match(/<svg\b[^>]*>/i)?.[0] ?? "";
    const num = (attr: string) => {
      const v = tag.match(new RegExp(`\\s${attr}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, "i"))?.[1];
      return v ? Math.round(Number(v)) : null;
    };
    const box = tag.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    return { width: num("width") ?? (box ? Math.round(Number(box[1])) : null), height: num("height") ?? (box ? Math.round(Number(box[2])) : null) };
  }
  if (!RASTER.has(format) && !["tif", "tiff", "heic", "psd"].includes(format)) return { width: null, height: null };
  const r = await run(["/usr/bin/sips", "-g", "pixelWidth", "-g", "pixelHeight", path], 20_000).catch(() => null);
  const w = r?.out?.match(/pixelWidth:\s*(\d+)/)?.[1];
  const h = r?.out?.match(/pixelHeight:\s*(\d+)/)?.[1];
  return { width: w ? Number(w) : null, height: h ? Number(h) : null };
}

/** A PNG to show and to hand Claude, when the file itself is too big or can't be shown. */
async function makeView(id: string, path: string, format: string, size: number, dims: { width: number | null; height: number | null }) {
  const out = `${id}.view.png`;
  const outPath = join(BRAND_DIR, out);
  // A GIF stays itself, so it still moves; a small raster is its own picture.
  if (format === "gif") return null;
  if (RASTER.has(format)) {
    const big = size > VIEW_BYTES || Math.max(dims.width ?? 0, dims.height ?? 0) > VIEW_SIDE;
    if (!big) return null;
    const r = await run(["/usr/bin/sips", "-Z", String(VIEW_SIDE), "-s", "format", "png", path, "--out", outPath], 60_000).catch(() => null);
    return r?.code === 0 && existsSync(outPath) ? out : null;
  }
  if (!LOOKABLE.has(format) && !["tif", "tiff", "heic", "psd"].includes(format)) return null;
  // Quick Look writes "<file name>.png" into a folder of its own.
  const tmp = join(BRAND_DIR, `.look-${id}`);
  mkdirSync(tmp, { recursive: true });
  try {
    await run(["/usr/bin/qlmanage", "-t", "-s", String(VIEW_SIDE), "-o", tmp, path], 30_000).catch(() => null);
    const made = readdirSync(tmp).find((f) => f.endsWith(".png"));
    if (!made) return null;
    renameSync(join(tmp, made), outPath);
    return out;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Save an uploaded file as a brand asset of a project (or of none). */
export async function addBrandAsset(file: File, projectId: string | null, kind?: string) {
  if (!file.size) throw new Error(`${file.name} is empty.`);
  if (file.size > MAX_FILE) throw new Error(`${file.name} is over ${MAX_FILE / 1024 / 1024} MB.`);
  if (projectId && !db.query("SELECT 1 FROM projects WHERE id = ?").get(projectId)) throw new Error("That project is gone.");
  const ext = extname(file.name).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 9);
  const format = ext.slice(1) || "file";
  const id = newId();
  const name = `${id}${ext || ""}`;
  mkdirSync(BRAND_DIR, { recursive: true });
  const path = join(BRAND_DIR, name);
  await Bun.write(path, file);
  const dims = await sizeOf(path, format);
  const view = await makeView(id, path, format, file.size, dims).catch(() => null);
  const clean = file.name.replace(/[\u0000-\u001f]/g, "").slice(0, 200);
  db.run(
    "INSERT INTO brand_assets (id, project_id, kind, name, file, original_name, format, size, width, height, view, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, projectId, kind && BRAND_KINDS.includes(kind as BrandKind) ? kind : guessKind(file.name), nameFrom(clean), name, clean, format, file.size, dims.width, dims.height, view, now()],
  );
  return getBrandAsset(id)!;
}

/** Rename an asset, change its kind, or move it to another project (null: to none). */
export function updateBrandAsset(id: string, patch: { name?: unknown; kind?: unknown; project_id?: unknown }) {
  if (!getBrandAsset(id)) throw new Error("That asset is gone.");
  if (typeof patch.name === "string") {
    const n = patch.name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 120);
    if (!n) throw new Error("The asset needs a name.");
    db.run("UPDATE brand_assets SET name = ? WHERE id = ?", [n, id]);
  }
  if (typeof patch.kind === "string") {
    if (!BRAND_KINDS.includes(patch.kind as BrandKind)) throw new Error("That isn't a kind of asset Panel knows.");
    db.run("UPDATE brand_assets SET kind = ? WHERE id = ?", [patch.kind, id]);
  }
  if (patch.project_id !== undefined) {
    const p = patch.project_id === null || patch.project_id === "none" ? null : String(patch.project_id);
    if (p && !db.query("SELECT 1 FROM projects WHERE id = ?").get(p)) throw new Error("That project is gone.");
    db.run("UPDATE brand_assets SET project_id = ? WHERE id = ?", [p, id]);
  }
  return getBrandAsset(id)!;
}

/** Remove an asset. Its file goes to the macOS Trash, so a mistake can be undone there. */
export function removeBrandAsset(id: string) {
  const r = db.query<Row, [string]>("SELECT * FROM brand_assets WHERE id = ?").get(id);
  if (!r) return { removed: 0 };
  db.run("DELETE FROM brand_assets WHERE id = ?", [id]);
  const file = join(BRAND_DIR, r.file);
  if (existsSync(file)) {
    try {
      renameSync(file, join(TRASH, `Panel brand ${r.original_name || r.file}`.replace(/\//g, "-") + ` ${Date.now()}${extname(r.file)}`));
    } catch {
      rmSync(file, { force: true });
    }
  }
  if (r.view) rmSync(join(BRAND_DIR, r.view), { force: true });
  return { removed: 1 };
}

/** A file to serve, if it's one of ours: what kind it is, and its own name for downloading. */
export function brandFile(name: string) {
  if (!/^[0-9a-f]{16}(\.view\.png|\.[a-z0-9]{1,8})?$/.test(name)) return null;
  const path = join(BRAND_DIR, name);
  if (!existsSync(path)) return null;
  const id = name.slice(0, 16);
  const r = db.query<{ original_name: string; format: string }, [string]>("SELECT original_name, format FROM brand_assets WHERE id = ?").get(id);
  if (!r) return null;
  const isView = name.endsWith(".view.png");
  const format = isView ? "png" : r.format;
  return { path, mime: MIME[format] ?? "application/octet-stream", format, original_name: r.original_name, showable: isView || SHOWABLE.has(format) || format === "pdf" };
}

/** Where an asset's file is on this Mac (for Claude Code building for real), and its picture for Claude. */
export function brandPaths(id: string) {
  const r = db.query<Row, [string]>("SELECT * FROM brand_assets WHERE id = ?").get(id);
  if (!r) return null;
  const look = r.view ? join(BRAND_DIR, r.view) : RASTER.has(r.format) && r.format !== "gif" ? join(BRAND_DIR, r.file) : null;
  return { file: join(BRAND_DIR, r.file), look };
}

const dims = (a: BrandAsset) => (a.width && a.height ? `, ${a.width}×${a.height}` : "");

/** One line per asset, the way FRIDAY and other AI tools read them. */
export function brandLine(a: BrandAsset) {
  const where = a.project_name ? `project “${a.project_name}”` : "no project";
  const use = SHOWABLE.has(a.format) ? `in a sketch: <img src="${a.url}">` : `file: ${a.url}`;
  return `“${a.name}” (${a.kind}, ${a.format.toUpperCase()}${dims(a)}, ${where}, id ${a.id}) — ${use}`;
}

/** How many assets each project has, for a short note in a project's card. */
export function brandCount(projectId: string) {
  return db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM brand_assets WHERE project_id = ?").get(projectId)?.n ?? 0;
}
