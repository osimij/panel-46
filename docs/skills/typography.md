---
name: Typography
description: How to choose and set type so a page reads well and looks intended. For anything with words on it.
---

An example skill in Panel's form (Decide / Build / Check), written to try the skills machine. Replace it with your own, or change it freely.

## Decide

Before making anything with text, settle these and write them down (in the plan, or in a line to the designer):

- **Families.** One for display and one for text; they may be the same. Never more than two, plus a mono only for real code or figures. For Russian or Tajik text, choose by the Cyrillic, as the designer's rules say.
- **A scale.** At most seven sizes, each with a name and a job (display, title, heading, body, small, caption). Neighbours differ enough to be told apart at a glance: a step of 1.2 or more. Body is 16–18px on desktop, 16–17px on a phone. Nothing under 12px.
- **Line height by size.** Body 1.45–1.6. Headings 1.1–1.25. Very large display type 0.95–1.1. The bigger the type, the tighter the lines.
- **Measure.** Running text is 55–75 characters a line. Say how it is held there (a column width, a max-width).
- **Weights.** At most three. One level is told from the next by size or by weight, rarely both.
- **Order of reading.** Say what the eye lands on first, second and third, and what makes it so (size, weight, position, space), not color alone.

## Build

- Sizes, line heights and families are knobs on `:root` (`--font-display`, `--font-text`, `--size-body`, `--leading-body`…), used everywhere in place of fixed values.
- Line heights are unitless (`line-height: 1.5`), so they follow the size.
- Hold the measure: `max-width: 65ch` on running text.
- `text-wrap: balance` on headings and short lines; `text-wrap: pretty` on paragraphs.
- Fluid display sizes with `clamp()`, so a headline fills a phone and a desktop without a breakpoint for each.
- `font-synthesis: none`: no faked bold or italic. If the weight isn't in the font, choose another weight.
- Figures in tables, prices and timers: `font-variant-numeric: tabular-nums`.
- Leave body text at the font's own spacing. Only small capitals or all-caps labels get a little more (`letter-spacing: 0.04em`), and never the name in the navbar.
- Russian and Tajik: «ёлочки» for quotes, a real dash (—) with spaces around it, and a non-breaking space after one-letter words (в, к, с, и, а, о, у) so a line never ends on one.
- Space between blocks comes from the type: about one line of body text between paragraphs, more above a heading than below it.

## Check

- line_length: 45–85
- font_sizes: 7
- font_families: 2
- line_height: 1.35–1.7
- contrast: 4.5
- small_text: 12
- overflow (breaks)

## Look for

Things only an eye can judge, to check in the pictures before answering:

- Does the headline break where a person would break it, with no single word alone on the last line?
- Is it clear in one second what to read first?
- Does Cyrillic text look as considered as the Latin would, at every size used?
