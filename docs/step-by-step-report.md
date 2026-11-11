# FRIDAY makes a whole thing step by step: report

Carried out from [step-by-step-plan.md](step-by-step-plan.md) on 12 Nov 2026, on my own copy
(`.copy/lib-steps`, UI in `.copy/dist-steps`, server `panel-copy-steps` on port **4707**).
Nothing committed, the real app not touched or restarted.

## 1. In two sentences

Asked for a whole new website or poster, FRIDAY now follows a recipe one decision at a time
(sections as a gray wireframe, words, the gem, color, type, hero, motion, whole page), asks with
buttons the designer presses, and locks each agreed step on the canvas, with a row in its panel
showing where the project stands. A drawing or picture in a sketch can now be kept as a real
brand asset (Keep in the studio, or FRIDAY's `keep_part`), so later sketches and builds use the
real file instead of redrawing it.

## 2. Per package

Pictures are in `.copy/`, named `steps-*.jpg`.

### Package 1: recipes and steps

| Done when | | How I checked |
|---|---|---|
| Both recipes read; Website and Poster steps in order; Color, Typography, Motion carry facets; no `Topic:` line left; Sections holds the wireframe (`class="wf-row"`), no `{{file` anywhere | **yes** | `steps.test.ts`: "both are read…", "the steps' facets come from their Topic: lines" |
| `get_recipe` with nothing / a name / a step | **yes** | same tests; also an unknown recipe or step lists what there is |
| start → Sections now with its topic; done → locked, Words now, Sections leads to Words; Words skipped → Gem now, empty Words topic gone; Sections now → reopened, Gem waiting; stop → route says stopped; start again → on, states kept | **yes** | "start, done, skipped, back, stop and start again" |
| A locked Color topic → Color starts done with its decision | **yes** | "a locked Color topic already on the canvas starts as done" |
| Plain errors: no decision, unknown step, second recipe | **yes** | "plain errors…" (also: a project not going step by step) |
| Undo after `set_step` done takes the lock back: one change, one undo | **yes** | "undo after a step is done…": one logged change labelled "Locked Sections, added Words after Sections"; one undo reopens Sections and takes Words off |
| `set_step` skipped on a waiting step leaves now as it is | **yes** | "skipping a waiting step…" (and done on a waiting step locks a topic of its own, now stays) |
| A library opened by this code still opens with the code at `76e158d` | **yes** | throwaway `git worktree` of `76e158d` in my scratchpad, run on port 4791 against a copy of `.copy/lib-steps` (with both new tables and a `wire` sketch): health, projects, the wireframe's sketch info, the test conversations and brand assets all load, no errors in its log. Worktree removed after. |

### Package 2: FRIDAY follows the steps

| Done when | | How I checked |
|---|---|---|
| `tests/duo.test.ts` passes, with a test for what moved | **yes** | the `allow` lists moved to `duo.ts` (`oneModelAllows`, `plannerAllows`, `builderAllows`); new tests "which tools each run may use" (4) |
| `systemPrompt()` holds the section with both recipes; with no recipes the section is gone and nothing else changed | **yes** | rendered `systemPrompt("solo")` on the copy twice, the second time with `PANEL_RECIPES_DIR` pointing at an empty folder (see section 4): the text without recipes equals the text with recipes minus the section, exactly. Both recipes listed (`  - Poster: …`, `  - Website: …`). |
| Size of `SYSTEM` | | **10,854 → 13,491 characters** (+2,637). Filled in, the section is 2,798 characters. |
| The live checks | see section 3 | |

### Package 3: wireframes

| Done when | | How I checked |
|---|---|---|
| `make_sketch` kind wireframe with the recipe's page → `wireframe: true`, no `rule_checks`; card has `wire: true`; `edit_sketch` the same; `get_project` says it is a wireframe; the same page without `kind` still gets its checks | **yes** | `tests/wireframe.test.ts` (2 tests). Also: no rule findings in the studio's versions, `get_sketch` says `wireframe: true`, a sketch made *from* a wireframe isn't one. |
| On the copy, the card and the studio say "Wireframe" | **yes** | `steps-wireframe-card.jpg` ("Wireframe · the order of the sections"), `steps-wireframe-studio.jpg` (see section 4 on the studio title) |
| `wireframe.html` rendered at desktop and phone | **yes, one fix** | Desktop fine. On a phone the navbar row couldn't wrap and pushed the gray block past the right edge; fixed only that, in its phone rules (`min-width: 0` on the row's two parts, a narrower block, wrapping navbar). Looks the same otherwise. |

### Package 4: questions with buttons, and the steps row

| Done when | | How I checked |
|---|---|---|
| The row shows on a project going step by step, states match `stepsOf` | **yes** | `steps-row.jpg`; headless Chrome read the row's words against the route |
| One question and four, waiting and answered, drawn right | **yes** | `steps-question-one-waiting.jpg`, `steps-questions-four-waiting.jpg`, `steps-questions-four-marked.jpg` (three marked, Send waiting for the fourth), `steps-questions-answered.jpg` (older answers: questions as text, choices as one quiet line) |
| Pressing a choice sends it | **yes** | headless Chrome, with the send caught inside the page: one question sends `"Go on to Words"`; four questions send `Who comes to it most? → Tourists` … one line per question |
| Keyboard alone: Tab reaches each choice, Enter presses it | **yes** | real key events: Tab went × → "Go on to Words" → "Change the order"; Enter sent "Change the order"; Space marks a choice among several |
| At the panel's narrowest width nothing overlaps or is cut | **yes** | panel at 340px (its minimum): the row doesn't wrap, × stays inside, no choice runs past the panel's edge (measured) |

### Package 5: keep a part as a brand asset

| Done when | | How I checked |
|---|---|---|
| svg with a `:root` fill and a gradient → `svg` asset with the real color, no `<script>`, opens as a picture; div with background and shadow → `png` at 2×; both in the project and in `get_brand_assets`; a selector that finds nothing → the plain error | **yes** | `tests/keep.test.ts` (4 tests). The PNG is read pixel by pixel: 400×240 for a 200×120 part, RGBA, its rounded corner see-through (only a trace of the card's own shadow, alpha 7 of 255). Also: a shape inside a drawing is kept as the whole drawing; a part with no size says so. |
| In the studio: point at a drawing, press Keep, find it in Brand assets looking the same | **yes, on a study I made** | Real sketches first: in NavTech's figure each square is its own button, the deck's globe sits under a slide, and HUJJAT's guilloche has `pointer-events: none`, so the pointer can't reach the drawing in any of them (see section 4). So I made "Gem study: the rosette" on the test project through the tool, pointed at it in the studio and pressed Keep: "Kept in Brand assets", an SVG of the whole rosette. The real HUJJAT guilloche I kept through `keep_part` by its selector `#ros`: the same as in the sketch. `steps-kept-part.jpg` shows both beside their sketch. |
| Move a knob, press Keep without saving: one new version, kept picture has the new look | **yes** | rosette size knob 520 → 420px, Keep: the studio said "Saved as version 3", then "Kept in Brand assets"; exactly one new version (v3); the kept SVG is 420×420. `steps-keep-knob-moved.jpg`, `steps-keep-kept-2.jpg`. |
| A later `make_sketch` using the kept `src` renders it | **yes** | "Uses the kept rosette" on the copy (and in `keep.test.ts`, with an `onerror` that would show in `page_errors`) |

### Without FRIDAY

- Type check and tests: section 6.
- A project that never went step by step: the route says `null`, no row, and the status line is
  empty (checked `stepsLine` on NavTech on the copy; also empty for "Steps test" once stopped).
  Its sketches are still checked as always (`sketch.test.ts` passes).
- The four real projects on the copy open, with every sketch picture there (HUJJAT 3, CRM 5,
  WB Presentation 4, NavTech 3; none missing).
- New labels, errors and tool answers re-read for plain words.

## 3. The live check

12 FRIDAY messages in all, on the copy (Opus 5.5 high; Fable 5.2 → Opus 5.5 for B). **Two of
them were by my mistake**, before the live check: testing that pressing a choice sends it, my
catch in the page watched the wrong address, so two presses really went to FRIDAY on the test
project. I stopped both within seconds (a short think and one read each, nothing changed on any
canvas). That left exactly 10: no spares, so nothing was retried.

### Conversation A, One model ("Steps test")

| # | What FRIDAY did | Against the plan |
|---|---|---|
| 1 | `get_project`, `get_recipe` Website, `get_verdicts`, `library_overview`, 4 × `search_library` (mood, and three different looks), `get_reference` (6 saves, mood), `ask_designer` with 4 questions (feel: "Dark and quiet (Cupido, Stripe)" / "Sunny and warm" / "Folk pattern (Kuldīga, Sukhishvili)"; the one thing to do; languages; what exists). Words: "I've sent you the four questions…" | **no**, partly. No sketch, reads first, four questions with buttons: right. But the saves were only named inside the choices, never shown in a row, and its words came *after* the questions. I changed the `ask_designer` description (section 4). |
| 2 | `add_note` (the answers, in my words), `start_steps`, `make_sketch` "Wireframe" kind wireframe from Sections, `ask_designer` ("Go on to Words with these sections?" first choice "Yes, go on to Words"; where the booking form lives). Steps row: Sections now. | **yes**. Gray, a note beside every row, placeholders, no real copy. It explained the order only in the sketch's tries line, not in its reply, and the rows are numbered ("1. Hero"), which unugly.md lists as a slop sign. |
| 3 | `set_step` Sections done, `get_skill` better-writing, `make_sketch` "Wireframe with words" (kind wireframe, from the wireframe), `edit_sketch`, three headlines, `ask_designer` (which headline; go on to the gem). | **yes**. Wireframe changed? It said plainly that there was no story section and the menu was already above the hall, so it kept the order. Gray, Russian and English, no color. |
| 4 | `edit_sketch` (the chosen headline into the sketch), `set_step` Words done, 3 × `search_library`, `get_reference`, `place_on_board` 8 saves under Gem (after Words), three ideas, `ask_designer` which one. | **yes**. No study yet. |
| 5 | `get_skill` better-colors and better-accessibility, `make_sketch` "Gem study: atlas cloth" (a shader, thread by thread, seed knob, a knob per dye, threads, folds, light), 3 × `edit_sketch` after looking, `ask_designer` "Go on to Color, or keep working on the cloth?" | **yes**, but it said almost nothing about the study before asking (one line, after the question). |
| 6 | Words first ("I'll mark the gem as done, skip Color and Typography…"), `set_step` Gem done, `get_brand_assets`, `get_fonts`, `get_sketch` the study, `set_step` Color skipped, `set_step` Typography skipped, `get_ready_made` icons, `make_sketch` "Hero" from Hero, `edit_sketch` (failed once on a stale find, read again, fixed), `get_sketch` phone, `ask_designer` (does it feel right; how much cloth on a phone). Steps: Hero now. | **yes**. It also finished Gem, since the designer moved past it. |
| 7 | `edit_sketch` (one edit, version 3), `ask_designer` again. Steps unchanged (Hero now). | **yes** |
| 8 | `stop_steps`, `get_skill`, `get_sketch`, `get_ready_made`, `make_sketch` "Whole page" from the hero, 3 × `edit_sketch`, `get_sketch` in its error and sent states (phone). Reply answers the last check: remembers the atlas cloth; "Partly. The cloth is still a general Central Asian ikat"; where it brushes the rules (bracketed placeholders flagged as tags, dotted menu leaders, light field borders). Steps row gone. | **yes** |

Canvas at the end: `steps-canvas-A.jpg` (Sections → Words → Gem locked → Hero, the sketches above each).

**FRIDAY's three headlines (message 3), in full:**

- **A. From the name** (in the sketch now): «Роҳат» по-таджикски — покой. За ним сюда и приходят. *(Rohat means ease in Tajik. That's what people come for.)* No other chaikhona can use this line. It also puts a Tajik letter in the headline, which helps the type check later.
- **B. What it ends:** Здесь не торопятся. Чай доливают, пока идёт разговор. *(Nobody rushes here. The tea keeps coming as long as the talk does.)* It ends the quick lunch. It's warm, but another chaikhona could almost say it too.
- **C. A plain claim with facts:** Чайхона «Рохат», Душанбе. Каждый день с [10:00] до [23:00]. *(Rohat teahouse, Dushanbe. Open every day from [10 am] to [11 pm].)* Just the facts, but it needs the real hours.

Voice: "plain and warm, like the host talking to a guest. Short sentences, a little explanation for tourists, no exclamation marks."

**FRIDAY's three gem ideas (message 4), in full:**

**1. A piyola that never runs dry** *(a real object you can play with)*
- What it is: a tea bowl on a tablecloth, rendered fully real in 3D: glaze, a thin rim catching the light, steam, the tea surface moving slightly. As you scroll, the tea goes down. When it gets low, the teapot tops it up, but only to a third.
- Why only Rohat: it is the headline turned into a thing you watch happen. The custom of pouring a little and topping up often is the hospitality itself. A café selling takeaway tea couldn't use it.
- Where it lives: big in the hero. It comes back small next to "Book a table", where the bowl fills when the booking is sent.
- Craft from: [[1fd349efde3d4d1f]] for the liquid and the rim highlight, [[abd73a2d572b4862]] for the glaze.
- The risk: your rule about half-real. It only works fully real, so this is the most work of the three.

**2. Atlas cloth, woven for real** *(a generated pattern on a real material)*
- What it is: a generated ikat pattern (atlas, adras) drawn as fabric: real threads, the blurred dye edges ikat is known for, and folds.
- Why only Rohat: it's the cloth on the topchans and kurpachas. But I'll be honest: every Central Asian restaurant could use atlas too. It only passes the test if Rohat's own cloth or its hall becomes the source, and we don't have photos yet.
- Where it lives: a band of cloth in the hero, the edge of the menu tabs, a long strip at the bottom of the page.
- Craft from: [[3b27401d4fda4361]] shows folk weaving turned into a system without looking touristy.
- The risk: it's the weakest of the three on "could it sit on another site?"

**3. Dushanbe daylight through a carved window** *(light and time)*
- What it is: the shadow of a carved wooden window lattice (panjara) falls across the page. It moves with the real time in Dushanbe: short and pale at noon, long and amber at six, and by night it gives way to a warm, lamp-lit room.
- Why only Rohat: "nobody rushes" shown as time passing slowly, tied to Rohat's real hours. "Open until 23:00" becomes something you can see.
- Where it lives: the whole hero is lit by it. Later the shadow crosses the menu, and the light shows whether Rohat is open now.
- Craft from: [[1868b43cae2e423d]] for raking light on a crafted surface, [[22a8e158059f4766]] for warm limewash with one bright window, [[4dd30341db1f4e88]] for the evening.
- The risk: the shadow has to be soft and physically right, or it reads as a filter.

"My pick is 1 or 3. Both grow from the headline. Number 2 grows from the folk feel you named, but it needs Rohat's own material to be Rohat's."

### Conversation B, Plan, then build ("Steps test 2")

| # | What happened | Against the plan |
|---|---|---|
| 1 | Planner (Fable 5.2): `get_recipe`, `get_project`, `get_verdicts`, `get_brand_assets`, `library_overview`, 4 × `search_library`, `get_reference` (7 saves), `ask_designer` (4 questions). Its words came first, with four saves **in a row** and a line each on their color. Nothing handed over. | **yes** |
| 2 | Planner: `start_steps`, `hand_to_builder` (the plan says it is the Sections step, a wireframe, kind "wireframe", and writes out each row). Then the builder (Opus 5.5): `get_project`, `add_note` (the answers), `make_sketch` "Wireframe" **kind wireframe** from Sections. No step tool from the builder. | **yes**. One gap: the closing question ("Go on to Words, or change something?") came in words, not as buttons: the planner's turn ends with the hand-over, and the builder may not ask. |

Canvas at the end: `steps-canvas-B.jpg` (the steps row shows Sections now).

## 4. What differs from this plan, and why

- **`ask_designer`'s description** has one more sentence: "write them first (with any saves to look at as [[id]]s together on a line of their own), then call this, and write nothing after it." Changed after message A1, where Opus asked first, wrote after, and showed no saves. After the change, Opus put its words first in A3, A4 and A8 but still added a one-line "I've asked…" after the question every time, and still never showed saves as a row; Fable (B1) did both right. The app draws the questions after the last words either way, so it reads in the right order.
- **The step-by-step section's place in `SYSTEM`** is taken out by text (the section from "Making a whole thing" to "Sketches"), so with no recipes the instructions are byte for byte what they were.
- **`PANEL_RECIPES_DIR`** (new, optional): points the recipe reader at another folder. I used it for the "recipes moved away" check instead of moving `recipes/` in a folder other sessions share.
- **One change for a step on the canvas.** `set_step` done locks the topic *and* gives the next step its topic in one logged change, through one new helper in `board.ts` (`stepOnCanvas`), not through `lockTopic` and `addTopic` one after the other, so one undo takes both back, as the plan's test asks. The label reads like the others ("Locked Sections, added Words after Sections").
- **A step marked done before it had a topic** (the "colors are settled" case) gets a topic, locked with the decision, so the canvas shows it.
- **Studio title**: "Wireframe ·" is left out when the sketch's title already starts with "Wireframe" (the recipe names them "Wireframe" and "Wireframe with words"), so it never says "Wireframe · Wireframe". The canvas card always says it, in the tries line, as planned.
- **Keep: a shape inside a drawing is kept as the whole drawing.** The studio points at the deepest thing under the pointer, which in a drawing is one circle or path. Kept as asked, that would be a lone circle. Now any part inside an `<svg>` keeps the `<svg>` it's in.
- **Keep: the copy of a drawing loses its `<style>` too**, not only scripts: its look is written into each element, and a `<style>` reading the page's variables would override it with nothing.
- **Keep from real sketches can be out of reach in the studio**: decoration with `pointer-events: none` (HUJJAT's guilloche), a drawing made of separate buttons (NavTech's figure), or one under a slide (the WB globe). `keep_part` reaches them by selector. Not changed; worth knowing.
- **Keep's failure message** shows in the same place as "Kept in Brand assets", in the plain dark notice rather than the green one.
- `wireframe.html`: the phone fix above (allowed by the plan where it rendered wrong).

## 5. Files changed

- `server/steps.ts` (new): reads the recipes, the two tables, `startSteps`, `setStep`, `stopSteps`, `stepsOf`, `stepsLine`, `recipeText`.
- `server/board.ts`: `stepOnCanvas` (a step's canvas changes as one change); `makeSketch` kind wireframe; `wire` in the edit and read answers and in `sketchInfo` (no rule findings).
- `server/projects.ts`: `wire` kept on a sketch (`cleanData`, `SketchData`); `summary` says `wireframe: true`.
- `server/mcp-tools.ts`: `get_recipe`, `start_steps`, `set_step`, `stop_steps`, `keep_part`; the instructions line; `make_sketch` kind; wireframe answers without checks and with their own "look" line.
- `server/chat.ts`: the step-by-step section in `SYSTEM` (filled from the recipes, or left out); the status line; `fridayTools` (`ask_designer` always, `hand_to_builder` for the planner); the planner's note line; who may use what.
- `server/duo.ts`: `keep_part` in `MAKING`; the `allow` lists (`READ_TOOLS`, `STEP_TOOLS`, `oneModelAllows`, `plannerAllows`, `builderAllows`).
- `server/sketches.ts`: `inPage` (opening a page, shared by the pictures and Keep), `inLine`, `keepPart`, `PartError`.
- `server/brand.ts`: `addBrandAsset` split; `addMadeAsset` for files Panel makes.
- `server/index.ts`: `GET /api/projects/:id/steps`, `POST …/steps/stop`, `POST /api/projects/:p/sketches/:s/keep`.
- `web/src/api.ts`: `projectApi.steps`, `projectApi.stopSteps`, `studioApi.keep`, `ProjectSteps` types.
- `web/src/Assistant.tsx`: questions with buttons, the steps row, the names of the new steps.
- `web/src/assistant.css`: styles for both.
- `web/src/Canvas.tsx`: "Wireframe · …" on the card; `wire` carried through.
- `web/src/Studio.tsx`, `web/src/studio.css`: Keep in the part's strip; "Wireframe ·" in the title.
- `web/src/Icon.tsx`: `keep` (a tray with an arrow going in).
- `recipes/wireframe.html`: the phone fix.
- `.claude/launch.json`: `panel-copy-steps` on 4707.
- `tests/steps.test.ts`, `tests/wireframe.test.ts`, `tests/keep.test.ts` (new); `tests/duo.test.ts` (who may use what).

## 6. Type check and tests

```
$ bun run typecheck
$ tsc --noEmit
```

```
$ bun test tests
 248 pass
 0 fail
 30395 expect() calls
Ran 248 tests across 28 files. [158.00s]
```

## 7. Size and messages

`SYSTEM`: 10,854 characters before, 13,491 after. FRIDAY messages: **12** (2 by my mistake while testing the buttons, stopped at once; 8 in A; 2 in B).

## 8. What to look at first on http://localhost:4707/

1. **Steps test**: open FRIDAY's conversation and read it top to bottom: the questions, the
   wireframes, the three headlines, the three gem ideas, then **Gem study: atlas cloth** in the
   studio (turn its knobs, change the seed) and the **Whole page**.
2. **Steps test 2**: the steps row in FRIDAY's panel, and how the planner asked with saves in a row.
3. **Steps look**: the questions with buttons (its test conversations "Questions: one" and
   "Questions: four" — pressing a choice there will really ask FRIDAY), and **Gem study: the
   rosette** to try Keep in the studio. The kept files are under Brand assets → Steps look.
