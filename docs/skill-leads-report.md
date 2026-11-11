# Report: skills read by themselves, and one skill leads each subject (skills, part 4)

Carried out from [skill-leads-plan.md](skill-leads-plan.md) on 11 Nov 2026. Everything was tried on the copy (`.copy/lib`, my own server `panel-copy-search` on port 4757). The real library and the real app on 4646 were not touched. Nothing is committed.

## 1. What changed

### Server

- **`server/skillread.ts`** (the read itself):
  - `LEAD_SUBJECTS`: the ten subjects a skill can lead (typography, color, layout, surfaces, icons, motion, gestures, mobile, writing, accessibility).
  - `READ_VERSION = 2`. A read made with older instructions counts as not read yet.
  - `READ_RULES` changes:
    - **Checks:** only checks the skill itself states, with its own numbers. A check that takes a number and has none in the skill is left out. For `line_length`, give the minimum too when the skill gives one.
    - **`about`:** only when motion, a phone or forms is what the skill is mainly about. The example given: "a skill about type that has one line on animating headings is not about motion".
    - **New rule 4b:** a recipe for something a rule warns about is left out of Decide and Build and listed as a disagreement. The rules name three examples: an eyebrow, a wordmark with wide letter-spacing, and negative kerning. The designer can put it back.
  - `cleanRead`: drops a check that takes a number but comes back with neither `min` nor `max`.
  - Edits keep their subjects:
    - `editLines` reads the designer's text back into lines. A line starts with "- " or with a subject ("motion: …"). A line without a subject takes the skill's main subject. Any other line continues the one before it, so part 3's plain edits read as before.
    - `editText` shows the lines with their subjects in front. `readLines`, `readParts` and `readEditParts` build on these two.
  - `withRead` now also keeps the lines with their subjects, and the read's subjects, on the skill.
- **`server/skillleads.ts`** (new, pure): `pickLeads` and `applyLeads`.
  - A subject gets a lead only when two or more skills that are on have lines on it.
  - **Panel's pick**, in order: the skills whose main subject it is; then the one with more lines on it; then the one turned on first.
  - **The designer's pick** wins while that skill is on. When it is off, Panel's pick stands in, and the designer's pick is kept for when it is back.
  - `applyLeads` takes the other skills' lines on a led subject out, records what was cut (`cut`), and marks a skill left with nothing (`emptied`).
- **`server/skills.ts`** (the text FRIDAY gets):
  - `Cut`, `andList`, `followLines`. They live here, not in `skillleads.ts`, so that `skills.ts` never imports a file that imports it back.
  - `fitBudget` leaves out emptied skills.
  - `skillsBlock`:
    - skips emptied skills;
    - ends a cut skill's block with "On motion, follow emil-design-eng (read it with get_skill when the page moves)." The planner only sees subjects cut from Decide, the builder only those cut from Build. The hint after the name says how to reach the lead, and is left out when the lead is already in the instructions;
    - "read in full with get_skill" became "read with get_skill when they're needed";
    - one sentence was added to the block's opening: "Where two skills speak to one subject, one leads it: follow that one on it."
  - `skillsForOutside` (`get_design_rules`, `HANDOFF.md`): the same cuts and "follow" lines. The hint is "(read it with get_skill)" when the lead isn't among the skills given.
  - `readSkillFor` (`get_skill`):
    - For a read skill, or one with its own headings, it answers with the short version: its line, Decide, Build, the follow lines, what Panel checks, then its files with sizes (SKILL.md first, as written).
    - `file: "SKILL.md"` gives the whole file.
    - A skill with neither a read nor headings answers as before, with the whole file.
  - `describeSkill`: adds `subjects`, `cut` and `emptied`, and a new `given: "led"` with its own sentence ("Other skills lead everything it says…, so FRIDAY isn't given it. Its checks still run.").
- **`server/skilluse.ts`** (what the designer set):
  - New table `skill_leads` (one row per subject).
  - New column `skill_use.turned_on_at`, set when a skill goes from off to on. It is used for the last tie-break.
  - `leadsNow`, `withLeads` and `setLead`. FRIDAY's block, the outside text and `get_skill` all go through the skills with leads applied.
  - The Skills page now carries `leads`, `auto` and `not_read`.
  - `readView` now carries:
    - each line with its subject and `led_by`;
    - `carries` and `panel` in the edit form, with a subject in front of every line;
    - `tokens`: what really reaches FRIDAY.
- **`server/skillreads.ts`** (running reads):
  - New columns `skill_reads.version` and `skill_reads.tries`.
  - `autoReads()` follows `ai_auto`.
  - `readIfAuto(ids?)` puts in line the skills that want a read: never read; read with older instructions; or changed since they were read. Each only when the designer hasn't edited the read, and never one that failed twice.
  - `notReadYet()`: skills with no read, or with an older one the designer hasn't edited.
  - A failure goes back to the end of the line once (`tries`), then stays failed with its reason.
  - At start, with the setting on, the read under way goes back in line first, what waited carries on, and everything that wants a read is added. With the setting off, start behaves as in part 3.
  - Each answer is saved with its version.
  - **Up to three skills are read at the same time** (`READS_AT_ONCE = 3`), the rest waiting in line. `GET /api/skills/reads` now answers `reading` as a list. You asked for this during the live check, after the first 13 reads had run one at a time. Same tokens in all, spent sooner, so a usage limit is reached sooner too; a read that fails on it is tried once more, then waits for **Try again**.
- **`server/index.ts`**:
  - Adding from a pack or folder answers with `reading`: the ids put in line.
  - Turning "read automatically" on calls `readIfAuto()`.
  - New `POST /api/skills/reads/unread` ("Read them") and `PUT /api/skills/leads`. Both sit under `/api/skills`, behind `fromPanel`.
- **`server/capture.ts`**: `saveSkillText` (one `.md` file, or a link to one) ends with `readIfAuto([id])`.
- **`server/mcp-tools.ts`**: FRIDAY's tool notes and `get_skill`'s description now say "reads one", and give the short version first with `file: "SKILL.md"` for the whole file.

### Web

- **`web/src/api.ts`**: types for subjects, cuts, leads, `auto`, `not_read`, read lines and `older`; also `skillApi.setLead` and `skillReadApi.readUnread`.
- **`web/src/Packs.tsx`**:
  - The chooser says **Add and read all** and **Add and read the ticked ones** when the setting is on. The note under it says so too, and the toast says how many will be read.
  - **Read these** no longer asks first or names tokens. It keeps the progress line and **Stop reading**.
  - The Skills page has a quiet **By subject** / **By pack** switch, remembered in the browser. By subject is the default once something is read.
    - Beside the switch, one line shows either the reading progress, or (setting off) "N skills not read yet · Read them".
    - By subject: one section per subject in the plan's order, then Other, For real builds, Not for Panel yet, and Not read yet.
    - A subject's heading names its lead ("led by emil-design-eng · Panel's pick") when two or more skills that are on speak to it. Clicking the name opens a short menu of the skills that speak to it, each with its line count, plus "Let Panel pick (…)".
  - Card order follows the view (`orderSkills`), so stepping through skills in the detail view follows the page.
- **`web/src/SkillRead.tsx`**: "Panel's read" shows Decide and Build line by line, each with its subject in small type.
  - A line FRIDAY doesn't get is muted, with "· emil-design-eng leads motion".
  - The token count is what really reaches FRIDAY ("…, without 3 lines another skill leads").
  - **Edit** opens the two text boxes with a subject in front of every line.
  - New notes for "read with Panel's older instructions" and for a changed skill the designer has edited. Both are hidden while it waits to be read.
  - Every token cost line is gone.
- **`web/src/Grid.tsx`**: a skill's card shows its subjects in small print, the main one first.
- **`web/src/App.tsx`**: orders cards with `orderSkills`.
- **`web/src/styles.css`**: a few quiet classes for the lines, the view row, the lead and the card's subjects.

### Tests

- `tests/helpers.ts`: a companion can now `restart()` on the same library and port.
- `tests/skillleads.test.ts` (new, 20 tests); `tests/skillreads.test.ts`, `tests/skills.test.ts` and `tests/skillpacks.test.ts` adjusted where `get_skill` now gives the short version and edits show their subjects.

### Done differently from the plan, and why

- **Skills only for real builds (or neither) take no part in leads.** They never reach a sketch, so letting one lead (for example `write-swift` on mobile) would cut lines from a sketch skill for a skill FRIDAY never carries. They are never cut either.
- **A skill with its own headings** (part 1's Typography) is read too when the setting is on, as every added skill is, but its read is still not used (part 3's order). On the Skills page it is placed by its read's main subject; it has no subjects for leads.
- **"Not read yet"** counts skills with no read, a failed one, or a read with older instructions that the designer hasn't edited. A changed skill isn't counted: it shows "changed since it was read" as before.
- **The restart rule is only for the setting on**, as the plan puts it. With it off, a restart still drops the line, as in part 3.
- **Three reads at once instead of one after another** (part 3's rule), at your request mid-check. The page's line names the ones being read ("Reading A, B and C, 19 more in line").
- **`get_skill`'s short version gives the follow line's hint** ("read it with get_skill when the page moves"), the same as the instructions.

## 2. Every skill in one table

All 35 skills in the copy, read with the new instructions (version 2) by Opus 5.5 at extra-high effort, the copy's settings for reading. "Decide / Build" counts lines. Checks are only those the read kept; "must" means the read marked it as one that has to be fixed. Tokens are each read's input, output and cache together, as `ai_usage` logged them. The 35 reads came to **799,940 tokens**. One read cut short by my copy restart isn't counted because it logged none, and neither is the throwaway read in section 4 (about 9,700).

| Skill | Pack | Main subject · others | For | When | Decide / Build | Checks | Tokens |
|---|---|---|---|---|---|---|---|
| Typography | single file | **typography** · layout, writing | both | always | 6 / 10 | line_length ≥45 ≤85 (must), font_sizes ≤7 (must), font_families ≤2 (must), line_height ≥1.35 ≤1.7 (must), contrast ≥4.5 (must), small_text ≥12 (must), overflow (must) | 11,365 |
| animate | emilkowalski/skills | **motion** · accessibility, gestures | both | applies (motion) | 7 / 10 | reduced_motion (must) | 29,610 |
| animate-expo | emilkowalski/skills | **motion** · gestures, mobile, accessibility | both | applies (motion, phone) | 7 / 9 | reduced_motion (must), tap_targets ≥44 (must) | 27,875 |
| animation-performance | emilkowalski/skills | **motion** · review | both | applies (motion) | 5 / 7 | — | 15,255 |
| animation-vocabulary | emilkowalski/skills | **motion** · gestures | neither | asked (motion) | 6 / 12 | reduced_motion | 16,901 |
| apple-design | emilkowalski/skills | **motion** · gestures, surfaces, typography, accessibility | both | applies (motion) | 8 / 12 | reduced_motion (must) | 31,919 |
| ask-sonner | emilkowalski/skills | **other** | builds | asked | 0 / 0 | — | 10,322 |
| break-ui | emilkowalski/skills | **review** · layout, typography, writing, accessibility, icons | both | asked | 6 / 10 | overflow (must) | 22,776 |
| choreograph | emilkowalski/skills | **motion** · accessibility | both | applies (motion) | 8 / 9 | reduced_motion (must) | 30,868 |
| emil-design-eng | emilkowalski/skills | **motion** · gestures, accessibility, review | both | applies (motion) | 5 / 10 | reduced_motion (must) | 24,963 |
| find-animation-opportunities | emilkowalski/skills | **motion** · gestures, review | both | applies (motion) | 6 / 11 | reduced_motion (must) | 14,794 |
| gestures | emilkowalski/skills | **gestures** · motion, mobile, accessibility | both | applies (motion, phone) | 8 / 12 | tap_targets ≥44 (must), reduced_motion (must) | 14,224 |
| improve-animations | emilkowalski/skills | **motion** · accessibility, gestures, review, process | both | applies (motion) | 7 / 9 | reduced_motion (must) | 19,977 |
| mobile-native | emilkowalski/skills | **mobile** · gestures, accessibility, layout | both | applies (phone) | 7 / 9 | — | 18,422 |
| pick-ui-library | emilkowalski/skills | **other** · process | builds | asked | 0 / 0 | — | 7,642 |
| prototype | emilkowalski/skills | **process** · motion, layout, accessibility | both | asked | 8 / 8 | reduced_motion (must) | 23,834 |
| remove-animations | emilkowalski/skills | **motion** · review | both | asked (motion) | 6 / 12 | — | 15,541 |
| review-animations | emilkowalski/skills | **motion** · review, accessibility, gestures | both | applies (motion) | 6 / 12 | reduced_motion (must) | 21,483 |
| write-swift | emilkowalski/skills | **other** | builds | asked | 0 / 0 | — | 19,919 |
| afk | jakub | **process** · review | neither | asked | 0 / 0 | — | 9,416 |
| better-accessibility | jakub | **accessibility** · motion, gestures, review | both | always (forms, motion) | 8 / 12 | contrast ≥4.5 (must), reduced_motion (must), overflow (must), tap_targets ≥24 (must) | 30,352 |
| better-colors | jakub | **color** · accessibility, review | both | always | 7 / 11 | contrast ≥4.5 (must) | 45,900 |
| better-interface | jakub | **review** · process, accessibility | neither | asked | 0 / 0 | reduced_motion (must) | 10,974 |
| better-layout | jakub | **layout** · mobile, review | both | always | 8 / 10 | overflow (must) | 35,704 |
| better-typography | jakub | **typography** · writing, accessibility, layout, mobile | both | always | 7 / 11 | line_length ≥60 ≤75 (must), font_families ≤3, line_height ≥1.4 (must), small_text ≥12 | 42,431 |
| better-ui | jakub | **motion** · surfaces, icons, accessibility, gestures | both | always (motion) | 7 / 11 | reduced_motion (must) | 35,641 |
| better-writing | jakub | **writing** · accessibility | both | always | 6 / 8 | — | 16,692 |
| break | jakub | **review** · process, layout, typography | builds | asked | 0 / 0 | — | 10,404 |
| build-design | jakub | **process** · review, layout | both | asked | 6 / 9 | — | 16,103 |
| explain-interface | jakub | **process** · review | neither | asked | 0 / 0 | — | 17,516 |
| interface-review | jakub | **review** · process | neither | asked | 0 / 0 | — | 13,314 |
| state-machine | jakub | **process** · layout, accessibility | both | asked | 6 / 11 | — | 25,558 |
| teardown | jakub | **other** · layout, color, typography | both | applies | 6 / 11 | — | 40,932 |
| variant | jakub | **process** · layout, accessibility, surfaces | both | asked | 6 / 10 | reduced_motion (must), overflow (must) | 31,198 |
| make-interfaces-feel-better | folder | **surfaces** · motion, typography, icons, accessibility, review | both | always (motion) | 8 / 12 | reduced_motion (must), tap_targets ≥44 | 40,115 |

**Pack names:** "emilkowalski/skills" and "jakub" (jakubkrehel/skills) are GitHub packs. "folder" is make-interfaces-feel-better, from a dropped folder. "single file" is part 1's Typography, which has its own headings, so its read isn't used.

**Every disagreement with the rules, in full** (15 in 12 skills). Each line is left out of what FRIDAY carries:

- **Typography** (rule: No overused layouts): the skill says Only small capitals or all-caps labels get a little more letter-spacing (letter-spacing: 0.04em). — the rule says Eyebrows (the small label above a heading): be really careful with them. Either make them beautiful or leave them out. Never overuse them.
- **apple-design** (rule: Design slop indicators): the skill says Large display text wants negative tracking; tighten headings, e.g. `.display { letter-spacing: -0.02em; }` (Quick Reference: tighten large text -0.02em). — the rule says Negative kerning is a design slop indicator and needs a real reason to be there.
- **prototype** (rule: Corners): the skill says The picker's pill, highlight and items use a plain border-radius: 999px, copied verbatim with no other modifications allowed. — the rule says Every corner radius, on anything, uses Apple-style corner smoothing, never a plain circular radius: corner-shape: squircle / superellipse() or an SVG squircle path, with plain border-radius only as the fallback. Capsule buttons too.
- **better-colors** (rule: Design slop indicators): the skill says When a second accent hue isn't needed to tell two things apart at a glance, use more steps of the one accent ramp instead. — the rule says 'Many shades and opacities of a color' is a sign of generic design; each needs a real reason to be there.
- **better-typography** (rule: Design slop indicators): the skill says Headings at 24px and up take -0.01em to -0.02em letter-spacing. — the rule says Negative kerning is a design slop indicator and needs a real reason to be there.
- **better-typography** (rule: No overused layouts): the skill says Uppercase labels at 14px or smaller take 0.05em letter-spacing; a heading may be smaller than body text when it is a deliberate overline. — the rule says Be really careful with eyebrows (the small label above a heading): either make them beautiful or leave them out, and never overuse them.
- **better-ui** (rule: Corners): the skill says The concentric-radius recipes draw nested corners with plain border-radius (e.g. border-radius: 20px outer, 12px inner). — the rule says Every corner uses Apple-style corner smoothing, never a plain circular radius: corner-shape: squircle / superellipse() or an SVG squircle path, with plain border-radius only as the fallback.
- **better-ui** (rule: Design slop indicators): the skill says Keep borders on dividers and separators, as structure, rather than turning them into shadows. — the rule says Dividers are a design slop indicator and each needs a real reason to be there; dotted or dashed ones can be good.
- **build-design** (rule: Corners): the skill says The design decides: where a design breaks a rule, build it as designed and report the conflict. Any change the design doesn't show is a deviation for the user to decide. — the rule says Every corner radius, on anything, uses Apple-style corner smoothing (corner-shape: squircle / superellipse(), or an SVG squircle path), with plain border-radius only as the fallback. Never a plain circular radius.
- **build-design** (rule: Buttons): the skill says Build exactly what the design shows, even where it breaks a rule. A change the design doesn't show is a deviation. — the rule says Buttons come in three shapes, nothing else (sharp, capsule, in between), all with Apple corner smoothing.
- **state-machine** (rule: Design slop indicators): the skill says Switcher text and lines use a ladder of white opacities on the dark surface: headings rgb(255 255 255 / 0.45), labels and chevron 0.6, hover 0.85, active background 0.14 (white text), inset 1px border 0.1, focus outline 0.7. — the rule says Many shades and opacities of a color are a sign of generic design; each needs a real reason to be there.
- **state-machine** (rule: Corners): the skill says Switcher corners use plain border-radius (14px list, 8px buttons, 999px select), and the spec should be built as given and left alone. — the rule says Every corner radius uses Apple-style corner smoothing (corner-shape: squircle / superellipse() or an SVG squircle path), with plain border-radius only as the fallback.
- **variant** (rule: Corners): the skill says The picker spec sets a plain circular border-radius (14px list, 8px buttons, 999px select) and says to build the spec and leave it alone. — the rule says Every corner radius, on anything, uses Apple-style corner smoothing; on the web corner-shape: squircle / superellipse() or an SVG squircle path, with plain border-radius only as the fallback.
- **variant** (rule: Design slop indicators): the skill says Picker text and states use a ladder of white opacities: headings rgb(255 255 255 / 0.45), buttons rgb(255 255 255 / 0.6), hover rgb(255 255 255 / 0.85), active rgb(255 255 255) on an rgb(255 255 255 / 0.14) fill, focus outline rgb(255 255 255 / 0.7), select chevron rgb(255 255 255 / 0.6). — the rule says Many shades and opacities of a color is a slop indicator and needs a real reason to be there.
- **make-interfaces-feel-better** (rule: Design slop indicators): the skill says Keep dividers as borders: dividers between list items (border-b, border-t, side borders), table cell boundaries, layout separators and hairline separators in dense UI stay borders, not shadows. — the rule says Dividers are a sign of generic design and each needs a real reason to be there; dotted or dashed ones can be good.

Two of these are new kinds, from rule 4b:
- `better-typography`'s "uppercase labels at 14px or smaller take 0.05em" is now caught as an eyebrow recipe. This was one of the plan's four faults.
- `Typography`'s own "all-caps labels get a little more letter-spacing" is caught the same way.

Negative tracking on headings is caught in two skills. Some of these are stretched:
- **better-colors:** "use more steps of one accent ramp" versus "many shades" is not really the same thing.
- **build-design:** "build what the design shows" is about process, not corners.

They are listed honestly as disagreements, and leaving them out costs little.

## 3. The six reads checked

Every value below was found word for word in the skill's files. **All 30 matched to the digit.**

| Skill | Values checked (where) |
|---|---|
| better-colors | `0.005`–`0.02` neutral chroma (palette-structure.md:47) · `15°` status hue distance (palette-structure.md:59) · `#3b82f6: 3.68:1` (palette-generation.md:13) · `#11ad32` then `oklch(0.65 0.27 145)` (color-formats.md:56, 61) · `18.67px` bold large text (contrast.md:14) |
| better-layout | `8px` inside means `16px` between (SKILL.md:16) · `16px` default step (SKILL.md:24) · `12px` / `24px` between controls (SKILL.md:46) · peek `16–32px` (SKILL.md:40) · `calc(16px + env(safe-area-inset-bottom))` (spacing-and-adaptivity.md:40) |
| better-writing | "Move to storage" (SKILL.md:26) · "Project archived. Undo" (SKILL.md:89) · "Enter a date as DD/MM/YYYY" (SKILL.md:82) · "Type 'acme-web' to confirm" (patterns.md:13) · "9 of 12 files uploaded. Retry 3 failed files" (patterns.md:25) |
| gestures | `cubic-bezier(0.32, 0.72, 0, 1)` over `500ms` (SKILL.md:72) · `0.2s cubic-bezier(0.165, 0.84, 0.44, 1)` (SKILL.md:76–77) · `~40–50%` of travel (SKILL.md:36) · `velocity > 500` (SKILL.md:63) · `≈ 0.2` rubber band and `44×44px` targets (SKILL.md:31, 96) |
| choreograph | `30–80ms`, under `~300ms` (SKILL.md:74) · `100–150ms` steps on `0.5–0.6s` (SKILL.md:75) · `12px / 8px / 6px` at `0 / 80 / 140ms` (SKILL.md:155–157) · `0.6s cubic-bezier(0.645, 0.045, 0.355, 1)` (RECIPES.md:198) · `clamp(0.15s, Δheight / 500, 0.27s)` and `[0.26, 0.08, 0.25, 1]` (SKILL.md:102, RECIPES.md:148) |
| mobile-native | `interactive-widget=resizes-content` (SKILL.md:251) · `scale(0.97)`, `100–160ms` (SKILL.md:139, 144) · `100ms var(--ease-out)` (SKILL.md:136) · `calc(1rem + env(safe-area-inset-bottom))` (SKILL.md:183) · dark theme-color `#0a0a0a` (SKILL.md:229) |

**What the reads added that the skill doesn't quite say:**
- **better-colors:** its "Filled primary actions per view: exactly one" is firmer than the skill's "one primary action per view".
- **better-layout:**
  - It has an `overflow` check marked must. The skill says `100vw` "scrolls horizontally" and treats clipping at 320px as HIGH, so that is fair, but it's an inference.
  - Its "Clipping or overlap: none at 320px width or 200% zoom" turns a severity note into a measurable rule.
- **gestures:** it labels "velocity > 500" and "pan-x for a vertical drag" as "the skill's example". That's honest; the skill only gives them in code.
- **mobile-native:** it puts the light theme-color `#ffffff` beside the dark one; the skill's example has both.
- **choreograph** and **better-writing**: nothing added that I could find.

**Disagreements I think the reads missed:**
- **better-layout:**
  - "A needed separator is a low-contrast hairline" against "Dividers are a design slop indicator". The skill limits them to dense data, which is a real reason, so arguably not a miss.
  - "Controls get a background shape, border…" touches "containers with borders" too.
- **mobile-native:** `user-select: none` and press `scale(0.97)` don't touch any rule. Its corners aren't discussed.
- **choreograph:** blur in exits ("light blur") is fine by the rules.
- **gestures:** none.
- **better-writing:** none. Its "sentence case" rule doesn't touch the designer's rules.
- **better-colors:** "Several colored backgrounds are fine for distinct states or categories" sits near "many shades of a color". The read caught the closer one.

Plan point 4 asked the reads to drop checks the skill doesn't state. better-typography now has `line_length 60–75` (it says 60–75 characters), `font_families ≤3`, `line_height ≥1.4` and `small_text ≥12`, and no `overflow`. Part 3 had an `overflow` it didn't state and a `font_sizes` with no number. Both are gone.

## 4. Reads that start by themselves

I used a throwaway library: a fresh temp folder with "read automatically" on, the real `claude`, and a spare port. Script: `bun …/throwaway.ts`; output in `.copy/leads-throwaway.txt`.

- I added `better-interface` (2 kept files, 11 KB) from `~/Desktop/jakub-library/source/skills/skills/` by sending exactly what a folder drop sends (look, then add). Automation can't drop a real folder from Finder.
- **0.2 s after adding:** the answer to "add" already listed it under `reading`, and the Skills page showed "read: reading, on: false". Nobody pressed anything.
- **10.3 s:** the read was done, with version 2 and no failed tries. The skill was still off.
- It used Sonnet 5.5 at high effort, the defaults of a fresh library, and 1,076 tokens out (8,619 cache written).
- The companion was stopped and its library deleted.

**Also seen on the copy:**
- With the setting off, the Skills page said "35 skills not read yet · Read them". That was 30 never read plus part 3's five, which count as not read because they were made with older instructions. **Read them** put all 35 in line.
- After you asked, three at once: the line read "Reading find-animation-opportunities and choreograph, 19 more in line", and the 22 left took 10 minutes.
- `better-colors` was once found marked "Panel was restarted before this read finished" while my server was still reading it. Another Panel was started on the same `.copy/lib`: another session is rerunning FRIDAY on the copy, and the measuring script also starts one. With the setting off, any Panel that starts resets the line it finds. A **Read this skill** put it back, and it finished.

## 5. Leads

**Panel's pick for each subject**, once the six were on as their reads suggest. Speakers are in brackets, with their lines on the subject:

| Subject | Panel's pick | Speakers | Would I pick the same? |
|---|---|---|---|
| layout | better-layout | better-typography (2), better-layout (15) | Yes. |
| motion | emil-design-eng | better-ui (5), emil-design-eng (14), animate (14) | Yes. But emil and animate tie at 14 lines, both with motion as their main subject, so the last tie-break decided it: emil was turned on first. |
| gestures | animate | better-ui (1), animate (2) | Fine. emil-design-eng's read has no gesture lines, so **it can't lead gestures** as the plan asked. |
| mobile | better-typography | better-typography (2), better-layout (2) | **No: better-layout.** A tie, decided by which was turned on first. This cut better-layout's `100dvh` and safe-area lines, and both skills-on sketches then used `100vh`. |
| writing | better-typography | better-typography (1), better-layout (1) | Either. Also a tie, decided by order. |
| accessibility | better-colors | better-ui (1), better-typography (1), better-colors (3), emil-design-eng (1), animate (1) | **No.** It leads because it has the most contrast lines. That cuts better-ui's and emil's reduced-motion lines, which have nothing to do with color. |

Typography, color and surfaces have no lead: only one skill that is on speaks to each now. better-ui's new read made motion its main subject, not surfaces. So nothing needed setting by hand:
- layout and motion were already Panel's picks;
- typography, color and surfaces had nothing to lead;
- gestures can't go to emil.

The copy has **no designer's picks stored**. Picking by hand, Panel's pick taking over while the pick is off, and giving it back are tested on a companion in `tests/skillleads.test.ts`.

**What was cut** (from `.copy/leads-page-after.json`):
- better-ui lost 5 motion lines, 1 accessibility line and 1 gestures line (about 797 → 511 tokens).
- better-typography lost 2 layout lines and 1 accessibility line.
- better-layout lost 1 writing line and 2 mobile lines.
- emil-design-eng lost 1 accessibility line.
- animate lost all 14 motion lines and its accessibility line.

**FRIDAY's skills block** (saved as `.copy/leads-skills-block-{solo,planner,builder}.txt`):

| Reader | Block | Whole instructions | Against the 16,000 budget |
|---|---|---|---|
| One model | 12,750 chars | 26,215 | under. The budget counts only the Always parts: 4 skills, about 2,757 tokens. |
| Planner | 6,354 chars | 19,819 | under |
| Builder | 7,843 chars | 21,308 | under |

The follow lines read, for example: "On motion, follow emil-design-eng (read it with get_skill when the page moves). On accessibility, follow better-colors. On gestures, follow animate (read it with get_skill when the page moves)." The planner gets only those cut from Decide.

**`get_skill` now** (saved as `.copy/leads-get-skill-*.txt`):
- **emil-design-eng:** 3,765 characters for the short version against 27,577 for the file as written. That is 14%, and it is what FRIDAY read in all three runs.
- **animate:** 1,046 characters against 12,075 (9%). With emil leading motion, almost nothing of animate is left: its gesture lines, "On motion, follow emil-design-eng", and its check. FRIDAY still read it in both skills-on runs, which is cheap but wasted.

**Screenshots** of the copy:
- `.copy/leads-page-by-subject.jpg`: the Skills page by subject.
- `.copy/leads-change-lead.jpg`: the menu for changing motion's lead, with each skill's line count and Panel's pick ticked.
- `.copy/leads-detail-muted.jpg`: better-ui's detail view, its motion lines muted with "· emil-design-eng leads motion", and "about 511 tokens, without 7 lines another skill leads".

## 6. The three sketches

All three: One model, Opus 5.5, High; a new conversation on HUJJAT's canvas in the copy, typed into FRIDAY's panel. The first try of A failed at once with "Can't reach the API server (ENOTFOUND)", a moment without internet. Nothing was spent, and it is left in the copy's FRIDAY history. I sent it again and that run is the one below. Tool calls and answers are in `.copy/leads-{A-on,B-off,B-on}-run.txt` and `-answer.md`; pages in `.html` and `.jpg`.

| | A, skills on | B, skills off | B, skills on |
|---|---|---|---|
| Sketch | `8d1b89b65b824265` "Hero: the headline arrives like ink" | `017d21aff25f4c7d` "Pricing: three cut-corner sheets" | `b9849603090a4619` "Pricing: white cards on sage, a hairline drawing per plan" |
| Tools | get_project, get_verdicts, get_brand_assets, **get_skill "emil-design-eng"**, get_sketch ×2, **get_skill "animate"**, make_sketch, edit_sketch, get_sketch (tg) | get_project, get_verdicts, get_brand_assets, get_project_material ×2 (spec: "тариф", "27. Биллинг"), get_sketch, make_sketch, edit_sketch ×3, get_sketch ×3 (tg) | get_project, get_verdicts, get_brand_assets, get_sketch (B-off's), **get_skill "emil-design-eng"**, **get_skill "animate"**, get_reference (a line-art save), make_sketch, edit_sketch, get_sketch (tg) |
| `get_skill` asked for | the names only, so the short versions. Never `file: "SKILL.md"` or another file. | — | the names only, so the short versions |
| Time · output tokens | about 5 min · 13,642 | about 3 min · 18,389 | about 7 min · 18,074 |
| `skill_checks` | none | **contrast breaks** (better-colors): 8 pieces of text at 4.4:1. Measured afterwards with the six on; nothing was measured while skills were off. | none |
| `skills_checked` | all six | — at the time | all six |

**The values the pages took, and from which skill:**
- **A (hero):**
  - `--ease-out: cubic-bezier(0.23,1,0.32,1)`, from emil-design-eng's short version (animate gives the same curve, but its motion lines were cut).
  - Press `transform 160ms`, then `scale(.97)` on `:active` (emil).
  - Hover only in `@media (hover:hover) and (pointer:fine)`. Not from a skill FRIDAY saw: the only line saying it (better-ui's) was cut, and the skills-off pricing page does it too.
  - Entrance: a band rising 900ms, then the line and button at 1500ms and 1580ms with an 8px rise over 500ms. Emil's "translateY(8px)", and "marketing can be longer".
  - Reduced motion: everything becomes a 300ms fade.
  - Letter-spacing `0.03em`, from the project's own type decision, which outranks better-typography's "body 0". That is the order of authority working.
  - `height:100vh`: better-layout's "100dvh, not 100vh" never reached FRIDAY (mobile went to better-typography).
- **B, skills on:**
  - The same curve and press as A.
  - Plans rise 24px over 700ms with a stagger of 70ms each (inside emil's 30–80ms).
  - Prices roll over 260ms (emil's "under 300ms").
  - **One filled button**, Бизнес, with the other two sage (better-colors: "fill one primary action per view, peers neutral").
  - Text passes contrast.
  - `min-height:100vh` again.
- **B, skills off:** all three buttons filled (two dark green, one white), the body text at 4.4:1, no `:active` press. Its motion is FRIDAY's own: price roll 420ms, opacity 300ms.

**Where two skills still pulled different ways:**
- **Press:** 0.96 against 0.97 is settled. Only emil's 0.97 reaches FRIDAY now.
- **Prices:** better-typography says `font-variant-numeric: tabular-nums` on prices. Both B runs took it out, because ALS Unios draws slashed zeros with it. That is FRIDAY's call against a skill's line, said in its answer.
- **Body letter-spacing:** better-typography says 0, the project says +0.03em. The project won, as it should.

**My read of the pages, beside part 3's two:**
- **A (skills on)** is clean, confident type: «Подписано обеими сторонами.» set big, an ink-speckle reveal line by line, sage on sage. As an idea it is weaker than part 3's run 1 (the signed sheet turning green told HUJJAT's story). The empty top half and the footer-like band make it feel unfinished. Its motion is as well made as part 3's run 2, with the same curves and press.
- **Verdict on A:** the skills made it **different, not better** than part 3's best.
- **B (skills on) is better than B (skills off) on what can be measured and seen:**
  - one primary action instead of three;
  - contrast that passes instead of failing;
  - a press state;
  - white cards with smoothed corners;
  - a small drawing per plan that explains it.
- **B (skills off) has the stronger brand idea:** the hero's cut-corner sheets carried into pricing. It fails better-colors' contrast check.
- **Verdict on B:** the skills made B **better-made**, and slightly less distinctive.

## 7. With every skill off

After the live check I turned all six off; all 35 reads stay. Script: `offcheck.ts`; output in `.copy/leads-offcheck.txt`.
- I took one snapshot of the copy (a clone, with its database copied whole by SQLite). On it, I wrote FRIDAY's instructions for the three readers, and read the two skills-on sketches with `get_sketch`.
- I then deleted every skill from the snapshot (and with them all 35 reads) and did the same again.
- **The instructions are byte-for-byte identical:** 39,039 bytes for the three, 13,013 each.
- **So are both sketch answers** (655 + 673 bytes), with no `skill_checks`, `skills_checked` or `skills_that_apply`. The only thing changed before comparing is the companion's own port in each sketch's address.

On a companion, `tests/skillleads.test.ts` checks the same with a designer's lead and three reads stored: the three readers' instructions equal those written before any skill existed.

## 8. Checks

- `bun run typecheck`: clean.
- `bun test tests`: **174 pass, 0 fail** (20 files). This includes `tests/skillleads.test.ts` (20 tests), and tests other sessions added meanwhile.
- `PANEL_PORT=4799 PANEL_LIBRARY_DIR=.copy/lib bun scripts/measure-search.ts`: **every search line and every `ORDER` line is as before** (diffed against part 3's `.copy/reads-measure-after.txt`).
- **`TOOLS`:**
  - With my changes alone it was **28 tools, 31,533 characters** (part 3: 31,322). The +211 is `get_skill`'s new description and the `file` hint.
  - At the end it read 29 tools, 32,440 characters, because another session added `get_ready_made` to `server/mcp-tools.ts` meanwhile.
  - Outputs: `.copy/leads-measure.txt` and `.copy/leads-measure-final.txt`.

## 9. The database

Added, nothing changed in place:
- **`skill_leads`**: subject, the skill, and when it was picked.
- **`skill_reads.version`** and **`skill_reads.tries`**.
- **`skill_use.turned_on_at`**.

**They already exist in the real library**, checked with `sqlite3 -readonly`. I didn't add them. Claude Code's own Panel tools (`server/mcp.ts`, started on this folder's code by other sessions at 10:32 and 10:46) create them when they start. They are empty there: the real library has no skills yet. The real app on 4646 runs older code and doesn't read them.

## 10. Doubts, and what the next step should know

- **One lead per whole subject is too blunt for accessibility and mobile.**
  - Accessibility mixes contrast, reduced motion, focus and tap targets. The skill with the most contrast lines (better-colors) cut the reduced-motion lines of every motion skill. FRIDAY still added reduced motion each time, probably from the checks.
  - Mobile went to better-typography on a 2–2 tie, which dropped better-layout's `100dvh` and safe-area lines, and both pages used `100vh`.
  - Options:
    - leave accessibility out of leads;
    - lead only where the lines really disagree;
    - or let the designer pick per subject from the start.
- **Ties are common and decided by the order of turning on**: motion 14–14, mobile 2–2, writing 1–1. The Skills page says "Panel's pick", but not that it was a coin toss.
- **Subjects move between reads.** better-ui was mainly surfaces in part 3 and is mainly motion now. A re-read can change who leads.
- **emil-design-eng and animate overlap almost completely.** With emil leading motion, animate's short version is 1,046 characters, and FRIDAY still opens it each time. Turning animate off would save a call.
- **A read is at the mercy of any Panel started on the same library.** With "read automatically" off, a Panel that starts marks every waiting and in-progress read as failed:
  - the measuring script does this;
  - so does another copy server;
  - the in-progress read keeps going in the first Panel, but its row says failed.
  - Harmless on the real library, where only the real app reads, but confusing on a shared copy. Possible fix: keep the reads' process id with the row.
- **The two older fields in a skill's left column**, "When to use it" (its note) and "Used for" (its tags), **reach nothing FRIDAY sees by default**:
  - not the instructions, not `get_skill`, not `get_design_rules` or a hand-off;
  - only `search_library` with `types: ["skill"]` (their words are searchable) and `get_reference` on a skill, which FRIDAY only does when asked;
  - none of the copy's 35 skills has either filled in, and the real library has no skills.
  - They could go, or become "when" and "about".
- **Part 1's Typography is read but its read is unused**, because its own headings come first. With the setting on, every such file is read anyway, at about 11,000 tokens each.
- **Cost:** a full re-read of all 35 at extra-high effort was about 800,000 tokens. Raising `READ_VERSION` again re-reads every skill the designer hasn't edited.
- **Not done:** the plan's "Not in this step" list (mentioning a skill with @, skills per project, whole skills for Claude Code, new checks, a kit). Also not done: a phone-width look at the new Skills page sections.

## 11. Note for the designer

- **Reading:** skills are now read by themselves when "read automatically" is on, which it is in your real Panel, three at a time. Add a pack and it's read, and it still arrives off.
- **Leads:** when two skills you've turned on both talk about the same thing, like motion, only one of them leads it. FRIDAY then follows that one and is told so. Panel picks the lead for you, and on the Skills page (By subject) you can change it from the name next to the heading.
- **Reads now catch eyebrows:** better-typography's small spaced capitals are left out until you put them back.
- **The three test sketches:** skills on made the pricing better-made (one main button, readable text). The hero came out different, not better than part 3's.
- **Please look at the accessibility and mobile leads** before relying on them. That's where the rule cuts things it shouldn't.
- **Live:** nothing is live in your real Panel until it is restarted, and nothing is committed.
