# The studio, reorganized: a plan to hand to agents

Written 10 Nov 2026, after looking at the studio on the 4747 copy with FRIDAY open.
Line numbers are as of commit `998dfb0` plus the uncommitted work in the tree.

**The studio** is the full-size view of one sketch ([Studio.tsx](../web/src/Studio.tsx)). Beside
the page it can show **Knobs** (the sketch's colors, fonts and sizes as swatches and sliders,
[Knobs.tsx](../web/src/Knobs.tsx)), **Directions** (the sketches branched from this one), and
**Compare** (two or three directions side by side, [Compare.tsx](../web/src/Compare.tsx)).
**FRIDAY** is the assistant's panel on the right edge of the window
([Assistant.tsx](../web/src/Assistant.tsx)); it belongs to the app, not to the studio.

## What is wrong today

On a 1500px-wide window with FRIDAY open, the studio gets 1066px. Everything below was seen
there.

| # | What the designer sees | Why |
|---|---|---|
| 1 | After Compare, the page shrinks to a 200px thumbnail ("1440×1440 · 14%") and stays that way. | The page's room is measured by an observer attached once, when the studio opens ([Studio.tsx:127](../web/src/Studio.tsx:127)). Compare removes the stage from the page ([Studio.tsx:387](../web/src/Studio.tsx:387)); when it comes back it is a new element nobody is measuring, the old one reports 0×0, and line 138 clamps that to 200. Reproduced: open a sketch that has other directions, press Compare, press Knobs. |
| 2 | "Rule out" slides under "Build with Claude Code"; the title is cut to "Hero (EN): the sig…". | The header shows every label from 1081px up ([studio.css:295](../web/src/studio.css:295)), but with every label it needs 1112px with a short title and about 1360px with a long title and its second line. Between those widths it overflows, and that is exactly where the studio sits when FRIDAY is open. |
| 3 | Knob changes vanish without a word. | `edits` is emptied whenever the page's address changes ([Studio.tsx:201](../web/src/Studio.tsx:201)): stepping to another version, FRIDAY delivering a new version, switching direction. Esc also closes the studio with changes pending ([Studio.tsx:265](../web/src/Studio.tsx:265)). |
| 4 | Three columns: page, Knobs, FRIDAY. The page is at 55% and the thing being tuned is the smallest thing on screen. | Knobs (276px) and FRIDAY (408px or more) each take their own column; nothing stops both. |
| 5 | Two boxes to ask FRIDAY, both about this sketch: the bar under the page and FRIDAY's own. | The studio's bar ([Studio.tsx:600](../web/src/Studio.tsx:600)) doesn't know FRIDAY's panel is open. And asking from the bar always opens the panel ([App.tsx:310](../web/src/App.tsx:310)), which resizes the page mid-thought. |
| 6 | Knobs, Directions, Compare and Point switch each other off in ways that are hard to predict. | Four separate on/off flags with one-off rules between them ([Studio.tsx:299](../web/src/Studio.tsx:299), [:341](../web/src/Studio.tsx:341), [:345](../web/src/Studio.tsx:345)). |
| 7 | Compare leaves the bottom half of the screen empty. | A laptop page is capped at 1200px tall ([Compare.tsx:86](../web/src/Compare.tsx:86)); at the 37% scale two columns get beside FRIDAY, that is 445px of a 780px column. |
| 8 | Compare's row of names runs off the edge. | Full titles as chips in one row ([Compare.tsx:97](../web/src/Compare.tsx:97)). |
| 9 | Knobs is one long list: no sign of what was changed, no way to put one knob back, no before/after, no undo. Font fields show a cut-off CSS string. | [Knobs.tsx:165](../web/src/Knobs.tsx:165) onward. |
| 10 | In FRIDAY's box the placeholder wraps to "Ask about / this". Three alternates being made show three large live pictures that push the conversation away. | The model chip shares the row with the text ([Assistant.tsx:1391](../web/src/Assistant.tsx:1391)); each live draft is as wide as the panel ([assistant.css:258](../web/src/assistant.css:258)). |

## The design

Four rules. Everything in the packages below follows from them.

1. **One page, one column beside it.** Knobs, Directions and FRIDAY take turns in the same
   place, at the same width. Opening one folds the other away and closing it brings the other
   back. The page is never squeezed by two columns, and switching between them does not move
   or rescale the page.
2. **One place to ask.** While FRIDAY's panel is showing, the studio's own bar is gone (the
   panel's box already says "On the canvas: this sketch"). While it is folded away, the bar is
   the place, and asking from it does not open anything: the bar itself says what FRIDAY is
   doing.
3. **Nothing the designer changed is dropped silently.** Knob changes wait on their version
   until they are kept or reset.
4. **The header never overlaps itself.** It gives things up in a fixed order as it narrows.

```
 FRIDAY showing                         Knobs showing (FRIDAY folded away)
┌──────────────────────────┬─────────┐  ┌──────────────────────────┬─────────┐
│ ← Title  v8  ▭▯▯   tools │ FRIDAY  │  │ ← Title  v8  ▭▯▯   tools           │
├──────────────────────────┤         │  ├──────────────────────────┬─────────┤
│ states            checks │  chat   │  │ states            checks │ Knobs   │
│                          │         │  │                          │         │
│          page            │         │  │          page            │ colors  │
│                          │         │  │                          │ type    │
│                          │ [ask  ] │  │ [ask FRIDAY: working…  ] │ [Keep]  │
└──────────────────────────┴─────────┘  └──────────────────────────┴─────────┘
        same page width in both. Compare: no column, the pages get all of it.
```

Three choices in this design are the designer's to confirm before package 2 starts. Each has
a recommendation; package 1 does not depend on them.

- **A. Knobs and FRIDAY take turns** (recommended), rather than sitting side by side.
- **B. The studio's ask bar hides while FRIDAY's panel shows** (recommended).
- **C. Unkept knob changes wait quietly on their version, with a dot on the Knobs button**
  (recommended), rather than a "Keep or discard?" question each time the designer leaves.

## Rules for every agent

Read [CLAUDE.md](../CLAUDE.md) and [unugly.md](../unugly.md) first. The ones that bite here:

- Never test on the real app (port 4646, `~/DesignLibrary`). Use the copy: start the
  `panel-copy` server (port 4747) and rebuild its UI with `scripts/copy.sh --build` after
  changing `web/`. Never `bun run build` or `bun run start`.
- The copy's HUJJAT project (`/?project=ff46e4430ced4d69`) has a family of five sketches
  named "Knobs test…": use it for Knobs, Directions and Compare.
- In Claude's built-in browser pane the sketch page stayed white and Knobs stayed on "Reading
  the page…" when this plan was written. Layout can be checked there; anything that needs the
  live page (knobs moving it, pointing, Compare scrolling together) has to be checked in Chrome.
- No FRIDAY messages are needed for any of this. If one is, send one short one.
- `README.md`, `server/chat.ts`, `tests/smoke.test.ts`, `web/src/Assistant.tsx`,
  `web/src/ModelPicker.tsx` and `web/src/assistant.css` have someone else's uncommitted work.
  Build on it; never revert or reformat it.
- `bun run typecheck` and `bun test tests` pass before saying a package is done. Nothing here
  needs a new route, a database change or a new dependency.
- Grayscale, Inter, quiet. Reuse the `st-` classes and the ones in `styles.css`. Corners use
  `corner-shape: var(--corner)`. Anything that moves respects `prefersReducedMotion()`.
- Labels and comments in plain words that say what happens. Comments explain why.
- Commit only when the designer asks.

## The packages

Order: **1**, then **2**, then **3, 4 and 5 at the same time**, then **6**. Packages 3, 4 and 5
touch different files once 2 has landed; the file list in each is the whole of what it may
change.

### Package 1: three bugs, no change to how it looks

Files: `web/src/Studio.tsx`, `web/src/studio.css`.

1. **The page keeps its size after Compare** (row 1). Measure whichever stage element is on
   the page now: a callback ref that moves the observer, or run the effect again when
   `comparing` changes.
   Done when: Compare then Knobs, and Compare then Compare off, both show the page as large
   as before, and the size readout never says 14%.
2. **The header stops overlapping** (row 2), as a stopgap until package 2 rebuilds it: move
   the two thresholds at [studio.css:295](../web/src/studio.css:295) and
   [:302](../web/src/studio.css:302) from 1080/1081 to 1360/1361.
   Done when: with a 60-character title, nothing overlaps at studio widths 1066, 1160, 1300
   and 1474.
3. **Knob changes survive** (row 3). Keep unkept changes per sketch and version in a map that
   outlives the studio closing (it need not outlive a reload of Panel). Coming back to that
   version puts them back on the page (the `hello` handler at
   [Studio.tsx:159](../web/src/Studio.tsx:159) already re-applies whatever `edits` holds).
   When a new version of the same sketch arrives while changes are pending, carry over the
   ones whose variable still exists in the new page. Empty the entry only after "Keep as vN"
   succeeds or Reset. Show a small dot on the Knobs button while the open version has changes
   waiting and the panel is closed.
   Done when: change three knobs, step to the earlier version and back, close the studio and
   reopen it: the three changes are still on the page and in the panel. Keep them: the new
   version opens with nothing pending.

### Package 2: one column, one ask box, a header that fits

Files: `web/src/Studio.tsx`, `web/src/studio.css`, and the few lines of plumbing in
`web/src/Canvas.tsx`, `web/src/App.tsx`, `web/src/Assistant.tsx` named below. Not
`Knobs.tsx`, not `Compare.tsx`.

1. **One state instead of four flags** (row 6). Replace `knobs`, `rail` and `comparing` with
   `view: "one" | "compare"` and `side: "knobs" | "directions" | null`. Pointing only exists
   in `view: "one"`. Choosing Knobs, Directions or Point while comparing goes back to one page.
2. **One column** (row 4, rule 1).
   - The studio needs to know whether FRIDAY's panel is open and be able to open and fold it:
     pass `askOpen` and `setAskOpen` from [App.tsx:838](../web/src/App.tsx:838) through
     Canvas to Studio.
   - In the header, Knobs, Directions and FRIDAY become one three-way switch: the one showing
     is lit, pressing it again closes the column. ⌘J keeps working and stays in step with it.
   - Opening Knobs or Directions folds FRIDAY away and remembers it was open; closing them
     brings it back. FRIDAY keeps answering while folded.
   - Knobs and Directions take FRIDAY's width, not 276/248px. `--chat` is deliberately not
     inherited (see the note at [assistant.css:13](../web/src/assistant.css:13)); add the
     studio's column to the rule `setChatWidth` writes ([Assistant.tsx:575](../web/src/Assistant.tsx:575)).
   - Entering Compare folds whatever column is open and leaving brings it back. The switch
     still works there if the designer wants FRIDAY beside the comparison.
   Done when: with FRIDAY open, pressing Knobs, Directions and FRIDAY in turn never shows two
   columns, and `.st-stage` keeps the same width (within 1px) before, during and after each
   switch.
3. **One ask box** (row 5, rule 2).
   - FRIDAY's panel showing: the studio's bar is not rendered. Its "Alternates" button moves
     to the thin row above the page (`.st-bar`), at the right.
   - FRIDAY folded: the bar shows, and sending from it must not open the panel. Give
     `askWith` ([App.tsx:310](../web/src/App.tsx:310)) a way to ask without opening, and use it
     from the studio's bar and from the point bubble. While FRIDAY works, the bar reads
     "FRIDAY is working on it…" as now, with a button that opens the panel. Better, if it
     comes cheaply: show FRIDAY's current step there ("Sketching Header alt…"), which means
     Assistant reporting its step label upward the way it reports `onRunning`.
   Done when: there is never more than one box to type to FRIDAY in, and asking from the bar
   with Knobs open leaves Knobs open and the page where it was.
4. **The header** (row 2, rule 4). Three groups: what this is (back, title, version), how it
   is seen (the three screens, Point, Compare, the column switch), what to do with it (Choose,
   Rule out, Build). As it narrows it gives up, in this order: the second line under the
   title; the words on Choose and Rule out; "with Claude Code"; the words on Point and
   Compare; the words on the column switch; "of 8". It never gives up: back, the title (at
   least 120px, then an ellipsis), the version, the screens, Build. Decide the steps from
   what actually fits (watch the header's own width against its content), not from fixed
   numbers that go stale when a label changes.
   Done when: with a 60-character title, nothing overlaps or is cut off other than the title's
   own ellipsis at every studio width from 640 to 2000px. Check 640, 760, 900, 1066, 1160,
   1300, 1474.
5. **The page and its frame move together.** `.st-device` animates its size over 0.35s
   ([studio.css:92](../web/src/studio.css:92)) but the page inside jumps to its new scale at
   once. Either both glide or neither does.

Before packages 3 to 5 start, show the designer the result on 4747 at window widths 1280,
1500 and 1728, FRIDAY open and folded.

### Package 3: Knobs worth using

Files: `web/src/Knobs.tsx`, the Knobs block of `web/src/studio.css`
([:177](../web/src/studio.css:177) to [:198](../web/src/studio.css:198)), and only the knob
functions in `web/src/Studio.tsx` (`turn`, `resetKnobs`, `keepKnobs`).

- **What changed is visible.** A changed knob gets a dot by its name; pressing the dot puts
  that one knob back. The footer says "3 changed" beside Reset and "Keep as vN".
- **Before and after.** A "Before" button in the footer: while it is held, the page shows the
  version as it was; letting go shows the changes again. (Send `set` with nulls, then the
  edits again.)
- **Undo.** ⌘Z and ⇧⌘Z step through knob changes while the studio is open and the cursor is
  not in a text field (the canvas already leaves the keys alone then,
  [Canvas.tsx:838](../web/src/Canvas.tsx:838)). One drag of a slider is one step. Trying on a
  palette is one step.
- **Groups fold.** Colors, Type, Shape and space each have a header with a count, fold on a
  press, and stay as they were left.
- **Fonts read as names.** The field shows the first family ("Inter"); the whole list appears
  when it is being edited. Offer the families the page's other font knobs already use.
- **Sliders take a number.** The value on the right can be typed into; arrow keys step it,
  with Shift ten times as far. Double-click the slider to put it back.
- **Palettes.** The one being worn is marked.
- **Never "Reading the page…" forever.** If the page hasn't answered a few seconds after it
  loaded, say so and offer Reload.

Done when: every item above works in Chrome on a "Knobs test" sketch with FRIDAY open and
folded, by keyboard as well as mouse, and nothing in the panel is cut off at the column's
narrowest (340px) or widest (720px).

### Package 4: Compare

Files: `web/src/Compare.tsx`, the Compare block of `web/src/studio.css`
([:200](../web/src/studio.css:200) to [:222](../web/src/studio.css:222)).

- **The pages fill their columns** (row 7). Package 2 gives Compare the full width, which
  already helps. Then raise the cap at [Compare.tsx:86](../web/src/Compare.tsx:86) so a laptop
  page is as tall as its column allows, between 900 and 1600px. The cap exists so a hero sized
  by the screen's height isn't stretched: check with one (the copy's "Landing, four sections
  (EN)") that it still looks like itself.
- **Pick directions in the columns, not in a strip** (row 8). Each column's title becomes a
  menu of the family to put another direction in that place; a quiet "Add a third" sits after
  the last column, and a column can be closed down to two. The chip row goes, and the pages
  get its 40px.
- **A verdict here asks why**, the same small box as in the single view
  ([Studio.tsx:624](../web/src/Studio.tsx:624)). Today Choose and Rule out in Compare save
  with no reason ([Compare.tsx:118](../web/src/Compare.tsx:118)).
- Three columns are only offered when each would be at least 380px wide.

Done when: with five directions with long names, nothing runs off the edge at studio widths
900, 1066 and 1474; pages scroll together and change state together as before.

### Package 5: FRIDAY's panel beside the studio

Files: `web/src/Assistant.tsx`, `web/src/assistant.css` (both carry uncommitted work: build
on it).

- **The box to type in** (row 10). When the panel is narrower than about 420px, the model
  chip and Send sit on a row of their own under the text, so the placeholder and the
  designer's words get the full width.
- **Live pictures stay small when there are several** (row 10). One sketch being drawn: as
  now, but no taller than about 180px. Two or more at once (alternates): one row of small
  pictures, each labelled by its step, so the conversation stays in view.

Done when: at panel widths 340, 408 and 560 the placeholder never breaks into two-word lines,
and three alternates being made fit in one row without pushing the last message out of view.
(This one needs one real FRIDAY message asking for alternates. Send it once.)

### Package 6: look it all over

No new work: one agent, in Chrome on 4747, after 3 to 5 are in.

- Window widths 1280, 1500, 1728; sidebar tucked and open; FRIDAY open, folded and dragged to
  its widest. Light and dark.
- The walk: open a sketch → Knobs, change four things, Before, undo twice → step a version
  back and forward → Compare → pick another direction in column B → back to one page → ask
  for a change from the bar with Knobs open → Keep as a new version → Choose with a reason →
  Esc.
- At every step: one column at most, one ask box, no overlap in the header, the page never
  at 14%, nothing changed is lost.
- Reduced motion on: nothing slides.
- `bun run typecheck`, `bun test tests`.
- Report with pictures of each width. Then ask the designer before restarting the real app.

## Left for later

- A Fit / 100% switch on the page's size readout, to judge type at its real size.
- Choosing fonts from the ones measured in the project's saves.
- Keeping unkept knob changes across a reload of Panel.
