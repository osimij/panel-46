// Searches answer with a sheet: one picture of the saves found, each numbered as its card's n,
// so FRIDAY can choose by eye. And get_reference opens one exact picture of a save at full size.
// `bun test tests/sheet.test.ts`. Nothing here calls Claude.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { seedSaves, startPanel, type TestPanel } from "./helpers.ts";

let p: TestPanel;
let ids: string[];

/** A plain JPEG of one color, made the way the plan's trial made them. */
function jpeg(file: string, color: string, size = "800x600") {
  mkdirSync(join(file, ".."), { recursive: true });
  const r = Bun.spawnSync(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", `color=c=${color}:s=${size}`, "-frames:v", "1", file]);
  if (r.exitCode !== 0) throw new Error(`ffmpeg couldn't make ${file}`);
}

/** A picture's width and height, as ffprobe reads them. */
async function sizeOf(data: string) {
  const file = join(p.dir, `probe-${Math.random().toString(36).slice(2)}.jpg`);
  await Bun.write(file, Buffer.from(data, "base64"));
  const r = Bun.spawnSync(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file]);
  rmSync(file);
  const [w, h] = r.stdout.toString().trim().split(",").map(Number);
  return { w: w!, h: h! };
}

const profile = {
  summary: "A calm fintech hero with real product UI on a light ground.",
  mood: ["calm", "precise"],
  color: { summary: "Light gray ground with one deep blue accent.", temperature: "cool", contrast: "medium", saturation: "muted" },
  typography: { present: true, summary: "A neutral grotesk, tight and calm.", classification: ["grotesk"] },
  layout: { summary: "A centred headline over a product screenshot.", density: "balanced", whitespace: "generous" },
  imagery: { summary: "Product UI screenshots.", style: ["product ui"] },
  motion: { present: false },
  worth_taking: ["The product screenshot sits under the headline, cut by the fold."],
};

const visuals = (id: string) => [
  { rel: `${id}/read/0.jpg`, label: "The whole page, cut into 3 columns: read the left column top to bottom, then the next" },
  { rel: `${id}/read/1.jpg`, label: "Desktop, screen 1 of 2 (0–900px down the page)" },
  { rel: `${id}/read/2.jpg`, label: "Desktop, screen 2 of 2 (900–1800px down the page)" },
];

beforeAll(async () => {
  p = await startPanel();
  ids = seedSaves(p, 6);
  const media = join(p.dir, "media");
  const colors = ["red", "green", "blue", "orange", "purple"];
  // Five of the six have a picture on disk; the fifth is very tall. The sixth has none.
  ids.slice(0, 5).forEach((id, i) => jpeg(join(media, `${id}/0.thumb.jpg`), colors[i]!, i === 4 ? "800x4000" : "800x600"));
  // The second save has three prepared pictures, like a site: the folded page, then two screens.
  visuals(ids[1]!).forEach((v, i) => jpeg(join(media, v.rel), ["gray", "white", "black"][i]!));
  const at = new Date("2026-02-01T00:00:00Z").toISOString();
  p.db.transaction(() => {
    for (const id of ids) {
      const signals = id === ids[1] ? JSON.stringify({ visuals: visuals(id) }) : null;
      p.db.run("INSERT INTO reads (ref_id, state, mode, model, palette, profile, signals, read_at) VALUES (?, 'done', 'now', 'test', '[]', ?, ?, ?)", [id, JSON.stringify(profile), signals, at]);
    }
    // The sixth save, with no picture, is the only favorite: a search for favorites has nothing to show.
    p.db.run("UPDATE refs SET favorite = 1, updated_at = ? WHERE id = ?", [at, ids[5]!]);
  })();
});
afterAll(async () => {
  await p?.stop();
});

type Block = { type: string; text?: string; data?: string; mimeType?: string };
async function call(name: string, args: Record<string, unknown>) {
  const res = await p.send("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, { accept: "application/json, text/event-stream" });
  return ((await res.json()) as any).result as { content: Block[]; isError?: boolean };
}

describe("a search answers with a sheet", () => {
  test("the cards, the sheet's words and one picture, numbered 1 to 6", async () => {
    const r = await call("search_library", {});
    expect(r.content.map((c) => c.type)).toEqual(["text", "text", "image"]);
    const j = JSON.parse(r.content[0]!.text!);
    expect(j.results.map((c: any) => c.n)).toEqual([1, 2, 3, 4, 5, 6]);
    // The number comes first on the card, and the id stays, so FRIDAY's panel still finds every save.
    expect(Object.keys(j.results[0])[0]).toBe("n");
    expect(j.results.map((c: any) => c.id)).toEqual(ids);
    expect(r.content[1]!.text).toContain("each numbered as its card's n");
    expect(j.next).toContain("sheet");
    expect(r.content[2]!.mimeType).toBe("image/jpeg");
    // Four columns of 300 with 6 between: 1230 wide. Two rows for six saves.
    const { w, h } = await sizeOf(r.content[2]!.data!);
    expect(w).toBe(1230);
    expect(h).toBe(6 + 2 * (225 + 6));
  });

  test("pictures: false gives words only, as before", async () => {
    const r = await call("search_library", { pictures: false });
    expect(r.content.map((c) => c.type)).toEqual(["text"]);
    const j = JSON.parse(r.content[0]!.text!);
    expect(j.results.every((c: any) => c.n === undefined)).toBe(true);
    expect(j.next).not.toContain("sheet");
  });

  test("saves with no picture on disk: no sheet, no numbers, the answer as it was", async () => {
    const r = await call("search_library", { favorites: true });
    const before = await call("search_library", { favorites: true, pictures: false });
    expect(r.content.map((c) => c.type)).toEqual(["text"]);
    expect(JSON.parse(r.content[0]!.text!).results.map((c: any) => c.id)).toEqual([ids[5]]);
    expect(r.content[0]!.text).toBe(before.content[0]!.text!);
  });

  test("similar_to: the save compared is 1", async () => {
    const r = await call("similar_to", { id: ids[0] });
    const j = JSON.parse(r.content[0]!.text!);
    expect(r.content.at(-1)!.type).toBe("image");
    expect(j.like.n).toBe(1);
    expect(j.results.map((c: any) => c.n)).toEqual(j.results.map((_: unknown, i: number) => i + 2));
  });

  test("gather_for_brief: numbered facet by facet, a save picked twice keeps one number", async () => {
    // Six saves, four picks a facet: the layout picks must reuse some of the color picks.
    const r = await call("gather_for_brief", {
      brief: "calm fintech hero", facets: ["color", "layout"], per_facet: 4,
      facet_briefs: { color: "light gray blue accent", layout: "centred headline product screenshot" },
    });
    const j = JSON.parse(r.content[0]!.text!);
    expect(j.picks.color.length).toBe(4);
    expect(j.picks.layout.length).toBe(4);
    expect(r.content.at(-1)!.type).toBe("image");
    const seen = new Map<string, number>();
    let next = 1;
    for (const f of ["color", "layout"]) {
      for (const c of j.picks[f]) {
        if (!seen.has(c.id)) seen.set(c.id, next++);
        expect(c.n).toBe(seen.get(c.id));
      }
    }
  });
});

describe("get_reference opens exact pictures", () => {
  test("pictures: [2] gives exactly the second, with its label", async () => {
    const r = await call("get_reference", { ids: [ids[1]], pictures: [2] });
    expect(r.isError).toBeFalsy();
    const images = r.content.filter((c) => c.type === "image");
    expect(images.length).toBe(1);
    expect(r.content.some((c) => c.text === `${ids[1]} picture 2: Desktop, screen 1 of 2 (0–900px down the page)`)).toBe(true);
    // A plain white picture: the second one, not the gray folded page or the black second screen.
    const j = JSON.parse(r.content[0]!.text!);
    expect(j.pictures_note).toContain("folded small");
  });

  test("two ids with pictures: a plain error", async () => {
    const r = await call("get_reference", { ids: [ids[0], ids[1]], pictures: [1] });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain("one id");
  });

  test("picture 9 of 3: a plain error that says how many it has", async () => {
    const r = await call("get_reference", { ids: [ids[1]], pictures: [9] });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain("has 3 pictures");
  });

  test("the short answer (facets) lists the pictures too", async () => {
    const r = await call("get_reference", { ids: [ids[1]], facets: ["color"], images: "none" });
    const j = JSON.parse(r.content[0]!.text!);
    expect(j.pictures).toEqual([
      { n: 1, what: visuals(ids[1]!)[0]!.label },
      { n: 2, what: visuals(ids[1]!)[1]!.label },
      { n: 3, what: visuals(ids[1]!)[2]!.label },
    ]);
    expect(j.pictures[0].path).toBeUndefined();
  });
});
