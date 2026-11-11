# Report: skills built into how Panel makes things (the machine, part 1)

Done 11 Nov 2026, from [skills-machine-plan.md](skills-machine-plan.md). Everything was tried on the copy (`.copy/lib`, my server on port 4757). The real library and the real app on 4646 were not touched. Nothing was committed.

## 1. What changed

### New files

- **`server/skills.ts`**: reading a skill and everything that is only text. It never opens a library.
  - `parseSkill()` reads the name, the one line, and the `Decide`, `Build` and `Check` sections, by heading, at any level and in any case. Headings inside code blocks don't count. The `Check` lines become checks with their numbers and `(breaks)`. Lines Panel can't measure are kept apart as `unknown`. A file with no `Decide` or `Build` heading is `whole`.
  - `CHECKS` lists the 9 checks Panel knows, their default numbers, and how to say each one in plain words.
  - `skillsBlock(reader, skills)` writes the `<designer-skills>` block for one reader (One model, planner or builder).
  - `fitBudget()` applies the 16,000-character budget.
  - It also has `checkPlan()` (what to measure), `describeSkill()` / `skillsPage()` (what the Skills page shows), `readSkillFor()` (get_skill) and `skillsForOutside()` (get_design_rules and HANDOFF.md).
- **`server/skilluse.ts`**: the new table `skill_use`, and what the designer set for each skill: on or off, when, and what it is about. It holds the small functions that read the library and pass the result to `skills.ts`.
- **`server/skillcheck.ts`**: the checks, modeled on `rulecheck.ts`. One function runs inside the page. It first finds what the page has (it moves, it has a form; "phone" comes from the device it is rendered on), then runs the checks of the skills that apply. Its findings have the same shape as rule findings (`rule` = the skill's name, `level`, `what`, `where`), plus `check` (which measurement it was).
- **`tests/skills.test.ts`**: 21 tests (section 6).

### Changed files

- **`server/chat.ts`**
  - `systemPrompt(reader)` adds the `<designer-skills>` block after the designer's rules, read fresh on every message.
  - While any skill is on, the line about `rule_checks` in `SYSTEM` is followed by one line about `skill_checks` and `skills_that_apply`. With none on, `SYSTEM` is untouched.
  - The planner gets `systemPrompt("planner")`. `build()` always passes `systemPrompt("builder")` (hand-over, pointed edit, Figma rebuild). `get_skill` is added to `READ_TOOLS`.
- **`server/mcp-tools.ts`**
  - One line about `get_skill` in `INSTRUCTIONS`, and the `get_skill` tool itself (read-only).
  - `get_design_rules` adds the Always skills' Decide and Build under "## The designer's skills", after the rules.
  - A sketch's answer carries `skill_checks` and `skills_that_apply` beside `rule_checks`. `make_sketch`, `edit_sketch` and `get_sketch` pass the render through `withSkillChecks()`.
- **`server/sketches.ts`**
  - `Render` gains `skills`, `apply` and `skillKey`. They are kept in the version's `.json` beside `rules`, and only when something was measured, so with no skill on the file is exactly as before.
  - `shoot()` runs `checkSkills()` right after `checkRules()`, and can now measure a page without taking pictures.
  - `withSkillChecks()` brings an older render up to date (see "Done differently" 4).
- **`server/builds.ts`**: HANDOFF.md gains "## The designer's skills" with the Always skills' Build parts. It comes after the rules and says the rules win where they disagree.
- **`server/index.ts`**: three routes, all guarded with `fromPanel(req)`:
  - `GET /api/skills`: every skill, with what Panel read from it, what FRIDAY gets, the rough tokens, and the total for the page.
  - `GET /api/skills/:id`: one skill.
  - `PATCH /api/skills/:id`: `{ on, when, about }`.
- **`web/src/api.ts`**: the types, plus a small shared `skillStore` so the card, the detail view and the page's top line stay in step.
- **`web/src/Detail.tsx`**: `SkillUsePanel`, above the file's text:
  - the switch **Use in FRIDAY**;
  - when on, **Always · When it applies · When asked**, and for "When it applies" the pills Motion, Phone screens and Forms;
  - what FRIDAY gets, in plain words;
  - "Panel checks every sketch for" with each check in plain words. A check that must be fixed says "must be fixed". One Panel can't measure says "Panel can't measure this yet".
  - For a file with no headings, one line saying FRIDAY gets it whole.
- **`web/src/Grid.tsx`**: a small "In FRIDAY" label beside "SKILL.md" on the card of a skill that is on.
- **`web/src/App.tsx`**: one quiet line at the top of Skills, for example "1 used by FRIDAY, adding about 558 tokens to every message", or "None used by FRIDAY yet: open one to turn it on".
- **`web/src/styles.css`**: `.skill-use…`, `.skill-labels` and a small `.switch`. The switch is the only new control: there was no switch in Panel yet. It is grayscale, a capsule, and stops moving under reduced motion. Everything else reuses `.seg`, `.pill` and the `.doc` card look.

### Done differently from the plan, and why

1. **`skills.ts` is split in two.** The plan put the reading and the table in one file. But `bun test` runs every test file in one process with shared modules, and `tests/findin.test.ts` already opens a library through `db.ts` with no library folder set, which is the real `~/DesignLibrary`. I checked this with two scratch test files. A test that loads a file that creates a table could therefore create `skill_use` in the real library. So `skills.ts` has no database at all (tested directly), and the table lives in `skilluse.ts` (tested only through a test companion, a separate process with a temp library).
2. **"It moves" is a bit stricter than written.** The plan says motion means anything visible has a transition or animation, or the page defines keyframes. A colour change on hover (`transition: color .2s`) is on nearly every link, and would make the motion skill "apply" to almost every page. So a transition counts only when it moves or resizes something (transform, position, size, `all`). Running animations, animations from scripts and keyframes still count, as planned. For `reduced_motion`, keyframes count only when something uses them.
3. **No empty `skill_checks`, even with skills on.** When the checks ran and found nothing, `skill_checks` is left out, the way `rule_checks` is. FRIDAY can't tell "passed" from "not measured", but this keeps answers short. Easy to change.
4. **Older sketches are measured again when read.** A sketch made before a skill was turned on has no skill checks stored. `get_sketch` sees that what is stored was measured against other skills (or none), measures the page again without new pictures (about 2 to 15 seconds), and remembers the result in memory. With no skills on, stored skill checks are dropped from the answer. That is how "read the first sketch again with get_sketch" can measure both the same way.
5. **Alternates in Plan, then build** (several sketches at once) also get the builder's instructions. They branch from the builder's conversation, so giving them One model's text would break its cache.
6. **The planner hears about an Always skill that has only Build** (or no headings): it is listed at the end as "the builder follows it as written". Otherwise the planner wouldn't know it exists.
7. **Picking "When it applies" the first time guesses what the skill is about** from its name and line (motion, phone, forms). The designer can change it at once. Typography gets no guess, so the page asks: "Choose what it is about".
8. **Two guards added after looking at real sketches** (section 4): avatar initials, and a mono used only for figures.

No check was left out: all nine are in. Their limits are in section 4.

## 2. With no skills on

- **FRIDAY's instructions.** Before changing any code, I wrote out `systemPrompt()` from the code as it was, on a clone of the copy's library (12,213 characters). After all changes, on a fresh clone, `systemPrompt("solo")`, `("planner")` and `("builder")` are each byte for byte the same file (`cmp`). The planner's note and the builder's brief are built on top of these and were not changed.
- **A sketch's answer.** Before any change, I ran the old code on a clone of the copy. I called `make_sketch` with a fixed page, and `get_sketch` on three existing sketches (no pictures, no HTML), and saved the answers. After all changes I did the same on a fresh clone. The answers are identical (only the port in the URLs differs, by design of the test).
- **Stored files.** A version's `.json` only gains `skills`, `apply` and `skill_key` when something was measured. With none on, it is written exactly as before.
- **Tests that hold it.** `tests/skills.test.ts` checks that with nothing on, all three readers get the same text, with no `designer-skills` and no `skill_checks`. It also checks that with Typography on, removing the one inserted line and the block gives back exactly the text with nothing on. And it checks that a sketch's answer has no `skill_checks` and no `skills_that_apply` key while nothing is on, even on a page that would trip every check.
- **One thing does change for everyone.** Panel's MCP now always has the `get_skill` tool and one line about it in its instructions, as the plan asks. Claude Code puts MCP instructions and tool definitions in front of the model too. So with no skills on, the model still sees one more tool and one more line (391 characters of tool definition, section 5). FRIDAY's own instructions are unchanged.

## 3. The live check

Both runs: One model (Opus 5.5, high), a new conversation on the canvas of **HUJJAT** in the copy, with nothing selected. The message was sent exactly as the canvas sends it (`context: { project }`): "Sketch a simple article page for this project: a headline, a short intro, three paragraphs and a pull quote. One screen wide, keep it simple."

I added `docs/skills/typography.md` through the app: the Skills page's own drop handler was given the file. The browser pane can't use the Mac's file picker, so I handed the drop event a real `File`, the same code path as dragging it in. It arrived as "Added 1 skill". I turned it on with the switch in the detail view.

| | Run 1: skill off | Run 2: Typography on, Always |
|---|---|---|
| Sketch | `0144e09df9d34907` "Article page, sage header and one pull quote" (v2) | `5b2705c16427478a` "Article page, one white column" (v2) |
| Pictures | `.copy/skills-live-run1.jpg`, `-run1-2.jpg` | `.copy/skills-live-run2.jpg`, `-run2-2.jpg` |
| Tools FRIDAY called | get_project, get_verdicts, get_brand_assets, get_sketch (the sage hero), make_sketch, get_sketch (state tg), edit_sketch (1 edit) | get_project, get_verdicts, get_brand_assets, get_sketch (run 1's article), make_sketch (**refused**: "No such tool available", with `uses` sent as a string; retried at once), make_sketch, get_sketch (state tg), edit_sketch (1 edit: `text-wrap: balance` → `pretty` on the pull quote, for a Tajik line break) |
| `skill_checks` | none: the skill was off. Read again later with get_sketch through Panel's MCP, Typography on: **none found** | Measured in its make_sketch and edit_sketch answers: **none found** |
| `ai_usage` (one row each) | cache read 237,956 · cache write 71,101 · output 10,321 · input 12 | cache read 306,467 · cache write 59,150 · output 12,212 · input 14 |
| Time | 4 min 14 s | 3 min 0 s |
| Acted on a finding? | — | Nothing was found, so nothing to act on. It never called get_skill (an Always skill is already in its instructions). |

The higher cache read in run 2 is mostly its extra steps (the refused `make_sketch`, and reading run 1's sketch). It isn't the skills block, which is about 700 tokens.

The refused `make_sketch` came from Claude Code before the call reached Panel: the model sent `uses` as a string and the call was rejected. I don't think it is caused by this change. I've seen nothing like it in the tools Panel was given, but it is worth watching.

What run 2 took from the skill, visibly, in its HTML:
- `text-wrap: balance` and `text-wrap: pretty`, and `font-synthesis: none` (run 1 had none of these);
- knobs named the way the skill's Build says (`--size-body`, `--leading-body`, `--size-title`…);
- 26 non-breaking spaces after one-letter words, against 8 in run 1;
- a 56px light headline at 1.08, body 18px at 1.6;
- in its reply: "Text lines stay under 70 characters", and type in four main sizes.

It held the measure with a column width in px, not `max-width: 65ch` as Build says.

Run 1, measured by hand in the page to check that "none found" is honest: body 19px at 1.62, about 72 characters a line, five text sizes, one family (ALS Unios), body colour #4f5b50 on white (about 7:1). It passes every number, so the skill had little to correct.

**My read, as someone with an eye.** Run 2 is better *set*. The headline breaks at a natural phrase ("Как банк проверяет акт, / подписанный в HUJJAT"). The measure is shorter and more comfortable. The pull quote hangs its «» outside the text edge without a box. One-letter words stay with the next word. It looks like type that was considered, not just placed.

Run 1 is the better *page*. The sage band and the meta column beside the text give it structure and a sense of HUJJAT. Run 2 is a plain white column that sits left of centre with a large empty right side (FRIDAY says so itself). Its second paragraph has an awkward ragged edge where "на verify.hujjat.tj" was held together and pushed down.

So the skill improved the typesetting details and probably pushed towards a quieter, more literal "simple". The difference in layout is more likely chance between two runs than the skill. Neither page tripped a single check, so this run says nothing yet about whether FRIDAY fixes what the checks find. One run each is a first look, not proof. The designer judges.

Screenshots: `.copy/skills-detail-on.jpg` (the skill's detail view, on) and `.copy/skills-page-on.jpg` (the Skills page with it on). I also checked the panel in light mode.

## 4. The checks

All are "check" unless the skill's line says `(breaks)`. Every check ignores what isn't visible (zero size, `visibility: hidden`, opacity under 0.05 on it or a parent, clipped to a pixel), Panel's own kit, SVG, and text of fewer than two letters or figures.

| Check | What it measures | Guards against false alarms |
|---|---|---|
| `line_length` | Characters per line of running text: blocks of body-size type (8–24px) set in 3 lines or more. Chrome says where each word sits; the median line, not counting the last. Too long: past the max. Too short: under the min. | Headings, nav, buttons, tables and code are not running text. A block with other blocks inside isn't one paragraph. "Too short" is only reported for 4 lines or more at 14px or more, so a caption in a narrow column isn't flagged. |
| `line_height` | Of running text up to 22px: the real distance between lines (from where the words sit, not the CSS value, so `normal` is measured too), divided by the size. | Same blocks as above; 0.02 of slack at each end. |
| `font_sizes` | How many different text sizes (to the half pixel). | Icon fonts don't count. |
| `font_families` | How many families set text (the first one named). | Icon fonts don't count. Code (`pre`, `code`, `kbd`, `samp`) doesn't count. A mono that sets only figures (no words) doesn't count. |
| `contrast` | WCAG ratio of the text colour (with its own opacity and its parents') against what is really behind it. On the first screen Chrome says what lies under the text; below it, the text's own parents. Large text (24px and up) needs 3:1, or the skill's number if lower. | Skipped: text over a picture, video, canvas, SVG or gradient that isn't its own; text with a shadow or outline; gradient-clipped or transparent text; disabled controls; avatar initials. Below the first screen, also skipped when any painted box that isn't its parent overlaps it. |
| `small_text` | Text under the size. | `sup`/`sub`, and avatar initials, are skipped. |
| `overflow` | The page scrolls sideways, or text runs past the edge of the screen and is cut off. | Ignored: what is inside something that scrolls, clips or animates sideways (carousels, marquees); what is wholly off screen (a menu waiting); a huge fixed backdrop; and, when the page itself clips sideways, shapes without text (a decorative blob past the edge is a choice). |
| `reduced_motion` | The page moves (animations in use, scripted animations, transitions that move or resize), and nothing in it answers `prefers-reduced-motion` (no CSS media rule, no script that mentions it, no `media` attribute). | Colour-only transitions don't count as motion. Stylesheets from other sites can't be read; a page whose motion comes only from one could be flagged even if that sheet handles it. |
| `tap_targets` | On a phone only: links, buttons, inputs, selects, `summary`, `[role=button]` smaller than the size **both** ways. | A link inside a sentence is skipped (sized by the text). Something inside a bigger link, button or label is skipped. Disabled ones are skipped. |

What they said:

| Sketch | Findings with Typography on |
|---|---|
| Run 1, article (sage) | none |
| Run 2, article (white) | none |
| NavTech: Hero, one word, seven windows | none |
| HUJJAT: Hero in sage | none |
| HUJJAT: Platform, cut-corner sheets | none |
| CRM: pipeline (RKTIC greys) | `font_sizes`: 8 sizes (66, 18, 15, 14, 13.5, 13, 12, 10) |
| NavTech: Deck, cool greys | `line_height`: the lead paragraph at 1.32 (21.6px); `contrast`: the page counter "1 / 6" at 4.04:1 |
| CRM: Evening ledger | `font_sizes`: 11 sizes; `font_families`: Newsreader, Geist and Geist Mono |

Which I think are wrong, or borderline:

- **Fixed (were wrong).** On the CRM pipeline, the first version flagged avatar initials ("MK", "JS", "AA" in 10px circles) as text under 12px (12 times) and under 4.5:1 (twice). Initials in an avatar are read as a picture, not as text. Two or three capitals or figures in a small filled or round box are now skipped for size and contrast. On the ledger, the first version counted Geist Mono as a third family because it set a figure ("12"), which the skill itself allows. A mono now counts only when it sets words.
- **Borderline.** The ledger's Geist Mono still counts, because it also sets "12 open · $985,050", a figure label with a word. Fair as a "check", not as an error. The NavTech lead at 1.32 is measured right, but a 21.6px lead sits between body and heading in the skill's own Decide, so it is arguable.
- **Right.** The type-size counts on both CRM pages, and the "1 / 6" contrast.

Limits I know of:
- Text that a page hides until you scroll to it (fade-in on scroll) is invisible when Panel measures, so it isn't checked at all. That means fewer findings, never false ones.
- Contrast below the first screen is more cautious (it skips more), since Chrome can only say what lies under a point on the screen that is showing.

## 5. Cost

With Typography on, Always:

| Reader | `<designer-skills>` block | Plus the `skill_checks` line in SYSTEM | Added in all |
|---|---|---|---|
| One model | 2,643 chars (about 660 tokens) | 407 chars | 3,052 chars (about 760 tokens) |
| Planner (Decide) | 1,483 chars (about 370 tokens) | 407 chars | 1,892 chars |
| Builder (Build) | 1,553 chars (about 390 tokens) | 407 chars | 1,962 chars |

The Skills page says "about 558 tokens": Decide and Build alone (2,231 characters ÷ 4). The block adds its two opening sentences, the skill's line and the wrapping. The full texts are in `.copy/skills-prompt-solo.txt`, `-planner.txt` and `-builder.txt`.

`TOOLS` line: **before 27 tools · 30,832 chars**, **after 28 tools · 31,223 chars** (under 31,500). The `get_skill` definition is the 391 characters.

## 6. Checks

- `bun run typecheck`: clean.
- `bun test tests`: **109 pass, 0 fail** (15 files). `tests/skills.test.ts` has 21 tests:
  - reading: the three parts, the checks with numbers and `(breaks)`, unknown names, no headings, headings in code;
  - the block for each reader: off and not-Always skills left out, the list at the end, a whole file, the budget dropping the largest, empty with nothing on;
  - the routes: listing, turning on, changing when, refused from another origin, 404 for a missing skill;
  - FRIDAY's real instructions, written by `chat.ts` in a separate process on the companion's library: identical with nothing on, each reader's part with Typography on, and exactly the old text once the skill is taken out;
  - `get_skill` with and without a name, and get_design_rules with skills;
  - each of the 9 checks on a page made to trip it and one made well, through `make_sketch` in Chrome on the companion. That includes text over a picture, a decorative shape past a clipped edge, a mono for code and figures, and avatar initials;
  - motion "when it applies": not listed on a still page, listed with `reduced_motion` on a moving page, listed without it when handled, and not listed for a colour-only hover;
  - tap targets: only on a phone, not for a link in a sentence;
  - `get_sketch` measuring a sketch made before the skill was on, and dropping the checks once it is off again.
- `PANEL_PORT=4799 PANEL_LIBRARY_DIR=.copy/lib bun scripts/measure-search.ts`, before and after: every `ORDER` line and every search line is identical. Only `TOOLS` changed (above). Files: `.copy/skills-measure-before.txt` and `.copy/skills-measure-after.txt`.
  - How "before" was run: the current folder with my three server files put back to HEAD, plus the other session's one-line change to the `place_on_board` description, on the same library path. A first attempt through a scratch path showed different "open one save" sizes. That was only because each original file's full path on this Mac is in the answer, and the scratch path was longer.

## 7. The database

- New table: **`skill_use`** (`ref_id` → refs, deleted with the save; `turned_on`; `used_when`; `applies_to`; `updated_at`). It is only added; nothing is renamed, dropped or rewritten. A skill with no row is off.
- **It does not exist in the real library now** (checked read-only: `sqlite_master` has no `skill_use`). Every `panel` MCP process running now started before `skilluse.ts` existed.
- **It will appear** the next time any Claude Code session starts Panel's MCP on this code (`server/mcp.ts` → `mcp-tools.ts` → `skilluse.ts`), or when the real app restarts. The old code beside it never reads it, so nothing breaks.
- In the copy (`.copy/lib`) it exists, and Typography is still on, Always.

## 8. Doubts, and what I'd do next

- **Do the checks ever bite?** Both live pages passed everything, so this run didn't show FRIDAY fixing a finding. A typography skill with tighter numbers (a measure of 55–75, say) or a busier brief would show it. That belongs in the larger with-and-without test.
- **Nothing in `skill_checks` when everything passes.** If FRIDAY should know the page passed (to say so, or to stop looking), an empty list, or "passed: [names]", would tell it. I left it like `rule_checks`.
- **The Typography skill partly repeats `unugly.md`** (Cyrillic, the letter-spaced navbar). Harmless, but it costs tokens. That is what the "adapt a downloaded skill" step will be for.
- **Measuring older sketches again costs 2–15 seconds** the first time each is read after a change in skills. The result is kept in memory, not on disk, so it is lost on restart.
- **The refused `make_sketch` in run 2** ("No such tool available", `uses` sent as a string). Probably a slip in Claude Code, not Panel, but worth keeping an eye on.
- **A test file opens the real library.** `tests/findin.test.ts` loads `db.ts` with no library folder set, so every `bun test` opens `~/DesignLibrary` and runs `db.ts`'s start-up steps on it. That was true before this work. It is safe today only because those steps only add things. Worth fixing on its own: set `PANEL_LIBRARY_DIR` to a temp folder for in-process tests.
- **Next:** the planned steps (adapting downloaded skills, more checks from the designer's real skills, the larger with-and-without test). Before those, I would show `skill_checks` in the studio beside the rule findings. Today only FRIDAY and the MCP see them. The studio panel was out of scope here, and its data comes through `board.ts`, which this plan said to leave alone.

## 9. Note for the designer

- To add a skill, drop its `.md` file on the Skills page, the way you add any skill.
- Open it. Above the file there is **Use in FRIDAY**. Turn it on, then choose when FRIDAY uses it:
  - **Always**: it's in FRIDAY's instructions on every message.
  - **When it applies**: FRIDAY reads it only for pages that move, phone screens or forms; you pick which.
  - **When asked**: FRIDAY reads it when you ask, or when it decides it needs it.
- FRIDAY follows the skill's **Decide** part when it plans and its **Build** part when it makes. After every sketch, Panel measures the page against the skill's **Check** list (line length, contrast, text sizes and so on). FRIDAY must fix what "must be fixed", and fix or explain the rest. Your rules (unugly.md) always come first, then a project's locked decisions, then skills, then references.
- Nothing reaches FRIDAY until you turn a skill on. With no skills on, FRIDAY works exactly as it did.
- The real Panel keeps the old behaviour until it is restarted. Nothing was committed.
