# Plan: skills fixes (a lead decides only where skills disagree, and five small things)

Written 11 Nov 2026 for another Claude session to carry out. Read all of it, `CLAUDE.md`, `unugly.md`, and the last step's plan and report ([skill-leads-plan.md](skill-leads-plan.md), [skill-leads-report.md](skill-leads-report.md)) with the code they describe (`server/skillleads.ts`, `server/skills.ts`, `server/skilluse.ts`, `server/skillread.ts`, `server/skillreads.ts`, `web/src/Packs.tsx`, `web/src/SkillRead.tsx`) before touching anything. When you finish, write the report described at the end and stop.

## Where things stand

Everything up to this plan is committed (`b71d6f3`) and **the real Panel on 4646 now runs it**. The designer is using it. So the rules in `CLAUDE.md` matter more than before: a change reaches the real Panel only at a restart, and only the designer asks for one.

## Why

Checking the last step showed one real fault and a few small ones.

1. **A lead leaves out too much.** When two skills that are on speak to one subject, the lead's lines stay and every other skill's lines on that subject are taken away, whether they disagree or not. With six skills on, FRIDAY lost, among others:
   - "Long-form text: 60–75 characters per line" (better-typography; its read filed the line under layout, and better-layout leads layout);
   - `100dvh` and the safe-area lines (better-layout; mobile went to better-typography on a tie), and both test pages then used `100vh`;
   - "Hover styles inside `@media (hover: hover)`" (better-ui; gestures went to animate);
   - better-ui's reduced-motion line (accessibility went to better-colors, which says nothing about motion).

   The lines that really disagree are a handful (press `scale 0.96` over 150ms against `0.97` over 160ms; a 100ms stagger against 30–80ms). So the cure cost more than the problem.
2. **A tie is decided by which skill was turned on a few milliseconds earlier.** Motion was 14 lines against 14, mobile 2 against 2.
3. **The last test could not show what skills do.** All three test pages were made on HUJJAT's canvas, which already holds an older hero with Emil's curve and press. The skills-off page has the same `cubic-bezier(0.23,1,0.32,1)` and `.btn:active{transform:scale(.97)}` as the skills-on pages, copied from that hero. The report credited them to the skills, and said the skills-off page has no press state. It has.
4. Small things: a skill's card shows its author's long description; two fields in a skill's detail view do nothing; a read can be marked failed by another Panel started on the same library.

## Rules for this job

- Follow `CLAUDE.md`: never touch `~/DesignLibrary` (reading it with `sqlite3 -readonly` is fine) or port 4646; never `bun run build` or `bun run start`; **do not restart the real app; do not commit or push.** Never `git stash`, `git checkout` or `git reset`.
- **Use the skills copy**: `.copy/lib` (35 skills, all read, all off), UI in `.copy/dist`, the `panel-copy-search` server on port **4757**. Build the UI with `bunx vite build --outDir "$PWD/.copy/dist" --emptyOutDir` from this folder. **Never run `scripts/copy.sh`**: it deletes `.copy/lib`.
- **Another session may be working on ready-made parts in this folder at the same time** ([ready-fixes-plan.md](ready-fixes-plan.md)). Stay out of `server/ready.ts`, `server/sketches.ts`, `server/board.ts`, `server/chat.ts`, `web/src/Ready.tsx`, `web/src/Assistant.tsx`, `scripts/copy.sh`, `tests/ready.test.ts` and any new file of theirs. In files you share (`server/mcp-tools.ts`, `README.md`, `web/src/api.ts`, `web/src/styles.css`), change only what this plan needs, read the file again right before each edit, and never rewrite or reformat it. If the type check or a test fails in a file you didn't touch, wait a few minutes and try again; if it still fails, say so in the report and don't fix it.
- The database only ever adds: one new empty column (below). Nothing is renamed, dropped or rewritten. `skill_use.turned_on_at` stays where it is, unused.
- No new dependency. Plain words everywhere the designer reads.
- No read is redone: `READ_VERSION` stays 2.
- This step spends the designer's Claude plan only on the **three FRIDAY messages** under "Live check".

## What to build

### 1. A lead decides only where skills disagree

**Nothing is left out any more.** Every skill that is on keeps all its lines: in FRIDAY's instructions, in `get_skill`'s short version, in `get_design_rules` and in a build's hand-off. A lead is now a rule for FRIDAY to follow, not a cut.

- **Who leads** stays as it is: a subject has a lead when two or more skills that are on (read, and for sketches) have lines on it; the designer's pick wins while that skill is on; otherwise Panel picks.
- **What FRIDAY is told.** In the `<designer-skills>` block, right after its opening lines, one short list, the same for one model, the planner and the builder:

  ```
  Where two skills say different things about the same thing, the lead of that subject wins. Where they don't disagree, follow both.
  - motion: emil-design-eng (read it with get_skill when the page moves)
  - layout: better-layout
  ```

  One line per subject that has a lead, in the subjects' usual order. The words in brackets are today's hint for reaching a lead that isn't already in the instructions, and are left out when it is. This replaces today's sentence "Where two skills speak to one subject, one leads it: follow that one on it." and every "On motion, follow …" line at the end of a skill.
- **`get_skill`'s short version** gives all of the skill's lines. After them, for each subject it speaks to that another skill leads, one line: "On motion, emil-design-eng leads: where it says something different, follow emil-design-eng (read it with get_skill when the page moves)."
- **For AI apps outside Panel** (`get_design_rules`, `HANDOFF.md`): the same list, once, before the skills.
- **Take out what the cut needed**: `applyLeads`'s removing of lines, `cut`, `emptied`, the `given: "led"` state and its sentence, the per-skill "follow" lines. Keep the code small: if a function is left doing nothing, remove it.
- With no skill on, FRIDAY's instructions stay byte for byte what they were before skills existed. With one skill on, or no subject shared, there is no list.
- The budget for Always skills (`SKILL_BUDGET`) doesn't change. Say in the report what the six skills of the live check come to now.

**Panel's pick, without the coin toss.** In order:

1. the skills whose main subject it is;
2. then the one with more lines on the subject;
3. then one used **Always** before one used **When it applies** before one used **When asked** (a lead that is already in front of FRIDAY is worth more than one it has to go and read);
4. then by name, A to Z.

When the first two in that order are level on points 1 and 2, it is a tie: the lead carries `tie` with the other skill's name, and the page says so (below). Nothing looks at when a skill was turned on any more.

**The Skills page and the detail view.**

- A subject's heading, as now: "led by emil-design-eng · Panel's pick". On a tie: "led by emil-design-eng · Panel's pick, level with animate". The menu for changing the lead stays as it is.
- In a skill's detail view, no line is muted. A line on a subject another skill leads keeps its small note ("· emil-design-eng leads motion") in the same quiet type as the subject, so the designer sees who wins if the two differ. The token count is all its lines; "without N lines another skill leads" goes.
- The sentence that says what FRIDAY gets from the skill (`gets`) never says "Other skills lead everything it says" any more.

### 2. A skill's card shows the short line

On the Skills page and in the library grid, a read skill's card shows its read's one line (`one_line`), not its author's description: some authors write a whole paragraph of trigger words there. A skill that isn't read yet shows the author's description, held to three lines with an ellipsis. The detail view's left column does the same.

### 3. "When to use it" reaches FRIDAY; "Used for" goes

A skill's detail view has two older fields in its left column: **When to use it** (the designer's note on the skill) and **Used for** (its tags). Neither reaches FRIDAY today.

- **When to use it** now counts. Wherever FRIDAY or another AI app is given or shown a skill that is on (its block in the instructions, its line in the list of skills to read, `get_skill`'s list and short version, `get_design_rules`, a hand-off), the note follows the skill's line as: `The designer's note: <the note>`. At most 300 characters; longer is cut at a word with an ellipsis. An empty note adds nothing, so with no notes everything FRIDAY gets is unchanged.
- **Used for** is hidden for skills (the read's subjects say it better). Tags already stored stay in the database, untouched.

### 4. A read isn't spoiled by another Panel on the same library

On a copy that two Panels share, the second one to start marks the first one's waiting and running reads as failed ("Panel was restarted before this read finished").

- Add one empty column, `skill_reads.pid`: the process id of the Panel that put the read in line or is running it. Set it when a read is put in line and when it starts.
- At start (`startSkillReads`), with the setting on or off: a waiting or running read whose `pid` belongs to another process that is still alive is left exactly as it is. Only rows with no `pid`, this process's own, or a dead one are handled as today.
- The real library has one Panel that reads, so nothing changes there.

### 5. README

Update the part of `README.md` about skills where it says a lead's lines replace the other skills' lines (if it does), and nothing else.

## Tests (no Claude, no internet)

Change `tests/skillleads.test.ts` and the other skills tests to the new behaviour, and add:

- with two skills on that speak to one subject, every line of both is in FRIDAY's block, `get_skill` and the outside text; the list names the lead once;
- the hint in brackets is there for a lead used When it applies, and absent for one already in the instructions;
- the planner, the builder and one model get the same list;
- the designer's pick, Panel's pick taking over while the pick is off, and giving it back to Panel, as before;
- Panel's pick: main subject first; more lines; Always before When it applies; then by name; a tie is marked and names the other skill; the order of turning on changes nothing;
- no skill on: the three readers' instructions equal those written before any skill existed (keep this test);
- a skill's note reaches the block, the list, `get_skill` and the outside text; it is cut at 300 characters; an empty note changes nothing;
- a read with another live process's `pid` is left alone at start; one with a dead `pid` is handled as before.

Then `bun run typecheck`, `bun test tests`, and `PANEL_PORT=4799 PANEL_LIBRARY_DIR=.copy/lib bun scripts/measure-search.ts` (every search line and `ORDER` line as before; say what `TOOLS` is before and after).

## Live check, on the skills copy (port 4757)

**Look, without Claude:**

- Turn on better-ui, better-typography, better-layout, better-colors, emil-design-eng and animate, as their reads suggest. Save FRIDAY's skills block for the three readers, and `get_skill` for better-ui and for animate. Check by reading them that these lines are back: line length 60–75, `100dvh` and safe areas, hover inside `@media (hover: hover)`, better-ui's reduced-motion line.
- Screenshots: the Skills page by subject with a tie showing; a detail view with a "· … leads motion" note and nothing muted; a card with a read's one line; the Skills page at a phone's width (375).

**Three FRIDAY messages, a fair test this time.** One model. Each message goes in a **new, empty project** made for it (no saves, no sketches, no colours, no brand), so nothing on the canvas can be copied. The same words each time:

> Sketch a sign-up page for a notes app: a headline, an email field and one button. The parts come in one after another, and the button reacts when pressed. Pick calm colours. One screen.

1. **Skills off.**
2. **The six on**, Panel's picks (emil-design-eng leads motion).
3. **The six on**, and you set better-ui to lead motion by hand.

For each page, read from the saved HTML, not from memory: the press (scale and time), the gap between the parts coming in, the curve, whether hover sits inside `@media (hover: hover)`, whether reduced motion is handled, `100dvh` or `100vh`, how many filled buttons, and what the skill checks said. Then:

- **Did the lead decide?** emil-design-eng says press `scale(0.97)` over 160ms and 30–80ms between items; better-ui says `scale: 0.96` over 150ms and 100ms between chunks. Page 2 should follow the first, page 3 the second.
- **Credit only what the skills-off page doesn't have.** For every value you put down to a skill, say whether page 1 has it too. If it has, it doesn't count.
- Say plainly which page is better, and whether you could tell why.

Afterwards turn all six off and take your pick for motion back, so the copy is as you found it. Leave the three test projects in the copy and name them in the report. Save everything in `.copy/` with names starting `skillfix-`.

## Not in this step

Mentioning a skill with `@` in FRIDAY, skills per project, skills and ready-made parts for real builds, new checks from what reads say could be measured, and files with their own Decide / Build headings being read although their read isn't used. Leave them.

## The report

Write `docs/skill-fixes-report.md`:

1. **What changed**, file by file; anything done differently from this plan and why.
2. **Leads**: the exact words FRIDAY is now given with the six on; the size of the block for each reader, before and after; the lines that are back.
3. **The three pages**: a table of the values read from each, where each value came from, and the two questions above answered.
4. **The small things**: the card, the note, the field that went, the `pid` column.
5. **Checks**: typecheck, tests, the measuring script, `TOOLS` before and after.
6. **The database**: what was added.
7. **Shared files**: each one you touched and what you added; any failure you saw that wasn't yours.
8. **Doubts**, and what the next step should know.
9. **Note for the designer**, a few plain sentences.
