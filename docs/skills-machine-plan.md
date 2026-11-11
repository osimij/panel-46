# Plan: skills built into how Panel makes things (the machine, part 1)

Written 11 Nov 2026 for another Claude session to carry out. Read all of it, `CLAUDE.md`, `unugly.md`, `server/rulecheck.ts`, `server/chat.ts` (the instructions and `duo()`/`build()`), `server/duo.ts` and the two example skills in [docs/skills/](skills/) before touching anything. When you finish, write the report described at the end and stop: it is checked before anything else is built on it.

## Why

The designer wants every output of Panel to be beautiful, and wants skills (files of craft knowledge: typography, motion…) to be part of how Panel works, not something the model may or may not remember.

Today Panel shapes an output three ways: the designer's rules (`unugly.md`, in FRIDAY's instructions on every message), the designer's references, and the **rule checks**: after a sketch is rendered, Panel measures the real page and FRIDAY must fix what breaks (`server/rulecheck.ts`). The checks are the strongest of the three, because they don't depend on the model remembering anything.

Skills plug into the same machine. A skill does its work at three moments:

| Moment | Part of the skill | Where it goes |
|---|---|---|
| Before: deciding | `## Decide`: the decisions to make and write down | The instructions of whoever decides |
| During: building | `## Build`: how to build it right | The instructions of whoever builds |
| After: checking | `## Check`: things Panel measures in the finished page | Beside `rule_checks` in every sketch's answer |

Panel has a Skills page already (saves with `kind = 'skill'`; the file's text is in `refs.text`; `readSkill()` in `server/capture.ts` reads the name and description). Nothing uses them yet. Skills, like collections, are the designer's: nothing reaches FRIDAY until the designer turns it on.

**Order of authority, to state wherever skills are given:** the designer's rules, then a project's locked decisions, then skills, then references.

## Rules for this job

- Follow `CLAUDE.md`: never touch `~/DesignLibrary` or port 4646; never `bun run build` or `bun run start`; do not restart the real app; do not commit. Try everything on the copy (`scripts/copy.sh`, and `scripts/copy.sh --build` after changing `web/`).
- Other sessions are editing this folder (a canvas rework among them). Never `git stash`, `git checkout`, `git reset` or reformat a file; change only what this plan needs. Stay out of `web/src/Canvas.tsx`, `web/src/canvas.css`, `server/projects.ts`, `server/board.ts`.
- The database may only gain things: this plan adds one new table. Nothing is renamed, dropped or rewritten.
- No new dependency. Comments, labels and messages in plain words that say what happens and why.
- Anything you can see is designed by `unugly.md` and the house style in `CLAUDE.md`: grayscale, Inter, quiet, the classes already in `styles.css`, `corner-shape: var(--corner)`. Look at it in the browser on the copy before saying it works.
- Use your own copy server: `panel-copy-search` (port 4757) in `.claude/launch.json`. Restart it after changing `server/`.
- This step spends the designer's Claude plan in exactly one place: the **two FRIDAY messages** of the "Live check". Nothing else may call Claude.

## What to build

### 1. A skill in Panel's form

A skill stays an ordinary `SKILL.md` (frontmatter with `name` and `description`, then Markdown), so a downloaded one still works. Panel reads these sections when they are there, by their headings (any level, any case):

- `Decide`, `Build`: prose, given as written.
- `Check`: a list, one check a line: `- <check name>: <numbers>`, with `(breaks)` at the end for a check that must be fixed. Example: `- line_length: 45–85`, `- overflow (breaks)`.
- Everything else (`Look for`, long reference): only read when the skill is opened with `get_skill`.

A file with none of these headings is still a skill: its whole body is its guide (see "How it is given" for what happens to it).

Put the reading of a skill in a new `server/skills.ts`, with no side effects on import beyond its own table, so it can be tested. See [docs/skills/typography.md](skills/typography.md) and [docs/skills/motion.md](skills/motion.md) for the form.

### 2. What the designer sets, and where it is kept

A new table (name it plainly, e.g. `skill_use`), one row per skill the designer has touched: the save's id, whether it is **on** (off until they say so), and **when it is used**:

- **Always**: for anything FRIDAY makes.
- **When it applies**: only for pages that have what it is about. This step knows three: `motion` (the page animates), `phone` (made for a phone), `forms` (it has fields to fill).
- **When asked**: only listed; FRIDAY reads it when the designer says, or when it judges it needs it.

Routes (guarded with `fromPanel(req)`, tested): one to list the skills with what Panel read from each (the parts, the checks it knows and doesn't, the cost in rough tokens), one to change a skill's setting.

### 3. How it is given to FRIDAY

In `systemPrompt()`, after the designer's rules, a `<designer-skills>` block, read fresh on every message the way the rules are (so a change applies to the next message without a restart). It needs to know who it is for:

| Who | Gets, for each skill that is on and Always |
|---|---|
| One model | `Decide` and `Build` |
| The planner (Plan, then build) | `Decide` |
| The builder (Plan, then build) | `Build` |

- The block opens with two sentences: what skills are (craft, how to do a kind of thing well) and the order of authority.
- It ends with a short list of every skill that is on but not Always: its name, its one line, and when it is for, to be read with `get_skill`.
- A skill with no `Decide`/`Build` headings that is on and Always is given whole, as if all of it were `Build`.
- **A budget:** all Always parts together stay under about 16,000 characters (about 4,000 tokens). Past that, the skills that don't fit (largest first) drop to the list and are read with `get_skill`; the Skills page says which, and why.
- The builder's instructions must stay the same from one builder run to the next (hand-over, pointed edit, Figma rebuild), or its cache is thrown away: give `build()` the builder's version every time. With no skills on, every instruction text must be exactly what it is today.
- Add a few lines to `SYSTEM` beside what it says about `rule_checks`: a sketch's answer also carries `skill_checks`, what Panel measured against the skills; fix every one marked "breaks"; for each marked "check", fix it, or keep it and say in the reply why; and when the answer lists `skills_that_apply`, read each with `get_skill` if it hasn't been read in this conversation, then look at the page again.

### 4. A tool to read a skill

`get_skill` in `server/mcp-tools.ts` (read-only): with a name, the whole skill as written; with none, the list of skills that are on. The planner may use it (add it to `READ_TOOLS`). Mention it in one line of `INSTRUCTIONS`. Tool definitions as a whole (the `TOOLS` line of `scripts/measure-search.ts`) stay under 31,500 characters.

Also, for AI apps that reach Panel from outside (Claude Code, a build): `get_design_rules` adds the Always skills' `Decide` and `Build` under their own heading after the rules, and the `HANDOFF.md` a build gets (`server/builds.ts`) gains a "The designer's skills" section with their `Build` parts, after the rules and saying they come second to them.

### 5. The checks

A new `server/skillcheck.ts`, modeled on `rulecheck.ts`: one function that runs in the page, findings of the same shape (`rule` is the skill's name, `level`, `what`, `where`). It runs in `shoot()` after `checkRules`, is kept with the render the way `rules` is, and reaches the model as `skill_checks` beside `rule_checks` (`sketchContent`, and wherever else `rule_checks` goes).

Which checks run: those named by skills that are on and either Always, or When it applies and the page has what they are about. Panel finds that out in the page itself: `motion` when anything visible has a transition or animation (or the page defines keyframes), `forms` when it has an input, textarea or select, `phone` from the device being rendered. When a When-it-applies skill is on and its thing is on the page, the answer also lists it under `skills_that_apply` (name and one line).

The first checks. Each takes its numbers from the skill's line, with these defaults. **All are "check" unless the skill's line says `(breaks)`**:

| name | what it measures | default |
|---|---|---|
| `line_length` | characters per line in running text (a block with 3 lines or more) | at most 85 |
| `font_sizes` | how many different text sizes are on the page | at most 8 |
| `font_families` | how many different font families set text | at most 3 |
| `line_height` | line height of running text (up to 22px) as a multiple of its size | 1.3 to 1.8 |
| `contrast` | text against what is behind it (WCAG ratio); larger text (24px and up) needs 3 | at least 4.5 |
| `small_text` | the smallest text on the page | at least 12px |
| `overflow` | the page scrolls sideways, or something is wider than the screen | never |
| `reduced_motion` | the page animates but nowhere handles `prefers-reduced-motion` | handled |
| `tap_targets` | on a phone, buttons and links smaller than 44px in both directions | none |

**False alarms are worse than no check.** A wrong finding makes FRIDAY "fix" a good design. So each check must be careful: skip text over a picture or a gradient when judging contrast; ignore what isn't visible, Panel's own kit (`[data-panel-kit]`) and single characters; say where (a few places, as `rulecheck.ts` does) and by how much. If you can't make one trustworthy, leave it out and say so in the report. A check name Panel doesn't know is ignored when measuring and shown to the designer as one Panel can't measure yet.

With no skills on, a sketch's answer must be exactly what it is today (no empty `skill_checks`).

### 6. The Skills page

Keep it quiet. For a skill, in its detail view (`web/src/Detail.tsx`), above the file's text:

- a switch: **Use in FRIDAY** (off at first);
- when on, the choice **Always · When it applies · When asked**, and for "When it applies" which of Motion, Phone screens, Forms;
- what FRIDAY gets from it, in plain words: "Decide and Build are in FRIDAY's instructions on every message (about 900 tokens)" / "FRIDAY reads it when a page moves" / "Too long to give every time, so FRIDAY reads it when needed";
- its checks as a short list in plain words ("Lines of text no longer than 85 characters"), with any Panel can't measure marked so;
- for a file without the three headings: one line saying FRIDAY gets it whole, as written.

On a skill's card in the grid, a small mark when it is on. At the top of the Skills page, one quiet line: how many are on and about how many tokens they add to every conversation. Change nothing else on the page.

## Tests

`tests/skills.test.ts`, with the two example files as fixtures:

- reading a skill: the three parts, the checks with their numbers and `(breaks)`, unknown check names kept apart, a file with no headings;
- the instructions: One model gets Decide and Build, the planner only Decide, the builder only Build; a skill that is off, or not Always, is not in the block; the list at the end; the budget drops the largest to the list; with no skills on the text is exactly today's;
- the routes: listing, turning on, changing when; refused from outside Panel;
- `get_skill` with and without a name;
- the checks, each on a small page that should trip it and one that should not, through the same rendering path the sketch tests use (if that needs headless Chrome and the tests can't have it, test the measuring function another honest way and say so);
- a sketch's answer has `skill_checks` only when a skill with checks is on, and `skills_that_apply` only for a page that moves when a motion skill is on.

Then `bun run typecheck`, `bun test tests`, and `PANEL_PORT=4799 PANEL_LIBRARY_DIR=.copy/lib bun scripts/measure-search.ts` (the `ORDER` lines and every search line must be what they are now; only `TOOLS` may grow, under 31,500).

## Live check (two FRIDAY messages, no more)

On your copy server, One model, on one project that exists in the copy. Add [docs/skills/typography.md](skills/typography.md) to the copy's Skills page through the app (drop the file), as the designer would.

1. **Skill off.** A new conversation on the project's canvas: "Sketch a simple article page for this project: a headline, a short intro, three paragraphs and a pull quote. One screen wide, keep it simple."
2. **Skill on, Always.** Turn it on in the app. A new conversation, the same message.

Then, with the skill still on, read the first sketch again with `get_sketch` (through Panel's MCP on the copy, not through FRIDAY) so the same checks measure both.

Report for each: the `skill_checks` found, the picture, the tools FRIDAY called, the `ai_usage` row (cache read, cache write, output), and whether FRIDAY in run 2 acted on a finding (fixed it, or said why it stays). Save both pictures in `.copy/`. Take a screenshot of the skill's detail view and of the Skills page with it on.

Then your honest read, as someone with an eye: is the second page better set than the first, and where? One run each is a first look, not proof; the designer judges.

## The report

Write `docs/skills-machine-report.md`:

1. **What changed**, file by file; anything done differently from this plan and why; any check left out and why.
2. **With no skills on**: how you made sure FRIDAY's instructions and a sketch's answers are exactly as before.
3. **The live check**: both runs side by side as above, the two pictures, your read.
4. **The checks**: for each, what it measures, its false-alarm guards, and what it said about the two live sketches and about two or three existing sketches in the copy (run them through `get_sketch`; no Claude). Say plainly which findings on those existing sketches you think are wrong.
5. **Cost**: the size of the `<designer-skills>` block for each of the three readers with the typography skill on; the `TOOLS` line before and after.
6. **Checks**: typecheck, tests, the measuring script.
7. **The database**: the new table, and whether it now exists in the real library (it will, once any Claude Code session starts Panel's MCP on this code, if `mcp-tools.ts` loads `skills.ts`; say which is true; do not add it yourself).
8. **Doubts**, and what you would do next.
9. **Note for the designer**, a few plain sentences: how to add a skill and turn it on, what FRIDAY does with it, that nothing reaches FRIDAY until they turn it on, that the real Panel keeps the old behaviour until restarted, that nothing was committed.

## Not in this step (planned next, after this is checked)

- **Adapting a downloaded skill**: Panel rewriting a general skill into Decide / Build / Check, showing where it disagrees with `unugly.md`, for the designer to approve.
- **More checks**, chosen from what the designer's real skills ask for.
- **A larger with-and-without test** across several briefs.
- Smaller pictures, anything about search, anything in the canvas.
