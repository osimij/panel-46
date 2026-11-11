// Search answers as the model reads them: short cards for the best, one line each for the rest,
// and the whole read one get_reference away. `bun test tests/search.test.ts`.
// The seeded saves have no design read, so a few are given one here, long enough that a
// short card has something to cut.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { seedSaves, startPanel, type TestPanel } from "./helpers.ts";

let p: TestPanel;
let ids: string[];
let read: string[];

const NOTE = "The designer's own note, which is long on purpose so that nothing may ever cut it: the way the headline breaks over three lines and the tiny caption sits under it is exactly what I want for the NavTech landing page, keep the acid green but only as a single accent, never as a background, and look at how the stagger lands on the last word.";

const profile = (n: number) => ({
  summary:
    `An energetic poster number ${n} for a music festival where a huge condensed grotesk headline is cropped by the edges of the sheet and set against a field of acid green, red and deep black, with small technical captions running along the margins like a timetable. ` +
    "A second sentence that a short card should never show, because it is only the start that says what the save is.",
  format: ["poster"],
  mood: ["energetic", "loud", "kinetic", "brash", "youthful", "raw"],
  style_references: ["swiss punk", "rave flyer", "brutalism", "constructivism"],
  color: { summary: "Acid green against black with a hot red accent; the green does all the shouting and the black keeps it from tipping into noise, with off-white captions to rest the eye between the loud parts of the sheet.", temperature: "mixed", contrast: "high", saturation: "vivid", roles: [{ hex: "#c6f432", role: "accent" }] },
  typography: { present: true, summary: "A heavy condensed grotesk set huge and cropped by the sheet's edges, with tight negative tracking, all caps, against tiny mono captions that carry the dates and times; the contrast in scale is the whole point of the page.", classification: ["grotesk", "condensed"], likely_fonts: ["Druk"], case: "upper", scale_contrast: "extreme", tracking: "tight" },
  layout: { summary: "Edge to edge, the headline bleeds off three sides.", density: "dense", whitespace: "minimal", notable: ["bleed"] },
  imagery: { summary: "None beyond type and flat color.", style: ["typographic"] },
  motion: { present: true, summary: "Letters stagger in from below with a hard spring and the last word lands a beat late, which gives the whole sequence its punch.", pace: "fast", techniques: ["stagger", "spring"], confidence: "high" },
  components: ["headline", "caption", "date block", "logo lockup", "ticket strip", "grid", "footer", "badge", "sticker"],
  worth_taking: ["Crop the headline by the edge of the frame.", "One acid accent on black."],
  search_terms: ["festival poster"],
});

const palette = [
  { hex: "#0b0b0b", share: 0.18, name: "black" },
  { hex: "#c6f432", share: 0.42, name: "acid green" },
  { hex: "#e2372b", share: 0.2, name: "red" },
  { hex: "#f4f1ea", share: 0.12, name: "off-white" },
  { hex: "#7a7a7a", share: 0.08, name: "gray" },
];

beforeAll(async () => {
  p = await startPanel();
  ids = seedSaves(p, 100);
  read = ids.slice(30, 33);
  const at = new Date("2026-02-01T00:00:00Z").toISOString();
  p.db.transaction(() => {
    read.forEach((id, i) => {
      p.db.run("INSERT INTO reads (ref_id, state, mode, model, palette, profile, read_at) VALUES (?, 'done', 'now', 'test', ?, ?, ?)", [id, JSON.stringify(palette), JSON.stringify(profile(i)), at]);
    });
    p.db.run("UPDATE refs SET note = ?, updated_at = ? WHERE id = ?", [NOTE, at, read[0]!]);
    // Most real saves have no title of their own: one with a read, and one with neither.
    p.db.run("UPDATE refs SET title = NULL WHERE id IN (?, ?)", [read[2]!, ids[1]!]);
    p.db.run("UPDATE refs_fts SET title = '' WHERE ref_id IN (?, ?)", [read[2]!, ids[1]!]);
  })();
});
afterAll(async () => {
  await p?.stop();
});

async function call(name: string, args: Record<string, unknown>) {
  const res = await p.send("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, { accept: "application/json, text/event-stream" });
  const out = (await res.json()) as any;
  return out.result as { content: { type: string; text?: string }[]; isError?: boolean };
}
const json = async (name: string, args: Record<string, unknown>) => JSON.parse((await call(name, args)).content[0]!.text!);

describe("search answers", () => {
  test("a default search gives short cards", async () => {
    const r = await json("search_library", { query: "energetic" });
    expect(r.total).toBe(3);
    expect(r.results.length).toBe(3);
    expect(r.more).toBeUndefined();
    expect(r.showing).toBe("1–3 of 3 as cards");
    expect(r.next).toContain("get_reference");
    for (const c of r.results) {
      expect(c.worth_taking).toBeUndefined();
      expect(c.summary).toBeUndefined();
      expect(c.open).toBeUndefined();
      expect(c.palette).toBeUndefined();
      expect(c.type_summary).toBeUndefined();
      expect(c.about.length).toBeLessThanOrEqual(165);
      expect(c.about.endsWith("…")).toBe(true);
      expect(c.about).not.toContain("second sentence");
      expect(c.mood).toEqual(["energetic", "loud", "kinetic", "brash"]);
      // The biggest three by share, whatever order they were measured in.
      expect(c.colors).toEqual(["#c6f432 acid green 42%", "#e2372b red 20%", "#0b0b0b black 18%"]);
      expect(c.matched).toBe("1/1: energetic");
    }
    const noted = r.results.find((c: any) => c.id === read[0]);
    expect(noted.note).toBe(NOTE);
  });

  test("a short card says its first sentence once", async () => {
    const r = await json("search_library", { query: "energetic" });
    // A save with its own title keeps it, beside what it is.
    const titled = r.results.find((c: any) => c.id === read[0]);
    expect(titled.title).toStartWith(`Save ${Number.parseInt(read[0]!, 16)}`);
    expect(titled.about).toStartWith("An energetic poster number 0");
    // Without one, the title would only repeat the start of `about`, so it's left out.
    const untitled = r.results.find((c: any) => c.id === read[2]);
    expect(untitled.title).toBeUndefined();
    expect(untitled.about).toStartWith("An energetic poster number 2");
    // With neither a title nor a read, the card still says something.
    const bare = (await json("search_library", {})).results.find((c: any) => c.id === ids[1]);
    expect(bare.title).toBe("Untitled");
    expect(bare.about).toBeUndefined();
    // The full card is as it was: the fallback title stays.
    const full = await json("search_library", { query: "energetic", detail: "full" });
    expect(full.results.find((c: any) => c.id === read[2]).title).toStartWith("An energetic poster number 2");
  });

  test("detail full gives the whole card, and no lines", async () => {
    const r = await json("search_library", { query: "energetic", detail: "full" });
    expect(r.results.length).toBe(3);
    expect(r.more).toBeUndefined();
    expect(r.next).toBeUndefined();
    for (const c of r.results) {
      expect(c.worth_taking).toEqual(["Crop the headline by the edge of the frame.", "One acid accent on black."]);
      expect(c.summary).toContain("A second sentence");
      expect(c.open).toContain(`?open=${c.id}`);
    }
  });

  test("the rest of the list comes as lines, in the same order", async () => {
    // "save" is in 98 titles (two were left without one above), and in the untitled read save's summary.
    const r = await json("search_library", { query: "save" });
    expect(r.total).toBe(99);
    expect(r.results.length).toBe(12);
    expect(r.more.length).toBe(60);
    expect(r.not_listed).toBe(27);
    expect(r.showing).toBe("1–12 of 99 as cards, 13–72 as lines");
    expect(r.next).toContain("27 more matched");
    for (const line of r.more) expect(typeof line).toBe("string");
    // Lines carry no "id": key, so FRIDAY's panel shows thumbnails only for the cards.
    expect(JSON.stringify(r.more)).not.toContain('"id"');
    const short = [...r.results.map((c: any) => c.id), ...r.more.map((l: string) => l.split(" · ")[0])];
    const full1 = await json("search_library", { query: "save", detail: "full", limit: 60 });
    const full2 = await json("search_library", { query: "save", detail: "full", limit: 12, offset: 60 });
    expect(short).toEqual([...full1.results, ...full2.results].map((c: any) => c.id));
    // A read save's line has its title and three of its moods.
    const few = await json("search_library", { query: "energetic", limit: 1 });
    const withRead = few.more.find((l: string) => l.startsWith(read[1]!));
    expect(withRead).toBe(`${read[1]} · Save ${Number.parseInt(read[1]!, 16)} · energetic, loud, kinetic`);
  });

  test("a search with nothing asked lists no lines after the cards", async () => {
    // With no words, look or colors it is only the newest saves, not matches.
    const r = await json("search_library", {});
    expect(r.total).toBe(100);
    expect(r.results.length).toBe(12);
    expect(r.more).toBeUndefined();
    expect(r.not_listed).toBe(88);
    expect(r.showing).toBe("1–12 of 100 as cards");
    expect(r.next).toContain("88 more aren't listed");
    expect(r.next).toContain("offset 12");
    expect(r.next).not.toContain("matched");
    // Further along, the count and the offset to ask from follow.
    const later = await json("search_library", { offset: 12 });
    expect(later.more).toBeUndefined();
    expect(later.not_listed).toBe(76);
    expect(later.next).toContain("offset 24");
    // A filter alone is still nothing asked: 14 saves carry the tag, 12 as cards and 2 unlisted.
    const tagged = await json("search_library", { tags: ["dark"] });
    expect(tagged.total).toBe(14);
    expect(tagged.more).toBeUndefined();
    expect(tagged.not_listed).toBe(2);
  });

  test("fewer found than the lines can hold: nothing is left unlisted", async () => {
    const r = await json("search_library", { query: "editorial poster", limit: 5 });
    // 20 are titled "editorial poster", and two of the read ones are posters by their read.
    expect(r.total).toBe(22);
    expect(r.results.length).toBe(5);
    expect(r.more.length).toBe(r.total - 5);
    expect(r.not_listed).toBeUndefined();
    expect(r.next).not.toContain("more matched");
  });

  test("a search within typography puts the type on the short card", async () => {
    const r = await json("search_library", { query: "grotesk", facets: ["typography"] });
    expect(r.results.length).toBe(3);
    for (const c of r.results) {
      expect(c.typography).toStartWith("A heavy condensed grotesk");
      expect(c.typography.length).toBeLessThanOrEqual(200);
      expect(c.motion).toBeUndefined();
    }
    const m = await json("search_library", { query: "brutalism", facets: ["mood"] });
    expect(m.results[0].style_references).toEqual(["swiss punk", "rave flyer", "brutalism"]);
    const k = await json("search_library", { query: "sticker", facets: ["components"] });
    expect(k.results[0].components.length).toBe(8);
  });
});

describe("opening a save", () => {
  test("with facets, only those parts and what's worth taking", async () => {
    const out = await call("get_reference", { ids: [read[0]], images: "none", facets: ["typography"] });
    const d = JSON.parse(out.content[0]!.text!);
    expect(d.typography.summary).toStartWith("A heavy condensed grotesk");
    expect(d.worth_taking.length).toBe(2);
    expect(d.note).toBe(NOTE);
    expect(d.title).toBeDefined();
    // Searches carry no link, so the way back to the save comes with opening it.
    expect(d.open).toContain(`?open=${read[0]}`);
    for (const k of ["files", "pictures", "read", "palette", "color", "motion", "post_text"]) expect(d[k]).toBeUndefined();
  });

  test("without facets, everything as before", async () => {
    const out = await call("get_reference", { ids: [read[0]], images: "none" });
    const d = JSON.parse(out.content[0]!.text!);
    for (const k of ["read", "files", "pictures", "palette", "open", "saved_at"]) expect(d[k]).toBeDefined();
    expect(d.read.worth_taking.length).toBe(2);
    expect(d.typography).toBeUndefined();
  });
});

describe("the other ways of finding", () => {
  test("gather_for_brief still answers with its picks", async () => {
    const r = await json("gather_for_brief", { brief: "energetic grotesk", facets: ["typography", "motion"] });
    expect(r.picks.typography.length).toBeGreaterThan(0);
    expect(r.picks.typography[0].worth_taking.length).toBe(2);
    expect(r.picks.typography[0].open).toContain("?open=");
  });

  test("find_by_color gives short cards with the color line", async () => {
    const r = await json("find_by_color", { colors: ["#e2372b"] });
    expect(r.total).toBe(3);
    expect(r.results[0].colors_matched[0]).toContain("#e2372b");
    expect(r.results[0].color).toStartWith("Acid green");
    expect(r.results[0].worth_taking).toBeUndefined();
    const full = await json("find_by_color", { colors: ["#e2372b"], detail: "full" });
    expect(full.results[0].worth_taking.length).toBe(2);
  });

  test("similar_to gives short cards, the save it started from too", async () => {
    const r = await json("similar_to", { id: read[0], facets: ["color"] });
    expect(r.like.id).toBe(read[0]);
    expect(r.like.worth_taking).toBeUndefined();
    expect(r.results.length).toBe(2);
    expect(r.results[0].why.length).toBeGreaterThan(0);
  });
});
