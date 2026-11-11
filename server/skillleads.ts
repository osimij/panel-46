// Who leads a subject (typography, motion…) when two skills that are on both speak to it, so
// FRIDAY knows whose word wins where they disagree.
//
// A read tags every Decide and Build line with a subject (skillread.ts). For each subject, look
// at the skills that are on and have lines on it. When there is more than one, one leads. Nothing
// is taken away: every skill keeps all its lines. A lead is a rule FRIDAY is given beside them
// (skills.ts writes it): where two skills say different things about the same thing, the lead
// of that subject wins; where they don't disagree, FRIDAY follows both. Most lines on a shared
// subject don't disagree at all (one skill's line length and another's safe areas), so cutting
// them cost far more than the few real disagreements (a press of 0.96 against 0.97).
//
// Who leads: the designer picks (skill_leads, in skilluse.ts). Until they do, Panel picks, and
// says it is Panel's pick, in this order:
//   1. the skills whose main subject it is (the first of its read's subjects);
//   2. then the one with more lines on it;
//   3. then one used Always before one used When it applies before one used When asked (a lead
//      already in FRIDAY's instructions is worth more than one it has to go and read);
//   4. then by name, A to Z.
// When the first two are level on 1 and 2, it is a tie, and the lead says so with the other
// skill's name, so the page can say Panel's pick was close. Nothing looks at when a skill was
// turned on. A lead must be on: when the designer's lead is turned off or removed, Panel's pick
// takes over until it is back.
//
// Only read skills take part: a whole file, or one with its own headings, has no subjects. Nor do
// skills only for real builds (or for neither): they never reach a sketch.
//
// This file only works on skills already read from the library: it never opens it, so it can be
// tested on its own.

import { LEAD_SUBJECTS, type LeadSubject } from "./skillread.ts";
import { notForSketches, WHENS, type Skill } from "./skills.ts";

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
  /** Panel's pick was level with this skill on main subject and lines: decided by when it is used, or its name. */
  tie?: string;
  /** Every skill that is on with lines on this subject, the lead among them. */
  speakers: { id: string; name: string; lines: number }[];
}

/** Lines a skill has on one subject, Decide and Build together. */
const linesOn = (s: Skill, subject: string) =>
  (s.parsed.lines?.decide.filter((l) => l.subject === subject).length ?? 0) + (s.parsed.lines?.build.filter((l) => l.subject === subject).length ?? 0);

/** Whether a skill takes part in leads: on, read, and for sketches. */
const takesPart = (s: Skill) => s.on && !!s.parsed.lines && !notForSketches(s);

/** Every subject that two or more skills that are on speak to, with its lead. `picks`: the designer's, by subject. */
export function pickLeads(skills: Skill[], picks: Map<string, string>): Lead[] {
  const part = skills.filter(takesPart);
  const out: Lead[] = [];
  for (const subject of LEAD_SUBJECTS) {
    const speakers = part
      .map((s) => ({ s, n: linesOn(s, subject), main: s.parsed.subjects?.[0] === subject ? 1 : 0 }))
      .filter((x) => x.n > 0);
    if (speakers.length < 2) continue;
    const ranked = [...speakers].sort(
      (a, b) => b.main - a.main || b.n - a.n || WHENS.indexOf(a.s.when) - WHENS.indexOf(b.s.when) || a.s.parsed.name.localeCompare(b.s.parsed.name) || a.s.id.localeCompare(b.s.id),
    );
    const [first, second] = ranked as [(typeof ranked)[number], (typeof ranked)[number]];
    const panel = first.s;
    const mine = picks.get(subject);
    const chosen = speakers.find((x) => x.s.id === mine)?.s;
    const lead = chosen ?? panel;
    const tie = !chosen && first.main === second.main && first.n === second.n ? second.s.parsed.name : undefined;
    out.push({
      subject, id: lead.id, name: lead.parsed.name, by: chosen ? "designer" : "panel", panel: panel.id,
      ...(tie ? { tie } : {}),
      speakers: speakers.map((x) => ({ id: x.s.id, name: x.s.parsed.name, lines: x.n })),
    });
  }
  return out;
}
