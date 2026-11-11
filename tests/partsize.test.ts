// A part's font size changed by hand is written as the page's own rule for it times a number
// (web/src/partsize.ts), so it keeps scaling with the page; a part that only inherits its
// size is written in em of the text around it.

import { expect, test } from "bun:test";
import { sizeFor, sizeOf, splitSize } from "../web/src/partsize.ts";

test("a size the page writes in its own units is that rule times a number", () => {
  // 1.12cqw of a 1090px page is 12.209px; the designer drags it to 18.3135px (one and a half).
  const look = { size: 12.209, parentSize: 16, sizeRule: "1.12cqw" };
  const value = sizeFor(18.3135, look);
  expect(value).toBe("calc((1.12cqw) * 1.5)");
  expect(sizeOf(value, look)).toBeCloseTo(18.3135, 3);
  // A range and one of the page's knobs work the same way.
  expect(sizeFor(40, { size: 20, parentSize: 16, sizeRule: "clamp(1rem, 2vw + 0.5rem, 2rem)" })).toBe("calc((clamp(1rem, 2vw + 0.5rem, 2rem)) * 2)");
  expect(sizeFor(30, { size: 20, parentSize: 16, sizeRule: "var(--size-title)" })).toBe("calc((var(--size-title)) * 1.5)");
});

test("a size changed before is changed again without growing longer", () => {
  // The file already has the part at one and a half times its rule (18px now); it goes to 24px.
  const look = { size: 18, parentSize: 16, sizeRule: "calc((1.12cqw) * 1.5)" };
  const value = sizeFor(24, look);
  expect(value).toBe("calc((1.12cqw) * 2)");
  expect(sizeOf(value, look)).toBeCloseTo(24, 6);
  expect(splitSize("calc((1.12cqw) * 1.5)")).toEqual({ rule: "1.12cqw", times: 1.5 });
  // Something that only looks like it is left whole.
  expect(splitSize("calc((1em) + (2px) * 2)")).toEqual({ rule: "calc((1em) + (2px) * 2)", times: 1 });
});

test("a part that only inherits its size is written in em of the text around it", () => {
  const look = { size: 16, parentSize: 16, sizeRule: null };
  expect(sizeFor(24, look)).toBe("1.5em");
  expect(sizeOf("1.5em", look)).toBe(24);
  expect(sizeOf("20px", look)).toBe(20);
  // A value this can't read says so, and the bar falls back to the page's own size.
  expect(sizeOf("larger", look)).toBeNull();
  // A rule too long to write on the part falls back to em.
  expect(sizeFor(24, { size: 16, parentSize: 16, sizeRule: `clamp(${"1rem + ".repeat(40)}1rem, 2vw, 3rem)` })).toBe("1.5em");
});
