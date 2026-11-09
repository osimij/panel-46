# Unugly

Rules for every design we make. Read them before designing or building anything, and check the result against them before showing it.

## Physical in digital

Good design often combines the digital with the physical. A physical thing on screen (paper, a stamp, a card, a material) makes a design feel rich, because it takes real effort to make something digital look physical.

- Whenever we imitate or replicate anything physical, go for the most realistic result possible: light, shadow, texture, material, weight, small imperfections. Use whatever it takes: shaders, 3D, Three.js, photography.
- Half-real is the failure. A flat drawing of paper with a vector stamp reads as fake, not rich.

## Cyrillic type

- Most Cyrillic versions of fonts are bad. Only a few are usable, so be really careful.
- Judge a font by its Cyrillic, set in real Russian and Tajik text, never by its Latin specimen.
- For Tajik, check that Ғ ғ, Ӣ ӣ, Қ қ, Ӯ ӯ, Ҳ ҳ, Ҷ ҷ are properly drawn, not missing or faked.

## Corners

- Every corner radius, on anything, uses Apple-style corner smoothing (continuous corners, the way Apple does it). Never a plain circular radius.
- In Figma: corner smoothing at 60% (the iOS setting).
- On the web: the closest native CSS is `corner-shape: squircle` / `superellipse()`, which isn't in every browser yet. Otherwise draw the shape as an SVG squircle path (e.g. figma-squircle), with plain `border-radius` only as the fallback.

## Buttons

Three shapes, nothing else. All with Apple corner smoothing.

1. **Sharp.** A rectangle with almost square corners, just a slight radius.
2. **Capsule.** Full radius.
3. **In between.** Softer than sharp, not yet a capsule.

## No overused layouts

- **Wordmark.** Never the name with wide letter-spacing in the navbar (H U J J A T). Either the name as plain text, or invest real time in a symbol that represents the product.
- **Eyebrows** (the small label above a heading). Be really careful with them. Either make them beautiful or leave them out. Never overuse them.

## Design slop indicators

Signs that a design is generic. Each needs a real reason to be there; some are fine under the condition given.

- Tags
- Italicized words
- Instrument Serif, and negative kerning
- Over-the-top detailed UI
- Dividers. Dotted or dashed ones can be good.
- Many shades and opacities of a color
- Containers with borders. Fine when the border is low-contrast and feels light.
- Diagrams. The more detailed, the worse. Fine when the diagram has taste and a good visual direction.
- Code breadcrumbs
- Section numbering

## On the HUJJAT landing (hujjat-experiment, Nov 2026)

- **Hero.** The paper and the stamp animation are the right idea, but they don't look real yet. Take them to full realism.
- **Second section** (Как это работает). Keep the folder-tab card layout. The only change: smooth the corner radius.
- **Navbar.** Replace the letter-spaced HUJJAT.
