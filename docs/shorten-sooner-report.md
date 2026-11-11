# Report: three leftovers from the short cards, and shortening conversations sooner (step 2a)

Carried out on 11 Nov 2026 from [shorten-sooner-plan.md](shorten-sooner-plan.md). Everything was tried on the copy (`.copy/lib`), through the measuring script and the tests; no server of mine was started. Claude was called **zero** times. Nothing was committed, the real app on 4646 was not touched or restarted, and the database was not changed.

## What changed

- **`server/library.ts`**
  - `shortCard()`: `title` is now `d.r.title` when the save has its own title; left out when it has none but has an `about`; and the old fallback (the link, or "Untitled") when it has neither. A comment above says why. `card()` and `listLine()` are unchanged.
  - `search()`, short answers only: when nothing is asked (no `query`, no `look`, no `colors`), no lines are listed after the cards. `more` is left out, `not_listed` counts everything after the cards, `showing` names only the cards, and `next` says: "N more aren't listed: search with words, a look or colors to find the right ones, or ask from offset X for the next newest." A search with words, a look or colors is unchanged. The `detail: "full"` path is untouched.
  - `reference()` with `facets`: now ends with `open` (the link back to the save in Panel), with a one-line comment on why.
- **`server/mcp-tools.ts`**: the last line of `INSTRUCTIONS` is now: *For each save you recommend, give the designer its "open" link from get_reference's answer, so they can watch or look at the original.* It was 22 words and is now 24. Nothing else in the file was touched.
- **`server/chat.ts`**: `COMPACT_WINDOW` went from `320_000` to `240_000`. The comment above it was rewritten to say it means about 210K, what it was before (320K, about 290K), and why: the 550 requests, the 141K average, a quarter above 210K, and that every step re-reads the conversation and one picked up after an hour is written again in full. Nothing else in the file was touched.
- **`tests/search.test.ts`**:
  - In setup, two saves lose their titles: one read save (`read[2]`) and one with no read (`ids[1]`).
  - New test "a short card says its first sentence once": a titled save has `title` and `about`, the untitled read save has only `about`, and the bare save is titled "Untitled" with no `about`. The full card keeps its fallback title.
  - New test "a search with nothing asked lists no lines after the cards": no `more`, `not_listed` 88, the right `showing` and `next`, and the offset follows on page two. A tag filter alone also lists no lines.
  - The "lines, in the same order" test now searches with words (`"save"`), since a search with nothing asked no longer has lines. Its line-format check uses a small `"energetic"` search with `limit: 1`.
  - The `get_reference` with facets test now expects `open`.

**Done differently from the plan, and why**

- **`README.md`, one word.** The FRIDAY section said compaction happens "at about 290K tokens". It now says 210K. The plan asked me to check that nothing else assumes 290K, and that line would have become untrue. It is the only change outside the plan's files, and it is not in `web/`.
- **Expected counts in the lines test.** "save" is in 98 titles, but the untitled read save's own summary also has the word "save" ("…says what the save is"). So it is found as well, and the test expects 99. Not a bug, just the test's own words.

## Numbers

The baseline matched the plan's expected numbers exactly: 9,025 / 11,564 / 878 / 30,797.

| line | before (chars) | after (chars) | change | after: what's in it |
| --- | ---: | ---: | ---: | --- |
| TOOLS | 30,797 | 30,797 | 0% | 27 tools |
| search energetic | 9,025 | 7,929 | −12% | found 40, 12 cards, 28 lines |
| search energetic, full cards | 22,271 | 22,271 | 0% | found 40, 12 cards |
| search energetic in mood | 9,744 | 8,721 | −10% | found 40, 12 cards, 28 lines |
| search energetic in motion | 12,350 | 11,307 | −8% | found 53, 12 cards, 41 lines |
| search dark (a common word) | 11,840 | 11,131 | −6% | found 156, 12 cards, 60 lines |
| search bold (a common word) | 11,955 | 11,223 | −6% | found 79, 12 cards, 60 lines |
| search calm editorial serif | 12,367 | 11,414 | −8% | found 113, 12 cards, 60 lines |
| search by look | 8,442 | 7,479 | −11% | found 40, 12 cards, 28 lines |
| search words + look | 12,430 | 11,459 | −8% | found 117, 12 cards, 60 lines |
| search, no words (newest) | 11,564 | 4,435 | −62% | found 206, 12 cards, no lines |
| find by color #e2372b | 8,755 | 7,748 | −12% | found 13, 12 cards |
| gather for a brief | 17,491 | 17,491 | 0% | 15 cards |
| similar to the top save | 5,156 | 4,388 | −15% | 10 cards |
| similar in look and color | 7,135 | 6,249 | −12% | 10 cards |
| open one save, no pictures | 8,746 | 8,746 | 0% | |
| open one save, type only | 878 | 932 | +6% | now with `open` |
| open one save, first picture | 8,856 | 8,856 | 0% | 1 picture |
| open three saves, first picture | 21,040 | 21,040 | 0% | 3 pictures |

**All 13 `ORDER` lines are identical to before.** Every target is met:

| target | must be | is |
| --- | --- | --- |
| search energetic | ≤ 8,400, 12 cards + 28 lines | 7,929, 12 + 28 |
| search, no words (newest) | ≤ 6,500, 12 cards, no lines | 4,435, 12, no lines |
| search dark | 12 cards + 60 lines, shorter than 11,840 | 12 + 60, 11,131 |
| search energetic, full cards | 22,271 | 22,271 |
| gather for a brief | 17,491 | 17,491 |
| open one save, no pictures | 8,746 | 8,746 |
| open one save, type only | ≤ 950 | 932 |
| TOOLS | ≤ 30,800 | 30,797 |

On the copy, only 1 of the 12 cards in the "energetic" search has a title of its own, so dropping the repeated title is where most of the 1,100 characters came from.

The raw outputs are in `.copy/measure-2a-before.txt` and `.copy/measure-2a-after.txt`.

## The 320K / 290K assumption

I read the code; I did not run Claude. Only one place sets the size, and the meter follows it on its own:

- `COMPACT_WINDOW` is used in one place: `settings: { autoCompactWindow: COMPACT_WINDOW }` in `viaSdk` (`server/chat.ts`).
- After each answer, `viaSdk` asks Claude Code for `getContextUsage()` and passes on `autoCompactThreshold` as the limit (`panel_context`). `server/chat.ts` stores it in `chats.context_limit` and sends it to the panel as `{ t: "context", used, limit }`.
- `web/src/ModelPicker.tsx` shows `used / limit` as a percentage (the chip from 50%, "high" from 85%). `web/src/api.ts` has only the `ContextUse` type. Nothing in `web/` holds a number of its own, and nothing in `web/` was changed.
- A search for `320`, `290` and `compact` across `server/`, `web/src/`, `tests/`, `scripts/`, `README.md` and `CLAUDE.md` found only the README line (fixed, see above). The other hits are unrelated: `IDEAL_COL = 320` in the grid, and "320px" in a comment in `media.ts`.

**One small thing to know:** an old conversation keeps the limit stored with it (about 290K) until its next answer. So right after the restart, its meter will read a little low until the next message updates it.

## Checks

- `bun run typecheck`: passes.
- `bun test tests`: **63 pass, 0 fail** across 12 files. That includes the 12 tests in `tests/search.test.ts`, two of them new. No other session's test failed.

## Doubts

- **"About 210K" is the plan's figure, not one I measured.** Claude Code compacts a little before the window it is given, and 320K gave about 290K. I took the same gap for 240K and did not run Claude to confirm it. The meter in the model menu will show the real number after the first answer on the new code.
- **A card with no title now leans on `about`.** A model that wants a name for such a save will take it from `about`, which is the same sentence the old title was cut from. FRIDAY writes `[[id]]` anyway, so nothing it shows the designer depends on the title.
- **TOOLS is still at 30,797 of 30,800.** This step did not touch the tool descriptions. The next session that adds or lengthens a tool will go over that limit.
- **`open` on `get_reference` with facets uses the address Panel runs on.** On the copy the link came out as `http://127.0.0.1:4799/?open=…`. On the real app it will be the 4646 address, the same as the full answer has always given.

## For the designer

Searches now come back a little shorter: a save without a title no longer says its first sentence twice. Asking for "the newest" no longer lists 60 extra saves. FRIDAY's conversations will be summarized at about 210K tokens instead of about 290K, so long chats stay cheaper.

Panel on 4646 keeps the old behaviour until it is restarted, and nothing was committed.
