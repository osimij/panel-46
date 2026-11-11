// Ready-made parts (ready/ and server/ready.ts): the loading animations, colour palettes and icons
// that ship with Panel, what get_ready_made answers, and that every piece is safe to paste into a
// sketch. No Claude and no internet: everything here is files in this folder.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getReadyMade, ICON_WEIGHTS, iconDrawings, iconIndex, iconSvg, loadingParts, OWN_WORDS, palettes } from "../server/ready.ts";
import { fillParts, filledIcon, shortParts } from "../server/parts.ts";
import { startPanel, type TestPanel } from "./helpers.ts";

// Sketches are rendered in the Chrome on this Mac, so the tests that make one run only where Chrome is installed.
const chrome = ["/Applications/Google Chrome.app", "/Applications/Chromium.app", "/Applications/Brave Browser.app", "/Applications/Microsoft Edge.app"].some((x) => existsSync(x));
const withChrome = chrome ? test : test.skip;

const READY = join(import.meta.dir, "..", "ready");

let p: TestPanel;
beforeAll(async () => {
  p = await startPanel();
});
afterAll(async () => {
  await p?.stop();
});

/** get_ready_made as FRIDAY calls it, over Panel's MCP route; the answer's text. */
async function ask(args: Record<string, unknown>) {
  const res = await p.send("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_ready_made", arguments: args } }, { accept: "application/json, text/event-stream" });
  const body = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean } };
  expect(body.result.isError).toBeFalsy();
  return body.result.content.map((c) => c.text).join("");
}

test("the list holds 36 animations, 37 palettes and 1,512 icons in each of six weights", async () => {
  expect(loadingParts().loading).toHaveLength(36);
  expect(readdirSync(join(READY, "loading")).filter((f) => f.endsWith(".html"))).toHaveLength(36);
  expect(palettes().palettes).toHaveLength(37);
  expect(iconIndex().icons).toHaveLength(1512);
  expect(ICON_WEIGHTS).toEqual(["thin", "light", "regular", "bold", "fill", "duotone"]);
  for (const w of ICON_WEIGHTS) expect(Object.keys(iconDrawings(w))).toHaveLength(1512);

  // The page's routes give the same, and only read.
  const list = await p.get("/api/ready");
  expect(list.loading).toHaveLength(36);
  expect(list.loading[0].html).toContain("<style>");
  expect(list.palettes.palettes).toHaveLength(37);
  expect(list.icons.icons).toHaveLength(1512);
  expect(Object.keys(await p.get("/api/ready/icons/duotone"))).toHaveLength(1512);
  expect((await fetch(`${p.url}/api/ready/icons/heavy`)).status).toBe(404);
  const piece = await fetch(`${p.url}/api/ready/loading/arc`);
  expect(piece.headers.get("content-type")).toStartWith("text/plain");
  expect(await piece.text()).toContain("ld-arc");
  expect((await p.send("POST", "/api/ready")).status).not.toBe(200);
});

test("every icon is only drawing: no script, no outside link, no event handlers", () => {
  for (const w of ICON_WEIGHTS) {
    for (const [name, inner] of Object.entries(iconDrawings(w))) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
      expect(svg.toLowerCase()).not.toContain("<script");
      expect(svg.replace("http://www.w3.org/2000/svg", "")).not.toContain("http");
      expect(/\son[a-z]+\s*=/i.test(svg), `${w}/${name}`).toBe(false);
    }
  }
  // Each has its search words and categories from the package's catalogue.
  const trash = iconIndex().icons.find((i) => i.name === "trash")!;
  expect(trash.tags).toContain("delete");
  expect(trash.categories.length).toBeGreaterThan(0);
});

test("find_icons looks up several words at once, by name and by search words", async () => {
  const text = await ask({ find_icons: "trash, settings, arrow right" });
  const line = (w: string) => text.split("\n").find((l) => l.startsWith(`- ${w}:`)) ?? "";
  expect(line("trash")).toContain("trash");
  expect(line("settings")).toContain("gear");
  expect(line("arrow right").split(":")[1]!.trim().split(",")[0]).toBe("arrow-right");
  // Names only: no drawings in this answer.
  expect(text).not.toContain("<svg");
});

test("icons come as SVGs to paste, in a weight, twelve at most, and a wrong name gets the closest", async () => {
  const bold = await ask({ icons: ["trash", "gear"], weight: "bold" });
  expect(bold).toContain(`- trash: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="1em" height="1em" fill="currentColor" aria-hidden="true">${iconDrawings("bold").trash}</svg>`);
  expect(bold).toContain(iconDrawings("bold").gear);
  // Regular when no weight is given.
  expect(await ask({ icons: ["trash"] })).toContain(iconDrawings("regular").trash);

  const many = ["trash", "gear", "house", "user", "bell", "heart", "lock", "eye", "plus", "minus", "check", "x", "star", "sun"];
  const text = await ask({ icons: many });
  expect(text.match(/<svg /g)).toHaveLength(12);
  expect(text).toContain("Only 12 at once: ask again for star, sun.");

  const wrong = await ask({ icons: ["gaer"] });
  expect(wrong).toContain("gaer: not one of Panel's icons. Closest:");
  expect(wrong).toContain("gear");
  expect(wrong).not.toContain("<svg");
});

test("every animation is plain HTML and CSS that keeps to itself", () => {
  for (const { name } of loadingParts().loading) {
    const html = readFileSync(join(READY, "loading", `${name}.html`), "utf8");
    expect(html.toLowerCase()).not.toContain("<script");
    expect(html).not.toContain("http");
    expect(html).not.toContain("import");
    expect(html).toContain("currentColor");
    expect(html).toContain("@media (prefers-reduced-motion: reduce)");
    expect(html.match(/<style>/g)).toHaveLength(1);
    // Every class and every keyframe is the animation's own, so two on a page never collide.
    const classes = [...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1]!.split(/\s+/)).filter(Boolean);
    const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
    const selectors = [...css.matchAll(/\.([a-z][a-z0-9-]*)/gi)].map((m) => m[1]!);
    const keyframes = [...html.matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1]!);
    expect(keyframes.length, name).toBeGreaterThan(0);
    for (const c of [...classes, ...selectors, ...keyframes]) expect(c, `${name}: ${c}`).toStartWith(`ld-${name}`);
  }
});

test("get_ready_made: the list, one animation, one palette, and wrong names", async () => {
  const list = await ask({});
  expect(list).toContain("- bouncing-dots: Three staggered dots bouncing up and down.");
  expect(list).toContain("gray, slate, red, blue");
  expect(list).toContain("1512");

  const arc = await ask({ loading: "arc" });
  expect(arc).toContain(readFileSync(join(READY, "loading", "arc.html"), "utf8").trim());
  expect(arc).toContain("--ld-size");

  const blue = await ask({ palette: "blue" });
  expect(blue).toContain("1: Page background: oklch(0.989 0.008 252) · oklch(0.181 0.028 252)");
  expect(blue).toContain("9: Solid fill");
  expect(blue).toContain("12: High-contrast text");

  const noLoading = await ask({ loading: "spinner" });
  expect(noLoading).toContain(`There's no loading animation called "spinner". These are: arc, atom`);
  const noPalette = await ask({ palette: "beige" });
  expect(noPalette).toContain(`There's no colour palette called "beige". These are: gray, slate`);
});

test("every palette has its light and dark steps: 12 for each scale, 5 to 10 for each set", () => {
  const all = palettes();
  expect(all.steps).toHaveLength(12);
  const scales = all.palettes.filter((x) => x.kind === "scale");
  expect(scales).toHaveLength(16);
  for (const s of scales) {
    expect(s.light, s.name).toHaveLength(12);
    expect(s.dark, s.name).toHaveLength(12);
  }
  for (const s of all.palettes.filter((x) => x.kind === "set")) {
    expect(s.light.length, s.name).toBeGreaterThanOrEqual(5);
    expect(s.light.length, s.name).toBeLessThanOrEqual(10);
    expect(s.dark.length, s.name).toBe(s.light.length);
  }
  for (const s of all.palettes) for (const c of [...s.light, ...s.dark]) expect(c).toMatch(/^oklch\([\d.]+ [\d.]+ [\d.]+\)$/);
});

test("ready/NOTICE.md keeps both MIT notices", () => {
  const notice = readFileSync(join(READY, "NOTICE.md"), "utf8");
  expect(notice).toContain("Copyright (c) 2026 Jakub Krehel");
  expect(notice).toContain("Copyright (c) 2023 Phosphor Icons");
  expect(notice.match(/Permission is hereby granted, free of charge/g)).toHaveLength(2);
  expect(notice).toContain("Paul Faivret");
});

// ---------- Parts by name in a sketch (server/parts.ts, through make_sketch, edit_sketch, get_sketch) ----------

/** Any of Panel's tools, called the way FRIDAY calls it: the whole answer. */
async function tool(name: string, args: Record<string, unknown>) {
  const res = await p.send("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, { accept: "application/json, text/event-stream" });
  return ((await res.json()) as { result: { content: { type: string; text?: string }[]; isError?: boolean } }).result;
}
const texts = (r: { content: { type: string; text?: string }[] }) => r.content.filter((c) => c.type === "text").map((c) => c.text!);

let project = "";
async function aProject() {
  if (!project) project = ((await (await p.send("POST", "/api/projects", { name: "Parts test", brief: "A test." })).json()) as { id: string }).id;
  return project;
}
const sketchFile = (sketch: string, v: number) => join(p.dir, "projects", project, "sketches", sketch, `v${v}.html`);
const sketchesOn = async () => ((await p.get(`/api/projects/${project}`)) as { nodes: { kind: string }[] }).nodes.filter((n) => n.kind === "sketch").length;

const UPLOAD = `<!doctype html><html><head><meta charset="utf-8"><title>Upload</title><style>:root{--ink:#222}body{font-family:system-ui;color:var(--ink)}</style></head><body>
<main><h1>Files</h1><ul>
<li><panel-icon name="file-pdf"></panel-icon> Report.pdf <button aria-label="Remove"><panel-icon name="trash"></panel-icon></button></li>
<li><panel-icon name="file-image"></panel-icon> Photo.jpg <panel-loading name="ring" style="--ld-size:13px"></panel-loading> Uploading 62%</li>
<li><panel-icon name="check-circle" weight="fill"/> Notes.txt <panel-loading name="ring"></panel-loading><panel-loading name="ring" class="late"></panel-loading></li>
</ul></main></body></html>`;

test("find_icons: Panel's own words for everyday icons come first", async () => {
  const words = Object.keys(OWN_WORDS);
  expect(words).toEqual(["close", "menu", "settings", "search", "delete", "edit", "add", "back", "more", "home", "user", "download", "upload", "share", "copy", "link", "info", "warning", "success", "error"]);
  const names = new Set(iconIndex().icons.map((i) => i.name));
  for (const own of Object.values(OWN_WORDS)) for (const n of own) expect(names.has(n), n).toBe(true);
  const text = await ask({ find_icons: words.join(", ") });
  for (const w of words) {
    const found = text.split("\n").find((l) => l.startsWith(`- ${w}:`))!.slice(w.length + 4).split(", ");
    expect(found.slice(0, OWN_WORDS[w]!.length), w).toEqual(OWN_WORDS[w]!);
  }
});

test("a wrong part's name saves nothing, and the answer says the closest names", async () => {
  await aProject();
  const before = await sketchesOn();
  const r = await tool("make_sketch", { project, title: "Wrong", html: UPLOAD.replace(`name="trash"`, `name="close"`).replace(`name="ring"`, `name="rnig"`) });
  expect(r.isError).toBe(true);
  expect(texts(r).join("")).toContain("There is no icon called “close”. Closest: x, x-circle");
  expect(texts(r).join("")).toContain("There is no loading animation called “rnig”. Closest: ring");
  expect(await sketchesOn()).toBe(before);
});

test("the size limit counts the page with its drawings in", async () => {
  await aProject();
  const before = await sketchesOn();
  const tag = `<panel-icon name="house" weight="duotone"></panel-icon>`;
  const grows = filledIcon("house", "duotone")!.length - tag.length;
  const n = 1000;
  const shell = (pad: string) => `<!doctype html><html><body><!--${pad}-->${tag.repeat(n)}</body></html>`;
  const html = shell("x".repeat(1_500_000 - shell("").length - 10));
  expect(html.length).toBeLessThan(1_500_000);
  expect(html.length + n * grows).toBeGreaterThan(1_500_000);
  const r = await tool("make_sketch", { project, title: "Too big", html });
  expect(r.isError).toBe(true);
  expect(texts(r).join("")).toContain("too big");
  expect(await sketchesOn()).toBe(before);
});

withChrome("a sketch's parts: the file has the drawings, get_sketch gives the tags, a real build's hand-off the whole page", async () => {
  await aProject();
  const made = await tool("make_sketch", { project, title: "Upload", html: UPLOAD });
  expect(made.isError).toBeFalsy();
  const sketch = JSON.parse(texts(made)[0]!).sketch as string;

  const file = readFileSync(sketchFile(sketch, 1), "utf8");
  expect(file).toBe(fillParts(UPLOAD));
  expect(file).not.toContain("<panel-");
  expect(file).toContain(iconSvg("trash")!.slice(4));
  expect(file).toContain(iconDrawings("fill")["check-circle"]);
  expect(file.split(`<style data-panel-loading="ring">`)).toHaveLength(2);
  expect(file.split(`<svg data-panel-loading="ring"`)).toHaveLength(4);

  const got = texts(await tool("get_sketch", { project, sketch, pictures: false }));
  const page = got.at(-1)!;
  expect(page).toBe(shortParts(file));
  expect(page).not.toContain("<path");
  expect(page).toContain(`<panel-icon name="check-circle" weight="fill"></panel-icon>`);
  expect(page).toContain(`<panel-loading name="ring" style="--ld-size:13px"></panel-loading>`);
  expect(fillParts(page)).toBe(file);

  const handoff = JSON.parse(texts(await tool("get_handoff", { project, sketch }))[0]!) as { folder: string };
  expect(readFileSync(join(handoff.folder, "sketch", "index.html"), "utf8")).toBe(file);
}, 60_000);

withChrome("edit_sketch adds an icon by its tag, and the icons already there stay byte for byte", async () => {
  await aProject();
  const made = await tool("make_sketch", { project, title: "Upload to edit", html: UPLOAD });
  const sketch = JSON.parse(texts(made)[0]!).sketch as string;
  const v1 = readFileSync(sketchFile(sketch, 1), "utf8");
  const drawings = (html: string) => [...html.matchAll(/<svg data-panel-[\s\S]*?<\/svg>|<style data-panel-[\s\S]*?<\/style>/g)].map((m) => m[0]);

  const edited = await tool("edit_sketch", {
    project,
    sketch,
    edits: [
      { find: `<h1>Files</h1>`, replace: `<h1>Files</h1><label><panel-icon name="magnifying-glass" aria-label="Search"></panel-icon><input placeholder="Search files"></label>` },
      { find: `Photo.jpg`, replace: `Photo-2.jpg` },
    ],
  });
  expect(edited.isError).toBeFalsy();
  const v2 = readFileSync(sketchFile(sketch, 2), "utf8");
  for (const d of drawings(v1)) expect(v2).toContain(d);
  expect(drawings(v2)).toHaveLength(drawings(v1).length + 1);
  expect(v2).toContain(filledIcon("magnifying-glass", "regular", { "aria-label": "Search" })!);
  expect(v2).toContain("Photo-2.jpg");
  // Nothing else moved: the old page with the same two changes.
  expect(v2).toBe(v1.replace(`<h1>Files</h1>`, `<h1>Files</h1><label>${filledIcon("magnifying-glass", "regular", { "aria-label": "Search" })}<input placeholder="Search files"></label>`).replace("Photo.jpg", "Photo-2.jpg"));

  // An edit with a wrong name saves nothing.
  const wrong = await tool("edit_sketch", { project, sketch, edits: [{ find: "Notes.txt", replace: `Notes.txt <panel-icon name="trashcan"></panel-icon>` }] });
  expect(wrong.isError).toBe(true);
  expect(texts(wrong).join("")).toContain("There is no icon called “trashcan”");
  expect(existsSync(sketchFile(sketch, 3))).toBe(false);
}, 90_000);
