// The designer's own fonts (fonts.ts) and what they can do with their collections.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startPanel, type TestPanel } from "./helpers.ts";

// A font every Mac has, to upload as if it were the designer's.
const GENEVA = "/System/Library/Fonts/Geneva.ttf";
const withFont = existsSync(GENEVA) ? test : test.skip;

let p: TestPanel;
beforeAll(async () => {
  p = await startPanel();
});
afterAll(async () => {
  await p?.stop();
});

withFont("an uploaded font is read, listed, served to sketches and named to AI tools", async () => {
  const form = new FormData();
  form.append("file", new File([await Bun.file(GENEVA).arrayBuffer()], "Geneva.ttf"));
  form.append("file", new File(["not a font"], "notes.txt"));
  const up = (await (await fetch(`${p.url}/api/fonts`, { method: "POST", body: form })).json()) as any;
  expect(up.added).toHaveLength(1);
  expect(up.added[0].family).toBe("Geneva");
  expect(up.added[0].weight).toBe("400");
  expect(up.failed[0]).toContain("isn't a font file");

  const list = await p.get("/api/fonts");
  expect(list.map((f: any) => f.family)).toEqual(["Geneva"]);

  // The file itself, with the header a sandboxed sketch needs to load it.
  const file = await fetch(p.url + up.added[0].url);
  expect(file.ok).toBe(true);
  expect(file.headers.get("access-control-allow-origin")).toBe("*");
  expect(file.headers.get("content-type")).toBe("font/ttf");

  // Every sketch gets its @font-face, under the family's own name.
  const project = ((await (await p.send("POST", "/api/projects", { name: "Fonts", brief: "" })).json()) as any).id;
  const sketch = "0123456789abcdef";
  const dir = join(p.dir, "projects", project, "sketches", sketch);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "v1.html"), "<!doctype html><html><head><title>T</title></head><body><h1>Hi</h1></body></html>");
  const page = await (await fetch(`${p.url}/sketches/${project}/${sketch}/v1.html`)).text();
  expect(page).toContain(`font-family:"Geneva";src:url("/fonts/${up.added[0].url.split("/").pop()}")`);
  expect(page.indexOf("data-panel-fonts")).toBeLessThan(page.indexOf("</head>"));

  // FRIDAY and Claude Code learn the family from get_fonts.
  const res = await p.send("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_fonts", arguments: {} } }, { accept: "application/json, text/event-stream" });
  expect(JSON.stringify(await res.json())).toContain("“Geneva”: weights 400");

  // Renamed, the sketch writes the new name; deleted, it's gone from the list and the page.
  await p.send("PATCH", "/api/fonts/family?name=Geneva", { name: "Brand Sans" });
  expect((await p.get("/api/fonts"))[0].family).toBe("Brand Sans");
  await p.send("DELETE", `/api/fonts/family?name=${encodeURIComponent("Brand Sans")}`);
  expect(await p.get("/api/fonts")).toEqual([]);
  expect((await fetch(p.url + up.added[0].url)).status).toBe(404);
});

test("another site can't add fonts", async () => {
  const res = await p.send("POST", "/api/fonts", undefined, { origin: "https://example.com" });
  expect(res.status).toBe(403);
});

test("a collection can be duplicated and deleted, and its saves stay", async () => {
  const col = (await (await p.send("POST", "/api/collections", { name: "Warm refs" })).json()) as any;
  const copy = (await (await p.send("POST", `/api/collections/${col.id}/duplicate`)).json()) as any;
  expect(copy.name).toBe("Warm refs copy");
  const again = (await (await p.send("POST", `/api/collections/${col.id}/duplicate`)).json()) as any;
  expect(again.name).toBe("Warm refs copy 2");
  expect((await p.send("DELETE", `/api/collections/${copy.id}`)).ok).toBe(true);
  const names = ((await p.get("/api/collections")) as any[]).map((c) => c.name);
  expect(names).toEqual(["Warm refs", "Warm refs copy 2"]);
  // Only Panel's own page may change them.
  expect((await p.send("DELETE", `/api/collections/${col.id}`, undefined, { origin: "https://example.com" })).status).toBe(403);
});

test("FRIDAY's tools can't make collections any more", async () => {
  const res = await p.send("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }, { accept: "application/json, text/event-stream" });
  const names = ((await res.json()) as any).result.tools.map((t: any) => t.name);
  expect(names).toContain("get_fonts");
  expect(names).not.toContain("save_to_collection");
});
