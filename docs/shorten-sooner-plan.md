# Plan: three leftovers from the short cards, and shortening conversations sooner (step 2a)

Written 11 Nov 2026 for another Claude session to carry out. Read all of it, `CLAUDE.md`, and the first step's plan and report ([search-short-cards-plan.md](search-short-cards-plan.md), [search-short-cards-report.md](search-short-cards-report.md)) before touching anything. When you finish, write the report described at the end and stop.

This step is small on purpose. It calls Claude **zero** times: no FRIDAY messages, no reads, no builds.

## Rules for this job

The same as step 1: follow `CLAUDE.md`; never touch `~/DesignLibrary` or port 4646; never `bun run build` or `bun run start`; do not restart the real app; do not commit. Other sessions are editing this folder (`server/chat.ts`, `server/mcp-tools.ts` and others hold changes that are not yours): never `git stash`, `git checkout`, `git reset` or reformat, and change only the lines this plan needs. No change to the database, no new dependency. Comments and descriptions in plain words that say why.

## Before changing anything

`PANEL_PORT=4799 PANEL_LIBRARY_DIR=.copy/lib bun scripts/measure-search.ts > .copy/measure-2a-before.txt 2>/dev/null`

Expected: `search energetic` 9,025 chars; `search, no words (newest)` 11,564; `open one save, type only` 878; `TOOLS` 30,797. If yours differ, use yours and say so.

## What to build

### 1. A short card says its first sentence once (`server/library.ts`)

Most saves have no title of their own, so `title` falls back to the start of the read's summary, and `about` is that same sentence again. On a **short card only**:

- a save with its own title (`r.title`): `title` and `about`, as now;
- a save without one, but with an `about`: leave `title` out;
- a save with neither: `title` as now (the link, or "Untitled").

The full card (`card()`) and the one-line list (`listLine()`) stay exactly as they are.

### 2. The way back to the save (`server/library.ts`, `server/mcp-tools.ts`)

Short cards carry no `open` link, which is right. But `INSTRUCTIONS` still ends "Always give the designer the "open" link for each save you recommend", and `get_reference` with `facets` (the cheap way to open a save before recommending it) doesn't have the link either.

- Add `open` to the `get_reference` answer when `facets` is given.
- Reword that last line of `INSTRUCTIONS` so it says where the link is (in `get_reference`'s answer), in about the same number of words.

### 3. A search with nothing asked lists no extra lines (`server/library.ts`)

With no `query`, no `look` and no `colors`, a search is only "the newest saves that pass the filters". The 60 lines after the cards are then just more of the library, not matches. In that case leave `more` out; `not_listed` counts everything after the cards, and `next` says how to see them (a query, or `offset`). `showing` says only the cards.

A search with words, a look or colors is unchanged.

### 4. Conversations are shortened sooner (`server/chat.ts`)

`COMPACT_WINDOW` goes from `320_000` to `240_000`: the conversation is summarized at about 210K tokens, where it was about 290K. The designer chose the middle between 150K and 320K.

Rewrite the comment above it so it stays true, and add why in a sentence: across 550 past requests the average conversation was 141K tokens and a quarter of all requests ran above 210K; every step re-reads the whole conversation, and a conversation picked up after an hour is written again in full, so its size is what both cost.

Check, by reading the code (not by running Claude), that nothing else assumes 320K or 290K: the meter in FRIDAY's panel takes its limit from what Claude Code reports (`panel_context`, `context_limit`), so it should follow by itself. Say in the report what you found. Change nothing in `web/`.

## Tests

Update `tests/search.test.ts` for 1–3 (a titled and an untitled save; `open` present with `facets`; no `more` on a search with nothing asked, and `more` still there with a query). Then `bun run typecheck` and `bun test tests`: both must pass. A failing test that isn't yours: check whether it fails without your change, and report it rather than fix it.

## Measure again

`PANEL_PORT=4799 PANEL_LIBRARY_DIR=.copy/lib bun scripts/measure-search.ts > .copy/measure-2a-after.txt 2>/dev/null`

| line | must be |
|---|---|
| every `ORDER` line | identical to before |
| `search energetic` | at most 8,400 chars, still 12 cards + 28 lines |
| `search, no words (newest)` | at most 6,500 chars, 12 cards, no lines |
| `search dark (a common word)` | still 12 cards + 60 lines, shorter than before |
| `search energetic, full cards`, `gather for a brief`, `open one save, no pictures` | same chars as before |
| `open one save, type only` | at most 950 chars |
| `TOOLS` | at most 30,800 chars |

## The report

Write `docs/shorten-sooner-report.md`: what changed in each file; anything done differently and why; the script's lines before and after, side by side; whether every `ORDER` line matched; what you found about the 320K/290K assumption; typecheck and test results; doubts. End with two plain sentences for the designer. Mention that Panel on 4646 keeps the old behaviour until it is restarted and that nothing was committed.

## Not in this step

The two-model hand-over, picture sizes, the Skills page, anything in `web/`, any change to ranking.
