# Ready-made parts: where they came from

Panel ships with three sets of ready-made parts for sketches: loading animations, colour palettes and icons. This file says where each came from and keeps the notices that travel with them.

## Loading animations (`loading/`)

The 36 animations are plain HTML and CSS versions of the components in **loading.dev** (the `loading-dev` package, version 0.3.8), made by **Jakub Krehel** and **Paul Faivret**.

- Website: https://loading.dev
- Code: https://github.com/jakubkrehel/loading (commit `9327f75d04ca3a9d6444e71cd225916ef507eaaf`)

Each piece was written by hand from the component's source: the same shapes, keyframes, durations, delays and curves, with React taken out. Two things differ on purpose. Their size follows the text around them (`--ld-size`, 1.25em when not set, where the original is 20px), and two pieces that needed a unique id in React (phases, radar) use a fixed one. The one-line descriptions in `loading/index.json` are the first line of each component's page on loading.dev.

The original code carries this notice:

```
MIT License

Copyright (c) 2026 Jakub Krehel

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Icons (`icons/`)

The 1,512 icons, each in six weights (thin, light, regular, bold, fill, duotone), are **Phosphor Icons**, from the `@phosphor-icons/core` package, version 2.1.1. Phosphor is made by Helena Zhang and Tobias Fried (the package names Tobias Fried as its author; the copyright is "Phosphor Icons").

- Website: https://phosphoricons.com
- Code: https://github.com/phosphor-icons/core
- Package: https://registry.npmjs.org/@phosphor-icons/core/-/core-2.1.1.tgz

Each icon's drawing is kept exactly as in the package. `scripts/pack-icons.ts` packs them into one file per weight, and reads the search words and categories in `icons/index.json` from the package's own catalogue.

The package carries this notice:

```
MIT License

Copyright (c) 2023 Phosphor Icons

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Colour palettes (`palettes.json`)

The 37 palettes are colour values in OKLCH, read from the public palette pages of **oklch.fyi** on 11 November 2026; each palette keeps the link to its own page. 16 of them are 12-step scales with separate light and dark steps; the other 21 are sets of 5 to 10 colours.

The collection they came from says what they are: colour values as facts, with their source links, separated by the site's light and dark containers. They are not a licence over the site's implementation or branding, and their gamut and contrast have not been certified.

What each of the 12 steps is for (page background, subtle background, … high-contrast text) is the Radix convention as Jakub Krehel's `better-colors` skill lists it (https://github.com/jakubkrehel/skills, MIT, the same notice as above). It applies to the 12-step scales only.
