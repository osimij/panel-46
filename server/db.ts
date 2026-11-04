import { Database } from "bun:sqlite";
import { DB_PATH } from "./config.ts";

export type RefStatus = "pending" | "archived" | "link_only" | "failed";
export type MediaStatus = "pending" | "archived" | "failed";
export type MediaType = "image" | "video" | "gif";

export interface RefRow {
  id: string;
  kind: "x" | "web" | "upload";
  source_url: string | null;
  source_id: string | null;
  creator_handle: string | null;
  creator_name: string | null;
  title: string | null;
  text: string | null;
  note: string;
  favorite: number;
  status: RefStatus;
  status_detail: string | null;
  preview_path: string | null;
  avatar_path: string | null;
  posted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MediaRow {
  id: string;
  ref_id: string;
  idx: number;
  type: MediaType;
  remote_url: string | null;
  local_path: string | null;
  thumb_path: string | null;
  mime: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  sha256: string | null;
  status: MediaStatus;
  error: string | null;
}

export const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS refs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  source_url TEXT,
  source_id TEXT,
  creator_handle TEXT,
  creator_name TEXT,
  title TEXT,
  text TEXT,
  note TEXT NOT NULL DEFAULT '',
  favorite INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  status_detail TEXT,
  preview_path TEXT,
  posted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS refs_source ON refs(kind, source_id) WHERE source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  ref_id TEXT NOT NULL REFERENCES refs(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  type TEXT NOT NULL,
  remote_url TEXT,
  local_path TEXT,
  thumb_path TEXT,
  mime TEXT,
  bytes INTEGER,
  width INTEGER,
  height INTEGER,
  duration REAL,
  sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT
);
CREATE INDEX IF NOT EXISTS media_ref ON media(ref_id, idx);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE IF NOT EXISTS ref_tags (
  ref_id TEXT NOT NULL REFERENCES refs(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'user',
  PRIMARY KEY (ref_id, tag_id)
);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ref_collections (
  ref_id TEXT NOT NULL REFERENCES refs(id) ON DELETE CASCADE,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL,
  PRIMARY KEY (ref_id, collection_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS refs_fts USING fts5(
  ref_id UNINDEXED, title, text, note, creator, tags,
  tokenize = 'unicode61 remove_diacritics 2'
);
`);

// Columns added after the first release.
const refCols = db.query<{ name: string }, []>("PRAGMA table_info(refs)").all().map((c) => c.name);
if (!refCols.includes("avatar_path")) db.exec("ALTER TABLE refs ADD COLUMN avatar_path TEXT");

// Tag groups: each tag sits in at most one group, purely for tidy browsing.
db.exec(`CREATE TABLE IF NOT EXISTS tag_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
)`);
const tagCols = db.query<{ name: string }, []>("PRAGMA table_info(tags)").all().map((c) => c.name);
if (!tagCols.includes("group_id")) db.exec("ALTER TABLE tags ADD COLUMN group_id TEXT");

export const now = () => new Date().toISOString();
export const newId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 16);

/** Rebuild the search row for one reference. Called after any edit. */
export function reindex(refId: string) {
  const r = db.query<RefRow, [string]>("SELECT * FROM refs WHERE id = ?").get(refId);
  db.run("DELETE FROM refs_fts WHERE ref_id = ?", [refId]);
  if (!r) return;
  const tags = db
    .query<{ name: string }, [string]>(
      "SELECT t.name FROM tags t JOIN ref_tags rt ON rt.tag_id = t.id WHERE rt.ref_id = ?",
    )
    .all(refId)
    .map((t) => t.name);
  const collections = db
    .query<{ name: string }, [string]>(
      "SELECT c.name FROM collections c JOIN ref_collections rc ON rc.collection_id = c.id WHERE rc.ref_id = ?",
    )
    .all(refId)
    .map((c) => c.name);
  db.run("INSERT INTO refs_fts (ref_id, title, text, note, creator, tags) VALUES (?, ?, ?, ?, ?, ?)", [
    refId,
    r.title ?? "",
    r.text ?? "",
    r.note,
    // Also index "MunTheShinobi" as "Mun The Shinobi" so partial names match.
    [r.creator_handle, r.creator_handle?.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_.-]/g, " "), r.creator_name]
      .filter(Boolean)
      .join(" "),
    [...tags, ...collections].join(" "),
  ]);
}

/**
 * Derive a reference's honest status from its media rows.
 * Only files that were downloaded and verified count as archived.
 */
export function refreshStatus(refId: string) {
  const media = db.query<MediaRow, [string]>("SELECT * FROM media WHERE ref_id = ?").all(refId);
  let status: RefStatus;
  let detail: string | null = null;
  if (media.some((m) => m.status === "pending")) status = "pending";
  else if (media.length === 0) {
    status = "link_only";
    detail = "No media was found to save. Only the link and any preview are kept.";
  } else if (media.every((m) => m.status === "archived")) status = "archived";
  else {
    status = "failed";
    const failed = media.filter((m) => m.status === "failed");
    detail = `${failed.length} of ${media.length} file(s) could not be saved: ${failed[0]?.error ?? "unknown error"}`;
  }
  db.run("UPDATE refs SET status = ?, status_detail = ?, updated_at = ? WHERE id = ?", [status, detail, now(), refId]);
}
