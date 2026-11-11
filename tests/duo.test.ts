// "Plan, then build": the builder keeps a conversation of its own beside the planner's.
// A turn can't run here (it would call Claude), so each decision is tested on its own:
// which conversation a run continues, the brief the builder gets, and the note the
// planner gets about what was made. `bun test tests/duo.test.ts`.

import { afterAll, describe, expect, test } from "bun:test";
import { askedNote, builderAllows, builderBrief, builderNews, hasWords, oneModelAllows, plannerAllows, questionSaves, whichConversation, type Job } from "../server/duo.ts";
import type { Part } from "../server/chat.ts";
import { startPanel, type TestPanel } from "./helpers.ts";

describe("which conversation a run continues", () => {
  const ids = { main: "main-1", builder: "builder-1" };
  const jobs: Job[] = ["plain", "handover", "pointed", "figma", "alternates", "compact"];

  test("One model: always the main one", () => {
    for (const job of jobs) expect(whichConversation({ duo: false, job, ...ids })).toEqual({ on: "main", session: "main-1" });
  });

  test("Plan, then build: the planner the main one, the builder's jobs its own", () => {
    expect(whichConversation({ duo: true, job: "plain", ...ids })).toEqual({ on: "main", session: "main-1" });
    expect(whichConversation({ duo: true, job: "compact", ...ids })).toEqual({ on: "main", session: "main-1" });
    for (const job of ["handover", "pointed", "figma", "alternates"] as Job[]) {
      expect(whichConversation({ duo: true, job, ...ids })).toEqual({ on: "builder", session: "builder-1" });
    }
  });

  test("the builder's first job starts its conversation, never the planner's", () => {
    expect(whichConversation({ duo: true, job: "handover", main: "main-1", builder: null })).toEqual({ on: "builder", session: null });
  });
});

describe("the brief the builder gets", () => {
  const card = { text: "“NavTech” (project id p1). In the designer's words: a landing page.", hash: "h1" };
  const message = "<panel-context>The designer is on the canvas of the project “NavTech”. They have selected on the canvas: the topic Hero.</panel-context>\n\nSketch that hero.";
  const plan = "1. make_sketch from Hero, title “Hero”. 2. Headline 240px Hauss Next.";
  const brief = (given: { session: string | null; hash: string | null }, msg = message, c: typeof card | null = card) =>
    builderBrief({ job: "handover", builder: "Opus 5.5", planner: "Fable 5.2", message: msg, plan, card: c, given });
  const count = (s: string, x: string) => s.split(x).length - 1;

  test("a new builder conversation: who it is, the card, the message with its context, then the plan", () => {
    const r = brief({ session: null, hash: null });
    const text = r.prompt as string;
    expect(typeof text).toBe("string");
    expect(r.card).toBe("h1");
    const at = (x: string) => text.indexOf(x);
    expect(text).toStartWith("<panel-context>You are the builder, Opus 5.5.");
    expect(text).toContain("You haven't seen the planner's conversation");
    expect(at("<project-card>")).toBeGreaterThan(at("You are the builder"));
    expect(at("They have selected on the canvas: the topic Hero.")).toBeGreaterThan(at("</project-card>"));
    expect(at("Sketch that hero.")).toBeGreaterThan(at("They have selected"));
    expect(at("<plan>")).toBeGreaterThan(at("Sketch that hero."));
    expect(text).toContain(plan);
    expect(count(text, "<project-card>")).toBe(1);
    expect(text).toContain("Here is the project card.");
  });

  test("the same card again: not given twice across messages", () => {
    const r = brief({ session: "b1", hash: "h1" });
    expect(r.prompt as string).not.toContain("<project-card>");
    expect(r.card).toBeUndefined();
    expect(r.prompt as string).toContain("Sketch that hero.");
    expect(r.prompt as string).toContain(plan);
  });

  test("a changed card: given again, as a replacement", () => {
    const r = brief({ session: "b1", hash: "old" });
    expect(r.prompt as string).toContain("The project card has changed since you were given it");
    expect(r.card).toBe("h1");
  });

  test("never the card twice in one message", () => {
    const carried = `<panel-context>Here is the project card.\n<project-card>\n${card.text}\n</project-card>\n</panel-context>\n\nSketch that hero.`;
    const r = brief({ session: null, hash: null }, carried);
    expect(count(r.prompt as string, "<project-card>")).toBe(1);
    expect(r.card).toBeUndefined();
  });

  test("no project: no card", () => {
    const r = brief({ session: null, hash: null }, message, null);
    expect(r.prompt as string).not.toContain("<project-card>");
  });

  test("attachments come after the message, before the plan", () => {
    const picture = { type: "image" as const, source: { type: "base64" as const, media_type: "image/png" as const, data: "AAAA" } };
    const r = builderBrief({ job: "handover", builder: "Opus 5.5", planner: "Fable 5.2", message, blocks: [picture], plan, card, given: { session: null, hash: null } });
    const blocks = r.prompt as any[];
    expect(blocks.length).toBe(3);
    expect(blocks[0].text).toContain("Sketch that hero.");
    expect(blocks[0].text).not.toContain("<plan>");
    expect(blocks[1]).toBe(picture);
    expect(blocks[2].text).toContain(plan);
  });

  test("a pointed edit: the card when needed, then the message as it is", () => {
    const point = "<panel-context>In the studio, they pointed at one part of the sketch s1: the headline.</panel-context>\n\nBigger.";
    const first = builderBrief({ job: "pointed", builder: "Opus 5.5", message: point, card, given: { session: null, hash: null } });
    expect(first.prompt as string).toStartWith("Here is the project card.");
    expect(first.prompt as string).toEndWith(point);
    expect(first.prompt as string).not.toContain("You are the builder");
    const later = builderBrief({ job: "pointed", builder: "Opus 5.5", message: point, card, given: { session: "b1", hash: "h1" } });
    expect(later.prompt).toBe(point);
  });
});

describe("the note for the planner", () => {
  const page = "<!doctype html><html><head><style>:root{--bg:#fff}</style></head><body><h1>Создаём</h1></body></html>";
  const handover: Part[] = [
    { type: "tool", id: "t1", name: "get_project", model: "Fable 5.2", done: true },
    { type: "text", text: "I'm having the hero sketched." },
    { type: "tool", id: "t2", name: "hand_to_builder", model: "Fable 5.2", input: { plan: "1. …" }, done: true },
    { type: "tool", id: "t3", name: "place_on_board", model: "Opus 5.5", builder: true, input: { project: "p1", topic: "Hero", saves: [{ id: "a" }, { id: "b" }, { id: "c" }] }, done: true },
    { type: "tool", id: "t4", name: "make_sketch", model: "Opus 5.5", builder: true, input: { project: "p1", title: "Hero: edge to edge", html: page }, sketch: "d4098d0f546548c8", done: true },
    { type: "tool", id: "t5", name: "edit_sketch", model: "Opus 5.5", builder: true, input: { sketch: "d4098d0f546548c8", edits: [{ find: "<h1>", replace: "<h1 class=x>" }] }, done: true },
    { type: "text", text: "Fixing the leading.", builder: true },
    { type: "tool", id: "t6", name: "edit_sketch", model: "Opus 5.5", builder: true, input: { sketch: "d4098d0f546548c8", edits: [] }, done: true },
    { type: "tool", id: "t7", name: "get_sketch", model: "Opus 5.5", builder: true, input: { sketch: "d4098d0f546548c8" }, done: true },
    { type: "text", text: "The hero sketch is on the canvas, under a new Hero topic. «Создаём» runs edge to edge.", builder: true },
  ];

  test("names what was made and carries the builder's words", () => {
    const note = builderNews([handover]);
    expect(note).toContain("made the sketch “Hero: edge to edge” (d4098d0f546548c8)");
    expect(note).toContain("edited the sketch d4098d0f546548c8 (2 times)");
    expect(note).toContain("placed 3 saves under “Hero”");
    expect(note).toContain("The hero sketch is on the canvas");
    expect(note).not.toContain("Fixing the leading.");
    expect(note).toContain("get_project");
    expect(note).toContain("get_sketch");
    // Nothing of the page itself.
    expect(note).not.toContain("<");
    expect(note).not.toContain("doctype");
    expect(note.length).toBeLessThan(700);
  });

  test("no builder work: no note", () => {
    const plain: Part[] = [{ type: "tool", id: "t1", name: "search_library", done: true }, { type: "text", text: "Three references." }];
    expect(builderNews([plain])).toBe("");
    expect(builderNews([])).toBe("");
  });

  test("given once: an answer the planner took part in was told already", () => {
    const plain: Part[] = [{ type: "text", text: "Which one do you like?" }];
    expect(builderNews([plain, handover])).toBe("");
  });

  test("builder-only answers (a pointed edit) add up until the planner hears", () => {
    const pointed: Part[] = [
      { type: "tool", id: "p1", name: "edit_sketch", builder: true, input: { sketch: "d4098d0f546548c8" }, done: true },
      { type: "text", text: "Made the headline darker.", builder: true },
    ];
    const note = builderNews([pointed, handover]);
    expect(note).toContain("made the sketch “Hero: edge to edge”");
    expect(note).toContain("edited the sketch d4098d0f546548c8 (3 times)");
    expect(note).toContain("Made the headline darker.");
  });

  test("anything that failed is said", () => {
    const failed: Part[] = [{ type: "tool", id: "f1", name: "make_sketch", builder: true, input: { title: "Hero" }, error: "The page has no <body>.", done: true }];
    expect(builderNews([failed])).toContain("make_sketch failed");
  });
});

describe("the builder's conversation in the database", () => {
  let p: TestPanel;
  afterAll(async () => {
    await p?.stop();
  });

  test("two columns are added to a library that didn't have them, empty", async () => {
    p = await startPanel({}, `
      CREATE TABLE chats (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', session_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO chats (id, title, session_id, created_at, updated_at) VALUES ('0000000000000001', 'An older conversation', 'old-session', '2026-01-01', '2026-01-01');
    `);
    const cols = (p.db.query("PRAGMA table_info(chats)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("builder_session_id");
    expect(cols).toContain("builder_card_hash");
    const row = p.db.query("SELECT session_id, builder_session_id, builder_card_hash FROM chats WHERE id = '0000000000000001'").get();
    expect(row).toEqual({ session_id: "old-session", builder_session_id: null, builder_card_hash: null });
  });
});

describe("which tools each run may use", () => {
  const panel = (n: string) => `mcp__panel__${n}`;
  const steps = ["start_steps", "set_step", "stop_steps"].map(panel);

  test("One model: every one of Panel's tools, and asking, but nothing else", () => {
    for (const n of [panel("make_sketch"), panel("get_recipe"), ...steps, "mcp__friday__ask_designer"]) expect(oneModelAllows(n)).toBe(true);
    expect(oneModelAllows("mcp__friday__hand_to_builder")).toBe("FRIDAY only uses Panel's tools.");
    expect(oneModelAllows("Bash")).toBe("FRIDAY only uses Panel's tools.");
  });

  test("the planner runs the steps and asks; making is the builder's", () => {
    const planner = plannerAllows("Opus 5.5");
    for (const n of [panel("get_project"), panel("get_recipe"), ...steps, "mcp__friday__ask_designer", "mcp__friday__hand_to_builder"]) expect(planner(n)).toBe(true);
    for (const n of [panel("make_sketch"), panel("edit_sketch"), panel("place_on_board"), panel("keep_part"), panel("lock_topic")]) {
      expect(planner(n)).toBe("You plan and Opus 5.5 builds: put this in the plan for hand_to_builder instead.");
    }
  });

  test("the builder and the alternates never move the steps and never ask", () => {
    for (const n of steps) expect(builderAllows(n)).toBe("The planner moves the steps on.");
    for (const n of [panel("make_sketch"), panel("keep_part"), panel("get_recipe")]) expect(builderAllows(n)).toBe(true);
    expect(builderAllows("mcp__friday__ask_designer")).toBe("FRIDAY only uses Panel's tools.");
    expect(builderAllows("mcp__friday__hand_to_builder")).toBe("FRIDAY only uses Panel's tools.");
  });

  test("what the builder made with keep_part is told to the planner", () => {
    const parts: Part[] = [{ type: "tool", id: "k1", name: "keep_part", builder: true, input: { name: "Stamp" }, done: true }];
    expect(builderNews([parts])).toContain("keep part");
  });
});

describe("asking the designer", () => {
  const A = "a".repeat(16), B = "b".repeat(16);
  const words = "The wireframe is on the canvas under Sections: seven rows, from the promise down to booking a table. The menu comes before the story, because most people who open it are deciding where to eat tonight.";
  const ask: Part = { type: "tool", id: "q1", name: "ask_designer", input: {} };

  test("a question's saves, in order, each once; anything that isn't an id is left out", () => {
    expect(questionSaves({ questions: [{ question: "Which feels closest?", choices: ["One", "Two"], saves: [A, B, A, "nope", 7] }, { question: "Go on?", choices: ["Yes", "No"] }, { question: "And?", choices: ["x", "y"], saves: [B] }] })).toEqual([A, B]);
    expect(questionSaves({})).toEqual([]);
    expect(questionSaves(undefined)).toEqual([]);
  });

  test("words count when they come right before the questions", () => {
    expect(hasWords([{ type: "tool", id: "t", name: "make_sketch", done: true }, { type: "text", text: words }])).toBe(true);
    // The question itself, already in the answer, and thinking are looked past.
    expect(hasWords([{ type: "text", text: words }, { type: "thinking", done: true }, ask])).toBe(true);
  });

  test("working notes, tools since, and the builder's words don't count", () => {
    expect(hasWords([])).toBe(false);
    expect(hasWords([{ type: "text", text: "Desktop reads well now. Checking it on a phone." }, ask])).toBe(false);
    expect(hasWords([{ type: "text", text: words }, { type: "tool", id: "t", name: "make_sketch", done: true }, ask])).toBe(false);
    expect(hasWords([{ type: "text", text: words, builder: true }, ask])).toBe(false);
  });

  test("what FRIDAY is told after asking", () => {
    // Nothing said yet: its next lines say what it made, and never that it asked.
    const quiet = askedNote({ said: false, planner: false });
    expect(quiet).toContain("what you made or found");
    expect(quiet).toContain("written out in full");
    expect(quiet).toContain("don't say that you asked");
    expect(quiet).not.toContain("hand_to_builder");
    // Already said: the turn is over.
    expect(askedNote({ said: true, planner: false })).toContain("Your turn is over. Write nothing more");
    // The planner can still hand the making over; a save the library doesn't have is said.
    const planner = askedNote({ said: true, planner: true, missing: 1 });
    expect(planner).toContain("call hand_to_builder now");
    expect(planner).toContain("Apart from that, your turn is over");
    expect(planner).toContain("1 of the saves you gave isn't in the library");
  });

  test("the builder is told not to ask about going on", () => {
    const r = builderBrief({ job: "handover", builder: "Opus 5.5", planner: "Fable 5.2", message: "Make it.", plan: "1. Make the wireframe, as written out here in full for the builder.", card: null, given: { session: null, hash: null } });
    expect(String(r.prompt)).toContain("Don't end with a question about going on");
  });
});
