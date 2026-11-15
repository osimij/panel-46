// The fresh look: a separate Claude, with no memory of the conversation, compares a sketch with
// the pictures its mix card says it took from. Its findings come back with the sketch as
// mix_checks, the way rule_checks do.
//
// Why a separate run and not FRIDAY looking again: FRIDAY knows what it meant to make, and sees
// that instead of what is there. A run that never saw the conversation sees only the page and
// the references. It is asked the kind of question models answer well ("is this part of that
// picture really here?"), not the kind they answer badly ("is this good?"), which stays the
// designer's.
//
// It runs the way design reads do (readWithClaudeCode in read.ts): claude -p, only the Read
// tool, a form to fill in, a clean environment, in a temp folder deleted afterwards. It is
// turned off with the setting mix_check = "0" (tests always have it off). For tests of what
// FRIDAY gets, PANEL_MIX_CHECK_FAKE names a JSON file holding a filled-in form, read in place
// of calling Claude.

import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { db, getSetting, now } from "./db.ts";
import { claudeBinary, claudeToken, settings } from "./read.ts";
import { DEVICES, fullUrl, renderUrl, sketchPath, type Device } from "./sketches.ts";
import { mixPictures, type Mix } from "./mix.ts";

/** What the fresh look fills in. */
export interface MixChecks {
  takes: { save: string; job: string; verdict: "there" | "partly" | "missing"; note: string }[];
  copy: { verdict: "own" | "close" | "copy"; note: string };
  sections: { name: string; follows: string; template: boolean; note: string }[];
}

/** One line of what FRIDAY gets back, worst first, like rule_checks. */
export interface MixCheckLine {
  mark: "breaks" | "check" | "fine";
  what: string;
}

const FORM = {
  type: "object",
  additionalProperties: false,
  required: ["takes", "copy", "sections"],
  properties: {
    takes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["save", "job", "verdict", "note"],
        properties: {
          save: { type: "string" },
          job: { type: "string" },
          verdict: { type: "string", enum: ["there", "partly", "missing"] },
          note: { type: "string" },
        },
      },
    },
    copy: {
      type: "object",
      additionalProperties: false,
      required: ["verdict", "note"],
      properties: { verdict: { type: "string", enum: ["own", "close", "copy"] }, note: { type: "string" } },
    },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "follows", "template", "note"],
        properties: { name: { type: "string" }, follows: { type: "string" }, template: { type: "boolean" }, note: { type: "string" } },
      },
    },
  },
};

const SYSTEM = `You are a strict second pair of eyes for a designer. Another model made a page and says what it took from which reference. You have not seen their conversation. Open every listed picture with the Read tool, then answer only with the form.

Judge only what you can see. Be hard to please: the usual failure is a page that carries a reference's color and one detail while its structure is a common template.

1. For each take: is the thing really there in the page, as it is in the reference's picture? "there": a designer would see it at once. "partly": the idea is there but weaker, smaller, or changed in a way that loses it. "missing": it is not there, or only its words are. Say in one line what you see.
2. Is the page a copy of the hero? "copy": it would be mistaken for the same site with other words. "close": the structure and the look are both the hero's, with little of its own. "own": it takes what the card says and is clearly its own page.
3. Name each section of the page, top to bottom. For each, say whether it follows something in the references, or looks like a common template block (text left and picture right; three cards in a row; heading and grid; a centred headline over a gradient).`;

/** How long the fresh look may take before it is stopped. */
const TIMEOUT = 120_000;
/** How many screens of the page it sees: the whole page, not only the three FRIDAY gets. */
const SCREENS = 8;

/** Whether the fresh look runs at all: off with mix_check = "0", on otherwise. The fake runs either way. */
export const mixCheckOn = () => !!process.env.PANEL_MIX_CHECK_FAKE || getSetting("mix_check") !== "0";

/** A form as the fresh look or the fake wrote it, checked for the parts that are used. */
function asForm(v: unknown): MixChecks {
  const f = v as MixChecks;
  if (!f || typeof f !== "object" || !Array.isArray(f.takes) || !f.copy || typeof f.copy.verdict !== "string" || !Array.isArray(f.sections)) {
    throw new Error("its answer wasn't the form it was asked for");
  }
  return f;
}

/**
 * Compare a sketch version with the pictures its mix took from. Never throws: when it can't
 * run, the answer says why, in plain words.
 */
export async function checkMix(project: string, sketch: string, version: number, mix: Mix, device: Device): Promise<MixChecks | { not_checked: string }> {
  const started = Date.now();
  // How long it took, in the server's log: it is what a sketch with a mix waits for.
  const took = (what: string) => console.log(`Fresh look at sketch ${sketch} v${version}: ${what} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  try {
    const fake = process.env.PANEL_MIX_CHECK_FAKE;
    const form = fake ? asForm(JSON.parse(await Bun.file(fake).text())) : await askFreshLook(project, sketch, version, mix, device);
    saveChecks(project, sketch, version, mix, form);
    if (!fake) took("done");
    return form;
  } catch (e) {
    took(`not checked (${(e as Error).message})`);
    return { not_checked: (e as Error).message || "something went wrong" };
  }
}

async function askFreshLook(project: string, sketch: string, version: number, mix: Mix, device: Device): Promise<MixChecks> {
  const bin = await claudeBinary();
  if (!bin) throw new Error("the claude command line isn't installed");
  const token = await claudeToken();
  const dir = mkdtempSync(join(tmpdir(), "panel-mixcheck-"));
  try {
    // The whole page, screen by screen, into the temp folder.
    const render = await renderUrl(fullUrl(sketchPath(project, sketch, version)), device, (i) => join(dir, `sketch-${i + 1}.jpg`), SCREENS);
    if (render.failed || !render.screens.length) throw new Error(`the page couldn't be rendered${render.failed ? ` (${render.failed})` : ""}`);
    // Each take's picture at full size, beside it.
    const takes = mixPictures(mix).map((p, i) => {
      const name = `take-${i + 1}${extname(p.file) || ".jpg"}`;
      copyFileSync(p.file, join(dir, name));
      return { name, caption: p.caption };
    });
    if (!takes.length) throw new Error("none of the saves it took from has a picture on this Mac");
    const screen = DEVICES[device];
    const files = [
      ...render.screens.map((f, i) => `${join(dir, `sketch-${i + 1}.jpg`)}: the page, screen ${i + 1} of ${render.screens.length} on ${device} at ${screen.width}×${screen.height} (from ${i * screen.height}px down; the page is ${render.height}px tall)`),
      ...takes.map((t) => `${join(dir, t.name)}: a reference. ${t.caption}`),
    ];
    const prompt = `Open each of these pictures with the Read tool, in order:\n${files.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n\nThe mix card, what the page says it takes from which reference:\n${JSON.stringify(mix)}\n\nFill in the form.`;
    // A clean environment, as for design reads: nothing from a shell should change where this goes.
    const env: Record<string, string> = {
      HOME: process.env.HOME ?? "",
      USER: process.env.USER ?? "",
      PATH: `${process.env.PATH ?? ""}:/usr/bin:/bin`,
      ...(token ? { CLAUDE_CODE_OAUTH_TOKEN: token } : {}),
    };
    const proc = Bun.spawn(
      [
        bin, "-p", prompt,
        "--model", settings.model(), "--effort", "medium",
        "--output-format", "json", "--json-schema", JSON.stringify(FORM),
        "--system-prompt", SYSTEM,
        "--tools", "Read", "--allowedTools", "Read",
        "--no-session-persistence", "--strict-mcp-config", "--setting-sources", "",
      ],
      { cwd: dir, env, stdout: "pipe", stderr: "pipe" },
    );
    let late = false;
    const timer = setTimeout(() => {
      late = true;
      proc.kill();
    }, TIMEOUT);
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    clearTimeout(timer);
    if (late) throw new Error("it took longer than two minutes, so it was stopped");
    let res: { is_error?: boolean; result?: string; structured_output?: unknown };
    try {
      res = JSON.parse(out);
    } catch {
      throw new Error(`Claude Code didn't answer: ${(err || out).trim().split("\n").pop()?.slice(0, 200) || "no output"}`);
    }
    if (res.is_error) throw new Error(`Claude Code: ${res.result?.slice(0, 200) ?? "failed"}`);
    let form = res.structured_output;
    if (!form && res.result) {
      try {
        form = JSON.parse(res.result.replace(/^```(?:json)?\s*|\s*```$/g, ""));
      } catch {
        /* asForm says so below */
      }
    }
    return asForm(form);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Keep the form with the version it judged. A version with no row of its own (an edit that kept
 * the mix) gets one, with the same mix and these checks.
 */
function saveChecks(project: string, sketch: string, version: number, mix: Mix, form: MixChecks) {
  db.run(
    "INSERT INTO sketch_mix (sketch, version, project, mix, checks, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(sketch, version) DO UPDATE SET checks = excluded.checks",
    [sketch, version, project, JSON.stringify(mix), JSON.stringify(form), now()],
  );
}

/**
 * The last checks for the mix that holds at this version: from this version or an earlier one
 * with the same mix. A small edit carries them forward rather than asking again.
 */
export function lastChecks(sketch: string, version: number, mixVersion: number): { form: MixChecks; version: number } | null {
  const row = db
    .query<{ checks: string; version: number }, [string, number, number]>(
      "SELECT checks, version FROM sketch_mix WHERE sketch = ? AND version <= ? AND version >= ? AND checks IS NOT NULL ORDER BY version DESC LIMIT 1",
    )
    .get(sketch, version, mixVersion);
  if (!row) return null;
  try {
    return { form: asForm(JSON.parse(row.checks)), version: row.version };
  } catch {
    return null;
  }
}

/** The form as short lines for FRIDAY, worst first: what breaks, then what to check, then what is fine. */
export function checkLines(f: MixChecks): MixCheckLine[] {
  const lines: MixCheckLine[] = [];
  for (const t of f.takes) {
    lines.push({ mark: t.verdict === "missing" ? "breaks" : t.verdict === "partly" ? "check" : "fine", what: `${t.save} (${t.job}): ${t.verdict}: ${t.note}` });
  }
  const copy = { copy: "the page is a copy of the hero", close: "the page is close to the hero", own: "the page is its own" }[f.copy.verdict] ?? f.copy.verdict;
  lines.push({ mark: f.copy.verdict === "copy" ? "breaks" : f.copy.verdict === "close" ? "check" : "fine", what: `${copy}: ${f.copy.note}` });
  for (const s of f.sections) {
    if (s.template && (!s.follows || s.follows.trim().toLowerCase() === "none")) {
      lines.push({ mark: "check", what: `${s.name}: no save behind it, and it reads as a template block: ${s.note}` });
    }
  }
  const order = { breaks: 0, check: 1, fine: 2 };
  return lines.map((l, i) => ({ l, i })).sort((a, b) => order[a.l.mark] - order[b.l.mark] || a.i - b.i).map((x) => x.l);
}
