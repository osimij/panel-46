// The mix card travels with a sketch: what it takes from which save, kept per version, and the
// pictures it took from coming back beside its screens so the two can be compared.
// Sketches are rendered in the Chrome on this Mac, so these run only where Chrome is installed.
// `bun test tests/mix.test.ts`. Nothing here calls Claude: the fresh look is off in tests.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedSaves, startPanel, type TestPanel } from "./helpers.ts";

const chrome = ["/Applications/Google Chrome.app", "/Applications/Chromium.app", "/Applications/Brave Browser.app", "/Applications/Microsoft Edge.app"].some((p) => existsSync(p));
const withChrome = chrome ? test : test.skip;

let p: TestPanel;
let project: string;
let hero: string, helper: string, other: string;

type Block = { type: string; text?: string; data?: string };
const tool = async (name: string, args: unknown) => {
  const res = await p.send("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, { accept: "application/json, text/event-stream" });
  const out = ((await res.json()) as any).result as { content: Block[]; isError?: boolean };
  const json = out.content?.find((c) => c.type === "text" && c.text!.startsWith("{"));
  return { ...out, first: json ? JSON.parse(json.text!) : null };
};

function jpeg(file: string, color: string, size: string) {
  mkdirSync(join(file, ".."), { recursive: true });
  const r = Bun.spawnSync(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", `color=c=${color}:s=${size}`, "-frames:v", "1", file]);
  if (r.exitCode !== 0) throw new Error(`ffmpeg couldn't make ${file}`);
}

async function sizeOf(data: string) {
  const file = join(p.dir, `probe-${Math.random().toString(36).slice(2)}.jpg`);
  await Bun.write(file, Buffer.from(data, "base64"));
  const r = Bun.spawnSync(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file]);
  rmSync(file);
  const [w, h] = r.stdout.toString().trim().split(",").map(Number);
  return { w: w!, h: h! };
}

const PAGE = (body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Test</title><style>:root{--bg:#f4f1ea;--ink:#1a1a1a}body{margin:0;font-family:system-ui;background:var(--bg);color:var(--ink)}</style></head><body>${body}</body></html>`;

const visuals = (id: string) => [
  { rel: `${id}/read/0.jpg`, label: "The whole page, cut into 3 columns: read the left column top to bottom, then the next" },
  { rel: `${id}/read/1.jpg`, label: "Desktop, screen 1 of 2 (0–900px down the page)" },
  { rel: `${id}/read/2.jpg`, label: "Desktop, screen 2 of 2 (900–1800px down the page)" },
];

/** A mix of the hero (its second picture) and the helper (one picture only: its thumbnail). */
const MIX = () => ({
  takes: [
    { save: helper, role: "helper", job: "color", take: "The deep blue #1d1765 as the only accent." },
    { save: hero, role: "hero", job: "structure", take: "A centred headline over a product screen cut by the fold.", leave: "Its stock photos.", picture: 2 },
  ],
  shares: "Both are calm and light.",
  unusual: "The product screen tilts a little.",
});

const sketchCount = async () => ((await p.get(`/api/projects/${project}`)).nodes as any[]).filter((n) => n.kind === "sketch").length;

/** A companion with three saves, the hero and the helper on a project's canvas. */
async function setup(env: Record<string, string> = {}) {
  p = await startPanel(env);
  [hero, helper, other] = seedSaves(p, 3);
  const media = join(p.dir, "media");
  // The hero is a site with three prepared pictures, big enough that they must be made small.
  visuals(hero).forEach((v, i) => jpeg(join(media, v.rel), ["gray", "white", "black"][i]!, "1600x1000"));
  jpeg(join(media, `${hero}/0.thumb.jpg`), "gray", "800x600");
  // The helper has no prepared pictures, only its thumbnail.
  jpeg(join(media, `${helper}/0.thumb.jpg`), "blue", "800x600");
  const at = new Date("2026-02-01T00:00:00Z").toISOString();
  p.db.transaction(() => {
    for (const id of [hero, helper, other]) {
      const signals = id === hero ? JSON.stringify({ visuals: visuals(id) }) : null;
      p.db.run("INSERT INTO reads (ref_id, state, mode, model, palette, profile, signals, read_at) VALUES (?, 'done', 'now', 'test', '[]', ?, ?, ?)", [id, JSON.stringify({ summary: "A save." }), signals, at]);
    }
  })();
  project = ((await (await p.send("POST", "/api/projects", { name: "Mix test", brief: "A test." })).json()) as any).id;
  // Both saves of the mix are on the canvas, so they can get their "uses" lines.
  const placed = await tool("place_on_board", { project, topic: "Layout", saves: [{ id: hero }, { id: helper }] });
  expect(placed.isError).toBeFalsy();
}

beforeAll(() => setup());
afterAll(async () => {
  await p?.stop();
});

let first: string;

describe("a sketch carries its mix", () => {
  withChrome("made with a mix: the mix in its JSON, then the two pictures it took from, hero first, small", async () => {
    const made = await tool("make_sketch", { project, title: "Mixed", html: PAGE("<h1>Calm money</h1>"), mix: MIX() });
    expect(made.isError).toBeFalsy();
    first = made.first.sketch;
    expect(made.first.mix.takes.map((t: any) => t.role)).toEqual(["hero", "helper"]);
    expect(made.first.next).toContain("compare with the pictures it took from");
    // The fresh look is off in tests, and there is no stand-in: nothing about it in the answer.
    expect(made.first.mix_checks).toBeUndefined();
    const at = made.content.findIndex((c) => c.text === "What it took from, small. Compare each with the screens above.");
    expect(at).toBeGreaterThan(0);
    // The sketch's own screens come before it.
    expect(made.content.slice(0, at).some((c) => c.type === "image")).toBe(true);
    const after = made.content.slice(at + 1);
    expect(after.map((c) => c.type)).toEqual(["text", "image", "text", "image"]);
    expect(after[0]!.text).toBe(`Took from ${hero}, picture 2 (Desktop, screen 1 of 2 (0–900px down the page)): structure: A centred headline over a product screen cut by the fold.`);
    expect(after[2]!.text).toStartWith(`Took from ${helper}, its thumbnail: color:`);
    for (const img of [after[1]!, after[3]!]) {
      const { w, h } = await sizeOf(img.data!);
      expect(Math.max(w, h)).toBeLessThanOrEqual(768);
    }
  }, 60_000);

  withChrome("both saves on the canvas get a uses line, though uses wasn't passed", async () => {
    const board = await p.get(`/api/projects/${project}`);
    const refNode = (id: string) => board.nodes.find((n: any) => n.kind === "ref" && n.ref_id === id).id;
    for (const id of [hero, helper]) {
      expect(board.edges.some((e: any) => e.source === refNode(id) && e.target === first && e.label === "uses")).toBe(true);
    }
  });

  withChrome("a wrong mix is a plain error, and nothing is put on the canvas", async () => {
    const before = await sketchCount();
    const wrong: [string, unknown, string][] = [
      ["no hero", { takes: [{ save: helper, role: "helper", job: "color", take: "blue" }] }, "This one has 0."],
      ["two heroes", { takes: [{ save: helper, role: "hero", job: "a", take: "b" }, { save: hero, role: "hero", job: "a", take: "b", picture: 1 }] }, "This one has 2."],
      ["an unknown save", { takes: [{ save: "ffffffffffffffff", role: "hero", job: "a", take: "b" }] }, "No save with id ffffffffffffffff."],
      ["no picture on a save with three", { takes: [{ save: hero, role: "hero", job: "a", take: "b" }] }, "It has 3 pictures"],
      ["picture 9 of 3", { takes: [{ save: hero, role: "hero", job: "a", take: "b", picture: 9 }] }, "has 3 pictures"],
    ];
    for (const [, mix, says] of wrong) {
      const r = await tool("make_sketch", { project, title: "Wrong", html: PAGE("<p>x</p>"), mix });
      expect(r.isError).toBe(true);
      expect(r.content[0]!.text).toContain(says);
    }
    expect(await sketchCount()).toBe(before);
  });

  withChrome("an edit without a mix keeps it; a new mix holds from its version on", async () => {
    const small = await tool("edit_sketch", { project, sketch: first, edits: [{ find: "Calm money", replace: "Calm money, kept" }] });
    expect(small.isError).toBeFalsy();
    expect(small.first.version).toBe(2);
    expect(small.first.mix.takes[0].save).toBe(hero);
    expect(small.content.filter((c) => c.text?.startsWith("Took from ")).length).toBe(2);

    const swap = { takes: [{ save: helper, role: "hero", job: "structure", take: "The blue field, edge to edge." }] };
    const changed = await tool("edit_sketch", { project, sketch: first, edits: [{ find: "kept", replace: "changed" }], mix: swap });
    expect(changed.isError).toBeFalsy();
    expect(changed.first.version).toBe(3);
    expect(changed.first.mix.takes.map((t: any) => t.save)).toEqual([helper]);

    const v1 = await tool("get_sketch", { project, sketch: first, version: 1, html: false, pictures: false });
    expect(v1.first.mix.takes.map((t: any) => t.save)).toEqual([hero, helper]);
  }, 60_000);

  withChrome("a sketch made from a sketch with a mix carries it", async () => {
    const branch = await tool("make_sketch", { project, title: "Branch", html: PAGE("<h1>Branch</h1>"), from: first });
    expect(branch.isError).toBeFalsy();
    expect(branch.first.mix.takes.map((t: any) => t.save)).toEqual([helper]);
  }, 60_000);

  withChrome("a wireframe with a mix is made, and keeps no mix", async () => {
    const wire = await tool("make_sketch", { project, title: "Wire", kind: "wireframe", html: PAGE("<section>Hero</section>"), mix: MIX() });
    expect(wire.isError).toBeFalsy();
    expect(wire.first.mix).toBeUndefined();
    expect(p.db.query("SELECT COUNT(*) n FROM sketch_mix WHERE sketch = ?").get(wire.first.sketch)).toEqual({ n: 0 });
  }, 60_000);

  withChrome("get_sketch shows the pictures it took from only with compare", async () => {
    const plain = await tool("get_sketch", { project, sketch: first, version: 1, html: false });
    expect(plain.first.mix).toBeDefined();
    expect(plain.content.some((c) => c.text?.startsWith("Took from "))).toBe(false);
    const compared = await tool("get_sketch", { project, sketch: first, version: 1, html: false, compare: true });
    const caps = compared.content.filter((c) => c.text?.startsWith("Took from "));
    expect(caps.length).toBe(2);
    expect(compared.content.at(-1)!.type).toBe("image");
  }, 60_000);
});

// The fresh look, with a stand-in form in place of Claude (PANEL_MIX_CHECK_FAKE), so what FRIDAY
// gets back can be checked without spending anything.
describe("the fresh look", () => {
  const fakes = mkdtempSync(join(tmpdir(), "panel-mixcheck-fake-"));
  const fake = join(fakes, "form.json");
  const form = (heroVerdict: string) => ({
    takes: [
      { save: hero, job: "structure", verdict: heroVerdict, note: "The headline is centred, but the product screen isn't there." },
      { save: helper, job: "color", verdict: "there", note: "The blue is the only accent." },
    ],
    copy: { verdict: "close", note: "Same split as the hero, little of its own." },
    sections: [
      { name: "Hero", follows: hero, template: false, note: "Follows the hero's first screen." },
      { name: "Features", follows: "none", template: true, note: "Three cards in a row." },
    ],
  });
  let sketch: string;

  beforeAll(async () => {
    await p.stop();
    writeFileSync(fake, JSON.stringify(form("missing")));
    await setup({ PANEL_MIX_CHECK_FAKE: fake });
  });
  afterAll(() => rmSync(fakes, { recursive: true, force: true }));

  withChrome("a sketch with a mix comes back with mix_checks, worst first", async () => {
    const made = await tool("make_sketch", { project, title: "Checked", html: PAGE("<h1>Calm money</h1>"), mix: MIX() });
    expect(made.isError).toBeFalsy();
    sketch = made.first.sketch;
    const marks = made.first.mix_checks.map((l: any) => l.mark);
    expect(marks).toEqual(["breaks", "check", "check", "fine"]);
    expect(made.first.mix_checks[0].what).toContain("missing");
    expect(made.first.mix_checks[1].what).toContain("close to the hero");
    expect(made.first.mix_checks[2].what).toStartWith("Features: no save behind it, and it reads as a template block");
    expect(made.first.mix_checks_from_version).toBeUndefined();
    expect(made.first.next).toContain("mix_checks are what a fresh pair of eyes found");
  }, 60_000);

  withChrome("a small edit carries the checks forward, saying from which version", async () => {
    const small = await tool("edit_sketch", { project, sketch, edits: [{ find: "Calm money", replace: "Calm money, again" }] });
    expect(small.first.version).toBe(2);
    expect(small.first.mix_checks.map((l: any) => l.mark)).toEqual(["breaks", "check", "check", "fine"]);
    expect(small.first.mix_checks_from_version).toBe(1);
  }, 60_000);

  withChrome("check: true asks again", async () => {
    writeFileSync(fake, JSON.stringify(form("there")));
    const again = await tool("edit_sketch", { project, sketch, edits: [{ find: "again", replace: "fixed" }], check: true });
    expect(again.first.version).toBe(3);
    expect(again.first.mix_checks.map((l: any) => l.mark)).toEqual(["check", "check", "fine", "fine"]);
    expect(again.first.mix_checks_from_version).toBeUndefined();
    // Kept with version 3, which had no row of its own (the edit kept the mix).
    const row = p.db.query<{ checks: string; mix: string }, [string]>("SELECT checks, mix FROM sketch_mix WHERE sketch = ? AND version = 3").get(sketch);
    expect(JSON.parse(row!.checks).takes[0].verdict).toBe("there");
    expect(JSON.parse(row!.mix).takes[0].save).toBe(hero);
  }, 60_000);

  withChrome("a stand-in that isn't a form: not checked, and the sketch is still made", async () => {
    writeFileSync(fake, "this is not JSON");
    const made = await tool("make_sketch", { project, title: "Unchecked", html: PAGE("<h1>Calm</h1>"), mix: MIX() });
    expect(made.isError).toBeFalsy();
    expect(made.first.mix_checks).toStartWith("not checked: ");
    expect(made.content.some((c) => c.type === "image")).toBe(true);
  }, 60_000);
});
