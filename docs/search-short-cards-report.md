# Report: shorter search answers for FRIDAY (step 1)

Carried out on 11 Nov 2026 from [search-short-cards-plan.md](search-short-cards-plan.md). Everything was tried on the copy (`.copy/lib`). Nothing was committed, the real app on 4646 was not touched or restarted, and the database was not changed.

## 1. What changed

- **`server/library.ts`**
  - `card()` is unchanged. It is now the full card. Its title rule moved into a small `titleOf()` so the short card uses the same rule; the output is the same.
  - New `shortCard()`, which has `id`, `title`, `type`, `about`, `mood` (first 4), `colors` (the 3 biggest by share, as `#hex name 42%`), a line for each facet searched within, `note` (whole), `tags`, `favorite`, `unread`, and the same "why it was found" extras as before.
  - New `listLine()`: `id · title (≤60) · 3 moods`, as a plain string. New `cut()` cuts text at a word with `…`.
  - `search()` takes `detail` (`"short"` by default). `"full"` is today's code path, unchanged. `"short"` gives `results`, `more` (up to 60 lines), `not_listed`, `showing` and `next`.
  - `findByColor()` and `similar()` take `detail` too (short by default, `like` included). `gather()` asks `search()` for `detail: "full"`, so its answer is unchanged.
  - `reference(id, facets?)`: with facets, it returns only `id`, `title`, `type`, `note`, `tags`, `favorite`, the full `facetView` of each facet asked for, and `worth_taking`. `in_projects` is still added in `mcp-tools.ts`. Pictures work the same either way.
- **`server/mcp-tools.ts`**
  - `search_library`, `find_by_color` and `similar_to` take a shared `detail` input. `get_reference` takes `facets`.
  - The descriptions of `search_library` and `get_reference` were reworded, along with their two lines in `INSTRUCTIONS`.
- **`server/chat.ts`**: one sentence added under "How to work", next to the search line. Nothing else changed.
- **`README.md`**: the `search_library` and `get_reference` rows in the tools table now describe the new answers. The grep for `worth_taking|type_summary|motion_summary` found nothing else that depends on search results having those fields:
  - `server/read.ts` and `web/src/Reading.tsx` use the design read itself.
  - `web/src/api.ts` is the read's type.
  - `web/src/Assistant.tsx` only uses each tool part's `refs`, `total` and `input.ids`. Confirmed.
- **`tests/search.test.ts`** (new): 10 tests covering everything listed under "Tests" in the plan.
- **`.claude/launch.json`**: added `panel-copy-search` on port 4757, because another session's server was already on 4747.

**Done differently from the plan, and why:**

- **The `detail` description is shorter than the plan's wording.** It reads: "short (default): a short card each. full: the whole card, up to 4× longer; only when you need every save's detail." With the plan's exact line on three tools, the tool definitions came to 30,987 characters, over the 30,800 limit. I also tightened the two reworded descriptions until they fit (30,797).
- **`not_listed` counts only the saves after the lines.** It leaves out any saves before `offset`, since those were already shown on an earlier page. The `next` sentence ("N more matched and aren't listed") would mislead otherwise. Without `offset` the two counts are the same.
- **A search that shows nothing** says `showing: "nothing to show of N"` and has no `next`.
- **`fonts_measured` appears on a typography short card even when the read says `present: false`.** The search finds sites by their measured fonts even then, so the card should show why it was found. The typography summary itself is left out in that case, as the plan says.
- **The mood-facet line is keyed `style_references`.** `mood` is already the card's mood list.

## 2. Numbers

The baseline matched the plan's expected numbers exactly: 22,271 / 40 / 12, 24,637 / 156, 17,491 and 8,746.

| line | before (chars) | after (chars) | change | after: what's in it |
| --- | ---: | ---: | ---: | --- |
| TOOLS | 30,001 | 30,797 | +3% | (limit 30,800) |
| search energetic | 22,271 | 9,025 | −59% | found 40, 12 cards, 28 lines |
| search energetic, full cards | 22,271 | 22,271 | 0% | found 40, 12 cards |
| search energetic in mood | 19,035 | 9,744 | −49% | found 40, 12 cards, 28 lines |
| search energetic in motion | 25,339 | 12,350 | −51% | found 53, 12 cards, 41 lines |
| search dark (a common word) | 24,637 | 11,840 | −52% | found 156, 12 cards, 60 lines |
| search bold (a common word) | 23,437 | 11,955 | −49% | found 79, 12 cards, 60 lines |
| search calm editorial serif | 26,953 | 12,367 | −54% | found 113, 12 cards, 60 lines |
| search by look | 26,106 | 8,442 | −68% | found 40, 12 cards, 28 lines |
| search words + look | 24,788 | 12,430 | −50% | found 117, 12 cards, 60 lines |
| search, no words (newest) | 21,361 | 11,564 | −46% | found 206, 12 cards, 60 lines |
| find by color #e2372b | 26,749 | 8,755 | −67% | found 13, 12 cards |
| gather for a brief | 17,491 | 17,491 | 0% | 15 cards |
| similar to the top save | 26,681 | 5,156 | −81% | 10 cards |
| similar in look and color | 23,190 | 7,135 | −69% | 10 cards |
| open one save, no pictures | 8,746 | 8,746 | 0% | |
| open one save, type only | 8,746 | 878 | −90% | (before: `facets` didn't exist, so it was the whole save) |
| open one save, first picture | 8,856 | 8,856 | 0% | 1 picture |
| open three saves, first picture | 21,040 | 21,040 | 0% | 3 pictures |

**Every `ORDER` line matched (all 13).** Every target in the plan is met:

| target | must be | is |
| --- | --- | --- |
| search energetic | 12 cards + 28 lines, ≤ 9,500 | 12 + 28, 9,025 |
| search dark | 12 cards + 60 lines, ≤ 13,000 | 12 + 60, 11,840 |
| search energetic, full cards | 22,271 | 22,271 |
| gather for a brief | 17,491 | 17,491 |
| open one save, type only | ≤ 2,500 | 878 |
| open one save, no pictures | 8,746 | 8,746 |
| TOOLS | ≤ 30,800 | 30,797 |

The same length doesn't prove the same answer, so I also hashed the old and new answers on the copy. I ran the committed `library.ts` and the new one side by side, from a throwaway copy of `server/` inside `.copy/`, deleted afterwards. These were identical byte for byte:

- `search` with `detail: "full"`: three different queries, including one with facets and one with look;
- `gather`;
- `findByColor` and `similar` with `detail: "full"`;
- `reference` without facets.

The raw outputs are in `.copy/measure-before.txt` and `.copy/measure-after.txt`.

## 3. Live check

The same question both times, in a new library-page conversation on the copy (port 4757): *"Find me five references that feel energetic. One line each on what to take."* Model: claude-opus-5-5, effort high, for both.

| | before (old code) | after (new code) |
| --- | --- | --- |
| input (uncached) | 8 | 6 |
| cache read | 105,022 | 43,959 |
| cache write | 46,480 | 43,673 |
| output | 1,309 | 1,341 |
| tools, in order | `search_library` {query "energetic, dynamic, bold, high energy, kinetic", limit 15} → `get_verdicts` → `search_library` {query "energetic vivid punchy", look "an energetic, loud, vivid design with big bold type and movement", limit 10} → `get_reference` (5 ids, images "first") | `search_library` {query "energetic, bold, dynamic, high energy, loud", limit 15} → `get_verdicts` → `get_reference` (7 ids, facets mood, color, motion, typography; images "first") |
| text the library tools returned (measured afterwards on the copy) | about 33,200 + 20,100 + 34,800 = 88,100 chars, 5 pictures | about 13,600 + 16,600 = 30,200 chars, 7 pictures |
| five saves named | `1c91ee92f6104b43`, `181dac95f75049fe`, `0d23a7fb9ec74ced`, `d5d99d39d6694040`, `1a953080dcc14ffd` | `1c91ee92f6104b43`, `9b46f2f5b15b4522`, `0d23a7fb9ec74ced`, `181dac95f75049fe`, `d5d99d39d6694040` |

Four of the five saves are the same: the giffgaff reveal reel, the Play brand identity, Pintori's Olivetti poster and the Apple Pay film. The before run's fifth was an acid-lime-on-green identity (`1a95…`). The after run's fifth was the RTS event identity with the gooey wordmark (`9b46…`).

### Before: FRIDAY's answer, in full

> Here are five that feel energetic, each in a different way:
>
> [[1c91ee92f6104b43]]
> [[181dac95f75049fe]]
> [[0d23a7fb9ec74ced]]
> [[d5d99d39d6694040]]
> [[1a953080dcc14ffd]]
>
> - [[1c91ee92f6104b43]]: Take the chaos-to-order motion. Signpost shapes burst out, line up and lock into a tiled pattern, all with sharp, sometimes stepped easing on charcoal #181818 and neon #42ff5c.
> - [[181dac95f75049fe]]: Take the pace. One heavy grotesk wordmark stays in the same spot while the surface under it changes every 0.25s: sticker, cap, billboard, tattoo, steam on glass.
> - [[0d23a7fb9ec74ced]]: Take the energy that comes from repetition. One curved arrow branches out in every direction, and the translucent overprinted colors (#d83203, #f4be02, #49ae5b, #2e8396) mix where they cross.
> - [[d5d99d39d6694040]]: Take the rhythm. Whip pans and blurred props run at about 31 cuts a minute, and the calm phone-payment shot is the pause between beats.
> - [[1a953080dcc14ffd]]: Take the color tension. Acid lime #cbf04e against near-black green #19261d, with small red-orange and sky-blue heat-map stripes inside the graphics.
>
> Two rule conflicts to watch. The giffgaff stickers and name tags are tags, which your rules count as slop, so take its motion and color, not those. And skip the italic serif on the Olivetti poster; the arrows are the part worth taking.

### After: FRIDAY's answer, in full

> Five that feel energetic, each for a different reason:
>
> [[1c91ee92f6104b43]] [[9b46f2f5b15b4522]] [[0d23a7fb9ec74ced]] [[181dac95f75049fe]] [[d5d99d39d6694040]]
>
> - [[1c91ee92f6104b43]]: Charcoal **#181818** and acid green **#42ff5c** keep swapping places as background and figure. Take the move where scattered shapes burst out and then lock into a tiled pattern that becomes the next backdrop.
> - [[9b46f2f5b15b4522]]: Take the gooey wordmark whose letters stretch out to the screen edges and become a border around the content. Behind it, a deep green **#1d8a64** ground with changing bright letter colors (mint, chartreuse, pink).
> - [[0d23a7fb9ec74ced]]: The whole poster is one arrow that keeps branching, in see-through overlapping primaries. Where colors cross they make new darker shades, which gives it energy without any gradients. Take the arrows, not the italic serif in the middle, which your rules flag.
> - [[181dac95f75049fe]]: The same heavy grotesk wordmark stays in one spot while hard cuts swap what it's on every ~0.25s. Also take the headline that builds word by word on magenta **#e950b4**. If you use that white card, its corners need squircle smoothing.
> - [[d5d99d39d6694040]]: Take the pacing. Fast whip pans and motion blur, then a calm product shot as the breather, then a still wide shot with two small words to end. The energy comes from the contrast with stillness.
>
> The first two are the loudest. The Olivetti poster has the most energy with the least type, if you need something calmer to sit alongside.

### My honest read

The new answer is as good. Both give hex values for three of the five saves. The new one says a little more about how each save works (the colors that cross into new shades, the wordmark that becomes a border, energy from contrast with stillness), and applies the designer's rules to particular saves (the italic serif, squircle corners). It lost the before run's note that the giffgaff stickers count as slop under the rules.

FRIDAY understood the new answers:

- It searched once instead of twice.
- It opened saves before recommending, and opened **more** of them: 7 instead of 5. Each came with `facets` (mood, color, motion, typography) and the first picture.
- It never asked for `detail: "full"`.
- Two of the seven saves it opened were only in the lines, not the cards: `d5d99d39d6694040` was line 15 (30th overall) and `0670ada20a184b60` was line 46 (61st overall). So it read the lines and used them. One of those two made the final five.

It asked for four of the seven facets, so its `get_reference` answer was smaller than a whole read but not tiny.

Tokens fell from about 151,500 to about 87,600 (input + cache read + cache write). Most of the drop is in cache reads, from one fewer search and one fewer model turn. One run each is a sanity check, not a measurement: a different run might search twice.

In the browser on the copy, the search step in FRIDAY's panel still shows its thumbnails (one per card, 15) and the count (183). The answer shows the five saves as cards and inline chips as before. Screenshot: `.copy/live-check-after.jpg` (kept out of git with the rest of `.copy/`).

## 4. Checks

- `bun run typecheck`: passes.
- `bun test tests`: **61 pass, 0 fail** across 12 files. The 10 new tests in `tests/search.test.ts` are included. No other session's test failed.

## 5. Not done / doubts

- **The `open` link.** Short cards and `get_reference` with `facets` have no `open` link, as planned. `INSTRUCTIONS` still ends with "Always give the designer the 'open' link for each save you recommend". FRIDAY doesn't need it (it writes `[[id]]`). An outside MCP client like Claude Code gets the link only from `get_reference` without `facets`. Worth a look in a later step: maybe add `open` back to the facets answer (about 40 characters), or reword that line.
- **Title and `about` repeat each other on saves with no title.** The title falls back to the summary's first sentence cut at 90 characters, and `about` is that same sentence cut at 160. Most saves on the copy have no title, so about 90 characters per card are repeated. I kept the plan's shape. Dropping the fallback title on short cards, or leaving out `about` when it starts with the title, would save roughly another 1,000 characters per search.
- **Lines show moods by meaning.** Some lines in an "energetic" search show moods like "contemplative, expansive, warm", because they were found by meaning, not by the word. That is the ranking, which was not to change, but a line can look off-topic.
- **TOOLS has 3 characters to spare.** Another session that adds a tool or lengthens a description will push it over 30,800. The limit was this step's own, so that's fine, but the next step should know.
- **The short card lost the rules warning on the giffgaff reel**, as noted in the live check. FRIDAY still opened every save it recommended, so the warning came from what it chose to read, not from a missing field.
- **Server left running.** My copy server on 4757 (`panel-copy-search`) is still running the new code. The other session's server on 4747 was left alone.

## 6. Note for the designer

FRIDAY's searches now come back about half as long. It sees the best dozen as short cards and the rest of what was found as one line each, and opens the few it wants to recommend in full. In a test on the copy it gave an answer as good as before while reading about a third as much from the library. Your real Panel keeps the old answers until it is restarted. Nothing has been committed.
