---
name: Motion
description: How things move on a page, so motion explains and delights instead of decorating. For anything that animates.
---

An example skill in Panel's form (Decide / Build / Check), written to try the skills machine. Replace it with your own, or change it freely.

## Decide

- **What moves, and why.** One moment may be the show (a hero, a reveal). Everything else is quiet and has a job: showing where something came from, what changed, or that a press was felt.
- **How long.** A press or hover: 100–200ms. Something opening, closing or moving: 200–400ms. Only a one-time intro may run longer.
- **How it eases.** Things arriving slow down (ease-out). Things leaving speed up (ease-in). Linear is only for what never stops (a spinner, a drifting background).
- **In what order.** Things that belong together arrive together or in a short stagger (30–60ms apart), never all at once from everywhere.

## Build

- Animate `transform` and `opacity`. Not width, height, top or left: they make the page stutter.
- Give the easing and the durations as knobs (`--ease-out`, `--dur-fast`, `--dur`), used everywhere.
- Respect people who asked for less motion: inside `@media (prefers-reduced-motion: reduce)`, turn off everything that isn't needed to understand the page, and show the end state.
- Motion that starts on scroll starts once, when the thing is really in view, and never hides content from someone who doesn't scroll.
- A looping background moves slowly enough that text over it stays easy to read.

## Check

- reduced_motion

## Look for

- Does anything move that would not be missed if it stood still?
- After the intro has played, is the page calm?
