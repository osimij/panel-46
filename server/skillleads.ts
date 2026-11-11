// One skill leads each subject (typography, motion…), so two skills that are on never pull
// FRIDAY two ways on the same thing.
//
// A read tags every Decide and Build line with a subject (skillread.ts). For each subject, look
// at the skills that are on and have lines on it. When there is more than one, one leads, and
// FRIDAY gets the lead's lines on that subject and nobody else's: not in its instructions, not in
// get_skill's short version, not in get_design_rules or a build's hand-off. Where another skill's
// lines were left out, one line says so ("On motion, follow emil-design-eng."). A skill left with
// nothing isn't listed for FRIDAY at all. Checks don't change: every skill that is on is still
// measured.
//
// Who leads: the designer picks (skill_leads, in skilluse.ts). Until they do, Panel picks, and
// says it is Panel's pick: the skill whose main subject it is (the first of its read's subjects);
// between several, the one with more lines on it; then the one turned on first. A lead must be
// on: when the designer's lead is turned off or removed, Panel's pick takes over until it is back.
//
// Only read skills take part: a whole file, or one with its own headings, has no subjects and is
// never cut. Nor do skills only for real builds (or for neither): they never reach a sketch, so
// they neither lead a sketch's subject nor lose lines to one.
//
// This file only works on skills already read from the library: it never opens it, so it can be
// tested on its own. The "follow" lines themselves are written in skills.ts, with the rest of
// FRIDAY's skills block.

import { isLeadSubject, LEAD_SUBJECTS, linesText, type LeadSubject, type ReadLine } from "./skillread.ts";
import { notForSketches, type Cut, type Skill } from "./skills.ts";

/** Who leads one subject, and who else speaks to it. */
export interface Lead {
  subject: LeadSubject;
  /** The skill that leads. */
  id: string;
  name: string;
  /** designer: picked by hand. panel: Panel's pick (the designer hasn't picked, or their pick is off). */
  by: "designer" | "panel";
  /** Panel's own pick, to show beside the designer's. */
  panel: string;
  /** Every skill that is on with lines on this subject, the lead among them. */
  speakers: { id: string; name: string; lines: number }[];
}

/** Lines a skill has on one subject, Decide and Build together. */
const linesOn = (s: Skill, subject: string) =>
  (s.parsed.lines?.decide.filter((l) => l.subject === subject).length ?? 0) + (s.parsed.lines?.build.filter((l) => l.subject === subject).length ?? 0);

/** Whether a skill takes part in leads: on, read, and for sketches. */
const takesPart = (s: Skill) => s.on && !!s.parsed.lines && !notForSketches(s);

/**
 * Every subject that two or more skills that are on speak to, with its lead. `picks`: the
 * designer's, by subject. `since`: when each skill was turned on (an ISO time), for the last
 * tie-break.
 */
export function pickLeads(skills: Skill[], picks: Map<string, string>, since: Map<string, string>): Lead[] {
  const part = skills.filter(takesPart);
  const out: Lead[] = [];
  for (const subject of LEAD_SUBJECTS) {
    const speakers = part.map((s) => ({ s, n: linesOn(s, subject) })).filter((x) => x.n > 0);
    if (speakers.length < 2) continue;
    const mains = speakers.filter((x) => x.s.parsed.subjects?.[0] === subject);
    const pool = mains.length ? mains : speakers;
    const panel = [...pool].sort(
      (a, b) => b.n - a.n || (since.get(a.s.id) ?? "￿").localeCompare(since.get(b.s.id) ?? "￿") || a.s.id.localeCompare(b.s.id),
    )[0]!.s;
    const mine = picks.get(subject);
    const chosen = speakers.find((x) => x.s.id === mine)?.s;
    const lead = chosen ?? panel;
    out.push({
      subject, id: lead.id, name: lead.parsed.name, by: chosen ? "designer" : "panel", panel: panel.id,
      speakers: speakers.map((x) => ({ id: x.s.id, name: x.s.parsed.name, lines: x.n })),
    });
  }
  return out;
}

/**
 * The skills with each lead applied: a skill that isn't the lead of a subject loses its lines on
 * it (`cut` says which), and one left with no lines at all is marked `emptied`. Skills that take
 * no part come back as they were.
 */
export function applyLeads(skills: Skill[], leads: Lead[]): Skill[] {
  const by = new Map(leads.map((l) => [l.subject as string, l]));
  return skills.map((s) => {
    const lines = s.parsed.lines;
    if (!takesPart(s) || !lines) return s;
    const cut = new Map<LeadSubject, Cut>();
    const keep = (ls: ReadLine[], part: "decide" | "build") =>
      ls.filter((l) => {
        const lead = isLeadSubject(l.subject) ? by.get(l.subject) : undefined;
        if (!lead || lead.id === s.id) return true;
        const c = cut.get(lead.subject) ?? { subject: lead.subject, lead: lead.id, leadName: lead.name, decide: 0, build: 0 };
        c[part]++;
        cut.set(lead.subject, c);
        return false;
      });
    const decide = keep(lines.decide, "decide");
    const build = keep(lines.build, "build");
    if (!cut.size) return s;
    return {
      ...s,
      parsed: { ...s.parsed, decide: linesText(decide), build: linesText(build), lines: { decide, build } },
      cut: [...cut.values()],
      emptied: !decide.length && !build.length,
    };
  });
}
