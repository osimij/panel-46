# Plan: shorter search answers for FRIDAY (step 1 of the token work)

Written 11 Nov 2026 for another Claude session to carry out. Read all of it, and `CLAUDE.md`, before touching anything. When you finish, write the report described at the end and stop. Do not go on to other steps: the report is checked first.

## Why

Finding saves costs no tokens (it runs on this Mac). The cost is what a search hands back for the model to read. Today every search returns 12 long cards, about 580 tokens each, about 7,000 tokens a search, and FRIDAY has searched 91 times in 88 answers. Most of each card (the "worth taking" list, the full summary, the motion and type summaries) is only needed for the two or three saves FRIDAY goes on to open.

The designer agreed to this shape:

- the best 12 as **short cards** (about 150 tokens each);
- **everything else that was found as one line each**, so the whole ranked list is still visible;
- at most 60 such lines, then "N more, narrow the search";
- the full read stays one call away (`get_reference`), and that call can now return only the parts asked for.

The ranking itself must not change. Only what is written out changes.

## Rules for this job

- Follow `CLAUDE.md`. In particular: never touch `~/DesignLibrary` or port 4646, never run `bun run build` or `bun run start`, do not restart the real app, do not commit.
- Other sessions are editing this folder right now. `server/chat.ts`, `server/mcp-tools.ts`, `server/index.ts` and others have changes that are not yours and not committed. Never `git stash`, `git checkout`, `git reset` or reformat a file. Change only the lines this plan needs.
- No change to the database. No new dependency.
- Another session's server may be running on 4747. Check (`lsof -i :4747`). If it is there, leave it alone, add one entry to `.claude/launch.json` named `panel-copy-search` (same as `panel-copy` but `PANEL_PORT=4757`, port 4757) and use that. The server does not reload by itself: restart your own server after changing `server/`.
- Comments and tool descriptions in plain words, full sentences, saying why (house style in `CLAUDE.md`).
- This step spends the designer's Claude plan in exactly two places: the two FRIDAY messages in "Live check". Nothing else may call Claude.

## Before changing anything: the baseline

1. Run the measuring script and keep its output:
   `PANEL_PORT=4799 PANEL_LIBRARY_DIR=.copy/lib bun scripts/measure-search.ts > .copy/measure-before.txt 2>/dev/null`
   (If `.copy/lib` is missing, run `scripts/copy.sh` first.) Expected today: `search energetic` 22,271 chars, 40 found, 12 cards; `search dark` 24,637 chars, 156 found; `gather for a brief` 17,491 chars; `open one save, no pictures` 8,746 chars. If your numbers differ, the copy is newer than this plan: that is fine, use yours as the baseline and say so in the report.
2. Do the first half of "Live check" below (the *before* message) now, while the server still runs the old code.

## What to build

### 1. `server/library.ts`

Keep `card()` exactly as it is: it is now the *full* card.

Add a **short card**, built from the same `Doc`:

| field | what |
|---|---|
| `id`, `title`, `type` | as in `card()` |
| `about` | the first sentence of the read's summary, cut at a word near 160 characters with `…`. With no read: the start of the save's own text, same cut. |
| `mood` | the first 4 |
| `colors` | the 3 biggest swatches by share, each as `#hex name 42%` (no role) |
| one line per facet asked for | only when the search was within facets. `color`, `typography`, `layout`, `imagery`, `motion`: that facet's `summary`, cut near 200 characters. `typography` on a measured site also gets `fonts_measured` (first 3 family names). `mood`: `style_references` (first 3). `components`: the first 8. A facet the save doesn't have (`present: false`) is left out. |
| `note` | the designer's own note, whole, never cut |
| `tags` | the designer's tags, when there are any |
| `favorite`, `unread` | as in `card()` |
| the extras | `matched`, `close_in_meaning`, `looks_like_it`, `colors_matched`, `why`: unchanged |

Left out of the short card: `by`, `summary`, `format`, `type_summary`, `motion_summary`, `fonts_measured` (unless typography was asked for), `worth_taking`, `open`.

Add a **line** for the rest of the list: one plain string, `<id> · <title, at most 60 characters> · <up to 3 mood words>`. It must be a string, not an object with an `"id"` key: FRIDAY's panel shows a thumbnail for every `"id":"…"` it sees in a tool's answer (`idsIn` in `server/chat.ts`), and it should keep showing only the cards.

`search()`:

- New input `detail?: "short" | "full"`, default `"short"`.
- `"full"` returns today's answer, byte for byte.
- `"short"` returns `total`, `words_searched`, `found_by` as today, and:
  - `results`: short cards for rows `offset … offset+limit` (limit still defaults to 12, max 60);
  - `more`: lines for the rows after those, at most 60, in ranked order;
  - `not_listed`: how many found saves are in neither, when there are any;
  - `showing`: says both in words, e.g. `1–12 of 156 as cards, 13–72 as lines`;
  - `next`: one sentence telling the model what to do with it, e.g. "Open a save with get_reference for its whole read (facets: only the parts you need). 84 more matched and aren't listed: narrow the search with facets, filters or more exact words." Leave the second half off when nothing is unlisted.
- The order of results must be exactly what it is today.

`gather()` reads `open` and other fields off search results. Make it ask for `detail: "full"` (or share the ranking another way) so that **its answer does not change at all** in this step.

`findByColor()` and `similar()`: same `detail` input, default `"short"`, short cards (for `similar`, the `like` card too). No lines for these two; they already have their own small limits.

`reference()` / `get_reference`: new optional `facets`. With it, a save comes back as `id`, `title`, `type`, `note`, `tags`, `favorite`, `in_projects`, the full `facetView` of each facet asked for, and `worth_taking`. Nothing else (no files, no picture list, no post text, no other facets). Without it, the answer is exactly as today. Pictures (`images`) work the same either way; do not change the default or the picture sizes, that is the next step.

### 2. `server/mcp-tools.ts`

- `search_library`, `find_by_color`, `similar_to`: add `detail` to the input, described in a line ("short (default): a short card each. full: the whole card, as much as four times longer; ask for it only when you need every save's detail at once.").
- `get_reference`: add `facets` ("Only these parts of the read, when that's all you need: much shorter.").
- Reword the descriptions of `search_library` and `get_reference`, and the two matching lines in `INSTRUCTIONS`, so a model that has never seen the old answers knows: search returns short cards for the best and one line each for the rest; the whole read is in `get_reference`. Keep them as short as they are now: the tool definitions as a whole (the `TOOLS` line of the script) must not grow past 30,800 characters.

### 3. `server/chat.ts`

One sentence in `SYSTEM`, under "How to work", next to the line about searching: search answers are short cards and a line each for the rest; open a save with `get_reference` before saying what to take from it, with `facets` when only one part matters. Change nothing else in this file.

### 4. Anything that describes the old answer

`grep -rn "worth_taking\|type_summary\|motion_summary" README.md server web/src tests` and fix any place that describes or depends on search results having those fields. (`web/src` should not: it only uses ids and `total`. Confirm.)

## Tests

Add `tests/search.test.ts` (see `tests/helpers.ts` and the MCP test in `tests/smoke.test.ts` for how a test Panel is started, seeded and called). The seeded saves have no design read, so seed a few with one: a row in `reads` with `state = 'done'` and a `profile` JSON that has a long summary, six mood words, `worth_taking`, a typography and a motion part, plus a `palette` with five swatches. Check the columns in `server/db.ts`.

Cover:

- a default search returns short cards: no `worth_taking`, no `summary`, `about` at most ~165 characters, at most 4 moods, at most 3 colors, the note whole;
- `detail: "full"` returns the old card (`worth_taking`, `summary`, `open` present) and no `more`;
- with more found than `limit`: `more` holds strings in the right order, at most 60, `not_listed` is right, and the ids in `results` followed by the ids in `more` are the same sequence that `detail: "full"` with `limit: 60` gives;
- a search within `facets: ["typography"]` puts a typography line on the short card;
- `get_reference` with `facets: ["typography"]` has the typography part and `worth_taking`, and has no `files`, `pictures`, `read` or other facets; without `facets` it is unchanged;
- `gather_for_brief`, `find_by_color` and `similar_to` still answer.

Then `bun run typecheck` and `bun test tests`. Both must pass. If a test that isn't yours fails, check whether it fails without your change too (other sessions' work is in the tree) and report it rather than fixing it.

## Measure again

`PANEL_PORT=4799 PANEL_LIBRARY_DIR=.copy/lib bun scripts/measure-search.ts > .copy/measure-after.txt 2>/dev/null`

It is done when, against the baseline:

| line | must be |
|---|---|
| every `ORDER` line | identical to before |
| `search energetic` | 12 cards + 28 lines, at most 9,500 chars |
| `search dark (a common word)` | 12 cards + 60 lines, at most 13,000 chars |
| `search energetic, full cards` | same chars as `search energetic` was before |
| `gather for a brief` | same chars as before |
| `open one save, type only` | at most 2,500 chars |
| `open one save, no pictures` | same chars as before |
| `TOOLS` | at most 30,800 chars |

If a target can't be met without dropping something a designer would miss, stop short of it and explain in the report. Do not cut the designer's note or tags to hit a number.

## Live check (two messages to FRIDAY, no more)

The same single question, once on the old code and once on the new, each in a **new conversation on the library page** (no project), on your copy server:

> Find me five references that feel energetic. One line each on what to take.

Either type it in FRIDAY's panel in the browser, or: `POST /api/chats` (gives the id), then `POST /api/chats/<id>/messages` with `{"text": "…"}`, then wait until `GET /api/chats/<id>` says `running: false`. Calls must go to `http://127.0.0.1:<your port>`.

For each run, read from the copy (`sqlite3 -readonly .copy/lib/library.sqlite`):

- the newest `ai_usage` row with `mode = 'chat'`: model, input, cache read, cache write, output;
- from that answer's `chat_messages.parts`: the tools called, in order, with their inputs (for `get_reference`: how many ids and which `images`);
- the five saves FRIDAY named (`[[id]]` in its text) and its answer text.

Also look at the new run in the browser on the copy: the search step in FRIDAY's panel still shows its thumbnails and the count, and the answer shows the saves as before. Take a screenshot.

One run each is a sanity check, not a measurement (the model may search twice one time and four times the next). The script's numbers are the measurement. What the live check must show is that FRIDAY understood the new answers: it searched, opened saves before recommending, and did not fall back to asking for `detail: "full"` every time.

## The report

Write `docs/search-short-cards-report.md`:

1. **What changed**: each file, in a line or two. Anything done differently from this plan, and why.
2. **Numbers**: the before and after of every line of the script, side by side, with the change in percent. Whether every `ORDER` line matched.
3. **Live check**: both runs side by side (tokens, tools called, the five saves), the full text of both answers, and your honest read of whether the new answer is as good. Say plainly if FRIDAY opened more saves than before or asked for full cards.
4. **Checks**: typecheck and test results, and any failing test that isn't from this change.
5. **Not done / doubts**: anything skipped, anything that felt wrong, any place the short card lost something FRIDAY seemed to need.
6. **Note for the designer**, three or four plain sentences: what is different, that the real Panel keeps the old answers until it is restarted, and that nothing was committed.

## Not in this step

Picture sizes, the Skills page, summarizing conversations sooner, any change to ranking or to what is searched, any change to `gather_for_brief`'s answer, any change to the web UI.
