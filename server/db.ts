import { Database } from "bun:sqlite";
import { DB_PATH } from "./config.ts";

export type RefStatus = "pending" | "archived" | "link_only" | "failed";
export type MediaStatus = "pending" | "archived" | "failed";
export type MediaType = "image" | "video" | "gif";

export interface RefRow {
  id: string;
  /** "account": a person's profile (Instagram, X). "skill": a SKILL.md-style file for AI agents, kept as text. */
  kind: "x" | "instagram" | "youtube" | "pinterest" | "web" | "upload" | "account" | "skill";
  source_url: string | null;
  source_id: string | null;
  creator_handle: string | null;
  creator_name: string | null;
  title: string | null;
  text: string | null;
  note: string;
  favorite: number;
  /** Kept in the library but out of every view except Hidden. */
  hidden: number;
  /** A whole website, kept as full-page screenshots (desktop, then phone). */
  site: number;
  /** Shown under People & Accounts: a profile, or a person's portfolio site. */
  person: number;
  /** A person's other places, as a JSON array of URLs (mailto: for email). */
  links: string | null;
  /** What each of those links showed when read: JSON { [url]: LinkCard }. */
  link_profiles: string | null;
  /** A site as measured in the page: its fonts, sizes, colors, radii (sitefacts.ts), as JSON. '{}' when there was nothing to measure. */
  measured: string | null;
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
  /** Display order you chose; null keeps the original order. `idx` stays fixed, since files are named after it. */
  position: number | null;
  type: MediaType;
  remote_url: string | null;
  local_path: string | null;
  thumb_path: string | null;
  /** A small silent copy for the grid to play (media.ts makeLoop). '' when the original is small enough to play as it is. */
  loop_path: string | null;
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
if (!refCols.includes("hidden")) db.exec("ALTER TABLE refs ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0");
if (!refCols.includes("site")) db.exec("ALTER TABLE refs ADD COLUMN site INTEGER NOT NULL DEFAULT 0");
if (!refCols.includes("person")) db.exec("ALTER TABLE refs ADD COLUMN person INTEGER NOT NULL DEFAULT 0");
if (!refCols.includes("links")) db.exec("ALTER TABLE refs ADD COLUMN links TEXT");
if (!refCols.includes("link_profiles")) db.exec("ALTER TABLE refs ADD COLUMN link_profiles TEXT");
if (!refCols.includes("measured")) db.exec("ALTER TABLE refs ADD COLUMN measured TEXT");
const mediaCols = db.query<{ name: string }, []>("PRAGMA table_info(media)").all().map((c) => c.name);
if (!mediaCols.includes("position")) db.exec("ALTER TABLE media ADD COLUMN position INTEGER");
if (!mediaCols.includes("loop_path")) db.exec("ALTER TABLE media ADD COLUMN loop_path TEXT");

// Tag groups: each tag sits in at most one group, purely for tidy browsing.
db.exec(`CREATE TABLE IF NOT EXISTS tag_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
)`);
const tagCols = db.query<{ name: string }, []>("PRAGMA table_info(tags)").all().map((c) => c.name);
if (!tagCols.includes("group_id")) db.exec("ALTER TABLE tags ADD COLUMN group_id TEXT");
// Tags made on purpose (from the tag row) stay even while nothing uses them yet.
if (!tagCols.includes("kept")) db.exec("ALTER TABLE tags ADD COLUMN kept INTEGER NOT NULL DEFAULT 0");

// ---------- Sections ----------
// Panel has four kinds of page, each with its own tags: the library (posts, images,
// videos), Sites, People & Accounts, and Skills. A "web" tag on a site and a "web"
// tag on a person are different tags. Tag groups belong to one section too.

export type Section = "library" | "sites" | "people" | "skills";
export const SECTIONS: Section[] = ["library", "sites", "people", "skills"];

export function sectionOf(r: Pick<RefRow, "kind" | "person" | "site">): Section {
  if (r.kind === "skill") return "skills";
  if (r.person) return "people";
  if (r.site) return "sites";
  return "library";
}

const migratingSections = !tagCols.includes("scope");
if (migratingSections) {
  // Tag names were unique across the whole library; now they're unique per section.
  // SQLite can't change a constraint in place, so the table is rebuilt (same ids, so
  // every tag stays attached), inside one transaction, after a full backup.
  db.run(`VACUUM INTO ?`, [`${DB_PATH}.before-sections.bak`]);
  db.exec("PRAGMA foreign_keys = OFF");
  db.transaction(() => {
    db.exec(`CREATE TABLE tags_new (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE,
      scope TEXT NOT NULL DEFAULT 'library',
      group_id TEXT,
      kept INTEGER NOT NULL DEFAULT 0,
      UNIQUE (scope, name)
    )`);
    db.exec("INSERT INTO tags_new (id, name, scope, group_id, kept) SELECT id, name, 'library', group_id, kept FROM tags");
    db.exec("DROP TABLE tags");
    db.exec("ALTER TABLE tags_new RENAME TO tags");
  })();
  db.exec("PRAGMA foreign_keys = ON");
  if (db.query("PRAGMA foreign_key_check").all().length) throw new Error("Tag migration left broken links; restore library.sqlite.before-sections.bak");
}
const groupCols = db.query<{ name: string }, []>("PRAGMA table_info(tag_groups)").all().map((c) => c.name);
if (!groupCols.includes("scope")) db.exec("ALTER TABLE tag_groups ADD COLUMN scope TEXT NOT NULL DEFAULT 'library'");

// Posts you deleted. Background syncs (the browser extension) skip these, so a
// deleted post doesn't come back; saving it again by hand still works.
db.exec(`CREATE TABLE IF NOT EXISTS dismissed (
  kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (kind, source_id)
)`);

// ---------- Design reads ----------
// Each reference is read once by an AI model: what it is, its colors (measured from
// the pixels), type, layout, motion and mood. That profile is what search and any AI
// tool use to find references by feeling, not just by title.

db.exec(`
CREATE TABLE IF NOT EXISTS reads (
  ref_id TEXT PRIMARY KEY REFERENCES refs(id) ON DELETE CASCADE,
  -- queued: waiting to be sent · sent: in a batch at Anthropic · done · failed
  state TEXT NOT NULL,
  -- batch: half price, back within the hour (24h at most) · now: right away, full price
  mode TEXT NOT NULL DEFAULT 'batch',
  model TEXT,
  batch_id TEXT,
  palette TEXT,
  signals TEXT,
  profile TEXT,
  error TEXT,
  cost REAL,
  queued_at TEXT,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS reads_state ON reads(state);

CREATE TABLE IF NOT EXISTS read_batches (
  id TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  count INTEGER NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ended_at TEXT
);

-- Every call to the AI, with what it cost, so spending is measured, not estimated.
CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  ref_id TEXT,
  model TEXT NOT NULL,
  mode TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

export function getSetting(key: string): string | null {
  return db.query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?").get(key)?.value ?? null;
}
export function setSetting(key: string, value: string) {
  db.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value]);
}

// The search index gained a column for the design read. FTS tables can't take a new
// column, so it's rebuilt once; reindexAll() below fills it again.
const ftsCols = db.query<{ name: string }, []>("PRAGMA table_info(refs_fts)").all().map((c) => c.name);
const rebuildingSearch = !ftsCols.includes("design");
if (rebuildingSearch) {
  db.exec("DROP TABLE IF EXISTS refs_fts");
  db.exec(`CREATE VIRTUAL TABLE refs_fts USING fts5(
    ref_id UNINDEXED, title, text, note, creator, tags, design,
    tokenize = 'unicode61 remove_diacritics 2'
  )`);
}

/**
 * The words measuring a site adds to search: its fonts' names, and "cyrillic" / "tajik"
 * when one of its own fonts (not the system's) has those letters.
 */
export function measuredWords(json: string | null | undefined): string {
  if (!json) return "";
  try {
    const fonts = ((JSON.parse(json) as { fonts?: { family: string; cyrillic?: boolean; tajik?: boolean }[] }).fonts ?? []).filter((f) => f && typeof f.family === "string");
    const own = fonts.filter((f) => !f.family.startsWith("System "));
    return [...fonts.map((f) => f.family), own.some((f) => f.cyrillic) ? "cyrillic" : "", own.some((f) => f.tajik) ? "tajik" : ""].filter(Boolean).join(" ");
  } catch {
    return "";
  }
}

/** The words a design read adds to search: mood, type, colors by name, what's worth taking. Plus a site's measured fonts. */
export function designText(refId: string): string {
  const measured = measuredWords(db.query<{ measured: string | null }, [string]>("SELECT measured FROM refs WHERE id = ?").get(refId)?.measured);
  const row = db.query<{ profile: string | null; palette: string | null }, [string]>("SELECT profile, palette FROM reads WHERE ref_id = ?").get(refId);
  if (!row?.profile) return measured;
  const words: string[] = measured ? [measured] : [];
  const walk = (v: unknown) => {
    if (typeof v === "string") words.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => k !== "hex" && walk(x));
  };
  try {
    walk(JSON.parse(row.profile));
    for (const s of JSON.parse(row.palette ?? "[]") as { name: string }[]) words.push(s.name);
  } catch {
    /* a damaged profile just isn't searchable */
  }
  return words.filter((w) => !["none", "n/a"].includes(w.toLowerCase())).join(" ");
}

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
  db.run("INSERT INTO refs_fts (ref_id, title, text, note, creator, tags, design) VALUES (?, ?, ?, ?, ?, ?, ?)", [
    refId,
    r.title ?? "",
    r.text ?? "",
    r.note,
    // Also index "MunTheShinobi" as "Mun The Shinobi" so partial names match.
    [
      r.creator_handle, r.creator_handle?.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_.-]/g, " "), r.creator_name,
      // Their other places: "instagram.com/name" finds them by that handle too.
      ...parseLinks(r.links).map((l) => l.replace(/^(https?:\/\/(www\.)?|mailto:)/, "").replace(/[/.@_-]/g, " ")),
    ]
      .filter(Boolean)
      .join(" "),
    [...tags, ...collections].join(" "),
    designText(refId),
  ]);
}

if (rebuildingSearch) {
  for (const { id } of db.query<{ id: string }, []>("SELECT id FROM refs").all()) reindex(id);
}

/**
 * Derive a reference's honest status from its media rows.
 * Only files that were downloaded and verified count as archived.
 */
export function refreshStatus(refId: string) {
  const media = db.query<MediaRow, [string]>("SELECT * FROM media WHERE ref_id = ?").all(refId);
  let status: RefStatus;
  let detail: string | null = null;
  const kind = db.query<{ kind: string }, [string]>("SELECT kind FROM refs WHERE id = ?").get(refId)?.kind;
  if (media.some((m) => m.status === "pending")) status = "pending";
  // Profiles and skills are complete without any media files.
  else if (media.length === 0 && (kind === "account" || kind === "skill")) status = "archived";
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

// ---------- Tags ----------

/** Give a reference exactly these tags, from the tags of the section it's in. */
export function setTags(refId: string, names: string[]) {
  const r = db.query<RefRow, [string]>("SELECT * FROM refs WHERE id = ?").get(refId);
  if (!r) return;
  const scope = sectionOf(r);
  const clean = [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))];
  db.transaction(() => {
    db.run("DELETE FROM ref_tags WHERE ref_id = ?", [refId]);
    for (const name of clean) {
      db.run("INSERT OR IGNORE INTO tags (name, scope) VALUES (?, ?)", [name, scope]);
      const tag = db.query<{ id: number }, [string, string]>("SELECT id FROM tags WHERE scope = ? AND name = ?").get(scope, name)!;
      db.run("INSERT OR IGNORE INTO ref_tags (ref_id, tag_id, source) VALUES (?, ?, 'user')", [refId, tag.id]);
    }
    db.run("DELETE FROM tags WHERE kept = 0 AND id NOT IN (SELECT tag_id FROM ref_tags)");
  })();
  reindex(refId);
}

/**
 * After a reference moves to another section (a site added to People, say), carry
 * its tags over by name into that section's tags.
 */
export function retag(refId: string) {
  const r = db.query<RefRow, [string]>("SELECT * FROM refs WHERE id = ?").get(refId);
  if (!r) return;
  const tags = db
    .query<{ name: string; scope: string }, [string]>(
      "SELECT t.name, t.scope FROM tags t JOIN ref_tags rt ON rt.tag_id = t.id WHERE rt.ref_id = ?",
    )
    .all(refId);
  if (tags.some((t) => t.scope !== sectionOf(r))) setTags(refId, tags.map((t) => t.name));
}

// First run with sections: sites, people and skills take their tags into their own section.
if (migratingSections) {
  const moved = db
    .query<{ id: string }, []>(
      "SELECT DISTINCT r.id FROM refs r JOIN ref_tags rt ON rt.ref_id = r.id WHERE r.kind = 'skill' OR r.person = 1 OR r.site = 1",
    )
    .all();
  for (const { id } of moved) retag(id);
}

/** A person's saved links; tolerant of an empty or damaged value. */
export function parseLinks(json: string | null): string[] {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Clean up links typed or pasted by hand: "name@site.com" becomes an email link,
 * "site.com/name" gets https://. Anything that isn't a web or email address is dropped.
 */
export function cleanLinks(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    let v = raw.trim();
    if (!v) continue;
    if (/^[^\s@/:]+@[^\s@/]+\.[a-z]{2,}$/i.test(v)) v = `mailto:${v}`;
    else if (!/^(https?:|mailto:)/i.test(v)) v = `https://${v.replace(/^\/+/, "")}`;
    try {
      const u = new URL(v);
      if (!/^(https?:|mailto:)$/.test(u.protocol) || (u.protocol !== "mailto:" && !u.hostname.includes("."))) continue;
      const href = u.protocol === "mailto:" ? `mailto:${u.pathname}` : u.href;
      if (!out.some((x) => x.replace(/\/$/, "").toLowerCase() === href.replace(/\/$/, "").toLowerCase())) out.push(href);
    } catch {
      /* not a link */
    }
  }
  return out.slice(0, 40);
}
