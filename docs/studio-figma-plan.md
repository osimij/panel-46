# The studio, made to work like a design tool

Written 11 Nov 2026 for another Claude session to carry out. Read all of it, then
[CLAUDE.md](../CLAUDE.md) and [unugly.md](../unugly.md), then the code it names, before
touching anything. Line numbers are as of commit `2ed4453`. When you finish, write the report
described at the end and stop.

This plan replaces what is left of [studio-rework-plan.md](studio-rework-plan.md) (its packages
3 to 6). Where the two disagree, this one wins.

## Words used here

- **The studio**: one sketch, full size ([Studio.tsx](../web/src/Studio.tsx)).
- **The header**: the studio's top row. **The page row**: the thin row under it, above the page
  (`.st-bar`). **The ask bar**: the box under the page, shown while FRIDAY's panel is folded away.
- **A column**: what sits beside the page. One at a time: Knobs, Directions, Versions, or FRIDAY.
- **Knobs**: the page's colors, fonts and sizes as controls ([Knobs.tsx](../web/src/Knobs.tsx)).
  A knob is a CSS variable on `:root`; changing it changes every place that uses it.
- **Pointing**: pressing Point (or P) and clicking a part of the page. The clicked part is
  **the selected part**.
- **The kit**: the small script Panel adds to every sketch page it serves (`KIT` in
  [sketches.ts:83](../server/sketches.ts:83)). The studio and the page talk through it.
- **Hand changes**: what the designer changes without FRIDAY (knobs, words, and after this plan
  a part's own look, and deleting a part). They wait, shown live, until Save makes them one new
  version.

## What the designer asked for

In their words, shortened:

1. "We need to redesign this entire thing so it looks clean, like Figma": the toolbars, the
   views, the version history, all thought through.
2. "When I point to something, I want to be able to delete it too."
3. Tablet and phone views: "we could kind of hide it."
4. The title and the line under it take "too much space": cut it or make it short.
5. "When I point at something, I want knobs to focus on that thing. Let's say I want to change
   its weight, only its weight. But I see this thing that appears telling me to tell the
   assistant to make some change."
6. The size and percent readout ("1440×703 · 49%"): "we can put it somewhere else."
7. Directions: "why on earth do they have more and more space on the left as they go? Make
   them all on the same x-axis."
8. Choose, Rule out, Knobs, Directions, FRIDAY: "just put icons."
9. Compare is good, but it isn't clear what it compares with.
10. Version history: "I want to see them. I want to be able to revert them."
11. FRIDAY "comes up from a sidebar": it should feel like one tool, and "it should be
    intentional" how chat, knobs and pointing work together.

## What is wrong today, and why

| # | What the designer sees | Why |
|---|---|---|
| 1 | The header is a row of words that squeezes and folds. | Labels on every tool, and a machine that hides them step by step as room runs out (`FOLDS`, `fitHead`, [Studio.tsx:558](../web/src/Studio.tsx:558); `data-f1`…`data-f6`, [studio.css:453](../web/src/studio.css:453)). |
| 2 | Pressing FRIDAY makes every header button slide left, away from the pointer. | FRIDAY's panel is fixed to the window's right edge at full height ([assistant.css:32](../web/src/assistant.css:32)), so the whole studio, header included, gets narrower. |
| 3 | A second line under the title that is really "what the last version tried". | `sketch.tries` shown in the header ([Studio.tsx:631](../web/src/Studio.tsx:631)). |
| 4 | Three screen buttons always in the header; a size readout, Reload and Open in the page row. | Rarely used things given permanent room. |
| 5 | Directions step to the right as they branch. | `paddingLeft` by depth ([Studio.tsx:873](../web/src/Studio.tsx:873)). |
| 6 | Pointing at a part opens a card that only offers to ask FRIDAY. The Knobs column doesn't know what was clicked. | `PointBubble` ([Studio.tsx:899](../web/src/Studio.tsx:899)); Knobs gets the whole page's variables and nothing about the part. |
| 7 | No way to delete a part or change one part's look by hand. | Hand changes are only words (`pagetext.ts`) and variables (`pagevars.ts`). |
| 8 | Versions are a number with two arrows. No list, no time, no "who made it", no way back. | `‹ v29 of 29 ›` ([Studio.tsx:633](../web/src/Studio.tsx:633)). Stepping back also jumps the page to the top, so two versions can't be compared by flipping. |
| 9 | "Save" is in two places (page row, Knobs footer). | [Studio.tsx:795](../web/src/Studio.tsx:795), [Knobs.tsx:1040](../web/src/Knobs.tsx:1040). |
| 10 | Compare doesn't say what it compares. | It shows this direction beside the other directions, never versions, and its button only says "Compare". |

## The design

Five rules. Everything in the packages follows from them.

1. **One header, icons only, that never moves.** It spans the studio's full width, FRIDAY's
   panel included. Opening or closing a column moves nothing in it.
2. **One page, one column beside it.** Knobs, Directions, Versions and FRIDAY take turns in the
   same place at the same width (this rule is from the last plan and stays).
3. **Pointing selects.** The selected part decides what the Knobs column shows and what the ask
   box is about. By hand first; FRIDAY is one keystroke away, not a card in the way.
4. **Every hand change waits, can be undone, and is saved in one place.**
5. **Every version can be seen and brought back.** Nothing is ever deleted.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ ←  Print deck, A4 landscape…   ‹ v29 ›            ⌖ ◫ │ ≋ ⑂4 ◉ │ ✓ ✕ │ F ⚒        │  header
├──────────────────────────────────────────────────────────────┬─────────────────────────┤
│ Все страницы  Обложка  Продукты …      1 to look at  ▭ 49% ▾ │ Knobs                 × │  page row
│                                                              │                         │
│                                                              │ THIS PART               │
│                  the page                                    │ muted “для бизнеса…”    │
│            ┌──────────────────┐                              │  Size ▓▓▓░░  Weight ▓░░ │
│            │ для бизнеса      │  ← selected                  │  Color ■ 6b6f76         │
│            └──────────────────┘                              │                         │
│              ✎  ⑂  ≋  🗑       ← four icons, no card         │ KNOBS THIS PART USES    │
│                                                              │  Muted ■   Display font │
│  ● muted “для бизнеса…” ×  What should change here?      ↑   │ ▸ All knobs             │  ask bar
└──────────────────────────────────────────────────────────────┴─────────────────────────┘
```

Header, left to right: Back · title (one line) · version · gap · Point · Compare · line ·
Knobs · Directions (with its count) · FRIDAY · line · Choose · Rule out · line · Figma · Build.

### Choices already made

The designer was shown these with the plan. Unless the prompt that handed you this plan says
otherwise, build them as written.

- **A.** Pointing shows a strip of four icons under the part, not a card with a text box. The
  ask box (the ask bar, or FRIDAY's own box when its panel shows) carries what was pointed at.
- **B.** One Save, in the page row. The Knobs column loses its own Reset and Save.
- **C.** Desktop, tablet and phone move into a small menu at the right of the page row, with
  the percent, Reload and Open in a new tab.
- **D.** Versions is a fourth column, opened from the version number in the header.

## Rules for you

- **Never test on the real app** (port 4646, `~/DesignLibrary`). Never run `bun run build`,
  `bun run start` or `scripts/copy.sh` (it deletes `.copy/lib`, which another session uses).
- **Make your own copy**, fresh from the real library, because the sketch to test on was made
  today:
  ```
  mkdir -p .copy/lib-studio
  sqlite3 -readonly ~/DesignLibrary/library.sqlite ".backup '.copy/lib-studio/library.sqlite'"
  for d in media projects models fonts brand; do cp -c -R ~/DesignLibrary/$d .copy/lib-studio/$d; done
  ```
  then run on it the same `sqlite3` block that `scripts/copy.sh` runs on its copy (the one that
  starts with `ai_auto`: reads off, nothing waiting, builds stopped), and check
  `sqlite3 .copy/lib-studio/library.sqlite "pragma integrity_check"` says `ok`.
  Build the UI with `bunx vite build --outDir "$PWD/.copy/dist-studio" --emptyOutDir`. Add one
  line to `.claude/launch.json`: `panel-copy-studio`, port **4737**, with
  `PANEL_LIBRARY_DIR=.copy/lib-studio` and `PANEL_DIST=.copy/dist-studio`.
- **The sketch to test on**: project NavTech (`/?project=dd1283fa655a45c5`), sketch "Print
  deck, A4 landscape: spine and nodes" (`4f1d3100ea05400e`): four directions, 35 versions, nine
  states, Cyrillic words. For Knobs and Compare also the "Knobs test…" family in HUJJAT
  (`/?project=ff46e4430ced4d69`).
- **Look in Chrome.** Claude's built-in browser has not been able to run sketch pages (the page
  stays white). Layout can be checked there; anything that needs the live page (pointing,
  knobs, deleting, versions keeping their place) must be checked in Chrome through the Claude
  in Chrome tools. If you can't reach Chrome, say so in the report for each line you could not
  check. Don't claim it.
- **Another session is changing FRIDAY's box at the same time**
  ([context-meter-plan.md](context-meter-plan.md)): it owns `web/src/ModelPicker.tsx`, the
  composer part of `web/src/Assistant.tsx`, `web/src/assistant.css` and the context lines of
  `server/chat.ts`. You touch `Assistant.tsx` and `assistant.css` only in package 1 step 2 (a
  few CSS lines) and package 4 (the selected part in FRIDAY's box). Do package 4's part in
  `Assistant.tsx` only once `docs/context-meter-report.md` exists; read the file again right
  before each edit; never reformat it. Never `git stash`, `git checkout --` or `git reset`.
  If the type check fails in a file you didn't touch, wait a few minutes and try again; if it
  still fails, say so in the report and leave it.
- **The database only grows.** This plan needs no new table or column. Version notes go in
  each version's own `vN.json` file as new fields.
- New routes are guarded like the `/changes` route beside them (`fromPanel(req)`). Sketches stay
  in their sandbox: the kit talks only by `postMessage`.
- **No new dependency.** New icons (trash, clock, and any other) are drawn in
  [Icon.tsx](../web/src/Icon.tsx) the way the ones there are.
- Bump the page address in one place: `pageOf` in `Studio.tsx` says `?studio=5` and
  `Compare.tsx` says `?studio=4`. Make both read one shared constant and set it to 6, since the
  kit changes.
- Grayscale, Inter, quiet. Reuse `st-`, `kn-`, `.popover`, `.menu-item` before adding classes.
  Corners use `corner-shape: var(--corner)`. Anything that moves respects
  `prefersReducedMotion()` and the `prefers-reduced-motion` block in `studio.css`.
- Labels, tips, errors and comments in plain words that say what happens. Comments say why.
  Update the comment at the top of each file you reshape.
- `bun run typecheck` and `bun test tests` pass at the end of every package.
- FRIDAY messages: none until package 4, then two short ones at most.
- Commit nothing. Don't restart the real app.
- Do the packages in order, 1 to 5, without stopping between them. After each, add its part to
  the report.

## Package 1: the frame

Files: `web/src/Studio.tsx`, `web/src/studio.css`, `web/src/Icon.tsx`; a few lines of
`web/src/assistant.css` for step 2.

### 1. The header: icons only

- Every tool is an icon button with a 28px square to hit. No words in the header except the
  title and the version.
- Each shows its name at once on hover and on keyboard focus, under the button, the way Build
  does today (`data-tip`, [studio.css:80](../web/src/studio.css:80) to 89). Not the browser's
  slow `title`. Names: "Back to the canvas (Esc)", "Point at a part (P)", "Compare directions
  side by side", "Knobs (K)", "Directions (D)", "FRIDAY (⌘J)", "Choose", "Rule out", "Figma",
  "Build with Claude Code". Each keeps an `aria-label`.
- **Choose and Rule out**: icon only. When the sketch is chosen, the check sits on a dark fill
  and its name reads "Chosen · click to undo"; the same for ruled out. The small box that asks
  why (`Reason`) stays as it is.
- **Directions** keeps its count as a small number beside the icon, and always shows (also with
  one direction: see step 4). The dots stay (hand changes waiting on Knobs, an unread answer on
  FRIDAY).
- **Title**: one line, cut with an ellipsis. The line under it leaves the header. Clicking the
  title opens a small card (`.st-pop`) with the whole title and that line ("what this version
  tried"); Esc or a click elsewhere closes it.
- **Version**: `‹ v29 ›`. No "of 29". The number is a button that opens the Versions column
  (package 2); until then it does nothing.
- **Screens leave the header** (step 3).
- **Delete the folding machine**: `FOLDS`, `fitHead`, its two layout effects, the `data-f1` to
  `data-f6` rules and the `st-l-*` spans. Only the title gives way now (it shrinks to 80px
  before anything else moves). Under 720px of studio width, hide Compare, Figma and Build.
- **Keys**: K, D and V open and close their columns, like P for Point. Not while typing in a
  field, and not with ⌘, Ctrl or Alt held.

Done when: at studio widths 640, 760, 900, 1066, 1300, 1474 and 2000, with a 60-character
title, nothing overlaps and nothing but the title is cut; each icon shows its name on hover and
on Tab focus.

### 2. The header spans FRIDAY's panel too

While the studio is open, the header runs the full width of the studio's place in the window,
over the top of FRIDAY's panel, and FRIDAY's panel starts under it. `--chat` is deliberately not
inherited (see the note at [assistant.css:13](../web/src/assistant.css:13) and how
`.main:has(.studio)` and `.st-rail` already get it); follow that way of doing it. Outside the
studio FRIDAY's panel is exactly as it is now.

Done when: with the studio open, press FRIDAY, Knobs, Directions, FRIDAY, and close the column.
The left edge of every header button (read with `getBoundingClientRect`) is the same within 1px
at each step, and `.st-stage` keeps one width while any column shows.

### 3. The page row

- **Left**: the states as tabs, as now. When they don't fit they scroll sideways inside their
  own room (no wrapping, the right side never shrinks). With one state or none: nothing here.
  The title is not repeated.
- **Right**, in this order: page errors · rule checks ("1 to look at") · hand changes waiting
  ("3 changes not saved · Put back · Save as v30") · the view chip.
- **The view chip** replaces the size text, the Reload icon, the Open icon and the header's
  three screen buttons. It shows the screen's icon and the scale: `▭ 49%`. Pressing it opens a
  menu (`.popover` with `.menu-item` rows, as the font menu in Knobs does):
  - Desktop · 1440×900 (a check by the one in use), Tablet · 834×1112, Phone · 390×844
  - a line
  - Reload the page
  - Open in a new tab
  - a faint last line: "1440×703, shown at 49%"
- **Alternates leaves this row** (step 4).

Done when: on the print deck (nine states) with Knobs open at window width 1280, the tabs
scroll and the right side is whole; switching to Phone and back from the menu works and the
page and its frame glide together as before.

### 4. Columns: one shell, Directions flat

- Knobs, Directions and (package 2) Versions share one shell: `.st-rail`, the same head (its
  name at the left, a close × at the right that closes the column), the same width.
- **Directions is flat**: remove the indent by depth. Every row starts at the same x. Order,
  picture and the two lines of text stay.
- Directions' head gets a quiet button, "3 alternates", that does what Alternates does today
  (three new directions from this sketch); disabled while FRIDAY is answering. With only one
  direction, the list shows that one row and the button.
- Remove Alternates from the ask bar and from the page row.

### 5. The ask bar

`● [ Ask FRIDAY for a change… ] ↑` and nothing else. What it says while FRIDAY works ("Thinking
· Watch", "FRIDAY answered · See answer") stays.

## Package 2: versions

Files: `server/sketches.ts`, `server/board.ts`, `server/index.ts`, `web/src/api.ts`, a new
`web/src/Versions.tsx`, `web/src/Studio.tsx`, `web/src/Compare.tsx` (the shared address
constant only), `web/src/studio.css`, `tests/sketch.test.ts`.

### 1. What Panel knows about a version

`sketchInfo` ([board.ts:495](../server/board.ts:495)) gives each version three more fields:
`at` (when it was made), `by` (`"you"` or `"friday"`), `what` (one line, may be empty).

- **From now on**: every place that makes a version writes `by` and `what` into that version's
  `vN.json` (new fields beside `height`, `errors`…; old code ignores them). The places:
  `makeSketch` and `editSketch` (FRIDAY: `what` is the `tries` text given with that call, else
  empty), `setSketchVars`, `setSketchText`, `saveSketchChanges` (you: `what` is the label
  already built there without the sketch's name, e.g. `Changed the words to “NavCRM”`), and the
  new restore below.
- **Older versions**: `at` is the time on `vN.html`. `by` and `what` come from
  `project_events`: the event whose `ops` set this sketch's `version` to N (actor `designer` →
  you, anything else → FRIDAY; for the designer's, the event's label with
  ` in <title> (version N)` cut off). Read the events once per call, not once per version. A
  version with no event has no `by`.

### 2. Bringing a version back

New route `POST /api/projects/:project/sketches/:sketch/restore` with `{ version }`, guarded
like `/changes`. It writes that version's file as a new version through `writeVersion` (so
it is rendered and checked like any other), sets the sketch to show it, and records it as the
designer's: label `Brought back version 12 of <name> (version 36)`, `what`: `Brought back v12`.
Answers `{ version }`. Nothing is deleted or rewritten.

Tests (in `tests/sketch.test.ts`): after two versions, restore of v1 makes v3 whose file is
byte for byte v1's; the sketch's info lists three versions with `at`, `by` and `what`; restore
of a version that doesn't exist is refused with a plain message.

### 3. The Versions column

Opened by the version number in the header and by V. Newest first, under day headings ("Today",
"10 Nov").

- A row: the version's picture (`vN.jpg`, 72px wide, a fixed 16:10 box showing its top), `v29`,
  the time ("11:56"), who (the word "You", or FRIDAY's mark), and `what` on one line (two at
  most). No `by`: no who.
- The version on the page is marked (`.on`) and scrolled into view when the column opens.
- A click shows that version on the page (what the arrows do today). Up and Down move through
  the list while it has focus.
- A version with hand changes waiting on it shows the same small dot Knobs uses.
- The marked row, when it isn't the newest, has one button: **Bring back as v36**. After it,
  the page shows the new version and the short notice over the page reads "v12 brought back as
  v36" (it must not say "from FRIDAY": see `keptAt` at [Studio.tsx:122](../web/src/Studio.tsx:122)).

### 4. Versions keep their place

Stepping between versions of the same sketch (arrows, the list, a new one arriving) keeps the
page where it was scrolled, so two versions can be compared by flipping. The kit already scrolls
on `{t:"scroll"}` and reports its scroll when `follow` is on; the studio remembers the last
position per sketch and gives it back when the next version of that sketch says hello. Another
sketch starts at the top.

Done when (Chrome, the print deck): the column lists 35 versions with times and who; scroll to
the fifth page, press ‹ twice and › twice: the fifth page is still showing each time; bring back
v12 and `cmp` the new file with `v12.html` in `.copy/lib-studio`: the same.

## Package 3: change a part by hand

Files: `server/sketches.ts` (the kit), a new `server/pageparts.ts`, `server/board.ts`,
`server/index.ts`, `web/src/api.ts`, `web/src/Studio.tsx`, `web/src/Knobs.tsx`,
`web/src/studio.css`, a new `tests/pageparts.test.ts`.

### 1. The kit tells more, and does two new things

`picked` also carries:

- `path`: where the part sits, counted as the file is (`strict(el)`, already there for words).
- `own`: the part's look as the browser computed it: first font family, font size (px), weight
  (when the "wght" axis is set through `font-variation-settings`, that number, and say so),
  line height, letter spacing, color, background color, corner radius (only when all four
  corners are equal), opacity, its parent's font size (px), and whether it has words of its own.
- `vars`: the names of the page's `:root` variables that reach this part. A variable reaches a
  part when it, or a variable set from it (up to two steps, the chain `uses()` already follows),
  is read in a rule whose selector matches the part or one of its ancestors, or in the `style`
  of either. Rules on `*`, `:root`, `html` and `body` alone don't count.

New messages from the studio:

- `{ t: "style", path, props }`: sets (or, for `null`, takes away) inline style properties on
  that part. Only these: `font-family`, `font-size`, `font-weight`, `font-variation-settings`,
  `line-height`, `letter-spacing`, `color`, `background-color`, `border-radius`, `opacity`.
  Then the blue box is placed again.
- `{ t: "remove", path, on }`: hides the part (`display: none`), or shows it again. **Hide,
  never take it out of the page**: every other part's `path` must stay the same as in the file.

And while a part is selected and no words are being edited, the kit passes these keys up:
Delete, Backspace, Enter, ⌘Z, ⇧⌘Z, and any single letter or digit typed without ⌘ or Ctrl.

### 2. The file is changed carefully

`server/pageparts.ts`, pure functions beside `pagetext.ts` (read its opening comment: the same
care applies).

- `withStyle(html, { path, props })`: merges the properties into that element's `style`
  attribute (keeping what is there, replacing the same property, dropping one set to null).
  Values are refused if they are longer than 200 characters or hold `;`, `{`, `}`, `<`, `>` or
  `url(`.
- `withoutPart(html, { path })`: takes the element out of the file.
- Both find the element by `path` alone (`body > main:nth-child(2) > …`, the same shape
  `withText` accepts), and only if exactly one element is there. The studio also sends what it
  saw there: the element's `class`, `id` and its words (the first 300 characters). `class` and
  `id` must match the file. The words must match too, unless a word edit waiting in the same
  save is inside that part or around it.
- Anything else is refused: "This part is drawn by the page's script, so it can't be changed by
  hand here. Ask FRIDAY to change it."
- **The trap**: positions shift when a part is removed. Make every path-based change (words by
  path, styles, removals) in one pass over the file as it was, so each path means what it
  meant in the live page. Word edits that fall back to finding their words by text
  (`withText` steps 2 and 3) run after that pass.

`saveSketchChanges` ([board.ts:396](../server/board.ts:396)) and the `/changes` route take two
more lists, `styles` and `removes` (the old fields keep working; `check: true` checks these
too). The event's label counts them in plain words ("the look of 2 parts", "removed 1 part").

Tests (`tests/pageparts.test.ts`): a style merges into an existing `style`; the third of four
identical cards is the one removed; two siblings removed in one save are the right two; a
removal and a word edit elsewhere in one save both land; a wrong `class` is refused; a path
that isn't there is refused; a value with `;` is refused.

### 3. Hand changes: one list, undo, one Save

- Beside `pending` (knobs) and `pendingWords`, keep the styled and removed parts of each
  version the same way. When the page loads again they are put back on it (after the words).
  When FRIDAY's new version arrives they carry over like words do: checked against the new
  file, the ones that no longer fit are let go and the designer is told (see `fitWords`,
  [Studio.tsx:403](../web/src/Studio.tsx:403)).
- A new style or removal is checked against the file at once (`check: true`), like words. If
  it's refused, it's put back on the page and the reason shown.
- The count in the page row is all of them: knobs, words, styled parts, removed parts.
- **Undo**: ⌘Z and ⇧⌘Z step back and forward through hand changes on the version showing,
  while the studio is open and no field has the cursor. One drag of a bar is one step; trying
  on a palette is one step; deleting a part is one step. After undo the page shows exactly what
  the list says (for knobs and styles without loading the page again).
- **⌘S saves** (the same as the Save button). Save and Put back live only in the page row;
  remove the Knobs footer.

### 4. The strip under the selected part

`PointBubble` becomes a strip: one row of icon buttons with name tips, no card, no text box.

| Icon | Name | Does |
|---|---|---|
| pencil | Edit the words (↵) | as today; only for a part made of words |
| branch | 3 alternates of this | as today |
| sliders | Knobs for this (K) | opens the Knobs column on this part; lit while it's open |
| trash | Delete (⌫) | hides the part, lets go of it, adds one change |

It sits under the part (above when there's no room), as the card did. While words are being
edited it reads "Editing · ↵ done · Esc put back" with Done and Put back.

Keys while a part is selected and no field has the cursor: Delete or Backspace deletes it;
Enter edits its words; Esc lets go of it; a letter or digit starts a message about it (package
4). Selecting a part never opens or closes a column and never moves the page.

### 5. Knobs follows the selected part

With a part selected and the Knobs column open, the column shows, from the top:

1. **This part.** Its name as on the page (`muted “для бизнеса…”`) and a faint line: "Only
   this part changes."
   - For a part with words: Font (the font menu), Size, Weight, Line height, Letter spacing as
     bars with the ranges `rangeFor` gives each, and Color (the swatch with the picker).
   - For any part: Fill (its background; "None" when it has none), Corners (when all four are
     equal), Opacity.
   - A changed control gets the same dot that puts it back.
   - Each change goes to the page at once (`style` message) and into the hand changes.
2. **Knobs this part uses.** The page's knobs named in `vars`, with the controls they have
   today, and a faint line: "These change everywhere they're used." Hover outlines where, as
   today.
3. **All knobs.** One folded row; opened, it's the whole list as today.

With nothing selected the column is exactly as today (the whole list, no fold).

Write the values so they keep scaling with the page (decks size everything in container
units, and a fixed px would break on other screens): font size in `em` of the parent's size,
letter spacing in `em` of the part's own size, line height as a plain number, corners in `em`;
weight as `font-weight`, or through `font-variation-settings` when the part's weight comes from
the "wght" axis (keep its other axes); colors as hex. The bars still read in px.

Done when (Chrome, the print deck's cover):

- Point at the gray words "для бизнеса и государственного сектора", press K: "This part" shows
  its size, weight and color. Drag Weight: only those words change, the black words above
  don't. Under "Knobs this part uses" there is its color knob; changing it changes the other
  gray words too.
- Point at the small label "Собственная разработка", press Delete: it's gone, "1 change not
  saved". ⌘Z: it's back. Delete again, Save: the new version has no such label, and the file
  has lost exactly that element (diff the two files).
- Point at one of the curves (drawn by the page's script): Delete is refused with the plain
  message and the curve stays.
- Change a weight, a color and delete a part, then press ‹ and ›: all three are still on the
  page and counted. Switch to Phone: the changed size still looks in proportion.

## Package 4: asking about a part

Files: `web/src/Studio.tsx`, `web/src/App.tsx`, `web/src/Canvas.tsx` (passing through only),
`web/src/Assistant.tsx` (the composer: only once `docs/context-meter-report.md` exists),
`web/src/assistant.css`, `web/src/studio.css`.

- **FRIDAY folded away**: the ask bar shows the selected part as a chip before the words
  (`● muted “для бизнеса…” ×`), and its hint reads "What should change here?". Sending asks
  about that part (what `ask()` at [Studio.tsx:544](../web/src/Studio.tsx:544) does with
  `picked` today). The × lets go of the part. A letter typed with a part selected lands in the
  bar.
- **FRIDAY's panel showing**: its own box shows the same chip and sends with it. The studio
  tells the app what is selected (and that nothing is), the app gives it to the assistant, the
  assistant attaches it to the message the way `askWith` does for the studio's own asks, and
  lets go of the part once sent. A sent message already shows what it was about
  ([Assistant.tsx:787](../web/src/Assistant.tsx:787)); the chip should look like that.
- There is never more than one box to type to FRIDAY in.

Done when: with FRIDAY folded, point at a heading, type "make this one size smaller", Enter: the
message goes with the part, the bar says what FRIDAY is doing, the new version loads in place.
The same with FRIDAY's panel showing, from its box. (Two FRIDAY messages. No more.)

## Package 5: look it all over

In Chrome on port 4737. No new work.

- Window widths 1280, 1500, 1728. Light and dark. FRIDAY showing, folded, and at its widest.
- The walk: open the print deck → V, click three versions, bring one back → D, switch
  direction and back, Compare, leave Compare → P, select a part, K, change its weight and
  color, change a shared knob → select another part, Delete → ⌘Z, ⇧⌘Z → edit some words →
  Save → view chip: Phone, Desktop → select a part and ask from the bar → Choose with a reason
  → Esc.
- At every step: one column at most, one ask box, the header's buttons where they were, no
  overlap, nothing changed is lost.
- Reduced motion on: nothing slides.
- `bun run typecheck`, `bun test tests`.

## Left for later (don't build)

- **Small changes on a faster model.** Not now: FRIDAY's pointed changes already run at low
  effort on the open conversation, where about 89% of what Opus reads is remembered from the
  turn before (measured in the real library, 93 answers). Another model can't use that memory
  and would start from nothing. Deleting, weight, color and words by hand take the smallest
  jobs away from any model.
- Two versions side by side in Compare.
- A Fit / 100% choice in the view menu.
- Moving or resizing a part by dragging.
- Folding versions made in one answer into one row.

## The report

Write `docs/studio-figma-report.md`:

1. **In two sentences**: what the designer can do now that they couldn't.
2. **Per package**: each "Done when" line, with **yes**, **no** or **not checked** and how you
   checked it (Chrome, a test's name, a measured number). A picture for each of: the header
   with FRIDAY showing and folded, the view menu, Directions, Versions, a selected part with
   Knobs on it, the ask bar with a chip. Save pictures in `.copy/` as `studio-*.jpg`.
3. **What differs from this plan**, and why.
4. **Files changed**, one line each.
5. `bun run typecheck` and `bun test tests`: the last lines of each.
6. **What you'd want the designer to look at first** on `http://localhost:4737/?project=dd1283fa655a45c5`.
7. FRIDAY messages sent, and how many.
