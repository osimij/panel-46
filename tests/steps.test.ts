// Making a whole thing step by step: the recipes are read from recipes/, and a project's steps
// move on with start_steps, set_step and stop_steps, each step a topic on the canvas, locked
// with its decision when it is done. `bun test tests/steps.test.ts`. No call to Claude.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startPanel, type TestPanel } from "./helpers.ts";

let p: TestPanel;

beforeAll(async () => {
  p = await startPanel();
});
afterAll(async () => {
  await p?.stop();
});

/** A tool's whole answer: its text, and whether it failed. */
async function call(name: string, args: Record<string, unknown>) {
  const res = await p.send("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, { accept: "application/json, text/event-stream" });
  const out = (await res.json()) as any;
  const text = out.result.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
  return { text, error: !!out.result.isError };
}
const tool = async (name: string, args: Record<string, unknown>) => {
  const r = await call(name, args);
  if (r.error) throw new Error(r.text);
  return JSON.parse(r.text);
};
const newProject = async (name: string) => (await (await p.send("POST", "/api/projects", { name })).json()).id as string;
const board = (id: string) => p.get(`/api/projects/${id}`);
const topic = async (id: string, title: string) => (await board(id)).nodes.find((n: any) => n.kind === "topic" && n.data.title === title);

describe("the recipes", () => {
  test("both are read, with their steps in order, facets, and the wireframe put in", async () => {
    const all = await call("get_recipe", {});
    expect(all.error).toBe(false);
    expect(all.text).toContain("Website: a website or a landing page, new or a redesign. Steps: Sections → Words → Gem → Color → Typography → Hero → Motion → Whole page.");
    expect(all.text).toContain("Poster: ");
    expect(all.text).toContain("Steps: Message → Idea → Layout → Color → Typography → Poster.");

    const web = await call("get_recipe", { name: "website" });
    expect(web.text).toStartWith("# Website\n\nFor: a website or a landing page");
    expect(web.text).toContain("## What makes it great");
    expect(web.text).toContain("## Before the first step");
    expect(web.text).not.toMatch(/^Topic:/m);
    expect(web.text).not.toContain("{{file");
    for (const s of ["Sections", "Words", "Gem", "Color", "Typography", "Hero", "Motion", "Whole page"]) expect(web.text).toContain(`### ${s}\n`);

    const sections = await call("get_recipe", { name: "Website", step: "sections" });
    expect(sections.text).toStartWith("# Website: Sections (step 1 of 8)");
    expect(sections.text).toContain('class="wf-row"');
    expect(sections.text).toContain("```html");
    expect(sections.text).not.toContain("### Words");
    expect(sections.text).not.toContain("What makes it great");

    const poster = await call("get_recipe", { name: "Poster" });
    expect(poster.text).not.toMatch(/^Topic:/m);
    expect(poster.text).not.toContain("{{file");
  });

  test("the steps' facets come from their Topic: lines", async () => {
    const id = await newProject("Facets");
    const r = await tool("start_steps", { project: id, recipe: "Website" });
    expect(r.steps.map((s: any) => s.step)).toEqual(["Sections", "Words", "Gem", "Color", "Typography", "Hero", "Motion", "Whole page"]);
    // Walk to Color: its topic is a color topic, Motion's later a motion one.
    for (const s of ["Sections", "Words", "Gem"]) await tool("set_step", { project: id, step: s, state: "skipped" });
    expect((await topic(id, "Color")).data.facet).toBe("color");
    await tool("set_step", { project: id, step: "Motion", state: "now" });
    expect((await topic(id, "Motion")).data.facet).toBe("motion");
    expect((await topic(id, "Sections"))).toBeUndefined();
    const poster = await newProject("Poster facets");
    const pr = await tool("start_steps", { project: poster, recipe: "poster" });
    expect(pr.steps.map((s: any) => s.step)).toEqual(["Message", "Idea", "Layout", "Color", "Typography", "Poster"]);
  });

  test("an unknown recipe or step says which there are", async () => {
    expect((await call("get_recipe", { name: "App" })).text).toContain("The recipes: Poster, Website");
    const bad = await call("get_recipe", { name: "Website", step: "Logo" });
    expect(bad.error).toBe(true);
    expect(bad.text).toContain("Its steps: Sections, Words, Gem");
  });
});

describe("a project going step by step", () => {
  test("start, done, skipped, back, stop and start again", async () => {
    const id = await newProject("Steps 1");
    const s = await tool("start_steps", { project: id, recipe: "Website" });
    expect(s.recipe).toBe("Website");
    expect(s.now.step).toBe("Sections");
    expect(s.now.text).toContain('class="wf-row"');
    expect(s.steps[0]).toEqual({ step: "Sections", state: "now" });
    expect(await topic(id, "Sections")).toBeTruthy();

    const done = await tool("set_step", { project: id, step: "Sections", state: "done", decision: "Seven sections: hero, menu, the hall, booking." });
    expect(done.now.step).toBe("Words");
    expect(done.to_come).toEqual(["Gem", "Color", "Typography", "Hero", "Motion", "Whole page"]);
    const b = await board(id);
    const sec = b.nodes.find((n: any) => n.data.title === "Sections");
    const words = b.nodes.find((n: any) => n.data.title === "Words");
    expect(sec.data).toMatchObject({ status: "locked", summary: "Seven sections: hero, menu, the hall, booking." });
    expect(words).toBeTruthy();
    expect(b.edges.some((e: any) => e.source === sec.id && e.target === words.id)).toBe(true);

    const skipped = await tool("set_step", { project: id, step: "Words", state: "skipped" });
    expect(skipped.now.step).toBe("Gem");
    expect(await topic(id, "Words")).toBeUndefined();
    const gem = await topic(id, "Gem");
    expect((await board(id)).edges.some((e: any) => e.source === sec.id && e.target === gem.id)).toBe(true);

    const back = await tool("set_step", { project: id, step: "sections", state: "now" });
    expect(back.now.step).toBe("Sections");
    expect((await topic(id, "Sections")).data.status).toBe("exploring");
    let st = await p.get(`/api/projects/${id}/steps`);
    expect(st.steps.find((x: any) => x.step === "Gem").state).toBe("waiting");
    expect(st.steps.find((x: any) => x.step === "Words").state).toBe("skipped");
    expect(st.steps.filter((x: any) => x.state === "now").length).toBe(1);

    expect(await tool("stop_steps", { project: id })).toMatchObject({ stopped: true });
    st = await p.get(`/api/projects/${id}/steps`);
    expect(st.state).toBe("stopped");
    const again = await tool("start_steps", { project: id, recipe: "Website" });
    expect(again.now.step).toBe("Sections");
    st = await p.get(`/api/projects/${id}/steps`);
    expect(st.state).toBe("on");
    expect(st.steps.find((x: any) => x.step === "Words").state).toBe("skipped");
    expect(st.steps.find((x: any) => x.step === "Sections").decision).toBe("Seven sections: hero, menu, the hall, booking.");
  });

  test("a locked Color topic already on the canvas starts as done", async () => {
    const id = await newProject("Steps 2");
    await p.send("POST", `/api/projects/${id}/ops`, { client: "t", ops: [{ op: "add_node", node: { kind: "topic", data: { title: "", facet: "color", status: "locked", summary: "The brand's red and warm white." }, x: 0, y: 0 } }] });
    const s = await tool("start_steps", { project: id, recipe: "Website" });
    expect(s.steps.find((x: any) => x.step === "Color")).toEqual({ step: "Color", state: "done", decision: "The brand's red and warm white." });
    expect(s.now.step).toBe("Sections");
  });

  test("plain errors: no decision, an unknown step, a second recipe", async () => {
    const id = await newProject("Steps 3");
    await tool("start_steps", { project: id, recipe: "Website" });
    const noDecision = await call("set_step", { project: id, step: "Sections", state: "done" });
    expect(noDecision.error).toBe(true);
    expect(noDecision.text).toContain("Say the decision for Sections in a sentence");
    const unknown = await call("set_step", { project: id, step: "Logo", state: "done", decision: "x" });
    expect(unknown.text).toBe("No step “Logo” in the Website recipe. Its steps: Sections, Words, Gem, Color, Typography, Hero, Motion, Whole page.");
    const second = await call("start_steps", { project: id, recipe: "Poster" });
    expect(second.text).toBe("This project is already going step by step with Website. Stop that first (stop_steps).");
    const off = await call("set_step", { project: await newProject("Steps 3b"), step: "Sections", state: "done", decision: "x" });
    expect(off.text).toBe("This project isn't going step by step. start_steps begins it.");
  });

  test("undo after a step is done takes it back in one change", async () => {
    const id = await newProject("Steps 4");
    await tool("start_steps", { project: id, recipe: "Website" });
    // The designer moves the topic: what FRIDAY does next is a change of its own.
    const sec = await topic(id, "Sections");
    await p.send("POST", `/api/projects/${id}/ops`, { client: "t", ops: [{ op: "update_node", id: sec.id, x: 40 }] });
    await tool("set_step", { project: id, step: "Sections", state: "done", decision: "Five sections." });
    expect((await topic(id, "Sections")).data.status).toBe("locked");
    expect(await topic(id, "Words")).toBeTruthy();
    const events = p.db.query<{ n: number }, [string]>("SELECT COUNT(*) n FROM project_events WHERE project_id = ? AND actor = 'assistant' AND label LIKE 'Locked Sections%'").get(id)!.n;
    expect(events).toBe(1);
    const undone = await (await p.send("POST", `/api/projects/${id}/undo`, { client: "t", who: "assistant" })).json();
    expect(undone.undid).toBe("Locked Sections, added Words after Sections");
    expect((await topic(id, "Sections")).data.status).toBe("exploring");
    expect(await topic(id, "Words")).toBeUndefined();
  });

  test("skipping a waiting step leaves the step that is now as it is", async () => {
    const id = await newProject("Steps 5");
    await tool("start_steps", { project: id, recipe: "Website" });
    const r = await tool("set_step", { project: id, step: "Color", state: "skipped" });
    expect(r.now.step).toBe("Sections");
    const st = await p.get(`/api/projects/${id}/steps`);
    expect(st.steps.find((x: any) => x.step === "Color").state).toBe("skipped");
    expect(st.steps.find((x: any) => x.step === "Sections").state).toBe("now");
    // Done on a waiting step: its decision is kept and locked on a topic of its own; now stays.
    const t = await tool("set_step", { project: id, step: "Typography", state: "done", decision: "The brand's own serif." });
    expect(t.now.step).toBe("Sections");
    expect((await topic(id, "Typography")).data).toMatchObject({ status: "locked", summary: "The brand's own serif." });
  });

  test("the last step done finishes the recipe", async () => {
    const id = await newProject("Steps 6");
    await tool("start_steps", { project: id, recipe: "Poster" });
    for (const s of ["Message", "Idea", "Layout", "Color", "Typography"]) await tool("set_step", { project: id, step: s, state: "skipped" });
    const last = await tool("set_step", { project: id, step: "Poster", state: "done", decision: "The poster." });
    expect(last.finished).toBe(true);
    expect(last.next).toBe("Every step is done. The designer chooses the sketch (Choose), and then it can be built.");
    expect((await p.get(`/api/projects/${id}/steps`)).state).toBe("finished");
  });

  test("the routes: steps of a project that never went step by step, and stop", async () => {
    const id = await newProject("Steps 7");
    expect(await p.get(`/api/projects/${id}/steps`)).toBeNull();
    await tool("start_steps", { project: id, recipe: "Website" });
    const stopped = await (await p.send("POST", `/api/projects/${id}/steps/stop`)).json();
    expect(stopped.state).toBe("stopped");
    expect(stopped.recipe).toEqual({ id: "website", name: "Website" });
  });

  test("get_recipe with a project says where it stands", async () => {
    const id = await newProject("Steps 8");
    await tool("start_steps", { project: id, recipe: "Website" });
    const r = await call("get_recipe", { name: "Website", step: "Gem", project: id });
    expect(r.text).toContain("## Where “Steps 8” stands");
    expect(r.text).toContain("- Sections: now");
  });
});
