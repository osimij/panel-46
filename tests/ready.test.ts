// Ready-made parts (ready/ and server/ready.ts): the loading animations, colour palettes and icons
// that ship with Panel, what get_ready_made answers, and that every piece is safe to paste into a
// sketch. No Claude and no internet: everything here is files in this folder.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getReadyMade, ICON_WEIGHTS, iconDrawings, iconIndex, loadingParts, palettes } from "../server/ready.ts";
import { startPanel, type TestPanel } from "./helpers.ts";

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
