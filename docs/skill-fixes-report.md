# Report: a lead decides only where skills disagree, and five small things

Carried out from [skill-fixes-plan.md](skill-fixes-plan.md) on 11 Nov 2026, on the skills copy (`.copy/lib`, `panel-copy-search` on port 4757, UI built into `.copy/dist`). The real library and the real app on 4646 were not touched. Nothing is committed, nothing was restarted. Everything saved during the check is in `.copy/` with names starting `skillfix-`.

## 1. What changed

### Server

- **`server/skillleads.ts`**
  - `applyLeads` is gone. A lead no longer removes any line.
  - `pickLeads(skills, picks)` no longer takes the turn-on times. Panel's pick ranks every skill that speaks to the subject:
    1. main subject;
    2. more lines;
    3. Always, then When it applies, then When asked;
    4. name, A to Z.
  - When the first two are level on 1 and 2, the lead carries `tie` with the second skill's name. A designer's pick never carries `tie`.
- **`server/skills.ts`**
  - Removed: `Cut`, `followLines`, `andList`, `Skill.cut`, `Skill.emptied`, the `given: "led"` state and its "Other skills lead everything it says…" sentence.
  - The sentence "Where two skills speak to one subject, one leads it: follow that one on it." is gone from the block's opening.
  - New `leadsList`: the rule, then one line per led subject, in the usual subject order. The hint in brackets appears only when the lead isn't already in the instructions.
  - `skillsBlock(reader, skills, leads)` puts that list right after the opening paragraph, the same for all three readers.
  - `skillsForOutside(…, leads)` now answers `{ leads, skills }`, so `get_design_rules` and `HANDOFF.md` give the list once, before the skills.
  - `readSkillFor` (`get_skill`) gives all of a skill's lines. Then, for each subject it speaks to that another skill leads, it adds: "On motion, animate leads: where it says something different, follow animate (read it with get_skill when the page moves)."
  - New `noteLine` / `NOTE_LIMIT = 300`. The designer's note follows a skill's line as "The designer's note: …" in five places:
    - its block;
    - its line in the list of skills to read;
    - `get_skill`'s list, its short version and its whole-file answer;
    - `get_design_rules`;
    - the hand-off.

    A note longer than 300 characters is cut at a word and ends with "…".
- **`server/skilluse.ts`**
  - Reads `refs.note` into `Skill.note`.
  - `withLeads` is gone. `skillsForFriday()` returns the skills and the leads, and passes both to the block, the outside text and `get_skill`.
  - `leadsNow` no longer reads `turned_on_at`. The column stays, and `setSkillUse` still writes it, harmlessly.
  - The detail view's token count is all the lines. `led_by` stays, as a note only.
- **`server/skillreads.ts`**
  - New column `skill_reads.pid`. It is set when a read is put in line and again when it starts.
  - New helpers `alive(pid)` and `notOthers()`.
  - At start (setting on or off), waiting and running reads whose `pid` is another process that is still alive are left exactly as they are.
  - `drain()` also skips waiting reads that belong to another running Panel. Otherwise the second Panel would read them too, which the plan didn't spell out but needs.
  - `readSummaries` now carries the read's `one_line`, for the cards.
- **`server/mcp-tools.ts`** (`get_design_rules`) and **`server/builds.ts`** (`HANDOFF.md`): take `{ leads, skills }` and print the list once, before the skills.

### Web

- **`web/src/Grid.tsx`**: a skill's card shows its read's `one_line`. A skill not read yet shows its author's description, held to three lines (`.skill-desc.unread`).
- **`web/src/Detail.tsx`**:
  - The left column shows the read's one line the same way (the existing three-line clamp with More).
  - **Used for** (tags) is hidden for skills. **When to use it** stays.
- **`web/src/SkillRead.tsx`**:
  - No line is muted.
  - "· animate leads motion" stays, in the subject's quiet type.
  - The token line no longer says "without N lines another skill leads".
- **`web/src/Packs.tsx`**: a tie's heading reads "led by animate · Panel's pick, level with emil-design-eng".
- **`web/src/api.ts`** (types): `cut`, `emptied` and `"led"` removed; `tie` and `read.one_line` added.
- **`web/src/styles.css`**:
  - `.skill-line.led` is gone.
  - `.skill-line-why` now uses the subject's faint 11.5px type.
  - New `.skill-desc.unread` (three lines).

### Tests

- `tests/skillleads.test.ts` was rewritten for the new behaviour: 27 tests, 7 more than before. Section 5 lists what they cover.
- The other skills tests needed no change.

### README

`README.md` doesn't mention skills or leads anywhere, so there was nothing to change.

### Done differently from the plan, and why

- **Panel's pick for motion is animate, not emil-design-eng.**
  - Both are mainly motion, both have 14 lines, and both are "When it applies". So rule 4, by name A to Z, gives animate.
  - The plan's live check expected emil-design-eng. I kept the rules as written rather than set emil by hand: page 2 was meant to be "Panel's picks", and this is the tie the Skills page now shows.
  - animate carries the same Emil values as emil-design-eng: press `scale(0.97)` over 160ms, and 30–80ms between items. So the test asks the same question.
- **`drain()` skips another running Panel's waiting reads too** (see above).
- **`get_skill`'s whole-file answer** (a skill with no read) carries the note as well, under its first line. The plan listed only the short version and the list.

## 2. Leads

**The exact words FRIDAY now gets**, with the six on and Panel's picks. They come right after the block's opening paragraph, the same for one model, the planner and the builder:

```
Where two skills say different things about the same thing, the lead of that subject wins. Where they don't disagree, follow both.
- layout: better-layout
- motion: animate (read it with get_skill when the page moves)
- gestures: animate (read it with get_skill when the page moves)
- mobile: better-layout
- writing: better-layout
- accessibility: better-colors
```

**Panel's picks now**, compared with the last step:

| Subject | Speakers (lines) | Pick now | Tie? | Last step's pick |
|---|---|---|---|---|
| layout | better-typography 2, better-layout 15 | better-layout | no | better-layout |
| motion | better-ui 5, emil-design-eng 14, animate 14 | animate | **level with emil-design-eng** (decided by name) | emil-design-eng (turned on first) |
| gestures | better-ui 1, animate 2 | animate | no | animate |
| mobile | better-typography 2, better-layout 2 | better-layout | **level with better-typography** (decided by name) | better-typography |
| writing | better-typography 1, better-layout 1 | better-layout | **level with better-typography** (decided by name) | better-typography |
| accessibility | better-ui 1, better-typography 1, better-colors 3, emil-design-eng 1, animate 1 | better-colors | no | better-colors |

**The skills block, before and after** (characters; saved as `.copy/skillfix-{before,after}-block-{solo,planner,builder}.txt`):

| Reader | Before (lines cut) | After (nothing cut) |
|---|---|---|
| One model | 12,750 | 15,039 |
| Planner | 6,354 | 7,135 |
| Builder | 7,843 | 9,531 |

- **The whole instructions** are now 30,058 / 22,154 / 24,550 characters.
- **The Always parts of the six** come to **13,344 characters, about 3,337 tokens**, against the 16,000 budget (`SKILL_BUDGET`, unchanged). Nothing is dropped.
  - The last step's page said about 2,757 tokens, with lines cut.

**`get_skill`'s answers** (saved as `.copy/skillfix-after-get-skill-*.txt`):

| Skill | Before | After | Lines at the end of the answer |
|---|---|---|---|
| better-ui | 3,000 | 4,442 | motion, gestures and accessibility |
| animate | 1,046 | 4,077 | accessibility, led by better-colors |
| emil-design-eng | 3,765 | 4,104 | motion, led by animate; accessibility, led by better-colors |

**The lines that are back.** I read them in the saved blocks. They are in the one-model and builder blocks; they are Build lines, so the planner doesn't get them, as before.

| Line | Skill | In the block before? | Now? |
|---|---|---|---|
| "Long-form text: 60–75 characters per line (65ch…)" | better-typography | no | yes |
| "Full-height panes 100dvh, not 100vh…" | better-layout | no | yes |
| "…bottom padding calc(16px + env(safe-area-inset-bottom)); safe-area insets need viewport-fit=cover" | better-layout | no | yes |
| "Hover styles inside @media (hover: hover)…" | better-ui | no | yes |
| "Movement, scale and blur only inside @media (prefers-reduced-motion: no-preference); the opacity fade runs for everyone." | better-ui | no | yes |

**Screenshots** (in `.copy/`):

| File | What it shows |
|---|---|
| `skillfix-page-tie.jpg` | The Skills page by subject: "Motion · led by animate · Panel's pick, level with emil-design-eng" |
| `skillfix-detail-no-muted.jpg` | better-ui's detail view. No line is muted, "· animate leads motion" is in small quiet type, all lines are counted (834 tokens), the read's one line is on the left, and there is no "Used for" |
| `skillfix-cards-one-line.jpg` | Cards with the read's one line |
| `skillfix-page-phone.jpg` | The Skills page at 375 wide |

## 3. The three pages

**How they were made:**
- One model, Opus 5.5, High. Each in a new, empty project made for it: no saves, no sketches, no colours, no brand.
- I sent the plan's exact words, through the same route FRIDAY's panel uses (`.copy/skillfix-*-run.txt` has the script's log).

**The pages:**

| | Project | Sketch | Time |
|---|---|---|---|
| Page 1, skills off | "skillfix 1 · skills off" (`d344841995284c1c`) | `9c600addec93488f` "Sign-up, quiet paper" | 90 s |
| Page 2, six on, Panel's picks | "skillfix 2 · six on, Panel's picks" (`b2a8f22165b6412e`) | `52e4c5dc9c3b4c95` "Sign-up, quiet paper and sage" | 135 s |
| Page 3, six on, better-ui leads motion | "skillfix 3 · six on, better-ui leads motion" (`e198ca2e3bee4a4d`) | `529e179327924ac8` "Notes sign-up, calm paper" | 90 s |

- Pages 2 and 3 both read animate and emil-design-eng with `get_skill`, short versions only.
- Saved HTML: `.copy/skillfix-{1-off,2-on,3-ui}-*-v2.html`. Pictures: `.copy/skillfix-{1-off,2-on,3-ui}.jpg`. Answers: `-answer.md`.

**Values read from the saved HTML:**

| | Page 1, off | Page 2, animate leads motion | Page 3, better-ui leads motion |
|---|---|---|---|
| Press | `scale(.955) translateY(1px)` in 90ms ease-out, springing back over 500ms with overshoot `cubic-bezier(.34,1.7,.5,1)` | `scale(0.97)`, `transform 160ms var(--ease-out)` | `scale: 0.96`, `scale 150ms ease-out` |
| Gap between parts coming in | 140ms (+120ms start) | 90ms | 100ms |
| Each part's entrance | 700ms, up 14px out of `blur(4px)` | 460ms, up 10px out of `blur(4px)` | 300ms, up 12px out of `blur(4px)` |
| Curve | `cubic-bezier(.2,.7,.2,1)` | `cubic-bezier(0.23, 1, 0.32, 1)` | `cubic-bezier(0.23, 1, 0.32, 1)` |
| Hover inside `@media (hover: hover)` | no (plain `:hover`) | yes | yes |
| Reduced motion | `reduce`: animations off | movement and press only inside `no-preference`, the fade for everyone | the same, plus a dark mode |
| Height | `height: 100%` (neither dvh nor vh) | `min-height: 100dvh` | `min-height: 100dvh` |
| Safe areas | no | `viewport-fit=cover`, no `env()` | `viewport-fit=cover` and `env(safe-area-inset-bottom)` |
| Filled buttons | 1 | 1 | 1 |
| Visible field label | no (placeholder only) | yes | yes |
| Skill checks, all six measured afterwards | **contrast breaks** (better-colors): 3 texts at 4.23:1 | none | none |

**Where each value came from.** Only what page 1 doesn't have counts:

- **Press:**
  - Page 2's `scale(0.97)` over 160ms is animate's and emil-design-eng's line, word for word.
  - Page 3's `scale: 0.96` over 150ms, written with the `scale` property and `:not(:disabled):active`, is better-ui's line, word for word.
  - Page 1 has a press too, but a different one (0.955, 90ms, springy). Both values count for the skills.
- **Gap between parts:**
  - Page 3's 100ms is better-ui's "chunks 100ms apart", and its 300ms, `blur(4px)`, 12px entrance is better-ui's whole recipe.
  - Page 2's 90ms is **outside** Emil's 30–80ms. It doesn't follow the lead, nor anything else I can find; its 460ms isn't animate's 300ms either.
- **Curve:** `cubic-bezier(0.23, 1, 0.32, 1)` is Emil's `--ease-out`. Page 1 doesn't have it, so it counts.
  - Page 3 kept it while better-ui led. better-ui names no curve, so there was nothing to disagree about. That is "follow both" working.
- **Hover inside `@media (hover: hover)`:** pages 2 and 3; page 1 doesn't. It counts. It is better-ui's line, and animate's too ("Gate :hover motion…").
- **Reduced motion:** all three handle it, so handling it doesn't count. The way pages 2 and 3 do it (movement only inside `no-preference`, the fade for everyone) is better-ui's line, which the last step cut. That counts.
- **`100dvh`:** pages 2 and 3; page 1 uses `100%`. It counts, for better-layout, whose line is back. Page 3 also took better-layout's `env(safe-area-inset-bottom)`.
- **One filled button:** all three have one, so it **doesn't count**.
- **Blurred entrance:** page 1 has `blur(4px)` too, so it **doesn't count**.
- **Contrast:** page 1 fails better-colors (4.23:1). Pages 2 and 3 pass. It counts.
- **Visible field label:** pages 2 and 3; page 1 doesn't. This is likely from the skills, but I couldn't point to one line.

**Did the lead decide?** Yes, on the two values that really disagree about the press:
- page 2 took Emil's 0.97 / 160ms;
- page 3 took better-ui's 0.96 / 150ms and its 100ms gap.

On the gap, page 2 missed Emil's 30–80ms (90ms), so the lead decided the press, not the gap. Where the two didn't disagree (the curve), page 3 followed both, as the new rule says.

**Which page is better.**
- The three look nearly the same at first sight: off-white paper, sage button, ALS Hauss, one column.
- Pages 2 and 3 are **better-made**:
  - text that passes contrast;
  - a visible label;
  - `100dvh`;
  - hover only where there is hover;
  - gentler reduced motion;
  - page 3 also has a dark mode and safe areas.
- **Page 3 is the best:** the tightest, quietest motion (300ms parts, 100ms apart), and the most complete.
- **Page 1 has the most character in its motion** (the springy press, the slow 700ms rise), but it fails contrast and has no label.
- I can tell why for most of the difference: the lines listed above, several of them the very lines the last step had cut. I can't tell why page 2 chose 90ms.

## 4. The small things

- **The card:** a read skill's card, and its detail view's left column, show the read's one line. The fallback for a skill not read yet is held to three lines. I couldn't see that on the copy: all 35 skills there are read.
- **The note:**
  - "When to use it" now reaches FRIDAY and other AI apps in every place listed in section 1, as "The designer's note: …".
  - It is at most 300 characters, cut at a word with "…".
  - An empty note (or only spaces) changes nothing. The test compares the instructions byte for byte.
  - None of the copy's skills has a note.
- **The field that went:** "Used for" is hidden for skills. Tags already stored stay in the database, untouched.
- **The `pid` column:** described in section 1. Tested both ways:
  - another running Panel's reads are left alone, with the setting on or off;
  - a dead Panel's reads are handled as before.

## 5. Checks

- `bun run typecheck`: clean.
- `bun test tests`: **196 pass, 0 fail** (21 files). New and changed tests in `tests/skillleads.test.ts`:
  - with two skills on one subject, every line of both reaches the three readers, `get_skill`, `get_design_rules` and `HANDOFF.md`;
  - the list is given once and is identical for the three readers;
  - the hint is there for a "When it applies" lead and absent for an Always one (the designer's pick);
  - the designer's pick, Panel's pick taking over while the pick is off, and giving it back;
  - Panel's pick: main subject, then lines, then Always / When it applies / When asked, then name;
  - a tie is marked and names the other skill; the input order changes nothing; the designer's pick is never a tie;
  - no skill on: the instructions equal those before any skill;
  - one skill on: no list;
  - the note in the block, the list, `get_skill`, the outside text and the hand-off; cut at 300; an empty note changes nothing;
  - `pid`: a live other Panel's read left alone (setting off: stays reading; setting on: stays waiting and isn't read); a dead one's handled as before; a queued read keeps its Panel's pid.
- `PANEL_PORT=4799 PANEL_LIBRARY_DIR=.copy/lib bun scripts/measure-search.ts`: every search line and every `ORDER` line is identical before and after (diffed: `.copy/skillfix-measure-{before,after}.txt`).
- **`TOOLS`:** 29 tools, 32,910 characters, before and after. This step changed no tool's description.

## 6. The database

- Added one column: `skill_reads.pid` (INTEGER, empty on older rows). Nothing renamed, dropped or rewritten.
- `skill_use.turned_on_at` stays where it is, unread.
- On the copy the column exists. In the real library it doesn't yet (checked with `sqlite3 -readonly`). It will be added the next time this folder's code opens it: Claude Code's own `panel` MCP server, or the real app after a restart. That is harmless to the older code.

## 7. Shared files

- **`server/mcp-tools.ts`:** `get_design_rules` now reads `{ leads, skills }` and puts the list before the skills (3 lines).
- **`web/src/api.ts`:** skill types only (`tie`, `read.one_line`; `cut`, `emptied`, `"led"` removed).
- **`web/src/styles.css`:** `.skill-line.led` removed, `.skill-line-why` changed, `.skill-desc.unread` added.
- **`README.md`:** not touched (nothing about skills in it).
- **`server/builds.ts`:** not in either plan's list. Its `HANDOFF.md` part prints the list (3 lines).
- I didn't touch `server/ready.ts`, `sketches.ts`, `board.ts`, `chat.ts`, `Ready.tsx`, `Assistant.tsx`, `scripts/copy.sh` or `tests/ready.test.ts`.
- I saw no failure that wasn't mine.

## 8. Doubts, and what the next step should know

- **Ties are still common, and A to Z is still arbitrary.** Motion, mobile and writing are all ties with the six on. It is now visible on the page ("level with …") and no longer depends on milliseconds. But "animate leads motion" is only alphabetical.
  - Ties matter much less now that nothing is cut: they only decide the few real disagreements.
  - emil-design-eng and animate are nearly the same skill. Turning one off would remove the tie and one `get_skill` call each time. Both pages 2 and 3 read both.
- **Page 2's 90ms gap** sits outside its lead's 30–80ms. FRIDAY doesn't always land on the number; a check for the stagger gap would catch it (already planned as "new checks").
- **Bigger block:** the one-model block grew from 12,750 to 15,039 characters, and `get_skill` answers grew by up to four times for animate. Still well under the budget.
- **Accessibility led by better-colors:** this is now harmless, because nothing is cut. The lead only matters if colour and motion advice ever disagree, which they don't.
- **Process ids can be reused.** If a dead Panel's pid is reused by an unrelated program, its waiting reads would be left alone until that program ends. This is unlikely, and it only affects a shared copy.
- **Another Panel also stops FRIDAY's running answers.** Opening `server/chat.ts` in another process (another Panel, the measuring script, any script that imports it) marks every answer still streaming as "stopped" in the database (`chat.ts` line 78). It is the same kind of problem as the reads, in a file this step had to stay out of. I ran the measuring script only after the three messages were done.
- **Phone width:** at 375 wide the skill cards are about 170px square-ish (0.86 of their width), and the one line is squeezed to zero height. The "In FRIDAY / Read" labels also run off the card. This is not new: the author's description was squeezed out the same way. It needs its own small look at the card's shape on phones.
- **Not seen live:** the three-line hold on an unread skill's card (every skill on the copy is read), and a note on a real skill in the UI. Both are covered by tests and the CSS.

## 9. Note for the designer

- When two of your skills talk about the same thing, FRIDAY now keeps everything both say. It only follows the "lead" where they actually disagree, like 0.96 against 0.97 for a button press.
- The lines that went missing last time are back: line length, `100dvh`, safe areas, hover only on devices that hover, and better-ui's reduced motion.
- When Panel's pick was a close call, the Skills page now says so: "Panel's pick, level with …".
- What you write in a skill's "When to use it" now reaches FRIDAY. "Used for" is gone from skills.
- In the test, the lead clearly decided the press: Emil's 0.97 when animate led, better-ui's 0.96 when you put better-ui first. Both pages with skills on were better-made than the one without: readable text, a real label, and it works on phones.
- Nothing is live in your real Panel until it's restarted, and nothing is committed.
