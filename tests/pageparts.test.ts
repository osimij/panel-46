// A part's look changed by hand, and parts taken out, written into the sketch's file
// (pageparts.ts): only where it's certain, and with every place counted in the file as it was.

import { expect, test } from "bun:test";
import { NOT_HERE, withParts, withStyle, withoutPart } from "../server/pageparts.ts";

const PAGE = `<!doctype html><html><head><style>:root{--muted:#6b6f76}</style></head><body><main><h1 class="title">Заголовок</h1><p class="lead" style="margin: 0">Подзаголовок</p><div class="cards"><div class="card">A</div><div class="card">A</div><div class="card">A</div><div class="card">A</div></div></main></body></html>`;
const card = (n: number) => `body > main:nth-child(1) > div:nth-child(3) > div:nth-child(${n})`;
/** The same page with each card marked by a comment, so it's clear which ones are left. */
const MARKED = PAGE.replace(/<div class="card">A<\/div>/g, (() => {
  let i = 0;
  return () => `<div class="card">A<!--${++i}--></div>`;
})());
const marks = (html: string) => [...html.matchAll(/<!--(\d+)-->/g)].map((m) => Number(m[1]));

test("a style merges into the style the part already has", () => {
  const p = "body > main:nth-child(1) > p:nth-child(2)";
  const out = withStyle(PAGE, { path: p, cls: "lead", id: "", text: "Подзаголовок", props: { color: "#6b6f76", "font-weight": "300" } });
  expect(out).toContain(`<p class="lead" style="margin: 0; color: #6b6f76; font-weight: 300">Подзаголовок</p>`);
  // Again: the same property is replaced, and null takes one away.
  const again = withStyle(out, { path: p, cls: "lead", text: "Подзаголовок", props: { color: "#111111", "font-weight": null } });
  expect(again).toContain(`style="margin: 0; color: #111111"`);
});

test("a font name with quotes in it is kept whole, through a second change too", () => {
  const h1 = { path: "body > main:nth-child(1) > h1:nth-child(1)", cls: "title", text: "Заголовок" };
  const once = withStyle(PAGE, { ...h1, props: { "font-family": `"ALS Hauss Next VF", system-ui` } });
  expect(once).toContain(`<h1 class="title" style="font-family: &quot;ALS Hauss Next VF&quot;, system-ui">`);
  const twice = withStyle(once, { ...h1, props: { "font-size": "1.2em" } });
  expect(twice).toContain(`<h1 class="title" style="font-family: &quot;ALS Hauss Next VF&quot;, system-ui; font-size: 1.2em">`);
});

test("the third of four cards that look the same is the one taken out", () => {
  expect(marks(withoutPart(MARKED, { path: card(3), cls: "card", text: "A" }))).toEqual([1, 2, 4]);
});

test("two cards side by side taken out in one save are the right two", () => {
  const out = withParts(MARKED, { removes: [{ path: card(2), cls: "card", text: "A" }, { path: card(3), cls: "card", text: "A" }] });
  expect(marks(out)).toEqual([1, 4]);
});

test("a part taken out and words changed after it in one save both land", () => {
  const out = withParts(PAGE, {
    removes: [{ path: "body > main:nth-child(1) > h1:nth-child(1)", cls: "title", text: "Заголовок" }],
    words: [{ path: "body > main:nth-child(1) > p:nth-child(2)", before: "Подзаголовок", after: "Новые слова", beforeText: "Подзаголовок", afterText: "Новые слова" }],
  });
  expect(out).not.toContain("<h1");
  expect(out).toContain(`<p class="lead" style="margin: 0">Новые слова</p>`);
});

test("a part whose class isn't the file's is refused", () => {
  expect(() => withoutPart(PAGE, { path: card(1), cls: "tile", text: "A" })).toThrow(NOT_HERE);
});

test("a class the page's script added doesn't count against it", () => {
  expect(marks(withoutPart(MARKED, { path: card(1), cls: "card is-visible", text: "A" }))).toEqual([2, 3, 4]);
});

test("a place that isn't in the file is refused", () => {
  expect(() => withoutPart(PAGE, { path: card(9), cls: "card", text: "A" })).toThrow(NOT_HERE);
  expect(() => withStyle(PAGE, { path: "svg > path:nth-child(2)", props: { color: "red" } })).toThrow(NOT_HERE);
});

test("words that aren't the file's are refused", () => {
  expect(() => withoutPart(PAGE, { path: card(1), cls: "card", text: "B" })).toThrow(NOT_HERE);
});

test("a value with a semicolon in it is refused", () => {
  const h1 = { path: "body > main:nth-child(1) > h1:nth-child(1)", cls: "title", text: "Заголовок" };
  expect(() => withStyle(PAGE, { ...h1, props: { color: "red; position: fixed" } })).toThrow("That value can't be used here.");
  expect(() => withStyle(PAGE, { ...h1, props: { "background-color": "url(x)" } })).toThrow("That value can't be used here.");
});
