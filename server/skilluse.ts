// What the designer set for each of their skills (skills.ts reads the files): whether FRIDAY
// uses it, and when. Kept in its own table, one row per skill they have touched; a skill
// with no row is off. Also who leads each subject when two skills that are on speak to it
// (skillleads.ts): the designer's picks, one row per subject. The tables are only ever added to
// the library, never changed in place, so a Panel still on older code works beside them.

import { db, now } from "./db.ts";
import { skillFilesOf, skillFileText } from "./skillpacks.ts";
import { applyLeads, pickLeads, type Lead } from "./skillleads.ts";
import { autoReads, notReadYet, readsNow, readStateOf, readSummaries } from "./skillreads.ts";
import { hasOwnParts, isLeadSubject, readEditParts, readLines, withRead, type SkillRead } from "./skillread.ts";
import {
  asAbout, asWhen, checkPlan, guessAbout, fitBudget, parseSkill, readSkillFor, skillsBlock, skillsForOutside, skillsPage,
  describeSkill, tokensOf, type Reader, type Skill,
} from "./skills.ts";

db.exec(`
CREATE TABLE IF NOT EXISTS skill_use (
  ref_id TEXT PRIMARY KEY REFERENCES refs(id) ON DELETE CASCADE,
  -- 1: FRIDAY uses it. 0: it is only a file in the library.
  turned_on INTEGER NOT NULL DEFAULT 0,
  -- always · applies (only for pages that have what it is about) · asked (only listed)
  used_when TEXT NOT NULL DEFAULT 'always',
  -- For "applies": what it is about, comma-separated: motion, phone, forms.
  applies_to TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

-- Who leads a subject when two skills that are on speak to it: the designer's pick. With no row
-- (or while the pick is off) Panel picks (skillleads.ts).
CREATE TABLE IF NOT EXISTS skill_leads (
  -- typography · color · layout · surfaces · icons · motion · gestures · mobile · writing · accessibility
  subject TEXT PRIMARY KEY,
  ref_id TEXT NOT NULL REFERENCES refs(id) ON DELETE CASCADE,
  updated_at TEXT NOT NULL
);
`);
// When a skill was last turned on, for the last tie-break of Panel's pick. Added in place: empty
// on older rows, which fall back to when the row last changed.
if (!db.query<{ name: string }, []>("PRAGMA table_info(skill_use)").all().some((c) => c.name === "turned_on_at"))
  db.exec("ALTER TABLE skill_use ADD COLUMN turned_on_at TEXT");

interface Row { id: string; title: string | null; text: string | null; turned_on: number | null; used_when: string | null; applies_to: string | null; set: string | null; pack: string | null }

/**
 * A skill as Panel works from it. Its parts come from its own Decide / Build / Check headings
 * when it has them; else from its read, with the designer's changes over it; else the whole file.
 */
const toSkill = (r: Row, reads: ReturnType<typeof readsNow>): Skill => {
  const text = r.text ?? "";
  const own = parseSkill(text, r.title || "Untitled skill");
  const read = reads.get(r.id);
  const used = read?.answer && !hasOwnParts(own) ? read.answer : null;
  return {
    id: r.id, on: r.turned_on === 1, when: asWhen(r.used_when), about: asAbout(r.applies_to),
    parsed: withRead(own, used, read?.edits ?? null), text,
    ...(used ? { forUse: used.for } : {}),
    ...(r.pack ? { pack: r.pack } : {}),
  };
};

/** Every skill in the library (or just this one), with what the designer set for it. */
export function allSkills(id?: string): Skill[] {
  const reads = readsNow();
  return db
    .query<Row, string[]>(
      `SELECT r.id, r.title, r.text, u.turned_on, u.used_when, u.applies_to, u.ref_id AS "set", p.name AS pack FROM refs r
       LEFT JOIN skill_use u ON u.ref_id = r.id
       LEFT JOIN skill_pack_skills ps ON ps.ref_id = r.id LEFT JOIN skill_packs p ON p.id = ps.pack_id
       WHERE r.kind = 'skill' AND r.status != 'pending' AND r.text IS NOT NULL ${id ? "AND r.id = ?" : ""} ORDER BY r.created_at DESC`,
    )
    .all(...(id ? [id] : []))
    .map((r) => toSkill(r, reads));
}

/** The skills turned on, read fresh each time, so a change applies to the next message. */
export function skillsOn(): Skill[] {
  try {
    return allSkills().filter((s) => s.on);
  } catch {
    return [];
  }
}

/** Every subject two skills that are on speak to, with its lead (skillleads.ts). */
export function leadsNow(all: Skill[] = allSkills()): Lead[] {
  const picks = new Map(db.query<{ subject: string; ref_id: string }, []>("SELECT subject, ref_id FROM skill_leads").all().map((r) => [r.subject, r.ref_id]));
  const since = new Map(
    db.query<{ ref_id: string; at: string }, []>("SELECT ref_id, COALESCE(turned_on_at, updated_at) AS at FROM skill_use WHERE turned_on = 1").all().map((r) => [r.ref_id, r.at]),
  );
  return pickLeads(all, picks, since);
}

/** Skills with each subject's lead applied: what FRIDAY really gets. */
export function withLeads(all: Skill[]): Skill[] {
  return applyLeads(all, leadsNow(all));
}

/** The skills that are on, with leads applied, for FRIDAY and for apps outside Panel. */
function skillsForFriday(): Skill[] {
  try {
    return withLeads(allSkills()).filter((s) => s.on);
  } catch {
    return [];
  }
}

/** The designer picks who leads a subject; `id: null` gives it back to Panel's pick. */
export function setLead(subject: unknown, id: unknown) {
  if (!isLeadSubject(subject)) throw new Error("That isn't a subject a skill can lead.");
  if (id === null) db.run("DELETE FROM skill_leads WHERE subject = ?", [subject]);
  else {
    if (typeof id !== "string" || !allSkills(id)[0]) throw new Error("That skill is gone.");
    db.run(
      "INSERT INTO skill_leads (subject, ref_id, updated_at) VALUES (?, ?, ?) ON CONFLICT(subject) DO UPDATE SET ref_id = excluded.ref_id, updated_at = excluded.updated_at",
      [subject, id, now()],
    );
  }
  return leadsNow();
}

/** Change what the designer set for a skill: on or off, when it is used, what it is about. */
export function setSkillUse(id: string, patch: { on?: unknown; when?: unknown; about?: unknown }) {
  const s = allSkills(id)[0];
  if (!s) throw new Error("That skill is gone.");
  const on = typeof patch.on === "boolean" ? patch.on : s.on;
  // Turned on for the first time: start from what its read suggests. What the designer sets wins and stays.
  const first = !db.query("SELECT 1 FROM skill_use WHERE ref_id = ?").get(id);
  const read = first && on ? readStateOf(id).answer : null;
  const when = patch.when !== undefined ? asWhen(patch.when) : read ? read.when : s.when;
  let about = Array.isArray(patch.about) ? asAbout(patch.about.filter((x) => typeof x === "string").join(",")) : read ? read.about : s.about;
  // Picking "When it applies" for the first time: start from a guess at what it's about.
  if (when === "applies" && !about.length && patch.about === undefined) about = guessAbout(s.parsed);
  const ts = now();
  db.run(
    `INSERT INTO skill_use (ref_id, turned_on, used_when, applies_to, updated_at, turned_on_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(ref_id) DO UPDATE SET turned_on = excluded.turned_on, used_when = excluded.used_when, applies_to = excluded.applies_to, updated_at = excluded.updated_at,
       turned_on_at = CASE WHEN excluded.turned_on = 1 AND skill_use.turned_on = 0 THEN excluded.updated_at ELSE COALESCE(skill_use.turned_on_at, CASE WHEN excluded.turned_on = 1 THEN skill_use.updated_at END) END`,
    [id, on ? 1 : 0, when, [...new Set(about)].join(","), ts, on ? ts : null],
  );
  return describeOne(id);
}

/** One skill as the Skills page shows it. */
export function describeOne(id: string) {
  const all = withLeads(allSkills());
  const s = all.find((x) => x.id === id);
  if (!s) throw new Error("That skill is gone.");
  return describeSkill(s, fitBudget(all.filter((x) => x.on)));
}

/**
 * Every skill for the Skills page, with where its read stands, who leads each subject, whether
 * skills are read by themselves (the "read automatically" setting) and how many aren't read yet.
 */
export function skillsPageNow() {
  const all = allSkills();
  const leads = leadsNow(all);
  const page = skillsPage(applyLeads(all, leads));
  const reads = readSummaries();
  return {
    ...page,
    skills: page.skills.map((x) => ({ ...x, read: reads.get(x.id) ?? null })),
    leads,
    auto: autoReads(),
    not_read: notReadYet().length,
  };
}

/**
 * One skill's read as its detail view shows it: the answer, what FRIDAY carries (with the
 * designer's changes), Panel's own version to put back, and the skills it points to, with
 * whether each is in the library and on.
 */
export function readView(id: string) {
  const st = readStateOf(id);
  const all = allSkills();
  const s = all.find((x) => x.id === id);
  if (!s) throw new Error("That skill is gone.");
  const a: SkillRead | null = st.answer;
  const own = hasOwnParts(parseSkill(s.text));
  // As the designer edits them: each line with its subject in front.
  const carries = a ? readEditParts(a, st.edits) : null;
  const panel = a ? readEditParts(a, null) : null;
  // Line by line, with the ones another skill's lead leaves out (only while this one is on).
  const leads = new Map(leadsNow(all).map((l) => [l.subject as string, l]));
  const lineView = (ls: { subject: string; text: string }[]) =>
    ls.map((l) => {
      const lead = s.on && !own && s.forUse !== "builds" && s.forUse !== "neither" ? leads.get(l.subject) : undefined;
      return { ...l, led_by: lead && lead.id !== id ? lead.name : null };
    });
  const lines = a ? readLines(a, st.edits) : null;
  const shown = lines ? { decide: lineView(lines.decide), build: lineView(lines.build) } : null;
  const reach = shown ? [...shown.decide, ...shown.build].filter((l) => !l.led_by) : [];
  const find = (name: string) => {
    const n = name.toLowerCase().replace(/^.*\//, "");
    return all.find((x) => x.parsed.name.toLowerCase() === n || x.id === n);
  };
  return {
    ...st,
    /** The file has its own Decide / Build / Check headings, which come before any read. */
    own_parts: own,
    carries,
    panel,
    edited: !!st.edits && Object.keys(st.edits).length > 0,
    lines: shown,
    /** Rough tokens of what really reaches FRIDAY: without the lines another skill leads. */
    tokens: shown ? tokensOf(reach.reduce((n, l) => n + l.text.length + 3, 0)) : 0,
    points_to: (a?.points_to ?? []).map((name) => {
      const x = find(name);
      return { name, id: x?.id ?? null, on: !!x?.on };
    }),
  };
}

/** FRIDAY's <designer-skills> block right now, for one reader ("" with none on). */
export const designerSkills = (reader: Reader) => skillsBlock(reader, skillsForFriday());

/** The Always skills' parts for AI apps outside Panel. */
export const outsideSkills = (part: "decide+build" | "build") => skillsForOutside(skillsForFriday(), part);

/** What to measure in a page right now (skillcheck.ts). */
export const checkPlanNow = () => checkPlan(skillsOn());

/**
 * The skills whose checks ran on a page, by name: the Always ones with checks, and the
 * When-it-applies ones with checks that applied (`apply`). So FRIDAY can tell "passed" from
 * "not measured".
 */
export function skillsChecked(apply: { name: string }[] | undefined): string[] {
  const plan = checkPlanNow();
  if (!plan) return [];
  const applied = new Set((apply ?? []).map((a) => a.name));
  return plan.skills.filter((s) => s.checks.length && (s.when === "always" || applied.has(s.name))).map((s) => s.name);
}

/** get_skill: one skill that's on, its short version or as written (or one of its other files), or the list of them. */
export const getSkill = (name?: string, file?: string) => readSkillFor(skillsForFriday(), name, file, { list: skillFilesOf, read: skillFileText });
