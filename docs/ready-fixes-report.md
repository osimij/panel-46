# Report: three fixes to ready-made parts (icons by name, colours only when asked, fonts in a copy)

Carried out from [ready-fixes-plan.md](ready-fixes-plan.md) on 11 Nov 2026, on the ready-made copy (`.copy/lib-ready`, UI in `.copy/dist-ready`, port 4787). Nothing was committed or pushed, the real library and the real app (4646) were not touched, the database did not change, no dependency was added, and `scripts/copy.sh` was changed but never run.

## 1. What changed

New files:

- `server/parts.ts`: the filling and the turning back. Pure: it reads only `ready/` through `ready.ts`. `fillParts` (tags → drawings), `shortParts` (exact drawings → tags), plus two small helpers for reading only: `draftWithParts` (the live draft) and `shortPartsLoosely` (what the designer points at in the studio).
- `tests/parts.test.ts`: 9 tests of the file on its own.

Changed:

- `server/sketches.ts`: `writeVersion` fills the parts, then checks the size.
- `server/board.ts`: `editSketch` makes its edits on the short form.
- `server/mcp-tools.ts`: `get_sketch` and `get_figma_frame` hand back the short form; new words in `INSTRUCTIONS`, in `make_sketch`'s `html` and in `get_ready_made`'s descriptions.
- `server/chat.ts`: the two bullets in `SYSTEM`; the pointed-at HTML is shortened; the live draft is filled.
- `server/ready.ts`: Panel's own words for 20 everyday icons; a closer "closest names" (a swapped pair of letters counts as one change, so "gaer" finds gear); `nearLoading` for a mistyped loading name; the answers now point to the tags.
- `web/src/Assistant.tsx`: step labels for `get_ready_made`.
- `scripts/copy.sh`, `CLAUDE.md`, `README.md`: a copy gets `fonts` and `brand`.
- `tests/ready.test.ts`: 5 new tests.

Done differently from the plan, or beyond it, and why:

- **Where a loading animation's style goes.** Right before its first use. If that use is inside a `<template>`, the style goes before the template, because a style inside a template doesn't reach the page. It is not put in `<head>`: with the style beside its first use, "turn back, then fill again" gives the same bytes in every case, including pages someone has edited.
- **When a loading animation is turned back.** Only while its exact style is in the page. Its style is taken out only when it is the one copy and sits exactly where filling would put it back. Otherwise the style stays in the short form and filling adds no second one. This is what keeps the round trip byte for byte when a person has moved or changed things.
- **The weight is always marked** (`data-panel-weight="regular"` too), so turning back never has to guess.
- **Other attributes on a tag are dropped.** Only `class`, `id`, `style`, `title` and `aria-label` are carried over (`width="20"` or `data-x` are not; an icon is sized by font-size).
- **`aria-label` on a loading tag** works like on an icon: `role="img" aria-label="…"` replaces `aria-hidden`, and the piece's `role="presentation"` is removed.
- **A tag written any way** (self-closing, single quotes, no quotes, spaces before `</panel-icon>`) comes back from the short form written one way. Filling that gives the same drawing.
- **Two small additions beyond the plan, both read-only.** (1) FRIDAY's live draft (the small preview while a sketch is being written) now shows the icons; before, it would have shown empty spots where the tags are. A half-written or wrong name just stays a tag there. (2) What the designer points at in the studio reaches FRIDAY with icons and loading pieces as tags. That HTML comes from the browser, which writes a drawing a little differently from the file, so this matching is loose. It is only for reading, never for saving.
- **One instruction line added after message 2.** In message 2, FRIDAY styled the loading piece with a CSS rule on the tag's own name (`.meta panel-loading{--ld-size:13px}`). That rule matches nothing once Panel replaces the tag, so the ring drew at 16.25px instead of 13px. FRIDAY and other AI apps are now told: "The tag itself is replaced, so style a part through a class on it, never by the tag's name in CSS." I restarted my copy (4787) between messages 2 and 3 to pick that up; message 3 styled its new icon by a class.
- **The `<template>` line was added after the live check.** The plan says an icon a script needs goes in the HTML (in a `<template>`, or hidden) and the script copies it. I had built that into the filling but not said it to FRIDAY. It is now in `SYSTEM` and `INSTRUCTIONS`. None of the four sketches needed it (message 2's script clones a row that is already on the page), so it is not tested live.
- **The closest names for "close"** are x, x-circle, arrows-in-line-vertical (the plan's example said x-square). They come from the same search `find_icons` uses.

## 2. Icons and loading by name

**How it works.** FRIDAY writes `<panel-icon name="trash"></panel-icon>` (optional `weight`) and `<panel-loading name="ring"></panel-loading>`. Every save goes through `writeVersion`, which calls `fillParts`:

- An icon becomes `<svg data-panel-icon="trash" data-panel-weight="regular"` followed by `iconSvg()`'s own SVG from `xmlns` on, character for character. A carried class goes right after the marks; `id`, `style` and `title` go at the end of the opening tag.
- A loading tag becomes the piece's markup with `data-panel-loading="ring"` on its root and the carried class after `ld-ring`. Its `<style data-panel-loading="ring">` (with the piece's licence line as a CSS comment) is put in once.
- Tags are only looked for in the page's HTML. A small reader in `parts.ts` walks the tags and steps over comments, doctypes, and the text inside `script`, `style`, `textarea` and `title`. It also respects quoted values, so a tag written inside an attribute or a script string is left alone.
- A wrong name throws before anything is written. Every wrong tag is listed in one message: "There is no icon called “close”. Closest: x, x-circle, arrows-in-line-vertical. … Nothing was saved: fix the name and try again (get_ready_made find_icons finds icon names)." The size limit is checked on the filled page.

**Turning back** (`shortParts`) rebuilds what Panel would have put in from the marks and attributes it finds. It turns a part back only if the page has exactly that at that spot. Anything changed (a colour, one number in a path, a missing class) stays as it is.

**The hooks:** `writeVersion` (sketches.ts, fill); `editSketch` (board.ts, edits on the short form); `get_sketch` and `get_figma_frame` (mcp-tools.ts, short form); the pointed-at HTML and the live draft (chat.ts). The studio, the knobs, the words edited in place, Figma ("Copy for Figma" renders the served file) and a real build's hand-off (`writeHandoff` copies the file as is) all get the whole page, as before. Knob and text saves also go through `writeVersion`, but a filled page has no tags left, so nothing changes there.

**What the four messages showed** (counted by a small script from the saved conversations and pages):

| Message | Tags FRIDAY wrote | Drawings it typed | Saved page: parts that are exactly Panel's |
| --- | --- | --- | --- |
| 1 | none (it asked, made nothing) | none | no page |
| 2 make_sketch | 9 `<panel-icon>`, 1 `<panel-loading>` | none (one `<svg class="edge">` with a `<rect>` for the dashed drop-area edge, not an icon; its own edit took it out) | v1: 9 of 9 icons, 1 of 1 loading (and its style). v2 the same |
| 3 edit_sketch | 3 `<panel-icon>` (magnifying-glass for search, and x for the clear button) | none | v3: 11 of 11 icons, 1 of 1 loading |
| 4 make_sketch | 5 `<panel-icon>`, 1 `<panel-loading>` | none | v1 and v2: 5 of 5 icons, 1 of 1 loading |

- **Message 3, the parts already on the page:** all 11 drawings and the style from version 2 are in version 3 byte for byte. FRIDAY read the page with `get_sketch` (tags, no drawings) and made its edit on that. One of its `find`s held a part's tag and was found.
- **Size of what FRIDAY wrote against what was saved:** message 2: 10,352 characters written, 15,346 saved. Message 3: 2,466 written for the edit. Message 4: 9,530 written, 12,627 saved.
- **One weight a page:** message 4 used `check` in bold beside regular icons (the tick that appears after saving). That goes against "one weight on a page".
- **A Claude Code hiccup, not from this change:** in message 4, FRIDAY's first `make_sketch` call came back "No such tool available: make_sketch", which is Claude Code's own error. It sent the same page again at once and it worked.

Files: `.copy/readyfix-friday-1.json` to `-4.json` (the conversations with every tool call), `.copy/readyfix-friday-2-sketch.html` / `.jpg`, `-3-sketch…`, `-4-sketch…`.

## 3. Colours

The exact words FRIDAY now gets (`SYSTEM` in `server/chat.ts`):

> Colours: never use or imitate one of Panel's palettes unless the designer asks for one. Colours are settled when the project has a locked Color decision or brand assets that carry its colours, when the sketch you are changing has them, or when the designer has said in this conversation what colours to use ("pick calm colours" means your own; "use Slate" means that palette). Then don't ask, and open a palette only if one was named. When colours aren't settled, ask before you sketch, in one short question, and stop there: your own colours, or one of Panel's palettes. You may name two or three palettes that would suit, by name only. The answer holds for the rest of the conversation: don't ask again. When they pick a palette, use its values exactly as they are: a 12-step scale by what each step is for, a smaller set as its colours. Add a colour of your own only for something the palette doesn't have, and say which. In Plan, then build, the planner is the one who asks; the builder uses the colours the plan gives.

Other AI apps get the same in `INSTRUCTIONS`, a little shorter (no "the sketch you are changing", no planner line). `get_ready_made`'s `palette` now says "only once the designer asked for one". A palette's answer starts: "Only because the designer asked for a palette: use these values exactly as they are, and add a colour of your own only for something it doesn't have (say which)." FRIDAY has no way to offer answers as buttons, so it asks a plain question.

What it did:

1. **Asked, made nothing** (15 s). It read the project and its brand assets, opened the list of parts to name palettes, then wrote: "Notes doesn't have colours yet. There's no locked Color decision and no brand assets. Should I use my own colours, or one of Panel's palettes? Good fits for a calm notes app would be sand, slate or olive-garden."
2. **Used Sand** (87 s). It opened only Sand. All five of Sand's light values are in the page exactly as they are (`--sand-1` to `--sand-5`). It added three colours of its own and said so in its reply ("Sand is five light tones with nothing dark enough for text"): text `oklch(0.27 0.02 50)`, quiet text `oklch(0.5 0.025 55)`, surface `oklch(0.985 0.004 80)`. One more of its own it did **not** mention: a shadow colour, `oklch(0.4 0.03 50)` at 6%, 12% and 18%. Nothing else in the page is a colour.
3. **Didn't ask again**; added the search field with the colours already on the page.
4. **Didn't ask, didn't open any palette** (120 s). It chose its own calm colours (#e8edef page, #1c2830 text, #4d7189 for switches that are on) and said what they are.

Not tried live: Plan, then build (all four were One model).

## 4. The copy script

`scripts/copy.sh` now clones `fonts` and `brand` with `media`, `projects` and `models`, the same way (cloned where the disk can, copied otherwise). The comments at the top and above the loop say what a copy holds. `CLAUDE.md` and `README.md` say it too. I did not run it.

By hand, for my copy: `~/DesignLibrary/fonts` (3 files, 920 KB) and `~/DesignLibrary/brand` (2 files) cloned into `.copy/lib-ready/` with `cp -c -R`, reading the real library only. The copy's database already had the same 3 fonts and 1 brand asset.

**Do the designer's fonts load now?** Yes, in Panel's own Chrome. Every render on this copy before today logged "Access to font at …/fonts/3337be1237de4874.ttf … blocked by CORS policy": the file was missing, so the answer was a 404 without the header. Every render today has no errors. The pictures show ALS Hauss Next, which messages 2 and 4 chose. The browser pane in this app refuses font files by itself (`net::ERR_BLOCKED_BY_CLIENT`, before any request reaches Panel), so a sketch opened there shows a fallback font. That's the pane, not Panel.

## 5. Checks

- `bun run typecheck`: clean.
- `bun test tests`: 188 pass, 0 fail, 21 files (9 new in `tests/parts.test.ts`, 5 new in `tests/ready.test.ts`). The two test files again after the last instruction line: 22 pass.
- `PANEL_PORT=4798 PANEL_LIBRARY_DIR=.copy/lib-ready bun scripts/measure-search.ts`, before and after: every search line and every `ORDER` line the same. **`TOOLS` before: 29 tools, 32,440 characters (about 10,138 tokens). After: 29 tools, 32,910 characters (about 10,284 tokens), 470 more**, all from the new words in `get_ready_made`'s and `make_sketch`'s descriptions. `INSTRUCTIONS` is not counted there. Files: `.copy/readyfix-measure-before.txt`, `-after.txt`.
- **A sketch with 13 icons:** the earlier session's upload sketch (`.copy/ready-friday-rerun-1-sketch.html`, 13 icons and a ring, all typed in by FRIDAY) was **18,033 characters** to write. The same page with tags (`.copy/readyfix-13-icons-as-tags.html`) is **10,832**: 7,201 fewer, about 550 for each icon. FRIDAY reads the same short form back.
- **`find_icons` with the extra words** (Panel's own come first; then the package's search fills the rest up to five). Before → now, first results:

| Word | Before | Now |
| --- | --- | --- |
| close | arrows-in-line-vertical (x fifth) | x, x-circle |
| menu | dots-three (no list) | list, dots-three |
| settings | wrench, gear | gear, gear-six, sliders-horizontal |
| search | magnifying-glass | magnifying-glass |
| delete | trash, backspace | trash, trash-simple |
| edit | credit-card, pen | pencil-simple, pencil |
| add | selection-plus | plus, plus-circle |
| back | skip-back | arrow-left, caret-left |
| more | dots-three | dots-three, dots-three-vertical |
| home | house, house-line | house, house-simple |
| user | user, users | user, user-circle |
| download | download | download-simple, download |
| upload | upload | upload-simple, upload |
| share | share, export | share-network, export |
| copy | copy, clipboard | copy, copy-simple |
| link | link, link-break | link, link-simple |
| info | info | info |
| warning | warning, radioactive | warning, warning-circle |
| success | nothing at all | check-circle, check |
| error | network-slash | x-circle, warning-circle |

Full lists: `.copy/readyfix-find-icons-before.txt`, `-after.txt`.

- **The step label**, seen in FRIDAY's panel on the copy: "Found icons". The others read "Read the palette ‹name›", "Looked at the loading animation ‹name›", "Got icons", "Looked at the ready-made parts".

## 6. Shared files

- `server/mcp-tools.ts`: one import (`shortParts`). In `INSTRUCTIONS`, the ready-made bullet rewritten and a colours bullet added after it. `get_ready_made`'s description and its `loading`, `palette` and `icons` descriptions. One sentence at the end of `make_sketch`'s `html` description. `get_sketch` pushes `shortParts(page)`. `get_figma_frame` reads `shortParts(readSketch(…))`.
- `server/chat.ts`: one import. In `SYSTEM`, the ready-made bullet rewritten and the colours bullet added after it. `shortPartsLoosely` on the pointed-at HTML. `draftWithParts` on the live draft.
- `server/sketches.ts`: one import. `writeVersion` fills before the size check (its parameter is now `given`, with a comment).
- `server/board.ts`: one import. One line (with a comment) in `editSketch`: `shortParts(readSketch(…))`.

I touched no skills file, nor `Detail.tsx` or `Grid.tsx`. I saw no failure that wasn't mine, and no other session's changes showed up in `git status` while I worked.

## 7. Doubts, and what the next step should know

- **CSS on a tag's name.** The new line should stop it. Panel could also catch it: a rule check that marks CSS selecting `panel-icon` or `panel-loading` would tell FRIDAY in the answer it already reads. Message 2's sketch still has the dead rule (its ring is 16px, not 13px).
- **Mixed weights** (message 4's bold tick). The rule is in the words but not checked. A check could count `data-panel-weight` values on a page, now that Panel can see them.
- **Pages from before this change** have typed SVGs with no marks. They stay exactly as they are and FRIDAY reads them as they are. Only new parts become tags.
- **A tag inside a script's text is not filled** (on purpose). A script that builds rows with `<panel-icon>` in a string shows nothing there. FRIDAY is now told to use a `<template>`; that line came after the live check.
- **Loose matching** of pointed-at HTML is for reading only. If the designer points at an icon someone changed, FRIDAY still sees it as a tag; its `find` would then fail and it would read the page with `get_sketch`, as it already does.
- **Plan, then build** was not tried live. The planner has `get_ready_made` and is told it is the one who asks.
- **Other copies.** Copies made before this change (`.copy/lib`, `.copy/lib-canvas`) still have no fonts or brand files until they are made again.
- **My copy on 4787 is still running** with the code from before the last `<template>` line. Restart it to pick that line up.
- The real Panel gets all of this only at a restart.

## 8. Note for the designer

FRIDAY no longer copies icon and loading drawings into sketches by hand. It writes a short name, and Panel puts in the exact drawing when the sketch is saved, so no icon can come back slightly wrong, and a sketch is about 40% shorter for FRIDAY to write. When a project has no colours yet, FRIDAY now asks you first: its own colours, or one of Panel's palettes. When you pick a palette, it uses that palette's colours exactly and tells you about any it adds. It doesn't ask when you've already said ("pick calm colours"). Test copies of Panel now get your fonts and logos. Nothing was committed, and your real Panel has none of this until it is restarted.
