// Ready-made parts named by a tag in a sketch's page (server/parts.ts): Panel fills each
// <panel-icon> and <panel-loading> with its own drawing when a page is saved, and turns them back
// into tags when it hands the page to an AI. Pure: no Panel running, no Claude, no internet.

import { expect, test } from "bun:test";
import { draftWithParts, fillParts, filledIcon, loadingStyle, shortParts, shortPartsLoosely } from "../server/parts.ts";
import { iconDrawings, iconSvg, loadingPiece } from "../server/ready.ts";

const page = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><style>:root{--ink:#222}</style></head><body>${body}</body></html>`;
const count = (s: string, part: string) => s.split(part).length - 1;

test("an icon tag becomes exactly iconSvg()'s drawing, marked with its name and weight", () => {
  const svg = iconSvg("trash")!;
  expect(fillParts(`<p><panel-icon name="trash"></panel-icon></p>`)).toBe(`<p><svg data-panel-icon="trash" data-panel-weight="regular"${svg.slice(4)}</p>`);
  // Another weight.
  const bold = fillParts(`<panel-icon name="gear" weight="bold"></panel-icon>`);
  expect(bold).toBe(`<svg data-panel-icon="gear" data-panel-weight="bold"${iconSvg("gear", "bold")!.slice(4)}`);
  expect(bold).toContain(iconDrawings("bold").gear);
  // Written either way, the same drawing; names and weights in any case.
  expect(fillParts(`<panel-icon name="trash"/>`)).toBe(fillParts(`<panel-icon name="trash"></panel-icon>`));
  expect(fillParts(`<panel-icon name="trash" />`)).toBe(fillParts(`<panel-icon name="Trash" weight="Regular"></panel-icon>`));
  expect(fillParts(`<panel-icon name='trash'>  </panel-icon>`)).toBe(fillParts(`<panel-icon name="trash"></panel-icon>`));
});

test("class, style, id and title are carried over; an aria-label makes it a picture with that name", () => {
  const out = fillParts(`<panel-icon name="x" class="close big" style="font-size:20px" id="shut" title='Close "now"' data-x="dropped"></panel-icon>`);
  expect(out).toStartWith(`<svg data-panel-icon="x" data-panel-weight="regular" class="close big" xmlns=`);
  expect(out).toContain(` aria-hidden="true" id="shut" style="font-size:20px" title="Close &quot;now&quot;">`);
  expect(out).not.toContain("data-x");
  expect(out).toContain(iconDrawings("regular").x);

  const labelled = fillParts(`<panel-icon name="trash" aria-label="Delete file"></panel-icon>`);
  expect(labelled).toContain(` role="img" aria-label="Delete file">`);
  expect(labelled).not.toContain("aria-hidden");
});

test("a loading tag becomes its markup, and its style is in the page once however often it's used", () => {
  const out = fillParts(page(`<p><panel-loading name="ring"></panel-loading> Uploading</p><p><panel-loading name="ring" style="--ld-size:13px"/></p><p><panel-loading name="ring" class="big"></panel-loading></p>`));
  expect(count(out, `<style data-panel-loading="ring">`)).toBe(1);
  expect(count(out, `<svg data-panel-loading="ring"`)).toBe(3);
  expect(out).toContain(loadingStyle("ring")!);
  // The style is right before the first one, and keeps the piece's licence line.
  expect(out).toContain(`<p>${loadingStyle("ring")}<svg data-panel-loading="ring" class="ld-ring" aria-hidden="true"`);
  expect(loadingStyle("ring")).toContain("/* Ring · from loading.dev by Jakub Krehel and Paul Faivret");
  expect(out).toContain(`class="ld-ring big"`);
  expect(out).toContain(`viewBox="0 0 24 24" style="--ld-size:13px">`);
  // The markup is the piece's own, past its opening tag.
  const piece = loadingPiece("ring")!;
  const markup = piece.slice(piece.indexOf("</style>") + 8).trim();
  expect(out).toContain(markup.slice(markup.indexOf(">") + 1));
  expect(out).not.toContain("<panel-");

  // Inside a <template>, the style goes before the template, where the page can use it.
  const t = fillParts(page(`<template id="row"><li><panel-loading name="arc"></panel-loading></li></template>`));
  expect(t).toContain(`${loadingStyle("arc")}<template id="row"><li><svg data-panel-loading="arc"`);
});

test("a wrong name saves nothing, and says the closest names", () => {
  expect(() => fillParts(page(`<panel-icon name="close"></panel-icon>`))).toThrow("There is no icon called “close”. Closest: x, x-circle");
  expect(() => fillParts(page(`<panel-icon name="gaer"></panel-icon>`))).toThrow(/Closest: .*gear/);
  expect(() => fillParts(page(`<panel-icon name="trash" weight="heavy"></panel-icon>`))).toThrow("There is no icon weight “heavy”. The weights: thin, light, regular, bold, fill, duotone.");
  expect(() => fillParts(page(`<panel-loading name="rnig"></panel-loading>`))).toThrow(/There is no loading animation called “rnig”\. Closest: ring/);
  expect(() => fillParts(page(`<panel-icon></panel-icon>`))).toThrow("An icon tag has no name");
  // Every wrong one at once, so all can be fixed in one go.
  try {
    fillParts(page(`<panel-icon name="nope1"></panel-icon><panel-loading name="nope2"></panel-loading>`));
  } catch (e) {
    expect((e as Error).message).toContain("“nope1”");
    expect((e as Error).message).toContain("“nope2”");
    expect((e as Error).message).toContain("Nothing was saved");
  }
});

test("tags inside a script, a style, a comment or a textarea are left alone", () => {
  const body = `<script>const t = '<panel-icon name="trash"></panel-icon>'; const w = "<panel-loading name='nope'>";</script>` +
    `<style>/* <panel-icon name="trash"></panel-icon> */ .a::after{content:"<panel-icon name=x>"}</style>` +
    `<!-- <panel-icon name="trash"></panel-icon> --><textarea><panel-icon name="trash"></panel-icon></textarea>` +
    `<div title="<panel-icon name='trash'>"></div>`;
  expect(fillParts(page(body))).toBe(page(body));
  // …and only the real one outside them is filled.
  const out = fillParts(page(body + `<panel-icon name="trash"></panel-icon>`));
  expect(count(out, "data-panel-icon")).toBe(1);
  expect(out).toContain(`<script>const t = '<panel-icon name="trash"></panel-icon>';`);
});

const MIXED = page(
  `<header><panel-icon name="list" aria-label="Menu"></panel-icon><panel-icon name="magnifying-glass" weight="bold" class="s"/></header>` +
  `<ul><li><panel-icon name="file-pdf"></panel-icon> Report.pdf <panel-loading name="ring" style="--ld-size:13px"></panel-loading></li>` +
  `<li><panel-icon name="check-circle" weight="fill" title="Done"></panel-icon><panel-loading name="arc" class="a"></panel-loading></li></ul>` +
  `<template id="t"><li><panel-loading name="wave"></panel-loading><panel-icon name="x"></panel-icon></li></template>` +
  `<button><panel-loading name="ring"></panel-loading> Save</button><script>var s='<panel-icon name="trash">';</script>`,
);

test("turning back and filling again gives the same page, byte for byte", () => {
  const full = fillParts(MIXED);
  const short = shortParts(full);
  expect(short).not.toContain("<path");
  expect(short).not.toContain("data-panel-");
  expect(fillParts(short)).toBe(full);
  // The short form is the tags, written one way.
  expect(short).toContain(`<panel-icon name="list" aria-label="Menu"></panel-icon><panel-icon name="magnifying-glass" weight="bold" class="s"></panel-icon>`);
  expect(short).toContain(`<panel-loading name="ring" style="--ld-size:13px"></panel-loading>`);
  // A short form of a short form, and a page with no parts, stay as they are.
  expect(shortParts(short)).toBe(short);
  expect(shortParts(page("<p>Hi</p>"))).toBe(page("<p>Hi</p>"));
  // A tag written another way comes back in the one way, and fills the same.
  expect(fillParts(shortParts(fillParts(`<panel-icon name='x' class=a/>`)))).toBe(fillParts(`<panel-icon name='x' class=a/>`));
});

test("a drawing someone changed isn't turned back, and the page still fills back to itself", () => {
  const full = fillParts(MIXED);
  // An icon's colour changed in the file: that one stays a drawing, the others are tags.
  const recoloured = full.replace(`data-panel-icon="list" data-panel-weight="regular" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="1em" height="1em" fill="currentColor"`, `data-panel-icon="list" data-panel-weight="regular" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="1em" height="1em" fill="#c00"`);
  expect(recoloured).not.toBe(full);
  const s1 = shortParts(recoloured);
  expect(s1).toContain(`fill="#c00"`);
  expect(s1).toContain(iconDrawings("regular").list);
  expect(s1).toContain(`<panel-icon name="file-pdf"></panel-icon>`);
  expect(fillParts(s1)).toBe(recoloured);

  // A path's number changed: kept as it is.
  const drawing = iconDrawings("regular")["file-pdf"]!;
  const n = drawing.match(/\d+\.\d+/)![0];
  const retyped = full.replace(drawing, drawing.replace(n, `${n}0`));
  expect(shortParts(retyped)).toContain(drawing.replace(n, `${n}0`));
  expect(fillParts(shortParts(retyped))).toBe(retyped);

  // The first ring changed: its style stays in the page (it no longer sits where filling would put it), and refilling adds no second one.
  const ringed = full.replace(`stroke-dasharray="16 46.8"`, `stroke-dasharray="20 46.8"`);
  const s3 = shortParts(ringed);
  expect(count(s3, `<style data-panel-loading="ring">`)).toBe(1);
  expect(s3).toContain(`<panel-loading name="ring"></panel-loading> Save`);
  expect(fillParts(s3)).toBe(ringed);

  // Its style gone: the rings aren't Panel's as they were, so they stay as they are.
  const unstyled = full.replace(loadingStyle("ring")!, "");
  expect(shortParts(unstyled)).toContain(`<svg data-panel-loading="ring"`);
  expect(fillParts(shortParts(unstyled))).toBe(unstyled);
});

test("the live draft and the part the designer points at", () => {
  // A half-written page fills what it can and never throws.
  expect(draftWithParts(`<p><panel-icon name="trash"></panel-icon><panel-icon name="tr`)).toContain("data-panel-icon=\"trash\"");
  expect(draftWithParts(`<panel-icon name="nope"></panel-icon>`)).toBe(`<panel-icon name="nope"></panel-icon>`);
  expect(draftWithParts(null)).toBe(null);
  // The browser writes <path …></path>, not <path …/>: still shown as the tag.
  const asBrowser = fillParts(`<button><panel-icon name="trash" class="i"></panel-icon> <panel-loading name="blocks"></panel-loading></button>`)
    .replace(/<path([^>]*)\/>/g, "<path$1></path>")
    .replace(/<div([^>]*)><\/div>/g, "<div$1></div>");
  const loose = shortPartsLoosely(asBrowser);
  expect(loose).toBe(`<button><panel-icon name="trash" class="i"></panel-icon> <panel-loading name="blocks"></panel-loading></button>`);
});

test("filledIcon is the same drawing a sketch gets", () => {
  expect(filledIcon("house", "duotone")).toBe(`<svg data-panel-icon="house" data-panel-weight="duotone"${iconSvg("house", "duotone")!.slice(4)}`);
  expect(filledIcon("not-an-icon", "regular")).toBeNull();
});
