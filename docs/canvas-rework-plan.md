# The canvas, reworked: a plan to hand to another Claude session

Written 11 Nov 2026, after reading the canvas code, the history of the designer's three real
projects (read only) and using the HUJJAT canvas on a copy. Line numbers are as of commit
`7a23bb9` plus the uncommitted work in the tree; `web/src/Canvas.tsx`, `web/src/canvas.css`,
`server/projects.ts` and `server/board.ts` had no uncommitted changes when this was written.

Read all of this and `CLAUDE.md` before touching anything. Read `unugly.md` before designing
anything you can see. Work through the packages in order. When you finish (or have to stop),
write the report described at the end and stop: another session will read it and check
everything you did.

This job calls Claude **zero** times: no FRIDAY messages, no design reads, no builds.
Everything FRIDAY does on a canvas can be tried by calling Panel's own tools directly, the way
`tests/search.test.ts` and `scripts/measure-search.ts` do.

## Why this work

A project's canvas ([Canvas.tsx](../web/src/Canvas.tsx)) is where the designer works out a
design: **topics** for the decisions (Typography, Color…), the **saves** considered under each
(suggested, kept, chosen, ruled out), **notes**, **sketches**. FRIDAY (the assistant) reads the
decisions and the designer's reasons and builds from them.

What the three real projects show (66 saves, 12 topics, 408 logged changes):

| What happened | Count |
|---|---|
| Things FRIDAY put on the canvases | 193 |
| Things the designer put there | 33 |
| Times the designer moved something | 202 |
| Times the designer removed something | 116 (62 of them saves FRIDAY had suggested) |
| Saves still marked "Suggested" (never judged) | 53 of 66 |
| Saves ruled out | 2 |
| Reasons the designer ever gave | 1 |

So the canvas is meant to capture decisions and reasons, and in practice FRIDAY fills it and
the designer tidies up after it. Four things are wrong:

1. **Saying no teaches nothing.** The designer removes what they don't want. A removed card
   leaves no trace, so `get_verdicts` and `get_project` never hear of it and FRIDAY can
   suggest the same save again.
2. **Saves don't stay with their topic.** Dragging a topic moves only the topic. On HUJJAT
   the designer lined the topics up in a row and the saves stayed behind: Direction's 14
   saves now sit about 3,000 units below it, on long lines that cross other cards.
3. **Zoomed out, the canvas can't be read.** HUJJAT is about 6,700 × 4,500 units. "Show
   everything" stops at the zoom-out limit (0.15), so with FRIDAY's panel open a third of the
   canvas is behind the panel. At that zoom a topic is 37 × 11 px on screen and looks like
   any other box. Pan away and the canvas is blank, with nothing to say where things are.
4. **The tools above a card are heavy**: eight labelled buttons, 645 px wide, covering
   whatever is above the card.

## Decisions already made (don't reopen them)

- **Removing a suggestion is remembered** as a quiet "no", with a reason if the designer
  gives one. It is weaker than "ruled out": FRIDAY must not bring that save back to that
  topic, and must not read a taste into it unless there is a reason.
- **Ruled-out saves fold away under their topic** at once, behind a small "3 ruled out" on
  the topic, the way a locked topic already folds what wasn't chosen. This is what makes
  ruling out as tidy as deleting. Folding stays for saves only, not sketches.
- **A review mode** steps through FRIDAY's suggestions one at a time, large, with one key
  each. The reasons sit right beside the picture there.
- **On the canvas itself the "why?" strip stays where it is** (above the dock), and judging a
  suggestion still moves on to the next one. Don't hang the reasons on the card.
- **A topic carries its family when dragged.** Positions stay absolute in the database; there
  are no parent/child nodes (the real app, on older code, must keep drawing the same canvas).
- **Nothing rearranges itself.** Cards move only when the designer drags or presses Tidy.
- **No new dependency.** React Flow already has what is needed (`MiniMap`, `useStore`).

## Rules for this job

- Follow `CLAUDE.md`. Never touch `~/DesignLibrary` or port 4646. Never `bun run build` or
  `bun run start`. Don't restart the real app. Don't commit.
- Other sessions are editing this folder right now (`server/index.ts`, `server/chat.ts`,
  `server/mcp-tools.ts`, `web/src/App.tsx`, `web/src/api.ts` and more hold changes that are
  not yours). Never `git stash`, `git checkout`, `git reset` or reformat. In those files
  change only the lines this plan needs.
- **Use your own copy and port**, because another session is using `.copy/lib` on 4747 and
  you will be judging and deleting cards:
  - `cp -Rc .copy/lib .copy/lib-canvas` (a clone, nearly free on disk), then
    `sqlite3 .copy/lib-canvas/library.sqlite "pragma integrity_check"` must say `ok`.
    Don't run `scripts/copy.sh` at all, with or without `--build`: it writes into folders
    other sessions are serving.
  - Build the UI with `bunx vite build --outDir .copy/dist-canvas --emptyOutDir`.
  - Add one line to `.claude/launch.json`: `panel-copy-canvas`, port **4777** (another free
    port if that one is taken; say which in the report), with
    `PANEL_LIBRARY_DIR=.copy/lib-canvas` and `PANEL_DIST=.copy/dist-canvas`.
  - If you need the canvases back as they were, delete `.copy/lib-canvas` and clone again.
- The database may only gain things (a new table, a new field inside a node's `data`). The
  real app on older code, and Claude Code's `panel` MCP server on this code, share the real
  library: both must keep working. Never rename, drop or rewrite in place.
- Words on screen, comments and errors in plain language that says what happens ("Removed 3
  suggestions"), not how. Comments say why, in full sentences.
- Grayscale, Inter, quiet. Reuse classes in `styles.css` and `canvas.css` before adding new
  ones; corners use `corner-shape: var(--corner)`. Every new motion respects
  `prefersReducedMotion()` and the `prefers-reduced-motion` blocks at the end of `canvas.css`.
- Icons: use one already in [Icon.tsx](../web/src/Icon.tsx). Add one only when none fits.
- If the code turns out different from what this plan says, do the sensible thing and write
  it under "Done differently" in the report. If a package can't be finished, leave the
  canvas working, say exactly where it stands, and go on to the next only if it doesn't
  depend on the unfinished part.

## Before changing anything

1. `bun run typecheck` and `bun test tests`. Write down what passes and fails **now**. A
   test that already fails is not yours to fix; report it.
2. `PANEL_PORT=4799 PANEL_LIBRARY_DIR=.copy/lib-canvas bun scripts/measure-search.ts 2>/dev/null | grep TOOLS`
   and write the number down. It is how long the tool descriptions are; every FRIDAY message
   pays for them.
3. Open HUJJAT on your copy (`http://localhost:4777/?project=ff46e4430ced4d69`) at a
   1440 × 900 window and look at it: press "Show everything" with FRIDAY's panel open and
   closed, select a save, press X, press ⌘Z.

---

## Package 1: saying no counts

### 1a. A record that outlives the card (`server/projects.ts`)

New table, created like the others at the top of the file:

```sql
CREATE TABLE IF NOT EXISTS board_turned_down (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,            -- ref · sketch
  ref_id TEXT,                   -- the save, for a ref
  node_id TEXT NOT NULL,         -- the card it was, so undo can take the record back
  topic_id TEXT,                 -- the topic it sat under, if any
  topic TEXT NOT NULL DEFAULT '',-- that topic's name at the time
  title TEXT NOT NULL DEFAULT '',-- a sketch's title
  was TEXT NOT NULL,             -- proposed (a suggestion nobody judged) · ruled_out
  reason TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL
);
```
with indexes on `project_id` and `ref_id`.

In `apply()` ([projects.ts:219](../server/projects.ts:219)):

- **`remove_node`**: write a record when all of these hold: the actor is the designer; this
  change is not an undo (`opts.undoOf` is empty); the node is a save or a sketch; its state
  is `proposed` or `ruled_out`. Carry over `data.reason` if it has one. The topic is the
  first topic joined to it by a line (read the lines before the node is deleted).
- **`add_node`**: when a node arrives with an id that a record has as `node_id`, delete that
  record (this is how ⌘Z brings a card back without leaving a "no" behind). When the
  **designer** adds a save that has records in this project, delete those too: they brought
  it back themselves.

Nothing else about removing changes: a kept or chosen card that is removed leaves no record.

New route, next to the other project routes ([index.ts:743](../server/index.ts:743)), already
covered by the `fromPanel` guard on `/api/projects`:
`POST /api/projects/:id/turned-down` with `{ nodes: string[], reason: string }` sets the
reason (400 characters at most) on this project's records with those `node_id`s and answers
`{ ok: true, n }`. Add `projectApi.whyRemoved(id, nodes, reason)` to `web/src/api.ts`.

### 1b. FRIDAY hears about it

- **`verdicts()`** ([projects.ts:464](../server/projects.ts:464)): records that were
  `ruled_out`, and records with a reason, count as ruled out (in `ruled_out` and in
  `by_reason`). Records that were `proposed` and have no reason are counted apart as
  `suggestions_removed`, with up to 12 of the latest as lines like
  `save <id> “<title>” (HUJJAT, under Color)`. Add one sentence to `how_to_read`: these are
  suggestions the designer took off a canvas without saying why; a weak no; don't suggest
  them again for that topic; don't read a taste into them.
- **`verdictReasons()`**: reasons given on records count toward the five offered.
- **`summary()`** ([projects.ts:509](../server/projects.ts:509)): each topic gains
  `removed_by_designer: [{ id, title, reason? }]` (records whose `topic_id` is this topic);
  records with no topic go in a top-level list of the same name. One sentence in
  `how_to_read`.
- **`placeOnBoard()`** ([board.ts:114](../server/board.ts:114)): a save with a record under
  the **same topic** of this project is not placed. Return those as
  `removed_before: [{ id, reason? }]` with a note: "The designer took these off this topic
  before. They can drag one back in from Saves."
- **`server/chat.ts`**, the line that starts "The designer's reasons for choosing and ruling
  out are their taste" (about line 301): add one clause saying removed suggestions are in
  `get_project` (`removed_by_designer`) and `get_verdicts`, and are not to be brought back.
  Nothing else in that file.
- **`server/mcp-tools.ts`**: add no parameters. Touch a description only if it is now wrong.
  The `TOOLS` number must not grow by more than 150 characters.

### 1c. On the canvas (`web/src/Canvas.tsx`, `web/src/canvas.css`)

- **After removing suggestions**, the strip above the dock asks why. In `remove()`
  ([Canvas.tsx:878](../web/src/Canvas.tsx:878)), if any removed card is a save or sketch that
  was `proposed`, or `ruled_out` with no reason, show the strip as "Removed 3 suggestions ·
  why?" with the ruled-out reasons (1–5, or their own words). A reason there goes to
  `projectApi.whyRemoved`, not to `patchMany` (the cards are gone). No reason is needed; it
  steps aside by itself as now.
- **Ruled-out saves fold away.** Generalize the fold
  ([Canvas.tsx:939](../web/src/Canvas.tsx:939)): under **any** topic, saves marked ruled out
  hide unless that topic is opened; under a locked topic everything not chosen hides, as
  now. The topic's small button reads "3 ruled out" / "Fold 3 ruled out" while exploring,
  and "+5 considered" / "Fold 5 considered" when locked, as now. A ruled-out save under no
  topic stays in view, greyed. The existing fold motion is reused. Selection never stays on
  a hidden card.
- **Two bugs in the strip**: ⌘Z after a verdict leaves "why?" on screen, and a reason picked
  then is written onto a card that is no longer ruled out
  ([Canvas.tsx:825](../web/src/Canvas.tsx:825), [:1067](../web/src/Canvas.tsx:1067)). ⌘Z
  clears the strip; a reason is only written to cards that still have that verdict.

### 1d. Review: one suggestion at a time, large

A new file, `web/src/Review.tsx` (with its styles in `canvas.css`), opened from the canvas.

- **Getting in**: a "Review 12" button in the canvas's part of the dock
  ([Canvas.tsx:1870](../web/src/Canvas.tsx:1870)), shown only while there are suggested saves
  or sketches (the number is how many). The note that says what FRIDAY just placed
  ([Canvas.tsx:1324](../web/src/Canvas.tsx:1324)) gains a "Review" button beside "Undo". The
  key **R** opens it when nothing is being typed.
- **What it shows**: over the canvas (inside the canvas's own area, so FRIDAY's panel beside
  it stays usable; the look of `.sk-sheet` is the model), one suggestion at a time:
  - its picture as large as fits, whole, never cropped. A save's large picture is not on its
    card (`RefCard` has only the thumbnail): fetch the save with `api.ref(id)` and use its
    first picture's `url`; for a video, its picture with a small play mark. A sketch shows
    its picture (`sketchPicture`).
  - beside it, at reading size: the topic it is under ("Under Color"), FRIDAY's why
    (`taking`, or a sketch's `tries`), its title, its palette, and "3 of 12".
  - the choices, each with its key shown: **Keep** (K), **Choose** (C), **Rule out** (X),
    **Skip** (→ or Space), **Back** (←), **Open** (O: the save in Detail, the sketch in the
    studio), **Done** (Esc).
- **How it moves**: Keep moves on at once. After Choose or Rule out, the five reasons appear
  right there (1–5, or their own words and Enter); a reason, → or any verdict key moves on.
  ⌘Z takes back the last verdict and steps back to that card.
- **Order**: topic by topic, left to right as they sit on the canvas; inside a topic, top to
  bottom then left to right; cards under no topic last. The list is fixed when Review opens;
  a card removed meanwhile is skipped.
- **The end**: "That's all of them", with the count of each ("4 kept · 1 chosen · 3 ruled
  out"), and it closes.
- Every verdict goes through the canvas's own `judge` and `giveReason`, so undo, the live
  stream and the fold all behave as on the canvas. While Review is open the canvas's own keys
  are off, the way they are while the studio is open (`viewingRef`).
- Moving between cards is a short cross-fade; none with reduced motion.

### Tests (new file `tests/canvas.test.ts`; see the "projects" tests in `tests/smoke.test.ts` for how saves are seeded and `tests/search.test.ts` for calling tools)

1. The designer removes a suggested save: a record exists, `was` is `proposed`, with its topic.
2. ⌘Z (the undo route) brings the card back and the record is gone.
3. Removing a kept save leaves no record.
4. Removing a save ruled out with a reason leaves a record with that reason.
5. The reason route sets the reason; `/api/projects/reasons` then offers it.
6. `place_on_board` skips a removed save under the same topic and lists it in
   `removed_before`; under another topic it is placed.
7. `get_verdicts` shows `suggestions_removed` and counts a reasoned record in `by_reason`.
8. `get_project` shows `removed_by_designer` under the topic.
9. The designer adding that save again clears its records.

### Done when (on your copy, HUJJAT, 1440 × 900)

- Select a suggested save, press Backspace: the strip says "Removed a suggestion · why?";
  press 1; `sqlite3 -readonly .copy/lib-canvas/library.sqlite "select was, reason, topic from board_turned_down"`
  shows the row with the reason. ⌘Z: the card is back and the row is gone.
- Press X on a save under Color: it folds into the topic, which now says "1 ruled out";
  clicking that shows it again, greyed. ⌘Z brings it back as it was and the strip is gone.
- Review opens with the right count, every key works, a reason given there is on the card
  afterwards, ⌘Z steps back, the last card ends on the summary.
- All nine tests pass; `TOOLS` grew by 150 characters at most.

---

## Package 2: a topic holds its saves

### 2a. A topic's family

One function in `Canvas.tsx`, used by dragging, Tidy and the far view: the family of a topic
is everything reachable from it along lines, without passing through another topic and
without following a line labelled `uses` (a sketch's "took from this save" line), and leaving
out any card that is joined directly to a second topic (it belongs to both, so it stays put).
That covers the topic's saves, the notes on the topic and on those saves, its sketches, the
sketches branched from them and their build cards.

### 2b. Dragging a topic brings its family

- Dragging a topic moves its family by the same amount, live, including cards that are
  folded away. Several topics dragged together bring all their families.
- Holding **Option** when the drag starts moves the topic alone.
- When the drag ends, every card that moved is sent in **one** change, so one ⌘Z puts the
  whole family back ([Canvas.tsx:1213](../web/src/Canvas.tsx:1213) sends only the dragged
  cards today).
- A card that is itself selected and dragged is not moved twice.

### 2c. Tidy

A **Tidy** tool on a topic's toolbar ([Canvas.tsx:266](../web/src/Canvas.tsx:266)), shown when
the topic has two or more saves. It lays out the topic's saves, and only them and the notes
on them, beneath the topic:

- three columns, 236 apart, starting at the topic's left edge minus 4 and 64 below the
  topic's bottom (the same grid `slotsUnder` uses, [board.ts:84](../server/board.ts:84));
- order: chosen, kept, suggested, ruled out; inside each, the order they read in now (top to
  bottom, then left to right);
- a note that is only about one save goes directly beneath that save, in its column;
- each row is as tall as its tallest column (use the cards' measured heights), plus 44;
- folded cards get their places too, so unfolding doesn't land them on top of others.

All of it is one change (one ⌘Z). The cards glide to their places (about 0.4 s; none with
reduced motion), and the view glides to show the family if part of it is out of sight.
Sketches, build cards and notes on the topic itself are not moved. If the tidy block lands on
something outside the family, leave it and say so in the report: the designer can drag the
topic, and now the family comes along.

### 2d. Lines pass behind cards

On HUJJAT, lines are painted over cards they cross. Find out why (look at how React Flow
orders `.react-flow__edges` and the nodes, and at selected lines), and make lines pass behind
every card except while a line is selected or hovered. If they already do and what was seen
was something else, say what it was.

### Done when

- Drag the Direction topic 300 px to the right: its 14 saves and their notes move with it,
  the same distance. `select count(*) from project_events` grew by exactly 1. One ⌘Z puts
  everything back.
- The same with Option held: only the topic moves.
- Tidy on Direction: its saves sit in three columns under it, none overlapping another, in
  the stated order; one ⌘Z undoes it.
- No line is drawn over a card it merely crosses.

---

## Package 3: a canvas you can read from far away

### 3a. "Show everything" shows everything

- The zoom-out limit goes from 0.15 to 0.05 ([Canvas.tsx:1283](../web/src/Canvas.tsx:1283)).
- **Shift+1** shows everything, **Shift+2** zooms to what is selected (a selected topic: its
  whole family), **Shift+0** goes to 100% around the middle of the view. These are the keys
  the designer knows from Figma. Not while typing, not while Review or the studio is open.
- Beside the "Show everything" button in the dock, a small readout of the zoom ("62%");
  clicking it goes to 100%.

### 3b. The far view

Below a zoom of about 0.4 the canvas wears a class (`far`), and CSS changes how things are
drawn. Read the zoom with `useStore` reduced to a yes/no, so the canvas redraws only when it
crosses the line. Keep the live zoom in a CSS variable on the canvas's wrapper, set straight
on the element as the view moves (not through React state), so sizes can follow the zoom
without redrawing.

- **Topic names stay readable.** Each topic carries a label that keeps a steady size on
  screen (about 13–14 px) however far out the view is: its name, then quietly "9 saves ·
  2 chosen", and "Locked" when it is. Scale it with a CSS `transform` against the zoom, so it
  never changes the card's measured size (changing the size would make React Flow measure
  every topic again on every frame). Cut it off with "…" at the width of the topic's three
  columns, so two neighbours' labels never run into each other.
- **Saves become plain pictures**: their words and palette dots are hidden (keep the room
  they took, so nothing jumps). Their state still reads: chosen has a clear ring, ruled out
  is dim, suggested keeps its dashed outline.
- **Notes** become a quiet block without words. **Lines** get thinner and fainter; lines to
  notes go.
- **Double-clicking a topic** in the far view glides in to its family (it renames the topic
  only in the near view).
- Crossing the line in either direction is a short fade, none with reduced motion.

### 3c. Never lost

- When no card at all is in view, a quiet line in the middle: "Nothing here" with a "Show
  everything" button.
- A small map in the bottom right corner of the canvas (React Flow's own `MiniMap`, which
  comes with the library already installed), shown only while part of the canvas is out of
  view: grayscale, topics darker than saves, the part in view outlined; drag in it to move.
  It must be quiet. If it can't be made to sit well with the dock and FRIDAY's panel at
  1280, 1440 and 1728 wide, leave it out and say so.

### Done when (HUJJAT, 1440 × 900)

- "Show everything" with FRIDAY's panel open: every card is inside the visible canvas (check
  by measuring: no card's right edge is past the canvas's right edge).
- At that zoom all six topic names can be read, none overlapping, each at 11 px or more on
  screen.
- Zooming in and out across the line shows no jump in any card's position, and no errors in
  the console.
- Pan far away: "Nothing here" appears; its button brings the canvas back.
- Shift+1, Shift+2 and Shift+0 do what they say; the readout matches the zoom.

---

## Package 4: lighter tools, and names for screen readers

- **The toolbar above a card** ([Canvas.tsx:133](../web/src/Canvas.tsx:133), and the four
  toolbars that use `Tool`): the verdicts keep their words (Choose, Keep, Rule out). The rest
  (Sketch, Ask FRIDAY, Note, Open, Rename, Tidy, Remove) become icons alone, each with its
  name on hover and as its `aria-label`, and with a hairline between the verdicts and the
  rest. A save's toolbar must be 440 px wide at most (it is 645 today). The toolbar for
  several selected things follows the same rule.
- **Every card has a name** for screen readers and for tools that read the page (today they
  are all an unnamed "group"): "Topic: Color, exploring", "Save: <title>, suggested", "Note:
  <its first words>", "Sketch: <title>, kept", "Build: <title>". React Flow nodes take an
  `ariaLabel`.

### Done when

- A selected save's toolbar is 440 px wide or less, and every icon says what it is on hover.
- Reading the page's tree lists the cards by name.

---

## When all four are in

- `bun run typecheck` and `bun test tests` pass (apart from anything that failed before you
  started).
- The walk, on your copy, at 1280, 1440 and 1728 wide, light and dark, FRIDAY's panel open
  and closed: open HUJJAT → Show everything → double-click Color to glide in → rule one out
  with a reason (it folds) → remove a suggestion and say why → Review the rest, a few with
  reasons, one ⌘Z → Tidy Color → drag Color somewhere else → ⌘Z until the canvas is back as
  it was. Nothing overlaps the dock or FRIDAY's panel; nothing jumps; no errors in the
  console.
- With reduced motion on, nothing slides or fades.
- Open CRM and NavTech too: nothing about them looks broken.
- **The older app still draws the canvas.** Until it is restarted, the real app runs the
  code as it was, against a database that Claude Code's `panel` tools (on your code) also
  write to. You can't run the old code here (never `git stash` or `git checkout`), so
  confirm it by reading `git show 7a23bb9:server/projects.ts` and
  `git show 7a23bb9:web/src/Canvas.tsx`: the old code must be able to ignore the new table,
  and nothing you now store in a card's `data`, a line or a logged change may be something
  the old `cleanData`, `applyRemote` or `toFlow` would trip over. Say what you checked.
- Update the "Projects: a canvas per piece of work" part of `README.md` (from about line 162)
  in the designer's plain words: removing a suggestion is remembered, ruled-out saves fold
  away, Review, a topic carries its saves, Tidy, the far view and its keys. Change only that
  part.

## The report

Write `docs/canvas-rework-report.md`. Another session will check your work from it, so say
what is true, not what was hoped: a thing that was not tried in the browser is "not tried",
a check that failed is shown as failed with what you saw.

1. **Where it stands**: one line per package: done · partly (what is missing) · not started.
2. **What changed**, file by file, a line or two each. New files named.
3. **Done differently from the plan, and why.** Every place, however small.
4. **Each "Done when" line, copied from this plan, with its result**: pass or fail, and the
   thing you measured (the row from the database, the width in px, the count of events, the
   zoom). For anything judged by eye, say what you saw at which window width.
5. **Numbers**: `TOOLS` before and after; typecheck; the tests' output line (how many pass),
   before and after; the nine new tests by name.
6. **The database**: the exact `CREATE TABLE` you added, and what you checked about the older
   app still working beside it.
7. **How to see it**: the address and port, and anything that must be started first. Say
   what state you left `.copy/lib-canvas` in (which cards you judged or removed and did not
   undo).
8. **Doubts and what you'd look at first** if you were the one checking: the parts you are
   least sure of, anything that felt wrong in use, anything left ugly.
9. **For the designer**: three plain sentences on what is different, then: that the real
   Panel on 4646 keeps the old canvas until it is restarted, that nothing was committed, and
   that until the restart nothing is remembered about removed suggestions.

## Not in this job

- Search by meaning or filters in the Saves tray, and the tray covering cards beneath it.
- Folding sketches under locked topics.
- Arranging a whole canvas at once, or anything that moves cards without being asked.
- A way for FRIDAY to bring a removed save back by itself.
- Larger pictures on the cards themselves; a quick look with Space.
- Anything in the studio, FRIDAY's panel or the library page.
