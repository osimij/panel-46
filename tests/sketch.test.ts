// Sketches are rendered in the Chrome on this Mac, so these run only where Chrome is installed.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { startPanel, type TestPanel } from "./helpers.ts";

const chrome = ["/Applications/Google Chrome.app", "/Applications/Chromium.app", "/Applications/Brave Browser.app", "/Applications/Microsoft Edge.app"].some((p) => existsSync(p));
const withChrome = chrome ? test : test.skip;

let p: TestPanel;
let project: string;
const tool = async (name: string, args: unknown) => {
  const res = await p.send("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, { accept: "application/json, text/event-stream" });
  const out = ((await res.json()) as any).result;
  return { ...out, first: out.content?.[0]?.type === "text" ? JSON.parse(out.content[0].text) : null };
};

beforeAll(async () => {
  p = await startPanel();
  project = ((await (await p.send("POST", "/api/projects", { name: "Sketch test", brief: "A test." })).json()) as any).id;
});
afterAll(async () => {
  await p?.stop();
});

const PAGE = (css: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Test</title><style>:root{--bg:#f4f1ea;--ink:#1a1a1a;--accent:#c8472b;--radius:16px}body{margin:0;font-family:system-ui;background:var(--bg);color:var(--ink)}${css}</style></head><body>${body}</body></html>`;

withChrome("a sketch comes back with pictures and with what breaks the designer's rules", async () => {
  const made = await tool("make_sketch", {
    project,
    title: "Breaks rules",
    html: PAGE(
      ".logo{letter-spacing:.4em;font-size:14px}.card{border-radius:var(--radius);background:#fff;padding:40px;margin:40px;width:400px}",
      `<nav style="padding:24px"><span class="logo">H U J J A T</span></nav><div class="card">Карточка</div>`,
    ),
  });
  expect(made.isError).toBeFalsy();
  expect(made.content.some((c: any) => c.type === "image")).toBe(true);
  const rules = (made.first.rule_checks ?? []).map((r: any) => `${r.rule}:${r.level}`);
  expect(rules).toContain("Wordmark:breaks");
  expect(rules).toContain("Corners:breaks");
}, 60_000);

withChrome("a sketch that follows them comes back clean", async () => {
  const made = await tool("make_sketch", {
    project,
    title: "Follows rules",
    html: PAGE(
      ".card{border-radius:var(--radius);corner-shape:squircle;background:#fff;padding:40px;margin:40px;width:400px}",
      `<nav style="padding:24px"><span>Hujjat</span></nav><div class="card">Карточка</div>`,
    ),
  });
  expect(made.first.rule_checks?.filter((r: any) => r.level === "breaks") ?? []).toEqual([]);
}, 60_000);
