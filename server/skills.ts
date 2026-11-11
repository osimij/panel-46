// The designer's skills: files of craft knowledge (setting type, motion…) that shape what
// Panel makes. A skill is an ordinary SKILL.md (frontmatter with name and description, then
// Markdown), saved under Skills like any other. Panel reads three sections of it by their
// headings, at any level and in any case:
//
//   Decide  the decisions to make and write down: given to whoever decides.
//   Build   how to build it right: given to whoever builds.
//   Check   things Panel measures in the finished page (skillcheck.ts), one a line:
//           "- line_length: 45–85", with "(breaks)" for one that must be fixed.
//
// Everything else in the file (Look for, long reference) is only read when the skill is
// opened with get_skill. A file with none of these headings is still a skill: its whole body
// is its guide.
//
// Skills, like collections, are the designer's: nothing reaches FRIDAY until they turn a
// skill on (the skill_use table), and they say when it is used: always, when it applies to
// the page (it moves, it's for a phone, it has a form), or only when asked for.
//
// Order of authority, said wherever skills are given: the designer's rules, then a project's
// locked decisions, then skills, then references. Where two skills that are on say different
// things about one subject, its lead wins (skillleads.ts); where they don't disagree, both are
// followed. The designer's own note on a skill ("When to use it") goes with it wherever it is given.
//
// This file only reads and writes text: reading a skill, FRIDAY's skills block, the budget,
// what to measure. It never opens the library, so it can be tested on its own. What the
// designer set for each skill, and the table it's kept in, are in skilluse.ts.

import type { Lead } from "./skillleads.ts";
import type { For, ReadLine, Subject } from "./skillread.ts";

// ---------- Reading a skill ----------

export type When = "always" | "applies" | "asked";
export const WHENS: When[] = ["always", "applies", "asked"];
/** What a "When it applies" skill can be about, found in the page itself (skillcheck.ts). */
export type About = "motion" | "phone" | "forms";
export const ABOUTS: About[] = ["motion", "phone", "forms"];

/** One line of a skill's Check section that Panel knows how to measure. */
export interface SkillCheck {
  /** The check's name as Panel knows it: line_length, contrast… */
  name: string;
  min?: number;
  max?: number;
  /** breaks: must be fixed. check: fix it, or keep it and say why. */
  level: "breaks" | "check";
}

export interface ParsedSkill {
  name: string;
  /** Its one line: the frontmatter's description, else its first paragraph. */
  line: string;
  decide: string;
  build: string;
  /** The Check section as written, or "" when there is none. */
  checkText: string;
  checks: SkillCheck[];
  /** Check lines Panel can't measure yet, as written (their names, or the line itself). */
  unknown: string[];
  /** No Decide or Build heading: the whole body is its guide, given as if it were Build. */
  whole: boolean;
  /** The Markdown after the frontmatter. */
  body: string;
  /** From a read only: Decide and Build line by line, each with its subject (what leads work on). */
  lines?: { decide: ReadLine[]; build: ReadLine[] };
  /** From a read only: its subjects, the main one first. */
  subjects?: Subject[];
}

/** The checks Panel can measure, what their numbers mean, and how to say them in plain words. */
export const CHECKS: Record<string, { single: "min" | "max" | null; min?: number; max?: number; plain: (c: { min?: number; max?: number }) => string }> = {
  line_length: { single: "max", max: 85, plain: ({ min, max }) => (min != null ? `Lines of running text between ${min} and ${max ?? "any number of"} characters` : `Lines of running text no longer than ${max} characters`) },
  font_sizes: { single: "max", max: 8, plain: ({ max }) => `No more than ${max} text sizes on a page` },
  font_families: { single: "max", max: 3, plain: ({ max }) => `No more than ${max} font ${max === 1 ? "family" : "families"} setting text` },
  line_height: { single: "min", min: 1.3, max: 1.8, plain: ({ min, max }) => `Running text with a line height between ${min} and ${max} times its size` },
  contrast: { single: "min", min: 4.5, plain: ({ min }) => `Text at least ${min}:1 against what's behind it (large text at least ${Math.min(3, min ?? 3)}:1)` },
  small_text: { single: "min", min: 12, plain: ({ min }) => `No text smaller than ${min}px` },
  overflow: { single: null, plain: () => "Nothing wider than the screen: the page never scrolls sideways" },
  reduced_motion: { single: null, plain: () => "A page that moves turns its motion down for people who ask for less" },
  tap_targets: { single: "min", min: 44, plain: ({ min }) => `On a phone, no button or link smaller than ${min}px both ways` },
};

/** A frontmatter field: `name: value`, possibly folded over the next indented lines. */
function frontmatter(markdown: string) {
  const fm = markdown.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const field = (k: string) => {
    const m = fm?.[1]!.match(new RegExp(`^${k}:\\s*(.+(?:\\n[ \\t]+.+)*)`, "mi"));
    return m ? m[1]!.replace(/\s*\n\s*/g, " ").replace(/^(?:[>|][+-]?|["'-])\s*|["']$/g, "").trim() || null : null;
  };
  return { field, body: fm ? markdown.slice(fm[0].length) : markdown };
}

/** The sections of a Markdown text by heading: each heading's name (lowercased) and what's under it. */
function sections(body: string) {
  const lines = body.split(/\r?\n/);
  const heads: { at: number; level: number; name: string }[] = [];
  let fence: string | null = null;
  lines.forEach((l, i) => {
    const f = l.match(/^\s*(```|~~~)/);
    if (f) fence = fence ? (fence === f[1] ? null : fence) : f[1]!;
    if (fence && !f) return;
    const h = l.match(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/);
    if (h && !fence) heads.push({ at: i, level: h[1]!.length, name: h[2]!.replace(/[*_`:]/g, "").trim().toLowerCase() });
  });
  const out = new Map<string, string>();
  heads.forEach((h, k) => {
    const end = heads.slice(k + 1).find((x) => x.level <= h.level)?.at ?? lines.length;
    if (!out.has(h.name)) out.set(h.name, lines.slice(h.at + 1, end).join("\n").trim());
  });
  return out;
}

/** One line of a Check section: "- line_length: 45–85", "- overflow (breaks)". Null for a line that isn't a list item. */
function checkLine(item: string): { name: string; check?: SkillCheck } | null {
  const text = item.replace(/`/g, "").trim();
  const m = text.match(/^([A-Za-z][\w-]*)\s*(?::\s*(.*)|\((.*)\))?\s*$/) ?? text.match(/^([A-Za-z][\w-]*)\s*(\(.*)$/);
  if (!m) return { name: text };
  const name = m[1]!.toLowerCase().replace(/-/g, "_");
  const known = CHECKS[name];
  if (!known) return { name };
  const rest = text.slice(m[1]!.length);
  const level = /\(\s*breaks\s*\)/i.test(rest) ? "breaks" : "check";
  const nums = rest.replace(/\(\s*breaks\s*\)/i, "");
  const range = nums.match(/(\d+(?:\.\d+)?)\s*(?:px|ch|:1)?\s*(?:–|—|-|to)\s*(\d+(?:\.\d+)?)/);
  const one = nums.match(/(\d+(?:\.\d+)?)/);
  let min = known.min, max = known.max;
  if (range) {
    min = Number(range[1]);
    max = Number(range[2]);
  } else if (one && known.single === "max") {
    max = Number(one[1]);
    // A lone number for an "at most" check leaves no lower bound.
    min = undefined;
  } else if (one && known.single === "min") {
    min = Number(one[1]);
    // line_height's single number is its lowest; its highest stays the default.
  }
  return { name, check: { name, ...(min != null ? { min } : {}), ...(max != null ? { max } : {}), level } };
}

/** Read a skill file: its name, its line, its three parts and its checks. */
export function parseSkill(markdown: string, fallbackName = "Untitled skill"): ParsedSkill {
  const { field, body } = frontmatter(markdown);
  const parts = sections(body);
  const decide = parts.get("decide") ?? "";
  const build = parts.get("build") ?? "";
  const checkText = parts.get("check") ?? parts.get("checks") ?? "";
  const checks: SkillCheck[] = [];
  const unknown: string[] = [];
  for (const l of checkText.split(/\r?\n/)) {
    const item = l.match(/^\s*[-*+]\s+(.+)$/)?.[1];
    if (!item) continue;
    const c = checkLine(item);
    if (!c) continue;
    if (c.check) checks.push(c.check);
    else unknown.push(c.name);
  }
  const para = body
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .find((b) => b && !/^(#|```|[-*]\s|\d+\.\s|>|\|)/.test(b));
  const has = (k: string) => parts.has(k);
  return {
    name: field("name") ?? field("title") ?? body.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim() ?? fallbackName,
    line: (field("description") ?? para?.replace(/\s+/g, " ") ?? "").slice(0, 300),
    decide,
    build,
    checkText,
    checks,
    unknown,
    whole: !has("decide") && !has("build"),
    body: body.trim(),
  };
}

// ---------- A skill with what the designer set for it ----------

export interface Skill {
  id: string;
  on: boolean;
  when: When;
  about: About[];
  /** What Panel works from: the file's own parts, or its read over them (skillread.ts withRead). */
  parsed: ParsedSkill;
  /** The file as written. */
  text: string;
  /** Who the skill is for, from its read: a skill only for real builds never goes into sketch instructions. Unread: undefined. */
  forUse?: For;
  /** The pack it came from (skillpacks.ts), to tell two skills with one name apart. */
  pack?: string;
  /** The designer's own note on it ("When to use it" in its detail view): goes with it wherever it is given. */
  note?: string;
}

/** The longest designer's note given with a skill; a longer one is cut at a word. */
export const NOTE_LIMIT = 300;

/** "The designer's note: …" for a skill, or "" when it has none. */
export function noteLine(s: Pick<Skill, "note">): string {
  const n = (s.note ?? "").replace(/\s+/g, " ").trim();
  if (!n) return "";
  if (n.length <= NOTE_LIMIT) return `The designer's note: ${n}`;
  const cut = n.slice(0, NOTE_LIMIT - 1);
  const at = cut.lastIndexOf(" ");
  return `The designer's note: ${(at > NOTE_LIMIT / 2 ? cut.slice(0, at) : cut).replace(/[\s,;:.–—-]+$/, "")}…`;
}

/** A skill's line in a list ("- name: line (when)"), with the designer's note under it when there is one. */
const listItem = (s: Skill, after = "") => {
  const note = noteLine(s);
  return `- ${s.parsed.name}${s.parsed.line ? `: ${s.parsed.line}` : ""}${after}${note ? `\n  ${note}` : ""}`;
};

/** A skill that is on but, by its read, not for sketches: listed for FRIDAY, carried to real builds instead. */
export const notForSketches = (s: Pick<Skill, "forUse">) => s.forUse === "builds" || s.forUse === "neither";

export const asWhen = (v: unknown): When => ((WHENS as unknown[]).includes(v) ? (v as When) : "always");
export const asAbout = (v: string | null | undefined): About[] => (v ?? "").split(",").map((x) => x.trim()).filter((x): x is About => (ABOUTS as string[]).includes(x));

/** A guess at what a skill is about, for when the designer first picks "When it applies". */
export function guessAbout(p: ParsedSkill): About[] {
  const t = `${p.name} ${p.line}`.toLowerCase();
  const out: About[] = [];
  if (/motion|animat|transition|moves?\b/.test(t)) out.push("motion");
  if (/phone|mobile|ios|android|touch/.test(t)) out.push("phone");
  if (/form|input|field/.test(t)) out.push("forms");
  return out;
}

// ---------- How it is given to FRIDAY ----------

/** Who is reading: one model, or the planner and the builder of Plan, then build. */
export type Reader = "solo" | "planner" | "builder";

/** All the Always parts together stay under this many characters (about 4,000 tokens). */
export const SKILL_BUDGET = 16_000;

/** Rough tokens for prose: about 4 characters each. */
export const tokensOf = (chars: number) => Math.round(chars / 4);

/** What one model gets of a skill on every message: Decide and Build, or the whole body. */
const everyTime = (p: ParsedSkill) => (p.whole ? p.body : [p.decide, p.build].filter(Boolean).join("\n\n"));

/**
 * Which Always skills fit in the budget. Past it, the largest drop to the list (read with
 * get_skill when needed) until the rest fit. Decided on the one-model size, so the planner
 * and the builder drop the same skills.
 */
export function fitBudget(skills: Pick<Skill, "id" | "on" | "when" | "parsed" | "forUse">[], budget = SKILL_BUDGET) {
  const always = skills.filter((s) => s.on && s.when === "always" && !notForSketches(s));
  const size = new Map(always.map((s) => [s.id, everyTime(s.parsed).length]));
  let total = [...size.values()].reduce((a, b) => a + b, 0);
  const dropped = new Set<string>();
  for (const s of [...always].sort((a, b) => size.get(b.id)! - size.get(a.id)!)) {
    if (total <= budget) break;
    dropped.add(s.id);
    total -= size.get(s.id)!;
  }
  return { dropped, size, total };
}

const ABOUT_WORDS: Record<About, string> = { motion: "the page moves", phone: "it's made for a phone", forms: "the page has a form" };
export const aboutWords = (about: About[]) => (about.length ? about.map((a) => ABOUT_WORDS[a]).join(", or ") : "");

/**
 * How a skill that leads a subject can be read, said beside its name in the list of leads (""
 * when its lines are already in front of the reader, in FRIDAY's instructions).
 */
function leadHint(lead: Skill | undefined, dropped: Set<string>) {
  if (!lead) return "read it with get_skill";
  if (lead.when === "asked") return "read it with get_skill when you need it";
  if (lead.when === "applies") return `read it with get_skill ${lead.about.length ? `when ${aboutWords(lead.about)}` : "when it applies"}`;
  if (dropped.has(lead.id)) return "read it with get_skill before you make anything";
  return "";
}

/** The leads as a skill's leads list takes them: the subject, and the lead's id and name. */
export type LeadOf = Pick<Lead, "subject" | "id" | "name">;

/**
 * The rule for skills that share a subject, and who leads each one, one line per subject in the
 * subjects' usual order: "- motion: emil-design-eng (read it with get_skill when the page moves)".
 * `hint`: how to reach a lead that isn't already in front of the reader ("" when it is). "" with
 * no leads.
 */
export function leadsList(leads: LeadOf[], hint: (leadId: string) => string): string {
  if (!leads.length) return "";
  const lines = leads.map((l) => {
    const h = hint(l.id);
    return `- ${l.subject}: ${l.name}${h ? ` (${h})` : ""}`;
  });
  return `Where two skills say different things about the same thing, the lead of that subject wins. Where they don't disagree, follow both.\n${lines.join("\n")}`;
}

/**
 * The <designer-skills> block of FRIDAY's instructions, for one reader. Empty with no skill on,
 * so the instructions are then exactly what they were before skills existed. Every skill that is
 * on keeps all its lines; `leads` (skillleads.ts) are listed once, after the opening lines, the
 * same for every reader.
 */
export function skillsBlock(reader: Reader, skills: Skill[], leads: LeadOf[] = []): string {
  const on = skills.filter((s) => s.on);
  if (!on.length) return "";
  const { dropped } = fitBudget(on);
  const byId = new Map(on.map((s) => [s.id, s]));
  const given: string[] = [];
  const listed: string[] = [];
  const say = (s: Skill, why: string) => listed.push(listItem(s, ` (${why})`));
  for (const s of on) {
    const p = s.parsed;
    if (notForSketches(s)) { say(s, s.forUse === "builds" ? "only for building real code, not for sketches: read it with get_skill when you build for real" : "not for sketches"); continue; }
    if (s.when === "asked") { say(s, "when the designer asks for it, or when you judge you need it"); continue; }
    if (s.when === "applies") { say(s, s.about.length ? `when ${aboutWords(s.about)}` : "when it applies to what you make"); continue; }
    if (dropped.has(s.id)) { say(s, "for everything you make, but too long to give every time: read it before you make anything"); continue; }
    const decide = reader !== "builder" && !p.whole ? p.decide : "";
    const build = reader !== "planner" ? (p.whole ? p.body : p.build) : "";
    if (!decide && !build) {
      // The planner's share of a skill that is all Build: it should still know the builder follows it.
      if (reader === "planner") say(s, "the builder follows it as written; read it if you need to");
      continue;
    }
    const parts = [decide ? (p.whole ? decide : `Decide:\n${decide}`) : "", build ? (p.whole ? build : `Build:\n${build}`) : ""].filter(Boolean);
    const head = [p.line, noteLine(s)].filter(Boolean).join("\n");
    given.push(`<skill name="${p.name.replace(/"/g, "'")}">\n${head ? `${head}\n\n` : ""}${parts.join("\n\n")}\n</skill>`);
  }
  const lines = [
    "Skills are craft knowledge the designer chose for you: how to do one kind of thing well. Where anything disagrees, the designer's rules come first, then a project's locked decisions, then these skills, then any reference.",
    leadsList(leads, (id) => leadHint(byId.get(id), dropped)),
    ...given,
    listed.length ? `Skills to read with get_skill when they're needed (read each one once in a conversation):\n${listed.join("\n")}` : "",
  ].filter(Boolean);
  return `<designer-skills>\n${lines.join("\n\n")}\n</designer-skills>`;
}

/**
 * For AI apps outside Panel (get_design_rules, a build's HANDOFF.md): the Always skills' parts,
 * under the budget, then the skills whose read says they are for real builds, whenever they are
 * on. `leads`: the same list FRIDAY gets, to give once before the skills ("" with none).
 */
export function skillsForOutside(skills: Skill[], part: "decide+build" | "build", leads: LeadOf[] = []): { leads: string; skills: { name: string; text: string }[] } {
  const on = skills.filter((s) => s.on);
  const { dropped } = fitBudget(on);
  const given = on.filter((s) => notForSketches(s) || (s.when === "always" && !dropped.has(s.id)));
  const here = new Set(given.map((s) => s.id));
  const out = given.flatMap((s) => {
    const p = s.parsed;
    const text = p.whole ? p.body : part === "build" ? p.build : [p.decide && `Decide:\n${p.decide}`, p.build && `Build:\n${p.build}`].filter(Boolean).join("\n\n");
    return text ? [{ name: p.name, text: [noteLine(s), text].filter(Boolean).join("\n\n") }] : [];
  });
  return { leads: out.length ? leadsList(leads, (id) => (here.has(id) ? "" : "read it with get_skill")) : "", skills: out };
}

// ---------- What Panel measures (skillcheck.ts) ----------

/** One skill's checks as the page measures them, with when they run. */
export interface CheckPlan {
  skills: { name: string; line: string; when: "always" | "applies"; about: About[]; checks: SkillCheck[] }[];
  /** Changes whenever what would be measured changes: a stored measurement with another key is out of date. */
  key: string;
}

/** What to measure in a page right now: Always skills' checks, and When-it-applies skills (their checks, and whether they apply). Null when nothing. */
export function checkPlan(skills: Skill[]): CheckPlan | null {
  const use = skills.filter((s) => s.on && !notForSketches(s) && (s.when === "always" ? s.parsed.checks.length > 0 : s.when === "applies" && s.about.length > 0));
  if (!use.length) return null;
  const plan = use.map((s) => ({ name: s.parsed.name, line: s.parsed.line, when: s.when as "always" | "applies", about: s.when === "applies" ? s.about : [], checks: s.parsed.checks }));
  return { skills: plan, key: String(Bun.hash(JSON.stringify(plan))) };
}

// ---------- For the Skills page ----------

/** A skill as the Skills page shows it: what Panel read from it, what FRIDAY gets, and what it costs. `fit`: the budget over every skill that's on. */
export function describeSkill(s: Skill, fit: ReturnType<typeof fitBudget>) {
  const p = s.parsed;
  const every = everyTime(p).length;
  const dropped = fit.dropped.has(s.id);
  // In plain words, what FRIDAY gets from it.
  const gets = !s.on
    ? "Off: FRIDAY doesn't use it."
    : notForSketches(s)
      ? s.forUse === "builds"
        ? "For real builds: FRIDAY won't carry it in sketches. Claude Code gets its Build part when it builds for real."
        : "Not something Panel can use in a sketch: FRIDAY only sees its name."
    : s.when === "asked"
      ? "Listed for FRIDAY: it reads the skill when you ask, or when it judges it needs it."
      : s.when === "applies"
        ? s.about.length ? `FRIDAY reads it when ${aboutWords(s.about)}.` : "Choose what it is about, so FRIDAY knows when to read it."
        : dropped
          ? "Too long to give every time, so FRIDAY reads it when needed."
          : p.whole
            ? `The whole file is in FRIDAY's instructions on every message (about ${tokensOf(every).toLocaleString("en")} tokens).`
            : `${[p.decide && "Decide", p.build && "Build"].filter(Boolean).join(" and ") || "Nothing of it"} ${p.decide && p.build ? "are" : "is"} in FRIDAY's instructions on every message (about ${tokensOf(every).toLocaleString("en")} tokens).`;
  return {
    id: s.id,
    name: p.name,
    line: p.line,
    on: s.on,
    when: s.when,
    about: s.about,
    parts: { decide: p.decide.length, build: p.build.length, check: p.checkText.length },
    whole: p.whole,
    checks: p.checks.map((c) => ({ ...c, plain: CHECKS[c.name]!.plain(c) })),
    unknown: p.unknown,
    /** Rough tokens it adds to every message when on and Always. */
    tokens: tokensOf(every),
    given: !s.on ? "off" : notForSketches(s) ? "listed" : s.when === "always" ? (dropped ? "dropped" : "every") : "listed",
    gets,
    forUse: s.forUse ?? null,
    pack: s.pack ?? null,
    /** From its read: its subjects, the main one first ([] when it has no read in use). */
    subjects: p.subjects ?? [],
  };
}

/** Every skill for the Skills page, and what the ones turned on add to every conversation. */
export function skillsPage(all: Skill[]) {
  const fit = fitBudget(all.filter((x) => x.on));
  const skills = all.map((s) => describeSkill(s, fit));
  const every = skills.filter((s) => s.given === "every").reduce((a, s) => a + s.tokens, 0);
  return { skills, on: skills.filter((s) => s.on).length, tokens: every, budget: tokensOf(SKILL_BUDGET) };
}

/** A skill's other files (from a pack): their paths and sizes, and how to read one. */
export interface SkillFiles {
  list: (id: string) => { path: string; bytes: number }[];
  read: (id: string, path: string) => string | null;
}

const fileSize = (b: number) => (b < 1024 ? `${b} bytes` : `${Math.max(1, Math.round(b / 1024))} KB`);

/**
 * get_skill: a skill that is on, by its name or id; or the list of those that are on. A skill
 * Panel has read (or one with its own Decide / Build headings) answers with its short version
 * (its line, Decide, Build, what Panel checks, then its files); `file: "SKILL.md"` gives the file
 * as its author wrote it, and another `file` one of its other files. A skill with neither
 * answers with its whole file, as written. The short version ends with a line for each subject
 * it speaks to that another skill leads (`leads`): whose word wins where the two differ.
 */
export function readSkillFor(skills: Skill[], name?: string, file?: string, files?: SkillFiles, leads: LeadOf[] = []) {
  const on = skills.filter((s) => s.on);
  const when = (s: Skill) => (s.when === "always" ? "for everything you make" : s.when === "applies" ? (s.about.length ? `when ${aboutWords(s.about)}` : "when it applies") : "when the designer asks, or when you judge it's needed");
  if (!name?.trim()) {
    if (!on.length) return "The designer hasn't turned on any skills.";
    return `The designer's skills that are on. They come after the designer's rules and a project's locked decisions, and before any reference.\n${on.map((s) => listItem(s, ` (${when(s)})`)).join("\n")}`;
  }
  const want = name.trim().toLowerCase();
  // "pack/name" picks one of two skills that share a name: the pack's full name, or its last part.
  const slash = want.lastIndexOf("/");
  const inPack = slash > 0 ? { pack: want.slice(0, slash), name: want.slice(slash + 1) } : null;
  const packIs = (x: Skill, pk: string) => !!x.pack && (x.pack.toLowerCase() === pk || x.pack.toLowerCase().split("/").pop() === pk);
  const exact = inPack
    ? on.filter((x) => x.parsed.name.toLowerCase() === inPack.name && packIs(x, inPack.pack))
    : on.filter((x) => x.id === want || x.parsed.name.toLowerCase() === want);
  if (exact.length > 1)
    return `Two skills that are on are called “${exact[0]!.parsed.name}”. Read one with get_skill and its pack's name before it, as listed:\n${exact.map((x) => `- ${x.pack ? `${x.pack}/` : ""}${x.parsed.name}${x.parsed.line ? `: ${x.parsed.line}` : ""}`).join("\n")}`;
  const s = exact[0] ?? (inPack ? undefined : on.find((x) => x.parsed.name.toLowerCase().includes(want)));
  if (!s) throw new Error(`No skill “${name}” is turned on.${on.length ? ` Turned on: ${on.map((x) => x.parsed.name).join(", ")}.` : " None is."}`);
  const others = files?.list(s.id) ?? [];
  const mainSize = fileSize(new TextEncoder().encode(s.text).length);
  const listOf = (withMain = false) =>
    [...(withMain ? [`- SKILL.md (${mainSize}), the skill as its author wrote it`] : []), ...others.map((f) => `- ${f.path} (${fileSize(f.bytes)})`)].join("\n");
  const want2 = file?.trim().replace(/^\.?\//, "");
  const head = `The designer's skill “${s.parsed.name}”, used ${when(s)}. It comes after the designer's rules and a project's locked decisions, and before any reference.`;
  const note = noteLine(s);
  if (want2 && !/^skill\.md$/i.test(want2)) {
    const lower = want2.toLowerCase();
    const hit = others.find((f) => f.path.toLowerCase() === lower) ?? (() => {
      // Only its name, when that names one file.
      const by = others.filter((f) => f.path.toLowerCase().split("/").pop() === lower);
      return by.length === 1 ? by[0] : undefined;
    })();
    const text = hit ? files!.read(s.id, hit.path) : null;
    if (!hit || text === null)
      throw new Error(others.length ? `The skill “${s.parsed.name}” has no file “${file}”. Its files:\n${listOf(true)}` : `The skill “${s.parsed.name}” has no other files: it is all in its SKILL.md.`);
    return `The file “${hit.path}” of the designer's skill “${s.parsed.name}”.\n\n${text.trim()}`;
  }
  const p = s.parsed;
  // A skill Panel has read (or with its own Decide / Build headings): its short version first,
  // as FRIDAY carries it, and the file as written only when asked for by name.
  if (!p.whole && !want2) {
    const dropped = fitBudget(skills.filter((x) => x.on)).dropped;
    const byId = new Map(skills.map((x) => [x.id, x]));
    // Each subject it speaks to that another skill leads: whose word wins where the two differ.
    const speaks = new Set([...(p.lines?.decide ?? []), ...(p.lines?.build ?? [])].map((l) => l.subject as string));
    const ledBy = leads.filter((l) => l.id !== s.id && speaks.has(l.subject)).map((l) => {
      const h = leadHint(byId.get(l.id), dropped);
      return `On ${l.subject}, ${l.name} leads: where it says something different, follow ${l.name}${h ? ` (${h})` : ""}.`;
    });
    const checks = p.checks.map((c) => `- ${CHECKS[c.name]!.plain(c)}${c.level === "breaks" ? " (must be fixed)" : ""}`);
    return [
      `${head} ${p.lines ? "This is its short version, as Panel read it for sketches." : "This is its short version: the Decide, Build and Check parts of its file."}`,
      [p.line, note].filter(Boolean).join("\n"),
      p.decide && `Decide:\n${p.decide}`,
      p.build && `Build:\n${p.build}`,
      ledBy.join("\n"),
      checks.length ? `Panel checks every sketch for:\n${checks.join("\n")}` : "",
      `Its files. Read one with get_skill, its name and file (file "SKILL.md" for the whole skill as written):\n${listOf(true)}`,
    ].filter(Boolean).join("\n\n");
  }
  const more = others.length ? `\n\nThis skill has more files. Read one with get_skill, its name and file:\n${listOf()}` : "";
  return `${head}${note ? `\n${note}` : ""}\n\n${s.text.trim()}${more}`;
}
