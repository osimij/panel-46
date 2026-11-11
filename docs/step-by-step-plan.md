# FRIDAY makes a whole thing step by step

Written 12 Nov 2026 for another Claude session to carry out. Read all of it, then
[CLAUDE.md](../CLAUDE.md) and [unugly.md](../unugly.md), then the three files in
[recipes/](../recipes) and the code this plan names, before touching anything. Line numbers
are as of commit `76e158d`. When you finish, write the report described at the end and stop.

## Words used here

- **A recipe**: a file that says how one kind of work is made, one decision at a time
  ([recipes/website.md](../recipes/website.md), [recipes/poster.md](../recipes/poster.md)).
  It has what makes that kind of work great, what to ask first, and its steps in order.
- **A step**: one decision in a recipe (Sections, Words, Gem, Color…). A project that follows
  a recipe is **going step by step**. At any time one step is **now**; the others are
  **done**, **skipped** or **waiting**.
- **A wireframe**: a gray sketch that only shows what each section is for and what is in it.
  No design. It starts from [recipes/wireframe.html](../recipes/wireframe.html).
- **The gem**: the one thing in a design that people remember and that belongs to this brand
  only (an illustration style, a shader, a real object, one interaction).
- **A study**: a small sketch of one thing alone (the gem, the colors, the type), not a page.
- **Keep**: putting a part of a sketch into the project's brand assets as a file, so later
  sketches and builds use the real thing.
- **One model** and **Plan, then build**: FRIDAY's two ways of working, as the app names them
  (`solo` and `duo` in [chat.ts](../server/chat.ts)). In Plan, then build, **the planner**
  decides and **the builder** makes.
- **The status line**: one sentence Panel adds to each of the designer's messages on a
  project that is going step by step, saying what is done, what is now and what is to come.

## What the designer asked for

In their words, shortened:

1. "Friday still doesn't understand what makes a great website or what makes a great poster.
   It cannot give me ideas on his own." Asked for a redesign, "it goes and gives me some kind
   of a layout template."
2. "The first thing it says: let's first understand what the website will be showing, section
   by section. It shows me a draft. It shouldn't have a really good design. Just gray blocks,
   a rough sketch, wireframe."
3. "Then: let's now think about the copywriting. It goes and reads the skill about
   copywriting. It shouldn't give me some slop."
4. "It should be proactive and ask questions. Try to understand what we want and what we are
   feeling."
5. "Colors: in order for us to have this one accent color, let's think how it will be used on
   the website. And it derives from there on."
6. "What's going to be our gem, our small detail. It feels like one piece of a whole."
7. "Maybe Friday goes and builds a tool that lets us create things we could use on the
   website. Or maybe he does it on his own."
8. "We need to make our agentic workflow a combination of several processes that lead us to a
   really good result."

## What is wrong today, and why

| # | What the designer sees | Why |
|---|---|---|
| 1 | "Make me a website" gives one finished-looking template. | FRIDAY's instructions (`SYSTEM`, [chat.ts:317](../server/chat.ts:317)) say how to use the tools. Nothing says in what order a design is decided. So the sections, the words, the colors, the type and the motion are all decided at once, silently, inside one `make_sketch`. Each gets the safe answer. |
| 2 | No ideas of its own. | Nothing asks it for options that differ in kind, or for the one thing that makes this site unlike any other. |
| 3 | It doesn't ask. | The only question it is told to ask is "your own colours or a palette" ([chat.ts:352](../server/chat.ts:352)). A question is plain text the designer must answer by typing. |
| 4 | No rough draft to agree on first. | Every sketch is treated as a finished page: it is checked against the rules and skills and expected to have knobs. |
| 5 | A drawing or pattern FRIDAY made well can't be reused as it is. | Brand assets only come from files the designer uploads ([brand.ts:204](../server/brand.ts:204)). A later sketch redraws the thing, a little differently each time. |

Most of the shape needed is already in Panel: a canvas has topics, a topic is locked with its
decision in a sentence, and later topics build on locked ones. This plan gives FRIDAY a fixed
chain of them to follow, and the few new things that chain needs.

## The design

Six rules. Everything in the packages follows from them.

1. **One decision at a time.** A whole new thing is made with a recipe. FRIDAY works on the
   step that is now, shows it, asks, and stops. It goes on only when the designer agrees.
2. **Each step is a topic on the canvas.** Agreeing locks it with the decision in a sentence.
   The canvas shows the chain: Sections → Words → Gem → Color → Typography → Hero → Motion.
3. **Gray first.** The first thing shown is a wireframe. Nothing is designed until the
   sections and the words are agreed.
4. **The gem comes before color and type**, so they grow from it and the page feels like one
   piece.
5. **FRIDAY asks, and the designer answers by pressing.** Questions come with choices as
   buttons. Options at a step differ in kind, not in shade.
6. **The designer is never trapped.** A small ask is just done. "Skip it" skips a step. "Just
   make it" stops the steps. Going back to a step is one sentence.

How one project goes:

```
"I need a website for this teahouse"
        │
        ▼
  opening questions (4 at most, with buttons; "how should it feel" asked with saves)
        │  the designer answers
        ▼
  Sections ──▶ Words ──▶ Gem ──▶ Color ──▶ Typography ──▶ Hero ──▶ Motion ──▶ Whole page
  wireframe    3 head-   3 ideas, a color   a type        first    on the     the rest,
  (gray)       lines,    then a   study     study, in     screen   hero       then the
               words in  study            real words    for real            last check
               the wire- (+ Keep)
               frame
  after every step: show it · ask · stop · the designer agrees → locked on the canvas
```

### Choices already made

Build these as written, unless the prompt that handed you this plan says otherwise.

- **A.** The gem is chosen before color and type. The Hero step comes before Motion, because
  motion is judged on a real hero.
- **B.** Steps go in order and FRIDAY can't skip one by itself. The designer can skip, go back
  or stop at any time by saying so.
- **C.** The two recipes are written (by the planner of this work, in the designer's words
  where they gave them). **Don't change their words.** If your reader needs something else
  from the files, change the reader. You may fix `wireframe.html` only where it renders wrong.
- **D.** Recipes are files in the repo, like `unugly.md`. There is no editor for them in the
  app in this plan.
- **E.** Choices are words only (no pictures on the buttons). For a question about feeling,
  FRIDAY shows saves in a row in its answer, as it can today, and names the choices in words.

## Rules for you

- **Never test on the real app** (port 4646, `~/DesignLibrary`). Never run `bun run build`,
  `bun run start` or `scripts/copy.sh` (it deletes `.copy/lib`, which other sessions use).
- **Before you start**: if `docs/step-by-step-report.md` exists, or another session is already
  carrying this plan out, stop and say so.
- **Make your own copy**, fresh from the real library:
  ```
  mkdir -p .copy/lib-steps
  sqlite3 -readonly ~/DesignLibrary/library.sqlite ".backup '.copy/lib-steps/library.sqlite'"
  for d in media projects models fonts brand; do cp -c -R ~/DesignLibrary/$d .copy/lib-steps/$d; done
  ```
  then run on it the same `sqlite3` block that [scripts/copy.sh](../scripts/copy.sh) runs on
  its copy (the one that starts with `ai_auto`: reads off, nothing waiting, builds stopped),
  and check `sqlite3 .copy/lib-steps/library.sqlite "pragma integrity_check"` says `ok`.
  Build the UI with `bunx vite build --outDir "$PWD/.copy/dist-steps" --emptyOutDir`. Add one
  line to `.claude/launch.json`: `panel-copy-steps`, port **4707**, with
  `PANEL_LIBRARY_DIR=.copy/lib-steps` and `PANEL_DIST=.copy/dist-steps`.
- **The database only grows.** This plan adds two tables (`project_recipes`, `project_steps`)
  and one new key inside a sketch card's data (`wire`). Nothing is renamed, dropped or
  rewritten. The real app, still on old code, must keep working beside a library that has
  them.
- **Other sessions edit this folder at the same time** (one may be carrying out
  [mac-app-plan.md](mac-app-plan.md)). Read a file again right before each edit. Never
  reformat a file. Never `git stash`, `git checkout --` or `git reset`. If the type check
  fails in a file you didn't touch, wait a few minutes and try again; if it still fails, say
  so in the report and leave it.
- **Calls to Claude**: only the FRIDAY messages listed in Package 6, at most **12**. No design
  reads, no builds. Tests never call Claude.
- New routes are guarded with `fromPanel(req)` like the ones beside them. Sketches stay in
  their sandbox: nothing in this plan lets a sketch page call Panel.
- **No new dependency.** New icons are drawn in [Icon.tsx](../web/src/Icon.tsx) the way the
  ones there are.
- Everything the designer reads (labels, errors, tool answers FRIDAY repeats) is in plain
  words that say what happens. Comments say why, in full sentences. UI is grayscale, Inter,
  quiet; reuse classes in `styles.css` and `assistant.css` before adding one; corners use
  `corner-shape: var(--corner)`; motion respects `prefersReducedMotion()`.
- **Look in Chrome.** Claude's built-in browser has not been able to run sketch pages (the
  page stays white). Check anything that needs the live sketch page through the Claude in
  Chrome tools, or with headless Chrome. For each line you could not check, say "not checked"
  in the report. Don't claim it.
- Commit nothing. Don't restart the real app.

---

## Package 1: recipes and steps, in the server

New file `server/steps.ts`. It reads the recipes and keeps where each project stands. A top
comment says what it is for, in plain words.

### 1. Reading a recipe

- The folder is `recipes/` at the top of this repo (found the way [rules.ts](../server/rules.ts)
  finds `unugly.md`). Every `*.md` in it is a recipe; its file name without `.md` is its id
  (`website`). Read fresh each time, so an edit applies to the next message.
- A recipe file has:
  - `# Name`: the first top heading is the name shown (`Website`).
  - A line starting `For:` before the first `##`: one line saying when it is used.
  - `## Steps`: every `### Heading` after it, to the end of the file or the next `## `, is a
    step, in that order. The heading is the step's name (`Sections`).
  - Everything between the `For:` line and `## Steps` is **the top** (what makes it great,
    what to ask first).
- In a step's text, a line `Topic: <facet>` (one of `TOPIC_FACETS`,
  [projects.ts:105](../server/projects.ts:105)) is taken out of the text and kept as the
  step's facet. It means "this step is the same decision as a canvas topic of that kind".
- In a step's text, a line `{{file: name}}` is replaced by that file from `recipes/`, inside a
  fenced `html` block. Only names made of `a-z 0-9 . -` that exist in the folder; anything
  else is left out.
- A file that doesn't have a name, a `For:` line and at least one step is not a recipe: it is
  skipped, and Panel's log says which file and what is missing.

Exports (names are yours to choose; these are what the rest of the plan calls them):
`listRecipes()` → `{ id, name, for, steps: string[] }[]`; `readRecipe(idOrName)` → the same
plus `top` and each step's `text` and `facet`. A recipe is found by its id or its name, in any
case.

### 2. Where a project stands

Two tables, made in `steps.ts` the way other files make theirs:

```sql
CREATE TABLE IF NOT EXISTS project_recipes (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  recipe TEXT NOT NULL,                 -- the recipe's id: website
  state TEXT NOT NULL DEFAULT 'on',     -- on · stopped · finished
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_steps (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  step TEXT NOT NULL,                   -- the step's name, as the recipe has it: Sections
  state TEXT NOT NULL DEFAULT 'waiting',-- waiting · now · done · skipped
  decision TEXT NOT NULL DEFAULT '',    -- the decision in a sentence, once done
  topic_id TEXT,                        -- its topic on the canvas, once it has one
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, step)
);
```

The recipe file gives the steps and their order; the rows give each step's state. A step in
the file with no row is `waiting`. A row whose step is no longer in the file is ignored. So
the designer can edit a recipe while a project is half way through it.

Functions:

- **`startSteps(project, recipe)`**
  - Project already on with the same recipe: change nothing, answer where it stands.
  - On with another recipe: an error, "This project is already going step by step with
    Website. Stop that first (stop_steps)."
  - Stopped or finished before, same recipe: turn it on again, keeping every step's state.
    With another recipe: start that one fresh (the old rows are deleted).
  - New: for each step with a facet, look for a topic of that facet on the canvas. If one is
    **locked**, the step starts `done`, with the topic's decision (`summary`) as its decision
    and that topic as its `topic_id`. If one exists but isn't locked, it becomes the step's
    topic.
  - The first step that isn't done becomes `now` (see "a step becomes now" below).
- **`setStep(project, step, state, decision?)`**, with `state` one of `done`, `skipped`, `now`:
  - `done`: needs a decision (a sentence; kept to 600 characters). The step's topic is locked
    with it (`lockTopic`, [board.ts:220](../server/board.ts:220)). The next step in order
    that is `waiting` becomes `now`. If there is none, the project's recipe is `finished`.
  - `skipped`: its topic is taken off the canvas if nothing hangs from it (no saves, notes or
    sketches); otherwise it stays as it is. The next waiting step becomes `now`.
  - `now` (going back): that step becomes `now`, its topic is reopened (`lockTopic` with
    `unlock`), and the step that was `now` goes back to `waiting`. Steps that were done stay
    done. A finished or stopped project is turned on again.
  - `done` and `skipped` also work on a step that is still waiting ("skip color and
    typography", "the colors are settled, they are the brand's"). The step that is now then
    stays now; it only moves on when it is itself the one finished or skipped.
  - The step is found by name, in any case. An unknown step: an error that lists the steps.
  - Only one step is ever `now`.
- **A step becomes now**: make sure it has a topic on the canvas, named after the step, with
  the step's facet (or `other`), connected after the topic of the nearest earlier step that
  has one. Reuse a topic of the same name if there is one. Do it through the functions in
  [board.ts](../server/board.ts) (`addTopic`, and a small exported helper that gives back the
  topic's id), so it is one logged change with its undo, labelled like the others.
- **`stopSteps(project)`**: the recipe's state becomes `stopped`. Nothing on the canvas
  changes.
- **`stepsOf(project)`** → `null` when the project never went step by step, else
  `{ recipe: { id, name }, state, steps: [{ step, state, decision }] }`, in the recipe's order.
- **`stepsLine(project)`** → the status line, or `""` unless the state is `on`:

  > This project is being made step by step with the Website recipe. Done: Sections (“Seven
  > sections: hero, menu, …”), Words (“…”). Skipped: none. Now: Gem. To come: Color,
  > Typography, Hero, Motion, Whole page. Work only on Gem, as the recipe says (get_recipe
  > with step "Gem" if you haven't read it in this conversation). A small change the designer
  > asks for is just made; the steps are for the big decisions.

  Each decision is cut to 160 characters. "Skipped:" is left out when there are none.

### 3. The tools

In [mcp-tools.ts](../server/mcp-tools.ts), beside the project tools. Descriptions as written
here; answers through `safe(...)` like their neighbours.

- **`get_recipe`** (read-only). "Recipes say how a whole piece of work is made step by step,
  one decision at a time (a website, a poster). With nothing: the list, each with what it is
  for and its steps. With a name: the whole recipe: what makes that kind of work great, what
  to ask first, and every step. With step: only that step. With project: also where that
  project stands."
  Input: `name?`, `step?`, `project?`. The recipe comes back as text (markdown), not JSON, the
  way `get_skill` answers.
- **`start_steps`**. "Start making a project step by step with a recipe, once the recipe's
  opening questions are answered. The first step becomes the one to work on, and the designer
  sees the steps in FRIDAY's panel. A decision the canvas has already locked (Color,
  Typography, Motion) starts as done. Only when the designer asked for a whole new thing, or
  asked to go step by step."
  Input: `project`, `recipe`. Answer: `{ recipe, steps: [{ step, state, decision? }], now: { step, text } }`.
- **`set_step`**. "Move a project's steps on. done: the designer agreed to the step that is
  now; give the decision in a sentence, in their words where they gave them. Its topic on the
  canvas is locked with it, and the answer brings the next step to start on. skipped: they
  said to skip it. now: go back to an earlier step to change it. Only when the designer says
  so."
  Input: `project`, `step`, `state` (`done` · `skipped` · `now`), `decision?`.
  Answer: `{ step, state, now?: { step, text }, to_come: string[], finished?: true }`. When
  finished: `next: "Every step is done. The designer chooses the sketch (Choose), and then it can be built."`
- **`stop_steps`**. "Stop going step by step on a project: the designer said to just make it,
  or to stop. What was decided stays on the canvas."
  Input: `project`.

Add one line to `INSTRUCTIONS` ([mcp-tools.ts:22](../server/mcp-tools.ts:22)), after the
line about sketches:

> - A whole new piece of work (a website, a poster) is made step by step with a recipe:
>   get_recipe lists them and reads one, start_steps begins on a project, set_step moves on
>   when the designer agrees to a step. A step's first rough page is a wireframe: make_sketch
>   with kind "wireframe".

### 4. Routes

In [index.ts](../server/index.ts), beside the other project routes, both guarded with
`fromPanel(req)`:

- `GET /api/projects/:id/steps` → `stepsOf(id)` (or `null`).
- `POST /api/projects/:id/steps/stop` → `stopSteps(id)`, then the same answer as the GET.

Add both to [api.ts](../web/src/api.ts) with their types.

### Done when

- `tests/steps.test.ts` (new, the way [canvas.test.ts](../tests/canvas.test.ts) calls tools):
  - Both recipes are read: Website has the steps Sections, Words, Gem, Color, Typography,
    Hero, Motion, Whole page, in that order; Poster has Message, Idea, Layout, Color,
    Typography, Poster. Color, Typography and Motion carry their facets, and no step's text
    still has a `Topic:` line. The Sections step's text holds the wireframe page (it contains
    `class="wf-row"`) and no `{{file` is left anywhere.
  - `get_recipe` with nothing lists both; with a name gives the top and the steps; with a step
    gives only that step.
  - On a new project: `start_steps` website → Sections is now, a topic "Sections" is on the
    canvas. `set_step` Sections done with a decision → that topic is locked with the decision,
    Words is now, a topic "Words" exists and Sections leads to it. `set_step` Words skipped →
    Gem is now, and the empty Words topic is gone. `set_step` Sections now → Sections is now
    and reopened, Gem is waiting. `stop_steps` → the GET route says stopped, and
    `start_steps` again turns it on with the states kept.
  - A project that already has a locked Color topic: after `start_steps`, Color is done with
    that topic's decision.
  - `set_step` done without a decision, an unknown step, and `start_steps` with a second
    recipe while one is on each give the plain error.
  - Undo on the canvas (`POST /api/projects/:id/undo`) after a `set_step` done takes the lock
    back: one change, one undo. (The step itself stays done; see "Left for later".)
  - `set_step` skipped on a waiting step leaves the step that is now as it is.
- A library opened once by this code still opens with the code at `76e158d` (check on a copy
  of the copy with a throwaway `git worktree add` in your scratchpad).

---

## Package 2: FRIDAY follows the steps

All in [chat.ts](../server/chat.ts), plus one line in [duo.ts](../server/duo.ts).

### 1. The instructions

Add this section to `SYSTEM`, after the "On a project's canvas" section and before
"Sketches". Change no other line of `SYSTEM`. `{recipes}` is filled in `systemPrompt()` from
`listRecipes()`, one line each (`  - Website: a website or a landing page, new or a redesign.`).
With no recipes in the folder, the whole section is left out.

```
Making a whole thing, step by step (on a project's canvas):
- When the designer asks for a whole new thing or a whole redesign (a website, a landing page, a poster), don't sketch it straight away. Deciding the structure, the words, the color, the type and the motion all at once, alone, is what makes a template. Take it step by step with the recipe for that kind of work: one decision at a time, each shown to the designer and agreed before the next. The recipes:
{recipes}
- A small ask is not this: a change, one section, "sketch the hero", "try it with the stamp", a question. Just do it, as always.
- To begin, read the recipe whole (get_recipe with its name) and ask its opening questions: only the ones the project card, the canvas and get_verdicts don't already answer, at most four, in one message. When they have answered, start_steps. Off a canvas, say it needs a project and stop there.
- From then on each message says where the project stands: what is done, which step is now, what is to come. Work only on the step that is now, the way the recipe says (get_recipe with step, if you haven't read it in this conversation). Never do two steps in one answer, and never start the next before the designer agreed to this one.
- Where the recipe asks for options (three headlines, three ideas), make them different in kind, not three shades of one, and say in a line what each comes from.
- End each step by showing what you made and asking (ask_designer), with going on as the first choice. Then stop.
- When they agree ("yes", "go on", the first choice): set_step done, with the decision in a sentence, in their words where they gave them. Its answer brings the next step: start on it in the same answer.
- When they want a change, make it and ask again. "Skip it": set_step skipped. Going back to an earlier step: set_step now. "Just make it" or "skip the steps": stop_steps, then make it from what is decided so far.
- Every step builds on the ones before it: the words fit the sections, the color comes from the gem, the motion serves both. A wireframe has no colors, so the question about colors (under Sketches) waits for the Color step, which settles them.
- Ask before you assume, but little: beyond the closing question, one question per step at most. For a question about feeling, show two or three saves in a row and ask which is closer.
- ask_designer: one to four questions, each with two to four short choices the designer can press; they can also write their own answer. Call it last, after your words. A question with no clear choices is asked in your words instead. Without that tool, ask everything in words.
```

### 2. The status line

In `send()`, inside the `if (p)` block ([chat.ts:531](../server/chat.ts:531)), after the
project card: when `stepsLine(p.id)` isn't empty, push it to `said` and add its place to
`mainOnly`, so the builder's conversation never gets it. Not for `/compact`.

### 3. FRIDAY's own tools: asking

- Turn `handOver` ([chat.ts:813](../server/chat.ts:813)) into one function that makes the
  `friday` server with **`ask_designer`** always, and `hand_to_builder` only when it is given
  the hand-over callback.
- `ask_designer`:
  - Description: "Ask the designer one to four questions, each with choices they can press.
    Use it for a step's closing question (going on as the first choice) and for anything you
    would otherwise guess. Call it last, after your words to the designer."
  - Input: `questions`: 1 to 4 of `{ question: string (up to 200), choices: 2 to 4 strings (each up to 40) }`.
  - Answer: "The designer sees the questions with the choices as buttons, and can also write
    their own answer. Your turn is over: write nothing more."
- One model (`drive`, [chat.ts:1127](../server/chat.ts:1127)): pass the `friday` server to
  `viaSdk`, and let `mcp__friday__ask_designer` through beside Panel's tools (`panelOnly`,
  [chat.ts:1292](../server/chat.ts:1292)). The command-line fallback has no such tool; that
  is fine, FRIDAY asks in words there.
- The names of the tools appear in parts without their prefix already (`reader`,
  [chat.ts:997](../server/chat.ts:997)); nothing to change there.

### 4. Plan, then build

- The planner runs the steps. It may use, beside `READ_TOOLS`
  ([chat.ts:807](../server/chat.ts:807)): `get_recipe`, `start_steps`, `set_step`,
  `stop_steps`, and both `friday` tools.
- Add to `plannerNote` ([chat.ts:831](../server/chat.ts:831)), as one more line:

  > - Step by step: you run the steps. You read the recipe, ask the designer (ask_designer),
  >   decide each step and move the steps on yourself (start_steps, set_step and stop_steps
  >   are yours to call). What a step makes (the wireframe, a study, the hero) goes in the
  >   plan for the builder like anything else: say which step it is for and what to hang it
  >   from. For a wireframe, say it is one (make_sketch with kind "wireframe") and write out
  >   the recipe's starting page and what goes in each row.

- The builder and the side runs that make alternates never move the steps and never ask:
  `build()` and `fanOut()` get an `allow` that passes Panel's tools except `start_steps`,
  `set_step` and `stop_steps` ("The planner moves the steps on."), and no `friday` server.
- In [duo.ts](../server/duo.ts), add `keep_part` (Package 5) to `MAKING`.

### Done when

- `tests/duo.test.ts` still passes; add a test for whatever you move into a file that can be
  tested without opening the library (the `allow` lists are a good candidate).
- With the copy running, `systemPrompt()` holds the new section with both recipes listed, and
  with the `recipes/` folder moved away for a moment the section is gone and nothing else in
  the instructions changed (compare the two texts). Write in the report how many characters
  `SYSTEM` was before and after.
- The live checks of Package 6.

---

## Package 3: wireframes

A wireframe is a sketch that says it is one. Panel then treats it as a rough draft.

- `make_sketch` ([mcp-tools.ts:454](../server/mcp-tools.ts:454)) gets
  `kind: z.enum(["page", "wireframe"]).optional()`: "wireframe: a gray page that only shows
  what each section is for and what is in it, before any design (a recipe's Sections or
  Layout step). It isn't checked against the rules or the skills. Leave out for a designed
  page."
- `makeSketch` ([board.ts:290](../server/board.ts:290)) puts `wire: true` in the card's data
  for a wireframe. `cleanData` ([projects.ts:211](../server/projects.ts:211)) keeps `wire`
  for a sketch (only `true`), and `SketchData` gets `wire?: true`. A sketch made from a
  wireframe is a wireframe only if it says so itself.
- For a wireframe, the answers of `make_sketch`, `edit_sketch` and `get_sketch` leave out
  `rule_checks`, `skill_checks`, `skills_checked` and `skills_that_apply`, and carry
  `wireframe: true`. `make_sketch` and `edit_sketch` say this instead of `LOOK`:

  > Look at the screens before you answer: every section has its note (its name, its job, what
  > is in it), the order reads from top to bottom, and nothing is designed (gray only). Fix
  > what's off with edit_sketch first. page_errors come from the page itself.

- `sketchInfo` ([board.ts:558](../server/board.ts:558)) gives a wireframe's versions no rule
  findings, so the studio doesn't count them.
- `summary` ([projects.ts:631](../server/projects.ts:631)) says `wireframe: true` on such a
  sketch, so FRIDAY knows which sketches are drafts when it reads the canvas.
- On the canvas card ([Canvas.tsx:456](../web/src/Canvas.tsx:456)) and in the studio's
  title, a wireframe says "Wireframe" in quiet muted text before what it tries
  ("Wireframe · the order of the sections"). Plain words, not a tag or a pill.
- Render [recipes/wireframe.html](../recipes/wireframe.html) once as a wireframe sketch on the
  copy (through the tool, no FRIDAY) at desktop and phone, and look. Fix it only where it
  renders wrong; keep how it looks.

### Done when

- A test in `tests/sketch.test.ts` (or beside it): `make_sketch` with kind wireframe, using
  the recipe's page, answers with `wireframe: true` and no `rule_checks`; its card has
  `wire: true`; `edit_sketch` on it answers the same way; `get_project` says it is a
  wireframe. The same page sent without `kind` still gets its checks.
- On the copy, the card and the studio say "Wireframe" (a picture of each for the report).

---

## Package 4: questions with buttons, and the steps in FRIDAY's panel

In [Assistant.tsx](../web/src/Assistant.tsx) and [assistant.css](../web/src/assistant.css).
Read `unugly.md` again first: no tags, no pills with borders, no dividers.

### 1. Questions with buttons

- An `ask_designer` step is not listed among the steps of an answer
  ([Assistant.tsx:879](../web/src/Assistant.tsx:879)). It is drawn after the answer's last
  words, as the questions themselves.
- **While it waits for the designer** (it is in the last answer, FRIDAY isn't answering, and
  no message came after): each question as a line of text in the answer's own style, and
  under it its choices as buttons in a row that wraps.
  - One question: pressing a choice sends it as the designer's message, the same as typing it.
  - Two to four questions: pressing marks one choice per question (press again to unmark).
    When every question has one, a "Send" button sends them as one message, one line per
    question: `Who is it for? → Small businesses`.
  - Writing in the message box and sending works as always, and counts as the answer.
- **Once answered**, or in an older answer: the questions stay as text, with the choices as
  one line of muted words under each. No buttons.
- Buttons: real `<button>`s, each question's row a group named by the question, reachable by
  Tab, pressed by Enter or Space. Use the quiet button FRIDAY's panel already has (find it;
  don't add a new look). The first choice is not made louder than the others.
- The name of the step, where a name is still needed ([Assistant.tsx:1056](../web/src/Assistant.tsx:1056)):
  "Asking". Add names for the new tools in the same switch: `get_recipe` ("Reading the
  Website recipe" / "Read the Website recipe", or "the recipes" with no name), `start_steps`
  ("Starting step by step" / "Started step by step"), `set_step` ("Finished Sections" /
  "Skipped Sections" / "Went back to Sections"), `stop_steps` ("Stopped going step by step"),
  `keep_part` ("Keeping a part" / "Kept a part in Brand assets").

### 2. The steps row

- When the open project is going step by step (`GET …/steps` says `on`), FRIDAY's panel shows
  one thin row under its header ([Assistant.tsx:521](../web/src/Assistant.tsx:521)): the
  recipe's name, then its steps in order as plain words. Done steps are muted with a small
  check before them, the step that is now is in full ink, waiting and skipped steps are muted
  (skipped ones struck through). Space between them, no lines, no boxes.
- Pointing at a done step shows its decision (a `title`).
- At the right end, a small × named "Stop going step by step". It calls the stop route, and
  the row goes away.
- The row never wraps: it scrolls sideways, with the step that is now brought into view.
- It is read again when the project changes, when an answer ends, and when a step of an
  answer named `start_steps`, `set_step` or `stop_steps` comes back.
- Hidden when the project isn't going step by step, when it is stopped or finished, and off a
  project.

### Done when

- On the copy, with a project going step by step: the row shows, and its states match
  `stepsOf`. A picture for the report.
- An answer with one question and an answer with four, each drawn right, waiting and
  answered (you can write such answers into a test conversation's `chat_messages.parts` on
  the copy to look at them without calling Claude). Pressing a choice sends it. A picture of
  each.
- With the keyboard alone: Tab reaches each choice, Enter presses it.
- At the panel's narrowest width nothing overlaps or is cut.

---

## Package 5: keep a part of a sketch as a brand asset

So the gem FRIDAY made, and the designer tuned with Knobs, becomes a real file that every
later sketch and build uses.

### 1. In the server

- In [brand.ts](../server/brand.ts): split `addBrandAsset` so an asset can also be added from
  bytes Panel made itself (a name, a format, the bytes, the project, the kind), with the same
  row, the same picture to show (`makeView`) and the same checks.
- In [sketches.ts](../server/sketches.ts): **`keepPart(project, sketch, o)`** with
  `o = { selector, version?, device?, state?, name?, kind? }`. It opens the version's page in
  headless Chrome the way `shoot` does (same waiting; share that code, don't copy it), on the
  device and in the state given, finds the part with `document.querySelector(selector)`, and:
  - **The part is an `<svg>`** with no `<use>` pointing outside it, no `<image>` and no
    `<foreignObject>`: it is kept as an **SVG file**. Take a copy of it, write each element's
    look as the browser worked it out into the copy (fill, stroke and its width, caps, joins
    and dashes, the three opacities, font family, size and weight, letter spacing, text
    anchor, and a CSS transform), so it looks the same with no page around it. Give it
    `xmlns`, a `viewBox` and its size. Take out every `<script>`, every `on…` attribute and
    every `href` that isn't a `#…` or a `data:image/…`.
  - **Anything else**: it is kept as a **PNG on a see-through ground**, at 2× (less if a side
    would pass 4000 pixels). Only the part shows: everything else in the page is hidden for
    the picture and the page's own ground is made clear (one way: a style that hides
    everything but the part and what is inside it, a clear `html` and `body`, and Chrome's
    `Emulation.setDefaultBackgroundColorOverride` with alpha 0, then `Page.captureScreenshot`
    as PNG with a `clip`). Check the result really is see-through around the part.
  - No such part: "That part isn't in the page any more." A part with no size: "That part has
    no size to keep."
  - The asset goes to the sketch's project. Its name is `o.name`, or "<the part's label> from
    <the sketch's title>". Its kind is `o.kind`, or `image`.
- A route, guarded with `fromPanel(req)`, beside the sketch's other routes
  ([index.ts:787](../server/index.ts:787)):
  `POST /api/projects/:p/sketches/:s/keep` with `{ selector, version, device, state, name }` →
  the new asset.
- A tool, **`keep_part`**, in [mcp-tools.ts](../server/mcp-tools.ts): "Keep a part of a sketch
  as one of the project's brand assets: a drawing, a pattern or a picture as a real file (an
  <svg> part as SVG, anything else as a PNG on a see-through ground). Later sketches use it by
  its src, builds by its path. For something the designer approved and wants to reuse, like
  the gem. Only when the designer says so, or a recipe's step says to."
  Input: `project`, `sketch`, `part` (a CSS selector that finds it once), `name`, `kind?`,
  `version?`, `device?`, `state?`. Answer: the asset as `get_brand_assets` lists one (its id,
  name, `src`, and its path on this Mac).
- The project card lists brand assets already ([chat.ts:716](../server/chat.ts:716)), so
  FRIDAY is told about a kept part with the designer's next message. Nothing to add.

### 2. In the studio

- The strip under a selected part ([Studio.tsx:1356](../web/src/Studio.tsx:1356)) gets one
  more icon, before the trash: **"Keep as a brand asset"** (draw a small tray with an arrow
  going into it, in `Icon.tsx`).
- Pressing it: if hand changes are waiting, they are saved first (the same as pressing Save),
  then the part is kept from that new version, on the device and in the state showing. While
  it works the icon shows it is busy. Then the studio says "Kept in Brand assets" in the same
  place and way it says "Saved as version 4" (`setFresh`, [Studio.tsx:258](../web/src/Studio.tsx:258)),
  and on a failure says the server's plain reason there.
- It sends the part's `selector` as the studio already has it for a selected part. The kit
  doesn't change, so `STUDIO_PAGE` stays as it is.

### Done when

- `tests/brand.test.ts` or `tests/sketch.test.ts`: a sketch with an `<svg>` whose fill comes
  from a `:root` variable and has a gradient, and a `<div>` with a background and a shadow.
  Keeping the svg makes an asset of format `svg` whose file has the fill as a real color, no
  `<script>` (put one in the page's svg to prove it is taken out) and opens as a picture.
  Keeping the div makes a `png` with the part's size ×2. Both belong to the project and come
  back from `get_brand_assets`. A selector that finds nothing gives the plain error.
- On the copy, in the studio: point at a drawing in a real sketch, press Keep, and find it in
  Brand assets under that project, looking the same as in the sketch (a picture of both, side
  by side). Then move a knob that changes the drawing, press Keep without saving: one new
  version is made, and the kept picture has the new look.
- A later `make_sketch` (through the tool, no FRIDAY) that uses the kept asset's `src` in an
  `<img>` renders it.

---

## Package 6: look it all over

### Live check: at most 12 FRIDAY messages, on the copy

Model and effort as the copy has them. Switch between "One model" and "Plan, then build" in
FRIDAY's model menu on the copy (it changes only the copy). Keep each answer's steps and words
for the report (`chat_messages.parts`), and a picture of the canvas at the end of each
conversation.

**Conversation A, One model.** Make a new project on the copy, "Steps test", with this
brief: "Чайхона «Рохат» в Душанбе. Одностраничный сайт: меню, зал, бронь стола. Гости:
горожане и туристы." Then, one after another:

| # | The designer's message | What must happen |
|---|---|---|
| 1 | "I need a website for this teahouse. Make it." | No sketch. It reads the recipe and the canvas, and asks opening questions (four at most) with buttons. The question about feel comes with saves shown in a row. |
| 2 | Answers, in two or three plain lines (yours to write; say the feel is "warm, real materials, not touristy"). | `start_steps`. One wireframe on the canvas under Sections: gray, a note beside every section, no real copy. It ends by asking to go on. The steps row shows Sections as now. |
| 3 | "Put the menu above the story. Then go on." | The wireframe is changed. `set_step` Sections done with a decision. Then Words: it reads the writing skill, gives three headlines that differ in kind, makes "Wireframe with words" (still gray, Russian), and asks. No color anywhere yet. |
| 4 | "The second headline. Go on." | `set_step` Words done. Gem: three ideas that differ in kind, each with why it belongs to this teahouse, saves placed under Gem. It asks which. No study yet. |
| 5 | "The second idea." | A study of that gem alone, with knobs. It asks: go on to Color, or keep working. |
| 6 | "Skip color and typography for now. Go to the hero." | Both skipped (`set_step` twice), Hero is now, and one hero sketch is made from the words and the gem. |
| 7 | "Make the headline a little smaller." | Just done, as a new version. No step moves. |
| 8 | "Just finish the whole page, skip the steps." | `stop_steps`. One whole-page sketch. The reply answers the recipe's last check. The steps row is gone. |

**Conversation B, Plan, then build.** A second new project, "Steps test 2", same brief.

| # | The designer's message | What must happen |
|---|---|---|
| 1 | "I need a website for this teahouse." | The planner asks the opening questions itself. Nothing is handed to the builder. |
| 2 | The same answers as in A. | The planner calls `start_steps` itself, then hands the wireframe to the builder, whose `make_sketch` has kind wireframe. The builder calls no step tool. |

Two messages are spare, for one retry of a message that failed for a reason that isn't
FRIDAY's (a timeout, a limit). If FRIDAY does the wrong thing at a message, don't retry until
it comes out right: write down what it did, change the instructions or the recipe's reader if
the cause is there (never the recipes' words), and say so in the report.

### Without FRIDAY

- `bun run typecheck` and `bun test tests`.
- A project on the copy that never went step by step looks and works exactly as before: no
  row, no status line in a message (look at what `send()` builds), sketches checked as always.
- The four real projects on the copy open, and their sketches still show.
- Every new label, error and tool answer read once more against the house style: plain words
  that say what happens.

---

## Left for later (don't build)

- An editor for recipes in the app, and recipes for an app screen, a brand and a
  presentation.
- Pictures on the choice buttons.
- A step's state following the canvas when the designer unlocks or deletes its topic by hand.
- Keeping moving things (a video of a shader, an animated SVG).
- FRIDAY learning from which options the designer picks at each step (into the verdicts).
- Recipes for a site with several pages.

## The report

Write `docs/step-by-step-report.md`:

1. **In two sentences**: what the designer can do now that they couldn't.
2. **Per package**: each "Done when" line, with **yes**, **no** or **not checked** and how you
   checked it (a test's name, Chrome, a measured number). Pictures in `.copy/` as
   `steps-*.jpg`: the wireframe card and studio, the steps row, one question and three
   questions (waiting and answered), a kept part beside its sketch, and the canvas at the end
   of conversations A and B.
3. **The live check**: for each of the messages, what FRIDAY did (the tools it called, in
   order, and its words to the designer), and **yes** or **no** against "what must happen".
   Paste FRIDAY's three headlines and three gem ideas in full: the designer will judge them.
4. **What differs from this plan**, and why.
5. **Files changed**, one line each.
6. `bun run typecheck` and `bun test tests`: the last lines of each.
7. The size of `SYSTEM` before and after, in characters, and how many FRIDAY messages were
   sent.
8. **What you'd want the designer to look at first** on `http://localhost:4707/`.
