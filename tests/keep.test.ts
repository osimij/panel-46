// Keep: a part of a sketch becomes one of its project's brand assets, as a real file. An <svg>
// part is kept as SVG, with its look written in (a fill from a :root variable becomes the real
// color) and nothing that could run; anything else as a PNG on a see-through ground at 2×.
// Rendered in the Chrome on this Mac, so these run only where Chrome is installed.
// `bun test tests/keep.test.ts`. No call to Claude.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { startPanel, type TestPanel } from "./helpers.ts";

const chrome = ["/Applications/Google Chrome.app", "/Applications/Chromium.app", "/Applications/Brave Browser.app", "/Applications/Microsoft Edge.app"].some((p) => existsSync(p));
const withChrome = chrome ? test : test.skip;

let p: TestPanel;
let project: string;
let sketch: string;
const tool = async (name: string, args: unknown) => {
  const res = await p.send("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, { accept: "application/json, text/event-stream" });
  const out = ((await res.json()) as any).result;
  const json = out.content?.find((c: any) => c.type === "text" && c.text.startsWith("{"));
  return { ...out, text: out.content?.[0]?.text as string, first: json ? JSON.parse(json.text) : null };
};

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Keep</title><style>
:root { --gem: #c8472b; --ground: #f4f1ea; }
body { margin: 0; background: var(--ground); font-family: system-ui; }
#gem circle { fill: var(--gem); }
.card { width: 200px; height: 120px; margin: 40px; background: #1d4e89; box-shadow: 0 12px 30px rgba(0,0,0,.4); border-radius: 24px; }
</style></head><body>
<svg id="gem" width="120" height="120" viewBox="0 0 120 120" onclick="alert(1)">
  <defs><linearGradient id="g"><stop offset="0" stop-color="#ffd166"/><stop offset="1" stop-color="#ef476f"/></linearGradient></defs>
  <circle cx="60" cy="60" r="50"/>
  <rect x="30" y="30" width="60" height="20" fill="url(#g)"/>
  <script>document.title = "ran";</script>
  <a href="https://example.com"><text x="10" y="110">Рохат</text></a>
</svg>
<div class="card"></div>
<div id="empty"></div>
</body></html>`;

/** A PNG's width, height, color type, and the alpha of its top-left pixel (the first pixel needs no unfiltering). */
function png(bytes: Buffer) {
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), colorType = bytes[25]!;
  const idat: Buffer[] = [];
  for (let at = 8; at < bytes.length; ) {
    const len = bytes.readUInt32BE(at);
    const type = bytes.subarray(at + 4, at + 8).toString();
    if (type === "IDAT") idat.push(bytes.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  return { width, height, colorType, firstAlpha: raw[4]! };
}

beforeAll(async () => {
  p = await startPanel({ PANEL_TRASH_DIR: "/tmp" });
  project = ((await (await p.send("POST", "/api/projects", { name: "Keep test" })).json()) as any).id;
  const made = await tool("make_sketch", { project, title: "Gem study", html: PAGE });
  sketch = made.first.sketch;
}, 60_000);
afterAll(async () => {
  await p?.stop();
});

withChrome("an <svg> part is kept as an SVG file with its look written in and nothing that runs", async () => {
  const kept = await tool("keep_part", { project, sketch, part: "#gem", name: "Rohat gem" });
  expect(kept.isError).toBeFalsy();
  expect(kept.first).toMatchObject({ name: "Rohat gem", kind: "image", format: "svg", size: "120×120" });
  expect(kept.first.src).toMatch(/^\/brand\/[0-9a-f]{16}\.svg$/);
  const svg = readFileSync(kept.first.path, "utf8");
  // The fill from the :root variable, as the real color; the gradient kept, pointed at by its id.
  expect(svg).toMatch(/<circle[^>]*fill="rgb\(200, 71, 43\)"/);
  expect(svg).toContain('fill="url(#g)"');
  expect(svg).toContain('stop-color="rgb(255, 209, 102)"');
  expect(svg).not.toContain("<script");
  expect(svg).not.toContain("onclick");
  expect(svg).not.toContain("example.com");
  expect(svg).not.toContain("var(--");
  expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(svg).toContain('viewBox="0 0 120 120"');
  // It belongs to the project and comes back from get_brand_assets.
  const list = await tool("get_brand_assets", { project, pictures: false });
  expect(list.text).toContain("“Rohat gem” (image, SVG, 120×120, project “Keep test”");
  // It opens as a picture: a sketch that shows it by its src loads it.
  const shown = await tool("make_sketch", {
    project, title: "Uses the gem",
    html: `<!doctype html><html><body><img src="${kept.first.src}" width="240" onload="if (!this.naturalWidth) throw new Error('empty')" onerror="throw new Error('The kept drawing did not load')"></body></html>`,
  });
  expect(shown.first.page_errors).toBeUndefined();
}, 90_000);

withChrome("a shape inside a drawing is kept as the whole drawing", async () => {
  // The studio points at the deepest thing under the pointer: one circle of the drawing.
  const res = await p.send("POST", `/api/projects/${project}/sketches/${sketch}/keep`, { selector: "#gem > circle" });
  const kept = (await res.json()) as any;
  expect(kept).toMatchObject({ format: "svg", name: "Drawing from Gem study", width: 120, height: 120 });
  const svg = readFileSync(kept.path, "utf8");
  expect(svg).toContain("<rect");
  expect(svg).toContain("<circle");
}, 60_000);

withChrome("anything else is kept as a PNG of the part alone, at 2×, on a see-through ground", async () => {
  const res = await p.send("POST", `/api/projects/${project}/sketches/${sketch}/keep`, { selector: ".card" });
  expect(res.ok).toBe(true);
  const kept = (await res.json()) as any;
  expect(kept).toMatchObject({ format: "png", kind: "image", name: "Part from Gem study", project_id: project, width: 400, height: 240 });
  const pic = png(readFileSync(kept.path));
  expect([pic.width, pic.height]).toEqual([400, 240]);
  expect(pic.colorType).toBe(6);
  // The rounded corner is see-through (the page's ground would be fully opaque there): at most a
  // trace of the card's own soft shadow shows.
  expect(pic.firstAlpha).toBeLessThan(32);
  const list = await tool("get_brand_assets", { project, pictures: false });
  expect(list.text).toContain("“Part from Gem study” (image, PNG, 400×240");
}, 90_000);

withChrome("a part that isn't there, or has no size, says so", async () => {
  const none = await p.send("POST", `/api/projects/${project}/sketches/${sketch}/keep`, { selector: "#nothing" });
  expect(none.status).toBe(400);
  expect(((await none.json()) as any).error).toBe("That part isn't in the page any more.");
  const viaTool = await tool("keep_part", { project, sketch, part: "#nothing", name: "x" });
  expect(viaTool.isError).toBe(true);
  expect(viaTool.text).toBe("That part isn't in the page any more.");
  const empty = await p.send("POST", `/api/projects/${project}/sketches/${sketch}/keep`, { selector: "#empty" });
  expect(((await empty.json()) as any).error).toBe("That part has no size to keep.");
}, 60_000);
