# Panel today: how FRIDAY combines saved references

A read-only study, made on 16 Nov 2026 from the code in `/Users/osimij/Desktop/Panel46` (commit 46e5efe), the real library in `~/DesignLibrary/library.sqlite` (read with `sqlite3 -readonly`), and the Claude Code session files of FRIDAY's chats. Nothing was changed, no server was started, and FRIDAY was not asked anything.

"Combining" here means: making one new design by taking color from one save, type from another, a detail from a third.

Line numbers are for the files as they stand at that commit.

---

## 0. The short version

1. **FRIDAY is told to combine in one sentence, and never told how.** The words are "find, look at and combine their saves" (`server/chat.ts:318`) and "say what to take from each save" (`chat.ts:329`). There is no step that says how many saves to open, how to check that the picks fit each other, or how to compare the result with the saves.
2. **Every finding tool answers in words only.** `search_library`, `gather_for_brief`, `similar_to` and `find_by_color` never return a picture. Only `get_reference` (and `get_project` with `pictures: true`) shows saves, and by default it shows **one** picture per save, at about 1.2 megapixels.
3. **That one picture is often a contact sheet.** For 24 of the 35 saved sites the first picture is the whole page folded into 2 to 5 columns; for a video it is a grid of 8 or 9 small frames.
4. **`gather_for_brief` picks each facet on its own, by words and meaning.** Nothing checks that the color pick suits the type pick. Its only link between facets is "prefer a save not already picked".
5. **A sketch's answer shows only the sketch.** `make_sketch` and `edit_sketch` return up to three 1440×900 screens of the new page plus measured rule checks. The references are not shown beside it. In 117 answers that made or changed a sketch, FRIDAY re-opened a reference's pictures after seeing the render **once**.
6. **The design read is good raw material.** Every one of the 318 reads has exactly three `worth_taking` lines, and they are concrete moves ("Draw a trust/security section as a thin black rectangular line grid…"), not praise. But they are prose with almost no values (24 of 954 lines contain a hex).
7. **In real chats the designer does the combining.** They name the saves and the part of each. FRIDAY turns that into a list ("layout from A, glow from B") and a page. The designer's most frequent reaction words to the pages are *boring*, *templatic*, *generic*, *cliche*. What worked: pointing at one exact part of one save, and pasting their own screenshots of it.
8. **A record of "which saves a sketch used" exists**: 77 `uses` lines on canvases, for 25 of 38 sketches. It is what FRIDAY declared, not something checked.
9. **The canvas buttons made for combining are unused** in the stored chats: "Sketch from these" 0 times, Compare's "Take the best of each" 0 times, "Try 3 alternates" once.

---

## 1. What FRIDAY is told about combining

FRIDAY's instructions for a message are built fresh each time by `systemPrompt()` (`server/chat.ts:422-436`): the fixed text `SYSTEM` (`chat.ts:318-376`), the designer's fonts, then `unugly.md` inside `<designer-rules>`, then the designer's skills that are on. In "Plan, then build" the planner also gets `plannerNote` (`chat.ts:887-894`) and the builder gets `builderIntro` (`server/duo.ts:15`).

Panel's MCP server also has its own instructions (`server/mcp-tools.ts:23-46`). They do reach FRIDAY: each session file has an attachment `mcp_instructions_delta` with `addedNames: ['panel']`. **But FRIDAY receives them cut at about 4,100 characters**: the text ends `…and use them… [truncated]`, in the middle of the "Give a sketch knobs" line (`mcp-tools.ts:39`). The lines about combining are in the part that arrives.

### 1.1 The exact lines

**Finding references**

- `chat.ts:318`: "Use the panel tools to find, look at and combine their saves. Never invent a save."
- `chat.ts:326`: "Search before you say anything about the library. Search finds by words and by meaning, and by look when you describe one (look: "a dark dashboard with glowing charts"); found_by in its answer says which were used. If it says only "words", or results are thin, try other words or a facet."
- `mcp-tools.ts:26`: "Start with library_overview to learn the words the library uses (moods, fonts, motion techniques)."
- `mcp-tools.ts:27`: "gather_for_brief gives the best saves per facet for a brief in one call."
- `mcp-tools.ts:33`: "get_verdicts is the designer's taste across every project: what they chose and ruled out, with their reasons. Lean on it."
- `chat.ts:340`: "…read it [get_verdicts] before you suggest or sketch for a project, and don't bring back what they turned down for the same reason."
- `chat.ts:337` (on a canvas): "Place 4 to 8, the strongest first, each with a short why. Build on what's locked: a color search should suit the chosen type."

**Combining**

- `mcp-tools.ts:25`: "Use it to find references for a brief and to combine them: color from one save, type from another, motion from a third."
- `mcp-tools.ts:306` (gather_for_brief's description): "…the best saves for each facet on its own (color, typography, layout, imagery, motion by default), preferring different saves per facet so the mix is wide. This is where combining starts: e.g. "calm warm editorial banking app" might take its palette from a poster, its type from a magazine site and its motion from an onboarding video."
- `library.ts:741` (the last line of every gather answer): "Open the strongest picks with get_reference (images: \"all\") to look at them before combining."
- `chat.ts:329`: "Talk like a design partner: concrete about color (hex), type, layout and motion, and say what to take from each save. Keep it short; the pictures do the rest."
- `chat.ts:357`: "…Make it from what's settled: the locked decisions, their chosen saves (look at them first), the brief and materials."
- `chat.ts:365`: "Pass uses: the ids of the saves it takes from (type from one, color from another), so lines on the canvas show where it came from."
- `chat.ts:893` (planner only): "Say what to make and where it hangs (from:, the project and topic), and each save to use with what to take from it ([[id]] and the exact thing: the hex, the font, the layout move). … Concrete values, not adjectives. Number the steps."
- `duo.ts:15` (builder only): "Carry the plan out with the tools: make or change what it says, from the saves it names… Don't look for other references."
- `chat.ts:352` (step by step): "Every step builds on the ones before it: the words fit the sections, the color comes from the gem, the motion serves both."

**How many to open, and when to look at pictures**

- `chat.ts:327`: "Search answers are short cards for the best and a line each for the rest: open a save with get_reference before you say what to take from it, with facets when only one part matters."
- `chat.ts:328`: "Look at the pictures (get_reference) before you recommend a save for how it looks, when that matters."
- `mcp-tools.ts:31`: "get_reference returns everything about a save (the whole read, what's worth taking), and its pictures so you can look at it yourself; with facets, only those parts. Open and look before you recommend."
- `chat.ts:581` (when saves are selected on the canvas): "“This” and “these” mean what's selected; look at the saves with get_reference before you answer about them."
- `chat.ts:615` (when a save is mentioned with @): "…each [[id]] in their message is that save; look at it with get_reference when it matters."
- No line gives a number of saves to open or a number of pictures. The tool's own default is one picture per save (`mcp-tools.ts:324`, `images` default `"first"` at `:328`).

**Looking at its own sketch**

- `chat.ts:359`: "Look at the pictures that come back before you answer. Check them against the designer's rules and the brief: corners, buttons, type (Cyrillic set in real text), anything physical looking real, no slop. Fix what's off with edit_sketch, then look again. Only then reply."
- `mcp-tools.ts:109` (comes back with every sketch as `next`): "Look at the screens before you answer: check them against the brief, the locked decisions and the designer's rules, and fix what's off with edit_sketch first. …"
- `chat.ts:360`: "The answer also carries rule_checks… Fix every one marked "breaks". … They can't judge taste, so your own look still counts."

**Not copying, not generic**

- `chat.ts:431`: "The designer's rules (unugly.md) hold for everything you suggest, place, judge or write. They outrank any reference: take from a save only what passes them (a letter-spaced wordmark in a save they like is still out), and say so when a save you show breaks one."
- `server/skills.ts:327`: "Where anything disagrees, the designer's rules come first, then a project's locked decisions, then these skills, then any reference."
- `chat.ts:343`: "…don't sketch it straight away. Deciding the structure, the words, the color, the type and the motion all at once, alone, is what makes a template. Take it step by step with the recipe…"
- `chat.ts:348`: "Where the recipe asks for options (three headlines, three ideas), make them different in kind, not three shades of one, and say in a line what each comes from."
- `recipes/website.md:14`: "**One gem.** One thing nobody else has… It belongs to this brand and could not sit on another site. Color, layout and motion grow from it, so the site feels like one piece."
- `recipes/website.md:16`: "If the page could be another company's by changing the logo, it is not done."
- `recipes/website.md:75-77` (the Gem step): "Search the library for how others did each kind (search_library with look), and read get_verdicts for what this designer keeps choosing and keeps turning down." / "Offer three ideas, different in kind. For each: … and two or three saves that show the craft. Place those saves under the topic Gem." / "Test each idea: could it sit on another company's site? If yes, it is decoration, not a gem."
- `recipes/website.md:153`: "No section is a template block. … Three cards in a row is a choice, never a default."
- `recipes/website.md:156-159` (last check before showing the whole page): "What is the one thing a visitor will remember?… Could this page be another company's by changing the logo? Where? Which of the designer's rules does it brush against…"
- `recipes/poster.md:13, 48-50` say the same for a poster ("With another event's name on it, would it still work? Then it is decoration.").
- `unugly.md:32-50`: the overused layouts (letter-spaced wordmark, eyebrows) and the "Design slop indicators" list. These are about the page, not about how references are used.
- The only place the word "copy" appears for a reference is the canvas button for **one** save: "Sketch a direction from this save, for this project: take what it does best, not a copy of it." (`web/src/Canvas.tsx:1232`).

### 1.2 What is NOT said anywhere

I searched `server/`, `web/src/`, `recipes/`, `unugly.md`, `docs/skills/` and the README for "combin" and read every hit. These things are not in any instruction FRIDAY gets:

- **No method for combining.** Nothing says to write down, before making, what is taken from which save; nothing says to take one thing per save; nothing says what to do when two saves pull in different directions (only the order rules > locked decisions > skills > references).
- **No check that picks fit each other.** Not in the prompt, not in `gather_for_brief` (see 2.2).
- **No number.** How many saves to open, how many pictures, how many to combine: unsaid. `images: "all"` is suggested only in gather's closing line.
- **No "compare your sketch with the saves".** After rendering, the checks named are the brief, the locked decisions, the rules and the measured rule checks. References are not on that list.
- **No "don't copy a reference"** in FRIDAY's own instructions (only the one-save button's prompt).
- **Nothing ties "generic" to references.** Generic is fought with the slop list, the gem, "different in kind" and the last-check questions.
- **No use of look-likeness for combining.** `similar_to` and `look` are described as ways to find, never as ways to check a mix or a result.
- **Nothing about measured values when taking type or color from a site**, beyond "Trust those [measured_in_page] over likely_fonts" (`mcp-tools.ts:31`).
- The skills examples (`docs/skills/typography.md`, `docs/skills/motion.md`) do not mention references. The six skills the designer has on "always" are better-typography, better-colors, better-layout, better-ui, better-accessibility, better-writing (table `skill_use`); the skills machinery only says they come "before any reference".

---

## 2. What each tool hands back

All of these are registered in `server/mcp-tools.ts`; the logic is in `server/library.ts`. A tool wrapped in `safe(...)` answers with one block of JSON text and nothing else (`mcp-tools.ts:137-145`).

| Tool | Pictures? | What comes back | Real size seen in chats |
| --- | --- | --- | --- |
| `library_overview` (`:251`) | none | counts and the words the reads use | about 8,000–9,000 characters |
| `search_library` (`:258-273`) | **none** | 12 short cards (max 60) + one line each for up to 60 more | 6,000–15,000 characters for 8–20 cards |
| `find_by_color` (`:275-289`) | **none** | short cards with `colors_matched` | 7,500–35,000 characters |
| `similar_to` (`:291-302`) | **none** | the base save's card + up to 10 (max 40) cards with `why` | 5,600–8,000 characters |
| `gather_for_brief` (`:304-317`) | **none** | per facet, 3 picks (max 8), each with that facet in full + the save's three `worth_taking` | 18,000–40,000 characters |
| `get_reference` (`:319-346`) | **yes** | per save: JSON, then pictures. Up to 10 saves a call | full: about 6,500 characters a save; with `facets`: about 1,500–2,000 |
| `get_project` (`:358-392`) | only with `pictures: true` | the canvas as decisions; with pictures, the first picture of up to 12 chosen saves | 1,500–36,000 characters |
| `make_sketch` (`:509-529`), `edit_sketch` (`:531-557`) | **yes, of the sketch only** | JSON + up to 3 screens | 1,000–4,500 characters + 1–3 pictures |
| `get_sketch` (`:559-586`) | yes, of the sketch only | JSON + up to 3 screens + the page's HTML | — |

### 2.1 How saves are ranked

Three ways of finding, joined:

- **Words.** An in-memory SQLite FTS5 index with one column per facet (`library.ts:56, 104-118, 171`). A save's score is the sum of the rarity of the words it matched ("Rarer words count for more", `library.ts:562`; IDF at `:234`), then color match, then BM25, then newest (`:561-566`). Without facets, the designer's own text weighs 3, summary/worth_taking/search_terms and mood 2, the rest 1 (`:235`).
- **Meaning.** `multilingual-e5-small` turns each facet's text of each read into a vector (`server/embed.ts:21, 83-96, 214-221`); the query is embedded the same way and compared (`embed.ts:150-164`). Only the top 40 saves within 0.07 of the best count (`library.ts:542`, `top()` at `:522-529`).
- **Look.** CLIP ViT-B/32 (`embed.ts:22`) embeds each save's **first thumbnail only** (`library.ts:187-193`: `m?.thumb_path ?? d.r.preview_path`; `embed.ts:222-225`). A `look` description is embedded as text and compared (`embed.ts:167-175`); top 40 within 0.06 (`library.ts:543`).
- **Joining.** "Each way of finding gives a place in line; a save high in several lines comes first": score = sum of 1/(12 + place) over words, meaning and look (`library.ts:568-579`).
- `find_by_color` uses measured palettes and CIEDE2000 distance (`library.ts:258-279, 314-336, 626-658`); default 10, share at least 3%.
- `similar_to` ranks each facet on its own and fuses the ranks with 1/(10 + rank) (`library.ts:661-712`): color by palette distance (`:339-343`), `look` by CLIP nearest neighbours (`:684-687`), other facets by shared distinctive words plus nearest in meaning (`:696-705`).

Each short card says why it is there: `matched: "5/8: modular, industrial, object, modules, together"`, `close_in_meaning: true`, `looks_like_it: true` (`library.ts:583-588`).

A real short card (from a chat on 11 Nov):

```json
{"id":"abd73a2d572b4862","type":"image","about":"Stackable porcelain cups shaped like bamboo segments that stack into one olive-glazed stalk, shown on a calm serif e-commerce product page and backlit in a…","mood":["earthy","calm","crafted","natural"],"colors":["#f1eee7 warm white 44%","#a39740 yellow 9%","#4c3c0b brown 8%"],"tags":["industrial design","object design"],"matched":"5/8: modular, industrial, object, modules, together","close_in_meaning":true,"looks_like_it":true}
```

A short card has no `worth_taking` and no link (`library.ts:471-495`). That is one `get_reference` away.

### 2.2 How `gather_for_brief` picks "the best saves per facet"

All of it is `gather()` at `library.ts:718-743`:

1. For each facet (default color, typography, layout, imagery, motion), it runs the same `search()` **inside that facet only**, with that facet's own words if `facet_briefs` gave some, else the whole brief (`:721, 728`). Motion picks must have motion, type picks must have type (`:726`). It asks for `per_facet × 4` results.
2. It re-sorts those by how many times a save was already picked for another facet, fewest first, and takes the top `per_facet` (`:730`, comment: "Prefer saves not already picked for another facet, so the mix is wider.").
3. Each pick is returned with: id, title, type, the words searched, `matched`, **that facet's part of the read in full**, the save's three `worth_taking` lines, and the link (`:734`).

So:

- The pick is by **words and meaning of what the read says**, never by the pictures (no `look` is passed).
- **Nothing checks that the picks fit each other.** There is no step where the color pick is compared with the type pick, by palette, by look, or by anything else. The only cross-facet rule is "avoid repeating a save".
- `worth_taking` is the save's whole list, not the part about that facet. A real color pick came back with "Turn an offer or intake question into stacked white pill buttons…" as one of its three lines.
- No pictures. The closing line tells the model to open the strongest with `images: "all"`.

A real pick (journaling chat, 8 Nov), shortened:

```json
{"id":"2c8204cee36a4883","title":"Screenshot 2026-10-26 at 7.41.03 PM","type":"image",
 "searched":"warm off-white cream paper, tan, brown, muted, low contrast",
 "matched":"7/9: warm, white, tan, brown, muted, low, contrast",
 "color":{"summary":"Mostly warm brown and charcoal: the photo is pushed down under a dark umber tint…","temperature":"warm","contrast":"high","saturation":"muted",
          "palette":["#271b12 charcoal 31% · background","#3c3427 charcoal 18% · surface", "…"]},
 "worth_taking":["Lay a warm umber tint (around #271b12 at high opacity) over a lifestyle photo…","Turn an offer or intake question into stacked white pill buttons…","Place the interactive column to one side…"],
 "open":"http://127.0.0.1:4646/?open=2c8204cee36a4883"}
```

Note that this pick "matched 7/9" on the words *white, tan, brown, muted, low, contrast* while its palette is charcoal and umber with "high" contrast: a word match, not a fit.

### 2.3 `get_reference`: the only way FRIDAY sees a save

- Text: with no `facets`, everything (`library.ts:823-852`): note, tags, palette with roles, the whole read, `measured_in_page` for sites, file paths, the list of pictures. With `facets`, only those parts plus `worth_taking` (`:805-821`).
- Pictures: "the pictures the read was made from" (`library.ts:804`), which `prepare()` made when the save was read (`server/read.ts:392-459`). Each is a JPEG at most 1568 px on its long side and at most 1.2 megapixels (`read.ts:159-173`). `images` is `none`, `first` (the default) or `all` (`mcp-tools.ts:324, 335`).
- What "first" is:
  - **A site** with a page taller than two screens: "The whole page, cut into N columns" (`read.ts:414`, `foldedPage` at `:218-226`). In the library: 24 of 35 sites start with the folded page (2 columns: 6, 3: 15, 4: 2, 5: 1); 11 start with the first screen. A real one: Legora, 16 screens, shown as one 1060×1130 picture.
  - **A video or GIF**: a grid of 8 or 9 frames (`read.ts:309-346`). Real: the AI spreadsheet demo's first picture is "Part 1 of 4: 8 frames 0.16s apart", 1152×1038.
  - **A post with several images**: only item 1.
- With `all`: every prepared picture. The library has 9.6 pictures per save on average (median 6, most 90); 36 saves have one, 110 have 2–4, 75 have 5–10, 99 have more than 10.
- In real chats one call returned up to 14 pictures (two image posts opened with `all`).

### 2.4 `make_sketch` and `edit_sketch`: FRIDAY sees its sketch, alone

- Rendered in headless Chrome at 1440×900 at 1× (`server/sketches.ts:28`); phone 390×844 at 2×, tablet 834×1112 (`sketches.ts:774-778`).
- At most **three** screens down the page are photographed (`sketches.ts:30`, `MAX_SCREENS = 3`), each scrolled to, as JPEG quality 88 (`sketches.ts:858-867`).
- The answer (`sketchContent`, `mcp-tools.ts:78-105`; `made`, `:125-135`) is: one JSON block (`sketch`, `title`, `version`, `page`, `states`, `linked_saves`, `on_canvas`, `next`, `page_height`, `page_errors`, `rule_checks`, `skill_checks`, `skills_checked`, `skills_that_apply`), then for each screen a caption and the picture.
- **No reference picture is in that answer.** `linked_saves` is only the list of ids that got a "uses" line. To see a reference again FRIDAY would have to call `get_reference` again; nothing asks it to.
- A real answer's text (NavTech landing, 11 Nov): `…"linked_saves":["c76bc5640f4d4777","386599453a664027","3357efb54c9143ed","42bc3d8eca994329","bbaeaf2cfec241be"],…"page_height":4814}` then "Screen 1 of 3 on desktop at 1440×900 (page from 0px), what the designer sees first". The page was 4,814 px tall; FRIDAY saw the first 2,700 px and said so: "Below the top of Services I haven't seen it rendered."
- A wireframe is not measured against rules or skills (`mcp-tools.ts:119-123`).
- One place in Panel does show two things side by side to the model: `get_figma_frame` returns the Figma frame's picture and then the sketch's first screen "as it was before Figma" (`mcp-tools.ts:642-650`). That pattern exists; it is not used for references.

---

## 3. The design read

### 3.1 Shape

The read is one JSON object per save, written once by Claude (here Opus 5.5 at xhigh effort, `settings`: `ai_model`, `ai_effort`) under a strict schema (`server/read.ts:486-533`). The reader's instructions say what it is for (`read.ts:465`): "Your profile is used later to find and combine references by facet. A designer will ask things like "a calm, warm, editorial mobile app" and get color from one reference, type from another and motion from a third. So describe each facet on its own terms, concretely, in a working designer's vocabulary."

Fields: `summary`, `format[]`, `mood[]`, `style_references[]`, `color {summary, temperature, contrast, saturation, roles[{hex, role}]}`, `typography {present, summary, classification[], likely_fonts[], case, scale_contrast, tracking}`, `layout {summary, density, whitespace, notable[]}`, `imagery {summary, style[]}`, `motion {present, summary, pace, techniques[], confidence}`, `components[]`, `worth_taking[]`, `search_terms[]`, `tags[]`, `limits`.

Beside the read, stored separately:

- **Measured colors** (`reads.palette`): from the pixels of the prepared pictures, k-means in Lab, only "pure" pixels (`server/palette.ts:1-8`). Each is `{hex, share, name}`. The read's `color.roles` must use these hexes ("Use those hexes when you assign roles; don't invent new ones", `read.ts:468`).
- **Measured in the page** (`refs.measured`, sites only, 35 saves): the real fonts with weights, share of text and whether they have Cyrillic and Tajik letters; text sizes; colors as the CSS has them; corner radii (`server/sitefacts.ts:1-7`).

The whole read is 3,000–6,000 characters of JSON (median about 4,500).

### 3.2 Real read 1: a site (Altitude, `cd6b1292ca874913`), shortened

```json
{
 "summary": "Altitude's fintech landing page sets cropped product UI cards over soft, grainy sky photography and pairs them with small photoreal cut-out objects used as icons, all inside a quiet black-and-white neo-grotesk layout.",
 "mood": ["airy","calm","trustworthy","crisp","optimistic","understated"],
 "color": {
  "summary": "Near-white page and near-black type carry the layout. Color comes only from the blurred sky photos (blue, peach and sage haze), green success states in the UI and one burnt-orange accent.",
  "temperature": "mixed", "contrast": "high", "saturation": "muted",
  "roles": [{"hex":"#fefefe","role":"background"},
            {"hex":"#060606","role":"text, primary pill buttons, footer background, testimonial quote cards"},
            {"hex":"#df7a49","role":"accent: case-study card fill, toolbox illustration, spend-limit bar"}, "…"]
 },
 "typography": {"present": true,
  "summary": "One neo-grotesk family in regular weight throughout. Headlines are large and tightly tracked, set in two-line sentence-case statements. … The hero headline has a rotating word, with a small product-object image placed before it…",
  "classification": ["neo-grotesk"], "likely_fonts": [], "case": "sentence", "scale_contrast": "high", "tracking": "tight"},
 "layout": {
  "summary": "A 12-column page that alternates 50/50 splits: the text side has an icon+label eyebrow, headline, checklist and outline pill CTA, and the other side is a sky-photo panel with cropped UI cards. …",
  "density": "balanced", "whitespace": "generous",
  "notable": ["UI cards cropped by the edge of their image panel so the product reads as a fragment",
              "hero dashboard bleeds off the right edge of the viewport",
              "security section drawn as a thin black rectangular line grid with the headline seated in one cell", "… 4 more"]
 },
 "motion": {"present": true, "summary": "Only inferred from stills. …", "pace": "medium",
  "techniques": ["rotating headline word","logo marquee","scripted UI state animation","card reveal"], "confidence": "low"},
 "components": ["announcement bar","navigation with dropdowns","hero with product dashboard", "… 13 more"],
 "worth_taking": [
  "Float cropped, single-purpose UI cards over grainy, out-of-focus sky photos and give each feature its own sky tint (blue, peach, sage), so product shots feel airy but still belong together.",
  "Use small photoreal cut-out objects (toolbox of cash, paper plane, open book, invoice) as icons in section eyebrows and inside the headline, to add warmth to a strict monochrome grotesk layout.",
  "Draw a trust/security section as a thin black rectangular line grid with the headline set in one cell and a sky photo in another."
 ],
 "limits": "These are static full-page screenshots, so the motion the designer mentions … can only be inferred. The sky blue and UI green aren't in the measured palette, so they have no hex values. I can't name the typeface with confidence."
}
```

Stored beside it:

- palette: `#fefefe white 62%, #020202 black 19%, #d0dadc gray 11.3%, #9bcce5 blue 4%, #de7440 orange 1.4%`
- measured in the page: `{"fonts":[{"family":"gtStandard","role":"both","weights":[400,500,600,700],"share":1,"cyrillic":false,"tajik":false}],"sizes":[16,12,14,40,20,10,11,13],"colors":{"backgrounds":["#ffffff","#000000","#8dcaec"],"text":["#000000","#b3b3b3","#ffffff"],"accents":["#27a139"]},"radii":[11,14,8,19],"smooth_corners":false}`
- the designer's own note: "good combination of custom illustration + interface reveal and animation explaining the product"

### 3.3 Real read 2: a 5-second video (AI spreadsheet demo, `1b418727c10b46cb`), shortened

```json
{
 "summary": "A 5-second demo of an AI spreadsheet. After the prompt is sent, a soft iridescent glow (yellow, magenta, violet, blue, cyan) rises from behind the input card and passes up through the grid like a wave. The table warps slightly, and blurred rows sharpen into finished deal data as the glow passes.",
 "color": {"summary": "The UI is almost entirely off-white and grayscale. Color appears only during generation, as a passing pastel glow (pink, blue, teal) plus small tinted status pills, so color stands for AI activity.",
  "roles": [{"hex":"#f6f6f6","role":"background / canvas and UI surface"},{"hex":"#f6daf7","role":"glow accent: magenta-pink core of the generation wave"}, "…"]},
 "motion": {"present": true,
  "summary": "Cursor clicks Generate and the button morphs into a spinner/Stop state. … A magenta blob swells out from behind the card, turns violet then blue, and sweeps upward through the table as cyan. Rows behind it go from heavy blur to sharp… Gridlines bend slightly as it passes, like heat distortion. … The reveal takes about 1s and seems to ease out as it reaches the top.",
  "pace": "medium",
  "techniques": ["shader glow sweep","hue cycling gradient","blur-to-sharp reveal","displacement / warp distortion","edge rim light","button state morph","skeleton loading shimmer","bottom-to-top wipe"],
  "confidence": "medium"},
 "worth_taking": [
  "Show AI generation as a pastel iridescent glow that starts behind the input and sweeps across the output area. The result is revealed by the wave instead of appearing row by row.",
  "Pair the glow with a blur-to-sharp transition and a slight displacement warp on the content underneath, so the UI looks refracted while it's being 'written'.",
  "Keep the interface fully grayscale so the only saturated color appears during generation, making the color itself the sign that AI is working."
 ],
 "limits": "Judged from frames 0.16s apart with no close-ups, so the exact easing curve, how strong the warp is and how the color moves within the shader are approximate."
}
```

Designer's note on it: "i like the interface distortion, colors animation and the wave-glow animation". Its measured palette is 95% `#f8f8f8`; the glow colors are under 1% each.

### 3.4 Is `worth_taking` a concrete move or praise?

**A concrete, reusable move.** Across all 318 reads:

- every read has exactly 3 lines (954 in all), 85–271 characters each, median 152;
- they start with a verb or a noun phrase: Use (101), A… (85), Show (62), Keep (43), Build (42), Pair (41), Put (38), Set (22), Turn (21)…;
- 1 of 954 contains a praise word (beautiful, stunning, elegant…);
- 24 contain a hex value and 112 contain any number. The values live in the facets, not here.

More examples, picked at random:

- "Show color only during the transition: a brief iridescent gradient sweeps through the mark mid-morph, then it resolves back to solid black."
- "Fill one bar or block with a coarse pixel dither while the others stay flat. It adds texture and shows a 'mixed' value without a legend."
- "Turn a collection of cut-out images into a slowly rotating oval ring around a small centered title, and let it crop at the viewport edges. The landing page becomes the content itself."

The reader is told to do this (`read.ts:473`): "worth_taking is the most useful field: 1–3 specific, transferable ideas ("oversized serif headline cropped by the viewport edge", "single acid-green accent on an otherwise grayscale UI"), never generic praise."

Limits of the read as material for combining:

- A move is a sentence. It has no size, no proportion, no position, no hex unless the color facet has it.
- It names what **Claude** found worth taking, not what the designer saved it for. The designer's reason is in `note` (46 saves have one, about 70 characters on average) and is weighed "most" when the read is written (`read.ts:549`).
- Colors that matter but cover little of the picture are missing or tiny in the measured palette (the glow above; "The sky blue and UI green aren't in the measured palette").
- Motion is read from stills; `confidence` is often low or medium.

---

## 4. The canvas actions

### 4.1 "Sketch" / "Sketch from these"

The button is in `web/src/Canvas.tsx:2080` (several things selected), and "Sketch" on one save or topic (`:355, :398`). It calls `sketchFrom` (`Canvas.tsx:1220-1234`), which sends FRIDAY an ordinary message. The exact texts:

- several things: "Sketch a direction from these, for this project: take from each what it does best, hang it from them, and say what you took from which."
- one topic: "Sketch a direction from this decision and its chosen saves, for this project."
- one save: "Sketch a direction from this save, for this project: take what it does best, not a copy of it."
- one sketch: "Try 3 alternates of this sketch, each a different direction."

**How the references are passed:** as words, not pictures. The app sends the ids of the selected canvas cards; the server writes one sentence into `<panel-context>` (`chat.ts:580-581`, `describeSelection` in `server/projects.ts:825-871`). For each save: its `[[id]]`, title, its state, the topic it is under, FRIDAY's own earlier "why", the designer's reason and the designer's notes on it. For example (real):

> They have selected on the canvas: the save [[b0db0cb20ad04adf]] “Privacy - App Tracking Transparency | Apple” (proposed; under Concept; why: Each shape becomes the next with no cuts: how one line could turn into a waveform, a chart, a route). “This” and “these” mean what's selected; look at the saves with get_reference before you answer about them.

The read is not included, the pictures are not included. FRIDAY has to call `get_reference` itself. The thumbnails in `context.thumbs` are for the app's own chip, not for the model (`chat.ts:529-536`).

**In the stored chats this prompt was never sent** (0 messages starting "Sketch a direction from…").

### 4.2 Alternates, made at the same time

- Trigger: the studio's "Try 3 alternates" (`web/src/Studio.tsx:892`: "Try 3 alternates of this sketch, each a different direction for the whole page.", with `fan: 3`), or pointing at a part with mode "alternates" (`chat.ts:588-589`).
- `fanOut` (`chat.ts:800-839`) starts up to 4 runs at once, each a **fork of the conversation so far** (`fork: true`, `chat.ts:821`), so each copy has whatever pictures the conversation already holds.
- Each copy gets one angle from `ANGLES` (`chat.ts:779-792`). For a whole page: "the composition" ("Rethink the composition: what comes first, the proportions, where the eye goes. Keep the type and the palette."), "the voice" ("Rethink the voice: the typeface pairing, the scale, the density, the mood of the color. Keep the structure."), "the boldest idea", "the quietest version". For a part: "its layout", "its treatment", "the boldest idea", "the quietest version".
- The prompt each copy gets (`chat.ts:812-816`): "…You are one of N copies of yourself working at the same time, each making one alternate of the sketch “title” (id). … Your part: make exactly ONE new sketch with make_sketch (from: "id"), a different direction for the whole page. Your angle is X. … The other copies are taking: Y, Z. Commit to yours; don't hedge towards theirs. Read the sketch with get_sketch first if you haven't seen this version. Give yours a short title and a tries line that says how it differs. Look at the pictures that come back, fix what breaks the rules with edit_sketch, then answer in one line…"
- **Nothing about references in it.** The angles are about the page. No copy is told to take from a different save, or to look at the saves again.
- The one real run (CRM hero, 9 Nov): each copy called `get_sketch` with `pictures: false`, `get_verdicts`, `make_sketch`, then looked at its own render. None opened a reference. All three passed the base sketch's `uses` on, plus one or two more.

### 4.3 Compare: "Take the best of each"

In the studio, Compare shows two or three sketches of one family side by side **to the designer** (`web/src/Compare.tsx:1-4`). The box under them ("Take the best of each: “the hero from A, the type from B”", `Compare.tsx:151`) sends (`Canvas.tsx:1911-1919`):

> Make one new sketch that combines these directions. A is “title” (id), B is “title” (id). What to take: {the designer's words}. Start from the one that needs the least change (make_sketch with from: its id) and leave the rest of it as it is.

Again words and ids. **Never sent in the stored chats.**

### 4.4 Knobs: "Try a save's colors"

No AI. In the studio's Knobs, the measured palettes of the saves on the canvas (not the ruled-out ones) can be put on the open sketch (`Canvas.tsx:1261-1262`, `web/src/Knobs.tsx:1117-1120`); keeping it writes the sketch's `:root` variables as a new version (`server/pagevars.ts:9-31`, `board.ts:436`).

---

## 5. The library in numbers (real database, 16 Nov 2026)

**Saves** (table `refs`): 366 rows, 11 hidden, so 355 showing.

| Kind (as the tools see it, `library.ts:82-89`) | Count |
| --- | --- |
| video (includes GIFs) | 192 |
| image | 94 |
| site | 30 |
| person | 5 |
| skill (files for AI, not references) | 34 |

By where they came from: X 169, Instagram 92, web 35, Pinterest 18, uploads 6, YouTube 1 (plus the 34 skills).

**Reads and pictures** (of the 321 showing saves that are not skills):

- with a design read: **318** (all by `claude-opus-5-5`); 2 failed, 1 not read
- with saved media on disk: 321
- with prepared pictures for `get_reference`: 320; 9.6 pictures a save on average, median 6, most 90
- with a look vector (CLIP, first picture): 320; with meaning vectors: color 318, layout 318, mood 318, imagery 316, typography 261, motion 200, components 185
- sites measured in the page: 35 (the 30 sites and the 5 people's pages)
- with the designer's own note: 46; starred: 6; 61 tags; 7 collections

**Projects and canvases:** 6 projects (Hujjat Landing Page, NavTech Web 2.0, WB Presentation, NavTech Website, HUJJAT, CRM). 24 topics, 10 locked. 136 save cards (126 placed by FRIDAY, 10 by the designer). 50 notes (41 by FRIDAY, 9 by the designer). 1 build. Two projects are on the Website recipe.

**Sketches:** 38 on canvases now (49 sketch folders on disk; `make_sketch` was called 52 times, 5 of them wireframes). All made by FRIDAY.

**Verdicts:**

| | Chosen | Kept | Still suggested | Ruled out |
| --- | --- | --- | --- | --- |
| Saves on canvases | 5 (0 with a reason) | 13 | 101 | 17 (**11 with a reason**) |
| Sketches | 2 (2 with a reason) | 1 | 34 | 1 (1 with a reason) |

- All 11 reasons on saves are the starter buttons (`projects.ts:586-589`): "Type doesn't fit" ×5, "Too generic" ×2, "Color is off" ×3, "Wrong mood" ×1. Ten of the eleven are from one project (NavTech Website).
- The three reasons on sketches: "i like the layout", "like it", "Too generic".
- Taken off a canvas (`board_turned_down`): 1 sketch, no reason.
- So `get_verdicts` today holds 14 written reasons in all, 12 of them one of five stock phrases. The richer taste is elsewhere: the 9 designer notes on canvases (long, spoken: "…it's minimalistic, it's accurate, it's good, but it's too safe. There's no dramatic…"), the 46 notes on saves, and the chat messages.

**Is there a stored record of which saves a sketch used? Yes.** `make_sketch` takes `uses` (`mcp-tools.ts:518`); for each id that is a save card **on that canvas**, Panel adds an edge with `label = 'uses'` from the save card to the sketch (`server/board.ts:380-388`). In the database: **77 "uses" edges, on 25 of the 38 sketches** (1 to 6 each). Limits:

- it is only what FRIDAY passed; nothing checks it against the page;
- a save not on the canvas gets no line and is not stored anywhere else;
- there is no record of **what** was taken (color, type, a detail). That is only in the sketch's `tries` line, the reply, and each save card's `taking` text (FRIDAY's "why" when it placed the save; 126 cards have one, `board.ts:145`);
- `edit_sketch` cannot add or change the lines.

---

## 6. Real use

### 6.1 Where chats and tool calls are stored

- **Database**: `chats` and `chat_messages` (`chat.ts:28-52`). A user row has the typed text and `context` (what was open or selected, attached files). An assistant row has `parts`: text, thinking time, and each tool call with its name, its **input**, the ids of saves it came back with, and any error (`chat.ts:135-155`). Tool **answers** are not stored there, and neither are pictures.
- **Claude Code session files**: `~/.claude/projects/-Users-osimij-DesignLibrary-chat/<session_id>.jsonl` (FRIDAY runs with `cwd` = `<library>/chat`, `chat.ts:84, 1372`; the id is `chats.session_id`). These hold every tool answer in full, pictures included. All 30 chats' session files are there (39 files, 687 MB). The copies made for alternates are separate files. The model's thinking is not readable in them.
- The system prompt as sent is not stored; it is rebuilt from the code, `unugly.md` and the skills on every message.

Totals: 30 chats, 212 messages from the designer, 1,107 tool calls. By tool: get_sketch 209, edit_sketch 207, search_library 128, **get_reference 99**, ask_designer 56, get_project 52, **make_sketch 52**, add_note 51, place_on_board 35, get_skill 33, find_by_color 23, get_verdicts 23, library_overview 18, **gather_for_brief 12**, **similar_to 4**.

A few counts that matter for combining:

- `get_reference`: 72 calls with `images: "first"`, 27 with `"all"`, none with `"none"`; 3.2 saves a call on average, 8 at most; 30 calls used `facets`.
- `search_library`: 24 of 128 used `look`; 53 used `facets`.
- `gather_for_brief`: 12 calls, 11 of them in the first three days (8–10 Nov), the last on 11 Nov. None since.
- Of 117 answers that made or edited a sketch, **1** opened a reference's pictures after a render came back.
- 33 of 52 `make_sketch` calls passed `uses` (3 saves on average, 98 links declared). 78 of those 98 saves had been opened with a picture earlier in that chat (30 with all pictures); **20 had never been opened with a picture in that chat** (this ignores that a summary in between drops old pictures, so the true number seen is lower).
- 7 messages from the designer carried their own pasted pictures; 11 mentioned a save with @; 110 had something selected on the canvas.
- "Plan, then build" was used for 6 hand-overs, all on 9–10 Nov. The setting now is One model, Fable 5.2, high effort (`settings`: `chat_mode = solo`).

### 6.2 Six real chats

**A. "Warm paper journaling references"** (`5813b68d30d84d42`, library, 8 Nov)

- Asked: "I'm designing a journaling app for slow mornings: warm, quiet, paper-like. Pull me references for color, type and motion, and tell me how they'd combine."
- Tools, in order: library_overview → gather_for_brief (color, typography, motion; own words per facet; 4 each; 18,026 characters, no pictures) → search_library ×3 → get_reference for 6 saves, `images: "first"` (6 pictures, about 950–1,380 px).
- How it chose: by the words of the reads. Its first line: "One save does most of the work: [[e037ea6638a44fbb]]." Then a list per facet: "**Page:** #f8f5ef, from the Albers study… **Second surface:** #e3dccd, from the Renaissance carousel… **Morning glow:** take the peach wash from [[e037…]]… That save's peach wasn't measured, so the exact color is up to you."
- Made: words only.
- Reaction: none in that chat (one message).

**B. "Designing a CRM landing page"** (`99d5f1bae6864181`, library, 8 Nov)

- Asked: "…I want to really see whether we can make something that is really beautiful and really good… experiment with things that we have, colors, typography, interfaces, layouts… go and do the research and everything, and then give me a really good prompt."
- Tools: library_overview → gather_for_brief (6 facets, 37,551 characters) → search ×3 (one for favorites) → get_reference for 4 and then 5 saves, first picture each → (a collection tool that has since been removed).
- How it chose: it built one named idea around the designer's starred saves and notes, and gave each save one job: "**Color.** The ink photos supply a warm cream ground, oxblood-black text and magenta, teal and crimson. The receivables cards supply the rule: the page stays gray, and the single magenta marks only the client who needs you today. **The signature moment.** I took the glow-wave reveal from your starred AI spreadsheet… **Type.** A book serif for headlines comes from the dark SaaS page. Uppercase mono labels… come from Replay. The sans and the dashboard structure come from Steel."
- Made: a prompt for Claude Code, three times ("Inkwell", then "FIELD", then "Deck").
- Reactions: "okay good, but let's go totally with diff direction"; then a long message asking for no "AI slopping it like eyebrows", real-looking physical objects, "vibrant colors but at the same time not overused colors".

**C. "CRM Landing Hero References"** (`29958ef3eb3d4b28`, project CRM, 9 Nov)

- Asked first: "let's find good references for the landing page (specifically hero section) of a CRM product". Then: "let's go with this idea; i like [[cd6b1292ca874913]] hero section + some glow from [[1b418727c10b46cb]] let's make a hero section; the product is called GorillaCRM".
- Tools, first message: get_project → library_overview → gather_for_brief (40,457 characters) → search ×5 → get_reference for 5 + 5 saves (first picture) and one save with all 4 → place_on_board (8 saves).
- Tools, the mixing message: get_project → get_reference for the glow video with **all** 4 frame grids → mark_saves → add_note → make_sketch (`uses` both; one 1440×900 picture back) → get_sketch (another state) → edit_sketch → get_sketch.
- Pictures of the two saves being mixed: the glow save, 4 grids of 8 frames. The layout save (Altitude) was not opened again; it had been seen once, as a 10-screen page folded into one 1306×916 picture.
- How it combined: one thing from each, in the designer's words. Sketch title: "GorillaCRM hero, sky split + import glow". Its `tries`: "Altitude's split hero: the Deals screen bleeds off the right edge over a sky photo. Importing a spreadsheet sends a shader glow up through the table, and the deal rows sharpen into place as it passes." Those phrases are the reads' own (`layout.notable`: "hero dashboard bleeds off the right edge of the viewport"; `worth_taking`: "…a blur-to-sharp transition and a slight displacement warp…").
- After the render it checked its rules ("all corners use squircle smoothing… no eyebrows…"), not the saves.
- Reactions: "now look our accent color is around pink and purple; anything we got good?" → FRIDAY suggested a dusk sky from a third save → "oooh i really like it; implement pls" → "Try 3 alternates…" → the designer chose one ("i like the layout") → next chat: "for these two we need to work on the bg shader; make it more smooth pls; right now it looks like clouds, it shouldn't".

**D. "Idiosyncratic Nabtec landing page"** (`d72c336fdf1e4555`, project NavTech Website, 11 Nov)

- FRIDAY's own combinations came first: three concepts (Loom, Kit, Converge), each from 2–3 saves found by words and one `look` search, 7 saves opened with one picture each. Reactions: "three left; but you went over-idiosyncratic… we need smth simpler"; next try: "didn't like them to be honest"; then two saves ruled out as "Too generic".
- Then the designer gave the mix: "i like the shapes in shapes idea here: [[c76bc5640f4d4777]] then i like how serious and rich [[386599453a664027]] looks @A brand identity reel one i like this section (attached img) like where blue is full bg; we coudl combine this idea with [[42bc3d8eca994329]] and then i like the dropbox one too" — with their own screenshot of the section.
- Tools: get_reference (shapes save, all 4 pictures) → get_reference (two saves, color and imagery only, all pictures: 14) → place_on_board → add_note ("Designer's combination: shapes in shapes from…; the serious, rich look of…; a full blue background section as in…") → make_sketch "Color study: one blue, porcelain, squares in squares" (`uses` 5; 3 pictures back) → edit ×2, one phone check.
- How it combined, in its reply: "**Shapes in shapes.** The hero has seven flat nested squares… as in [[c76b…]]. **Serious and rich.** The palette is seven colours… That is the off-white, metal and cobalt of [[3865…]]. **Full blue section.** … a giant tone-on-tone "Cortex" after [[42bc…]]. **Blue voice.** The headline is set in blue on porcelain with black buttons, as in [[bbae…]]." And: "**The blue is my guess.** I used `#1747a6`, between Rimowa's and Inferact's blues."
- Then: "…following skills and references give some good landing page pls". FRIDAY re-opened the 5 saves (layout, typography, components; first picture), ran gather_for_brief, and made "Landing: seven squares, one blue field" from the color study.
- Reaction: "**no wait why tf this landing page is so boring and bad?**" FRIDAY's own answer: "It's boring because I turned a colour study into a page instead of designing one: **It's a template with new colours.** Text on the left, picture on the right, then heading + grid, heading + grid, FAQ, form… **The idea just sits there.** … **There's nothing to look at.**"
- Next: "…the reference that we have mentioned has something better in it. Right? It has some texture in it… go to the websites that we have added saved. I think the latest one that we have added is, is a good example." FRIDAY opened that site with all 14 pictures and the shapes save again, and made a new page. Reaction: "Maybe it is it is a bit better, but, like, still, it sucks. I don't like most of the parts". The project was started again as "NavTech Web 2.0".

**E. "Variable font width settings"** (`e6f6440dedfb4a9d`, project WB Presentation, 10 Nov)

- Asked: "…The Infinite Guardian, I like the structures. I like the way the illustrations happen… But for the second reference, the the three looping brand motion cards for Blend AI… we could use the colors. And the, you know, rectangles midlines. So I think we could, you know, merge these two and make something out of them." (two saves selected)
- Tools: get_reference for the second save only, all 3 pictures → get_brand_assets → make_sketch "Print deck: seven lines into one" (`uses` 5) → get_sketch → edit_sketch → add_note.
- The first save (Infinite Garden, the one whose *structures* were wanted) was not opened in that message. In that chat it had been seen once, as a whole page folded into one 1058×1132 picture.
- Reaction: "am liking it so far, the lines and all, but they are a bit boring; **if you scroll [[6f64d6a12a304055]] you can see how good its lines look**" — and the designer pasted **five of their own screenshots** of that site.
- FRIDAY then rebuilt the drawings "the way Infinite Garden does them: a centre line down every page, labelled nodes, dots at the ends of each line, dotted return lines and faint dot fields." That version was kept and worked on for three more days (FRIDAY later calls it "the version you liked"). A later chat on the same deck opens with "look closely the [[f6b0cc17de124f62]]".

**F. "Navtech landing page redesign"** (`9bfe1e5689f045fb`, project NavTech Web 2.0, 11–13 Nov, 50 messages, Website recipe)

- Feel: FRIDAY asked "Which of the six feels closest?"; the designer selected three saves and wrote "combination of these three feel closest". Tools: get_reference for the 3 (mood, color, layout, imagery; first picture each) → add_note: "Read as icy sky-blue on light ground, slate bands for weight; airy sky haze and real product fragments; precise, engineered grid and structure." A mix of three sites became three adjective phrases.
- Gem: three ideas, each with 2–3 saves found by `look` and words, 4 opened with one picture. The designer picked "C. Контур construction drawing". The study passed `uses` for three saves; one of them had been opened with a picture in that chat.
- Then: "@Dropbox Brand Guidelines … let's have something that Dropbox has. The color the Dropbox has, and the way the slightly animation happens in there… If we combine what we have r…". Tools: search → get_sketch → get_reference (Dropbox, all 5 pictures) → make_sketch "Gem study: Контур × Dropbox". Reaction: "Yes. Yes. It's it's better, but we need to adjust the motion. And, like, make it more cinematic".
- Color: FRIDAY made A and B from the Dropbox blue. The designer selected two saves: "i want this kinda light blue to be honest; and make one more variant with this pls: #00D0FF". Tools: get_reference for the 2 (color only, first picture) → "Color study C: light sky, after Steel" (it used Steel's measured accent, `#06A5FD`) and D. Reaction: "this one" (C). Locked.
- Hero, with everything decided put together: "to be honest i don't like a single bit of our current hero section…". FRIDAY searched again, opened 15 saves (one picture each), placed 8, and asked with saves shown in a row. "just make smth bro; don't ask me anything". Later: "Bro, what the fuck? They all look the fucking same", "it looks like a cheap shader… less predictive and cliche", then a shader hero was chosen ("like it").

Two shorter ones that went well:

- **HUJJAT** (`d884086a3e85459a`, 10 Nov): the designer wrote "for colors, what if we go with the 3rd post in [[ea1178f11ed34f51]]; it has this #cedcc3 and #B8C4AF (darker on on top of if)". FRIDAY opened that save with all 8 pictures, proposed a palette around those two values, and (as planner) handed a plan to the builder. The result, "Hero in sage: striped ribbons…", is the one the designer went on working on in the next chat ("make this button bg white pls", then two changes to its logo), and sage came back as one of the two color studies in the later "Hujjat Landing Page" project ("Color B: sage page").
- **CRM** (same chat): "I want to duplicate this, but change the color to colors from [[7f1a360c4968481e]]". One save, one thing, a copy of the sketch with the new colors. No complaint followed. Even here: "the ice blue in RKTIC wasn't measured from the video, so `#c9dce7` is my estimate of it."

From "Plan, then build" (9 Nov), how the planner wrote a mix for the builder: "What each save gives: f07e0cee42fc4452 (Aside) = one grotesk, hierarchy by tone (ink clause then gray clause), an inset rounded stage holding the product. cd6b1292ca874913 (Altitude) = scripted UI states that explain the product, white UI cards floating on a coloured field. 32b8610450284492 (Sand3D launch video) = no cuts, eased camera, odometer roll for the code characters…" The builder is told "Don't look for other references" and gets the plan, not the pictures.

### 6.3 The patterns

1. **It picks by words.** The way in is almost always: write the brief in the library's vocabulary → `search_library` or `gather_for_brief` → read text cards → open some. `look` was in 24 of 128 searches, `similar_to` was used 4 times in 30 chats. A pick can "match 7/9" words and still be the wrong thing (2.2).
2. **Its usual look at a save is one small overview.** 72 of 99 `get_reference` calls asked for the first picture only. For a long site or a video that is a folded page or a grid of frames. It asks for all pictures mostly when the designer has pointed at that save.
3. **It combines in sentences, one job per save.** "Layout from A, glow from B, color from C." Each job is a phrase from that save's read (`worth_taking`, `layout.notable`, a hex from the palette). Sketch titles show it: "…sky split + import glow", "Контур × Dropbox", "…after Steel". When the part wanted is not in the read or the palette, it guesses and says so ("The blue is my guess", "wasn't measured, so … is my estimate").
4. **It leans on one anchor save.** "One save does most of the work"; "Altitude's split hero"; "RKTIC's world as a 16:9 deck". The anchor is nearly always a save the designer starred, noted or pointed at.
5. **The mixes that count come from the designer.** In C, D, E and F the designer named the saves and the parts. When FRIDAY proposed the mix itself (B; the first three rounds of D), the designer moved on or said no.
6. **Nothing is checked against the references after rendering.** Once in 117 sketch answers. The checks FRIDAY runs are the measured rules, the skills, a phone view and the other states. "Does this have what I liked in that save" is never asked by the system.
7. **The usual complaint is not "wrong colors", it is "template".** The designer's words: "boring", "templatic", "too generic", "cliche", "cheap shader", "they all look the same". Color and one device get carried over; the structure of the page comes from FRIDAY's own defaults. FRIDAY's own diagnosis in D says exactly that.
8. **What worked.** (a) The designer pointing at one exact part of one save, with a value ("the 3rd post… #cedcc3"). (b) The designer pasting their own screenshots of the part. (c) Moving one concrete thing: a save's colors onto an existing sketch. (d) The recipe's one decision at a time: color study C and the type were locked without a fight; the fights came at Hero and Whole page, where everything meets.
9. **`uses` is a claim.** 20 of 98 declared links point at saves never opened with a picture in that chat. In E the save whose structures were "used" had only been seen as a folded page.
10. **The combining buttons are not how the designer works.** They type, with a selection, an @mention or an open save. "Sketch from these" and Compare's mix were never used in the stored chats.

---

## 7. What is already there to reuse

| Thing | Where | What it is today | Why it could matter for combining |
| --- | --- | --- | --- |
| Look vectors | `server/embed.ts:98-104, 167-189`; table `embeddings`, kind `look`, 320 saves | CLIP ViT-B/32 of each save's first thumbnail; text-to-picture and picture-to-picture likeness | Only saves are embedded. No sketch render is. `imageVector()` is not exported, and there is no picture-to-picture call for a file that is not a save |
| Meaning vectors per facet | `embed.ts:150-164`; kinds `t:color`, `t:typography`… | e5-small of what each read says per facet | Could score "do these two saves say compatible things" per facet; nothing does today |
| Measured colors | `server/palette.ts`; `reads.palette`; roles matched in `library.ts:288-307` | hex + share + name, from pixels | Exact; already used by `find_by_color`, `paletteDistance` (`library.ts:339-343`) and Knobs. Small accents can be missing |
| Measured in the page | `server/sitefacts.ts`; `refs.measured`; `library.ts:842-844` | real fonts, sizes, CSS colors, radii of 35 sites | Real values for "take the type from this site" |
| The read's facets and `worth_taking` | `read.ts:486-533` | three concrete moves per save, all 318 | Ready-made "what to take" candidates; not tied to a facet, a place in the picture, or the designer's note |
| The prepared pictures | `media/<id>/read/N.jpg`, labelled (`read.ts:392-459`) | every screen of a site, frame grids, motion close-ups | The single screens exist already ("Desktop, screen 3 of 12"); `get_reference` can only give the first or all, not "screen 3" or a crop |
| Rule checks | `server/rulecheck.ts:1-13, 116-203, 316-327` | measured in the rendered page: corners, wordmark, italics, eyebrows, tags, dividers, bordered boxes, fonts' letters | The pattern for "measure the render and hand findings back with the pictures" (`mcp-tools.ts:87`) |
| Skill checks | `server/skillcheck.ts:1-15` | line length, contrast, sizes… against skills that are on | Same pattern |
| `uses` lines | `board.ts:380-388`; 77 edges | which saves a sketch says it took from | A place to hang "what was taken from each" and a later check; today only the id |
| `taking` on a save card | `board.ts:145`; `projects.ts:710`; 126 cards | FRIDAY's "why" when it placed a save | Already a per-topic "what to take from it", shown on the card and returned by `get_project` |
| Verdict reasons | `projects.ts:613-641`; `get_verdicts` | reasons grouped and counted; a reason seen 3 times is offered for unugly.md | The plumbing works; the content is thin (14 reasons, mostly stock) |
| The designer's notes | `refs.note` (46), canvas notes (9 by the designer) | their own words on what they like in a save | The best signal of what to take; weighed "most" in reads, "outrank the saves' reads" in `get_project` (`projects.ts:816`) |
| Compare | `web/src/Compare.tsx` | two or three **sketches** side by side for the designer, scrolled together | Sketch against sketch only. Not sketch against save, and not for the model |
| Knobs + "Try a save's colors" | `Knobs.tsx:1117`, `pagevars.ts` | a save's measured palette onto a sketch's variables, no AI | A working, exact "color from this save" |
| `keep_part` and the studio's Keep | `mcp-tools.ts:588-610`, `sketches.ts:964` | cut a part of a sketch out as a real file in brand assets | A way to carry one approved part forward unchanged |
| Point at a part | `chat.ts:582-592` | the designer points at a part of a **sketch**; FRIDAY gets its CSS path, text, HTML | No such thing for a save: the designer cannot point at a part of a reference (they paste screenshots instead) |
| Recipes | `recipes/website.md`, `recipes/poster.md`; `server/steps.ts:229-250` | one decision at a time; the Gem before color and type; each step can show saves to compare | Already the place where "where does each thing come from" is decided in order |
| ask_designer with saves | `chat.ts:855-871`; `duo.ts:157` | a question with up to 6 saves shown in a row above the choices | A ready way to ask "which of these, for this part" with pictures |
| Alternates in parallel | `chat.ts:779-839` | forks of the conversation, one angle each | Angles could be "a different source for X" instead of only composition / voice / bold / quiet |
| Planner's plan format | `chat.ts:893` | "each save to use with what to take from it ([[id]] and the exact thing: the hex, the font, the layout move)" | The one place a written per-save "take" is already demanded |
| `get_figma_frame` | `mcp-tools.ts:642-650` | returns a target picture and the "before" render together | The existing precedent for showing the model two pictures to compare |
| Hand-off | `server/builds.ts:123-157` | copies the chosen saves' pictures into `references/` for Claude Code | Reference pictures already travel with a build |

---

## 8. What I could not find, and caveats

- **FRIDAY's thinking** is not readable in the session files, so "how it chose" above is from its tool calls and its own words, not its reasoning.
- **The system prompt as it was sent** on a given day is not stored. Chats from 8–10 Nov ran on older code: search gave full cards then (15,000–45,000 characters a search), a collection tool still existed, and the builder shared the planner's conversation.
- **The MCP instructions arrive cut** at about 4,100 characters (seen in the session files). I did not look into why.
- **Deleted chats** are gone from the database; the counts cover the 30 that remain.
- "Opened with a picture earlier in that chat" does not account for summaries in between, which drop earlier pictures. At least 7 of the 30 chats were summarized one or more times.
- I did not look at the pictures themselves (saves or sketches), so nothing here judges how close any sketch is to its references. The designer's words are the only measure used.
- I did not read `docs/harness-research.md` or the other plans in `docs/` for this study.
- Not found anywhere in the code: a check that picked saves fit each other; a comparison of a sketch's render with a save's picture; a look vector for a sketch; a way to open one named picture or a crop of a save; a stored "what was taken from which save".
