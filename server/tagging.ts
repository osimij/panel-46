// Tags written by the read. The model that writes a save's design profile also picks
// its tags, following tagging-guide.md (how this designer tags, learned from the saves
// they tagged by hand), the section's live tag list, and recent examples of their own
// tagging. Tags the model adds are kept as source 'ai'. A save the designer tagged
// themselves is never touched, and editing tags in Panel makes them the designer's.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db, sectionOf, type RefRow } from "./db.ts";

const GUIDE_PATH = join(import.meta.dir, "tagging-guide.md");

/** Read fresh each time, so edits to the guide apply to the next read without a restart. */
export function tagGuide(): string {
  try {
    return readFileSync(GUIDE_PATH, "utf8").trim();
  } catch {
    return "";
  }
}

/** Most tags a read may give; their own saves rarely have more than four. */
const MAX_TAGS = 6;
/** Tags not in their list that a single read may add. */
const MAX_NEW = 1;
/** Recent examples of their own tagging sent with each read. */
const EXAMPLES = 24;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const oneLine = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** The section's tags, by group, with how often each is used. */
function vocabulary(scope: string) {
  return db
    .query<{ name: string; grp: string | null; n: number }, [string]>(
      `SELECT t.name, g.name grp, COUNT(rt.ref_id) n FROM tags t
       LEFT JOIN tag_groups g ON g.id = t.group_id
       LEFT JOIN ref_tags rt ON rt.tag_id = t.id
       WHERE t.scope = ? GROUP BY t.id ORDER BY g.position, g.name, n DESC, t.name`,
    )
    .all(scope);
}

/** Saves in this section the designer tagged by hand, newest first. */
function examples(r: RefRow, scope: string) {
  const rows = db
    .query<RefRow & { tags: string; summary: string | null }, []>(
      `SELECT r.*, json_extract(x.profile, '$.summary') summary,
         (SELECT group_concat(t.name, ', ') FROM ref_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.ref_id = r.id) tags
       FROM refs r LEFT JOIN reads x ON x.ref_id = r.id
       WHERE EXISTS (SELECT 1 FROM ref_tags rt WHERE rt.ref_id = r.id AND rt.source = 'user')
       ORDER BY r.created_at DESC LIMIT 400`,
    )
    .all();
  return rows
    .filter((x) => x.id !== r.id && sectionOf(x) === scope)
    .slice(0, EXAMPLES)
    .map((x) => {
      const what = clip(oneLine(x.summary) || oneLine(x.title) || oneLine(x.text) || x.kind, 220);
      const note = oneLine(x.note);
      return `- ${what}${note ? ` | their note: "${clip(note, 160)}"` : ""} → ${x.tags}`;
    });
}

/** What the read is told about tags, added to the reference's context. */
export function tagContext(r: RefRow): string {
  const scope = sectionOf(r);
  const vocab = vocabulary(scope);
  const groups = new Map<string, string[]>();
  for (const t of vocab) {
    const g = t.grp ?? "Ungrouped";
    groups.set(g, [...(groups.get(g) ?? []), `${t.name} (${t.n})`]);
  }
  const label = { library: "the library", sites: "Sites", people: "People & Accounts", skills: "Skills" }[scope];
  const lines = [
    `Tags: this save goes in ${label}. Their tags there, with how many saves use each:`,
    ...[...groups].map(([g, names]) => `  ${g}: ${names.join(", ")}`),
  ];
  const ex = examples(r, scope);
  if (ex.length) lines.push("How they tagged their latest saves in this section:", ...ex);
  return lines.join("\n");
}

/** Has the designer tagged this save themselves? Then a read leaves its tags alone. */
export function hasOwnTags(refId: string) {
  return !!db.query("SELECT 1 FROM ref_tags WHERE ref_id = ? AND source = 'user' LIMIT 1").get(refId);
}

/**
 * Give a save the tags its read chose, replacing tags from an earlier read. Only names
 * from the section's list are taken, plus at most one new one. Callers reindex after.
 */
export function applyReadTags(refId: string, raw: unknown) {
  const r = db.query<RefRow, [string]>("SELECT * FROM refs WHERE id = ?").get(refId);
  if (!r || !Array.isArray(raw) || hasOwnTags(refId)) return [];
  const scope = sectionOf(r);
  const known = new Set(vocabulary(scope).map((t) => t.name.toLowerCase()));
  const picked: string[] = [];
  let fresh = 0;
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const name = v.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, " ");
    if (!name || name.length > 32 || picked.includes(name)) continue;
    if (!known.has(name)) {
      if (fresh >= MAX_NEW) continue;
      fresh++;
    }
    picked.push(name);
    if (picked.length >= MAX_TAGS) break;
  }
  db.transaction(() => {
    db.run("DELETE FROM ref_tags WHERE ref_id = ? AND source = 'ai'", [refId]);
    for (const name of picked) {
      db.run("INSERT OR IGNORE INTO tags (name, scope) VALUES (?, ?)", [name, scope]);
      const tag = db.query<{ id: number }, [string, string]>("SELECT id FROM tags WHERE scope = ? AND name = ?").get(scope, name)!;
      db.run("INSERT OR IGNORE INTO ref_tags (ref_id, tag_id, source) VALUES (?, ?, 'ai')", [refId, tag.id]);
    }
    db.run("DELETE FROM tags WHERE kept = 0 AND id NOT IN (SELECT tag_id FROM ref_tags)");
  })();
  return picked;
}
