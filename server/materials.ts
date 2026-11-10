// A project's materials: the files and links that say what the project is (a spec, the
// client's brand book, a competitor's site, screenshots of the old app). The designer adds
// them in the project's About panel; Claude reads them with get_project_material, so it
// knows the project and not just the canvas.
//
// Files live in <library>/projects/<project id>/. Their text is pulled out once, when they
// arrive (PDFs with pdftotext, Word and RTF with macOS textutil, plain text as is), and kept
// with the row, so reading a material is instant. Pictures get a smaller JPEG for Claude to look at.

import { existsSync, mkdirSync, rmSync, unlinkSync } from "node:fs";
import { extname, join } from "node:path";
import { db, newId, now } from "./db.ts";
import { LIBRARY_DIR } from "./config.ts";
import { fetchWithTimeout, run } from "./media.ts";
import { summarizeSoon } from "./digest.ts";

db.exec(`
CREATE TABLE IF NOT EXISTS project_materials (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- file · link
  kind TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  -- The designer's word on what it is ("the client's brand book, 2024").
  note TEXT NOT NULL DEFAULT '',
  url TEXT,
  -- Inside the library folder.
  path TEXT,
  view_path TEXT,
  mime TEXT,
  size INTEGER,
  -- The words in it, for Claude. Empty when there are none to read (a picture) or they couldn't be read.
  text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS project_materials_project ON project_materials(project_id, created_at);
`);
{
  const cols = db.query<{ name: string }, []>("PRAGMA table_info(project_materials)").all().map((c) => c.name);
  // The page Claude writes on what a long document says (digest.ts). Added in place, empty for
  // documents from before; the app on older code ignores them.
  if (!cols.includes("summary")) db.exec("ALTER TABLE project_materials ADD COLUMN summary TEXT NOT NULL DEFAULT ''");
  // '' not yet · working · done · error · short (the whole text is short enough to hand over as it is)
  if (!cols.includes("summary_state")) db.exec("ALTER TABLE project_materials ADD COLUMN summary_state TEXT NOT NULL DEFAULT ''");
  if (!cols.includes("summary_error")) db.exec("ALTER TABLE project_materials ADD COLUMN summary_error TEXT");
  // Anything left being written when Panel stopped starts again.
  db.run("UPDATE project_materials SET summary_state = '' WHERE summary_state = 'working'");
}

const PROJECTS_DIR = join(LIBRARY_DIR, "projects");
const MAX_FILE = 80 * 1024 * 1024;
/** Enough for a very long spec (hundreds of pages); past this Claude gets the start and is told it was cut. */
const MAX_TEXT = 2_000_000;
/** What the limit used to be: files cut there are read again in full (rereadCut). */
const OLD_MAX_TEXT = 400_000;

interface Row {
  id: string; project_id: string; kind: "file" | "link"; name: string; note: string; url: string | null;
  path: string | null; view_path: string | null; mime: string | null; size: number | null; text: string; created_at: string;
  summary: string; summary_state: string; summary_error: string | null;
}

export interface Material {
  id: string;
  kind: "file" | "link";
  name: string;
  note: string;
  url: string | null;
  mime: string | null;
  size: number | null;
  /** How many characters of text Claude can read. 0 for a picture, or when nothing could be read. */
  chars: number;
  picture: boolean;
  /** For the app: the file itself, and a small picture for images. */
  file_url: string | null;
  thumb_url: string | null;
  created_at: string;
  /** The page Claude wrote on what it says (long documents): '' not yet · working · done · error · short (read whole, no summary needed). */
  summary_state: string;
  summary: string;
  summary_error: string | null;
}

const isPicture = (r: Pick<Row, "mime" | "view_path">) => !!r.view_path || !!r.mime?.startsWith("image/");

function out(r: Row): Material {
  const base = `/api/projects/${r.project_id}/materials/${r.id}`;
  return {
    id: r.id, kind: r.kind, name: r.name, note: r.note, url: r.url, mime: r.mime, size: r.size,
    chars: r.text.length, picture: isPicture(r),
    file_url: r.path ? `${base}/file` : null,
    thumb_url: r.view_path ? `${base}/view` : null,
    created_at: r.created_at,
    summary_state: r.summary_state, summary: r.summary, summary_error: r.summary_error,
  };
}

const row = (projectId: string, id: string) =>
  db.query<Row, [string, string]>("SELECT * FROM project_materials WHERE project_id = ? AND id = ?").get(projectId, id);

export function listMaterials(projectId: string): Material[] {
  return db.query<Row, [string]>("SELECT * FROM project_materials WHERE project_id = ? ORDER BY created_at, rowid").all(projectId).map(out);
}

const touch = (projectId: string) => db.run("UPDATE projects SET updated_at = ? WHERE id = ?", [now(), projectId]);

// ---------- Reading what's in a file ----------

const TEXT_EXT = new Set([".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".yaml", ".yml", ".xml", ".svg", ".css", ".js", ".ts", ".tsx", ".jsx", ".html", ".htm"]);
const TEXTUTIL_EXT = new Set([".doc", ".docx", ".rtf", ".rtfd", ".odt", ".pages", ".wordml", ".webarchive"]);

/** The readable words of an HTML page: no scripts, styles or tags, entities decoded, blank runs squeezed. */
export function htmlText(html: string) {
  return html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br|header|footer|main|nav)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function textOf(absPath: string, ext: string, mime: string) {
  try {
    if (ext === ".pdf" || mime === "application/pdf") {
      const bin = Bun.which("pdftotext") ?? (existsSync("/opt/homebrew/bin/pdftotext") ? "/opt/homebrew/bin/pdftotext" : null);
      if (!bin) return "";
      const r = await run([bin, "-layout", "-enc", "UTF-8", absPath, "-"], 120_000);
      return r.code === 0 ? r.out : "";
    }
    if (TEXTUTIL_EXT.has(ext)) {
      const r = await run(["/usr/bin/textutil", "-convert", "txt", "-stdout", absPath], 120_000);
      return r.code === 0 ? r.out : "";
    }
    if (TEXT_EXT.has(ext) || mime.startsWith("text/") || mime === "application/json") {
      const raw = await Bun.file(absPath).text();
      return ext === ".html" || ext === ".htm" || mime === "text/html" ? htmlText(raw) : raw;
    }
  } catch {
    /* unreadable: kept as a file, without text */
  }
  return "";
}

/** A JPEG at most 1600px on its long side, for Claude to look at (and the app to show small). */
export async function pictureOf(absPath: string, viewAbs: string) {
  const r = await run(["/usr/bin/sips", "-Z", "1600", "-s", "format", "jpeg", "-s", "formatOptions", "82", absPath, "--out", viewAbs], 60_000).catch(() => null);
  return r?.code === 0 && existsSync(viewAbs);
}

const clip = (t: string) => t.replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim().slice(0, MAX_TEXT);

// ---------- Adding, changing, removing ----------

export async function addFile(projectId: string, file: File, note = "") {
  if (file.size > MAX_FILE) throw new Error(`${file.name} is over ${MAX_FILE / 1024 / 1024} MB.`);
  if (!file.size) throw new Error(`${file.name} is empty.`);
  const id = newId();
  const ext = extname(file.name).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 12);
  const dir = join(PROJECTS_DIR, projectId);
  mkdirSync(dir, { recursive: true });
  const rel = join("projects", projectId, `${id}${ext}`);
  const absPath = join(LIBRARY_DIR, rel);
  await Bun.write(absPath, file);
  const mime = (file.type || "application/octet-stream").split(";")[0]!.trim();

  let viewRel: string | null = null;
  if (mime.startsWith("image/") || [".heic", ".heif", ".tif", ".tiff", ".avif"].includes(ext)) {
    const v = join("projects", projectId, `${id}.view.jpg`);
    if (await pictureOf(absPath, join(LIBRARY_DIR, v))) viewRel = v;
  }
  const text = viewRel ? "" : clip(await textOf(absPath, ext, mime));
  const name = file.name.replace(/[\u0000-\u001f]/g, "").slice(0, 200) || "Untitled file";
  db.run(
    "INSERT INTO project_materials (id, project_id, kind, name, note, path, view_path, mime, size, text, created_at) VALUES (?, ?, 'file', ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, projectId, name, note.trim().slice(0, 500), rel, viewRel, mime, file.size, text, now()],
  );
  touch(projectId);
  summarizeSoon();
  return out(row(projectId, id)!);
}

export async function addLink(projectId: string, rawUrl: string, note = "") {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`);
  } catch {
    throw new Error("That doesn't look like a link.");
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error("Only web links (http or https).");
  let name = url.host.replace(/^www\./, "") + (url.pathname.length > 1 ? url.pathname.replace(/\/$/, "") : "");
  let text = "";
  try {
    const res = await fetchWithTimeout(url.href, { headers: { accept: "text/html,text/plain;q=0.9,*/*;q=0.5" } }, 12_000);
    const type = res.headers.get("content-type") ?? "";
    if (res.ok && /text\/html|application\/xhtml/.test(type)) {
      const html = (await res.text()).slice(0, 3_000_000);
      const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
      if (t) name = htmlText(t).slice(0, 200) || name;
      const desc = html.match(/<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]*content=["']([^"']*)["']/i)?.[1];
      text = [desc ? htmlText(desc) : "", htmlText(html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html)].filter(Boolean).join("\n\n");
    } else if (res.ok && /text\/plain|markdown|json/.test(type)) {
      text = (await res.text()).slice(0, MAX_TEXT);
    }
  } catch {
    /* kept as a link; Claude just can't read the page */
  }
  const id = newId();
  db.run(
    "INSERT INTO project_materials (id, project_id, kind, name, note, url, text, created_at) VALUES (?, ?, 'link', ?, ?, ?, ?, ?)",
    [id, projectId, name, note.trim().slice(0, 500), url.href, clip(text), now()],
  );
  touch(projectId);
  summarizeSoon();
  return out(row(projectId, id)!);
}

export function updateMaterial(projectId: string, id: string, patch: { name?: string; note?: string }) {
  const r = row(projectId, id);
  if (!r) throw new Error("That material is gone.");
  const name = typeof patch.name === "string" && patch.name.trim() ? patch.name.trim().slice(0, 200) : r.name;
  const note = typeof patch.note === "string" ? patch.note.trim().slice(0, 500) : r.note;
  db.run("UPDATE project_materials SET name = ?, note = ? WHERE id = ?", [name, note, id]);
  touch(projectId);
  return out(row(projectId, id)!);
}

const unlinkQuiet = (rel: string | null) => {
  if (!rel) return;
  try {
    unlinkSync(join(LIBRARY_DIR, rel));
  } catch {
    /* already gone */
  }
};

export function removeMaterial(projectId: string, id: string) {
  const r = row(projectId, id);
  if (!r) return;
  db.run("DELETE FROM project_materials WHERE id = ?", [id]);
  unlinkQuiet(r.path);
  unlinkQuiet(r.view_path);
  touch(projectId);
}

/**
 * Files whose text was cut at the old limit are read again in full, and summarized again
 * from the whole. Once, in the background, soon after Panel starts.
 */
export async function rereadCut() {
  const rows = db.query<Row, [number]>("SELECT * FROM project_materials WHERE kind = 'file' AND path IS NOT NULL AND length(text) = ?").all(OLD_MAX_TEXT);
  for (const r of rows) {
    const abs = join(LIBRARY_DIR, r.path!);
    if (!existsSync(abs)) continue;
    const text = clip(await textOf(abs, extname(r.path!).toLowerCase(), r.mime ?? ""));
    if (text.length <= r.text.length) continue;
    db.run("UPDATE project_materials SET text = ?, summary_state = '', summary = '' WHERE id = ?", [text, r.id]);
  }
  if (rows.length) summarizeSoon();
}

/** A deleted project's files go with it (its rows go by cascade). */
export function removeProjectFiles(projectId: string) {
  if (!/^[0-9a-f]{16}$/.test(projectId)) return;
  rmSync(join(PROJECTS_DIR, projectId), { recursive: true, force: true });
}

/** The file on disk, for the app to open or show. */
export function materialFile(projectId: string, id: string, which: "file" | "view") {
  const r = row(projectId, id);
  const rel = which === "view" ? r?.view_path : r?.path;
  if (!r || !rel) return null;
  return { path: join(LIBRARY_DIR, rel), mime: which === "view" ? "image/jpeg" : r.mime ?? "application/octet-stream", name: r.name };
}

// ---------- What Claude reads ----------

const FIND_MAX = 8;
const AROUND = 1500;

/**
 * Passages of a text around the places a phrase appears, merged where they overlap. Case and
 * spacing don't matter; a phrase of several words also matches where all its words appear
 * close together, in any order.
 */
export function findIn(text: string, phrase: string) {
  const words = phrase.toLowerCase().split(/\s+/).filter((w) => w.length > 1).slice(0, 8);
  if (!words.length) return [];
  const low = text.toLowerCase();
  const at: number[] = [];
  const exact = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "g");
  for (const m of low.matchAll(exact)) if (at.length < 200) at.push(m.index!);
  if (!at.length && words.length > 1) {
    // All the words within a few lines of each other.
    for (const m of low.matchAll(new RegExp(words[0]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))) {
      const near = low.slice(Math.max(0, m.index! - 600), m.index! + 600);
      if (words.every((w) => near.includes(w))) at.push(m.index!);
      if (at.length >= 200) break;
    }
  }
  const out: { at: number; text: string }[] = [];
  for (const i of at) {
    const from = Math.max(0, i - AROUND / 2), to = Math.min(text.length, i + AROUND);
    const last = out.at(-1);
    if (last && from <= last.at + last.text.length) {
      last.text = text.slice(last.at, Math.max(to, last.at + last.text.length));
      continue;
    }
    if (out.length >= FIND_MAX) break;
    out.push({ at: from, text: text.slice(from, to) });
  }
  return out;
}

/** Short enough to hand over whole with the project; longer ones are read with get_project_material. */
const INLINE = 2500;

/** The materials as get_project lists them: what each is, and its words when they're short. */
export function materialsForSummary(projectId: string) {
  const rows = db.query<Row, [string]>("SELECT * FROM project_materials WHERE project_id = ? ORDER BY created_at, rowid").all(projectId);
  return rows.map((r) => ({
    id: r.id,
    kind: isPicture(r) ? "picture" : r.kind,
    name: r.name,
    note: r.note || undefined,
    url: r.url ?? undefined,
    file: r.path ? join(LIBRARY_DIR, r.path) : undefined,
    text: r.text && r.text.length <= INLINE ? r.text : undefined,
    summary: r.text.length > INLINE && r.summary_state === "done" ? r.summary : undefined,
    starts: r.text.length > INLINE && r.summary_state !== "done" ? `${r.text.slice(0, 400).replace(/\s+/g, " ")}…` : undefined,
    length: r.text.length > INLINE ? `${r.text.length} characters; look things up in it with get_project_material and find, or read it page by page` : undefined,
    unreadable: !r.text && !isPicture(r) ? "No text could be read from this; the file is at the path given." : undefined,
  }));
}

/** One material in full, for get_project_material: its text (a page of it), or its picture. */
export function readMaterial(projectId: string, id: string, offset = 0, limit = 60_000, find?: string) {
  const r = row(projectId, id) ?? db.query<Row, [string, string]>("SELECT * FROM project_materials WHERE project_id = ? AND name = ? COLLATE NOCASE").get(projectId, id);
  if (!r) throw new Error(`No material “${id}” in this project. get_project lists them.`);
  const head = {
    id: r.id, kind: isPicture(r) ? "picture" : r.kind, name: r.name, note: r.note || undefined,
    url: r.url ?? undefined, file: r.path ? join(LIBRARY_DIR, r.path) : undefined,
  };
  const picture = r.view_path ? join(LIBRARY_DIR, r.view_path) : null;
  // Looking something up: the passages around each place the words appear, not the whole text.
  if (find?.trim()) {
    const hits = findIn(r.text, find);
    return {
      head: {
        ...head,
        characters: r.text.length,
        found: hits.length ? `${hits.length} passage${hits.length === 1 ? "" : "s"} for “${find.trim()}”${hits.length >= FIND_MAX ? " (the first ones; be more specific for others)" : ""}. Each starts at the offset shown, to read on from there.` : `Nothing found for “${find.trim()}”. Try another word, a shorter one, or the word in the document's language.`,
      },
      text: hits.map((h) => `[offset ${h.at}]\n${h.text}`).join("\n\n---\n\n"),
      picture: null,
    };
  }
  const slice = r.text.slice(offset, offset + limit);
  const more = offset + limit < r.text.length;
  return {
    head: {
      ...head,
      characters: r.text.length || undefined,
      from: offset || undefined,
      more: more ? `Continues: call again with offset ${offset + limit}.` : undefined,
      unreadable: !r.text && !picture ? "No text could be read from this file. It is on this Mac at the path in file." : undefined,
    },
    text: slice,
    picture,
  };
}
