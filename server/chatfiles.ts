// Files the designer attaches to a message for FRIDAY: a screenshot pasted in, a photo
// dropped on the composer, a PDF brief, a text file. They arrive before the message is
// sent (so the composer can show them), and belong to a conversation once it is.
//
// Files live in <library>/chat-files/. Pictures get a JPEG at most 1600px on its long side
// (the same one a project's materials get): it's what Claude looks at, small enough for any
// picture to be accepted, and HEIC or TIFF from a phone work too. PDFs go to Claude whole,
// so it sees their pages as they look, not just their words; long ones go as their text.
// Other documents go as their words.

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { extname, join } from "node:path";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources";
import { db, newId, now } from "./db.ts";
import { LIBRARY_DIR } from "./config.ts";
import { pictureOf, textOf } from "./materials.ts";
import { run } from "./media.ts";

db.exec(`
CREATE TABLE IF NOT EXISTS chat_files (
  id TEXT PRIMARY KEY,
  -- Empty until the message it came with is sent.
  chat_id TEXT,
  name TEXT NOT NULL DEFAULT '',
  mime TEXT,
  size INTEGER,
  -- Inside the library folder.
  path TEXT NOT NULL,
  view_path TEXT,
  text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_files_chat ON chat_files(chat_id);
`);

const DIR = "chat-files";
const MAX_FILE = 40 * 1024 * 1024;
/** A message can carry this many files. */
export const MAX_FILES = 10;
/** PDFs up to this size and page count go to Claude whole; past it, as their words. */
const PDF_WHOLE_BYTES = 20 * 1024 * 1024;
const PDF_WHOLE_PAGES = 80;
/** How much of one document's words go with a message. */
const MAX_TEXT = 120_000;

interface Row {
  id: string; chat_id: string | null; name: string; mime: string | null; size: number | null;
  path: string; view_path: string | null; text: string; created_at: string;
}

export interface ChatFile {
  id: string;
  name: string;
  mime: string | null;
  size: number | null;
  picture: boolean;
  url: string;
  thumb_url: string | null;
}

const out = (r: Row): ChatFile => ({
  id: r.id, name: r.name, mime: r.mime, size: r.size, picture: !!r.view_path,
  url: `/api/chat-files/${r.id}`,
  thumb_url: r.view_path ? `/api/chat-files/${r.id}/view` : null,
});

const PICTURE_EXT = [".heic", ".heif", ".tif", ".tiff", ".avif", ".bmp"];

export async function addChatFile(file: File): Promise<ChatFile> {
  if (file.size > MAX_FILE) throw new Error(`${file.name} is over ${MAX_FILE / 1024 / 1024} MB.`);
  if (!file.size) throw new Error(`${file.name} is empty.`);
  const id = newId();
  const ext = extname(file.name).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 12);
  mkdirSync(join(LIBRARY_DIR, DIR), { recursive: true });
  const rel = join(DIR, `${id}${ext}`);
  const abs = join(LIBRARY_DIR, rel);
  await Bun.write(abs, file);
  const mime = (file.type || "application/octet-stream").split(";")[0]!.trim();

  let viewRel: string | null = null;
  // An SVG is a picture to the designer but words to Claude (sips can't draw it anyway).
  if ((mime.startsWith("image/") && mime !== "image/svg+xml") || PICTURE_EXT.includes(ext)) {
    const v = join(DIR, `${id}.view.jpg`);
    if (await pictureOf(abs, join(LIBRARY_DIR, v))) viewRel = v;
  }
  const text = viewRel ? "" : (await textOf(abs, ext, mime)).replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim();
  const name = file.name.replace(/[\u0000-\u001f]/g, "").slice(0, 200) || (viewRel ? "Pasted picture" : "Untitled file");
  db.run("INSERT INTO chat_files (id, chat_id, name, mime, size, path, view_path, text, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)", [
    id, name, mime, file.size, rel, viewRel, text, now(),
  ]);
  return out(row(id)!);
}

const row = (id: string) => db.query<Row, [string]>("SELECT * FROM chat_files WHERE id = ?").get(id);

/** The file itself, or the picture made from it, for the app to show. */
export function chatFile(id: string, which: "file" | "view") {
  const r = row(id);
  const rel = r && (which === "view" ? r.view_path : r.path);
  if (!r || !rel) return null;
  const abs = join(LIBRARY_DIR, rel);
  if (!existsSync(abs)) return null;
  return { file: Bun.file(abs), name: r.name, mime: which === "view" ? "image/jpeg" : r.mime || "application/octet-stream" };
}

/** A file taken back out of the composer before sending. Only ones not yet sent can go. */
export function removeChatFile(id: string) {
  const r = row(id);
  if (!r || r.chat_id) return false;
  dropFiles([r]);
  db.run("DELETE FROM chat_files WHERE id = ?", [id]);
  return true;
}

/** When a conversation is deleted, its files go with it. */
export function removeChatFiles(chatId: string) {
  const rows = db.query<Row, [string]>("SELECT * FROM chat_files WHERE chat_id = ?").all(chatId);
  dropFiles(rows);
  db.run("DELETE FROM chat_files WHERE chat_id = ?", [chatId]);
}

function dropFiles(rows: Row[]) {
  for (const r of rows) for (const p of [r.path, r.view_path]) if (p) rmSync(join(LIBRARY_DIR, p), { force: true });
}

/**
 * The files sent with a message: they now belong to its conversation. Ids that aren't
 * there, or already belong to another conversation, are left out.
 */
export function claimFiles(chatId: string, ids: unknown): Row[] {
  if (!Array.isArray(ids)) return [];
  const wanted = [...new Set(ids.filter((x): x is string => typeof x === "string" && /^[0-9a-f]{16}$/.test(x)))].slice(0, MAX_FILES);
  const rows: Row[] = [];
  for (const id of wanted) {
    const r = row(id);
    if (!r || (r.chat_id && r.chat_id !== chatId)) continue;
    if (!r.chat_id) db.run("UPDATE chat_files SET chat_id = ? WHERE id = ?", [chatId, id]);
    rows.push(r);
  }
  return rows;
}

/** What's kept with the message, so the conversation shows what was attached. */
export const fileNote = (r: Row) => ({ id: r.id, name: r.name, picture: !!r.view_path });

async function pdfPages(abs: string) {
  const bin = Bun.which("pdfinfo") ?? (existsSync("/opt/homebrew/bin/pdfinfo") ? "/opt/homebrew/bin/pdfinfo" : null);
  if (!bin) return null;
  const r = await run([bin, abs], 20_000).catch(() => null);
  const n = r?.code === 0 ? Number(r.out.match(/^Pages:\s+(\d+)/m)?.[1]) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * The files as Claude is given them: pictures to look at, PDFs to read page by page,
 * documents as their words. Also a line for each, for the note that says what came.
 */
export async function filesForClaude(rows: Row[]): Promise<{ blocks: ContentBlockParam[]; lines: string[] }> {
  const blocks: ContentBlockParam[] = [];
  const lines: string[] = [];
  for (const r of rows) {
    const abs = join(LIBRARY_DIR, r.path);
    if (r.view_path && existsSync(join(LIBRARY_DIR, r.view_path))) {
      const data = Buffer.from(await Bun.file(join(LIBRARY_DIR, r.view_path)).arrayBuffer()).toString("base64");
      blocks.push({ type: "text", text: `Picture: ${r.name}` });
      blocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } });
      lines.push(`“${r.name}” (a picture)`);
      continue;
    }
    const isPdf = r.mime === "application/pdf" || extname(r.path) === ".pdf";
    if (isPdf && existsSync(abs) && (r.size ?? 0) <= PDF_WHOLE_BYTES) {
      const pages = await pdfPages(abs);
      if (pages !== null && pages <= PDF_WHOLE_PAGES) {
        const data = Buffer.from(await Bun.file(abs).arrayBuffer()).toString("base64");
        blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data }, title: r.name });
        lines.push(`“${r.name}” (a PDF, ${pages} page${pages === 1 ? "" : "s"})`);
        continue;
      }
    }
    if (r.text) {
      const cut = r.text.length > MAX_TEXT;
      blocks.push({ type: "text", text: `<attached-file name="${r.name.replace(/"/g, "'")}">\n${r.text.slice(0, MAX_TEXT)}\n</attached-file>${cut ? `\n(Only the first ${MAX_TEXT.toLocaleString("en")} of its ${r.text.length.toLocaleString("en")} characters are here.)` : ""}` });
      lines.push(`“${r.name}” (its text${cut ? ", cut short" : ""})`);
      continue;
    }
    lines.push(`“${r.name}” (${r.mime ?? "a file"}, which can't be read here: say so if it matters)`);
  }
  return { blocks, lines };
}
