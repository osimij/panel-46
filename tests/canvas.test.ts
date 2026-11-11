// Saying no on a canvas counts: a suggestion (or a ruled-out save) the designer takes off a
// canvas leaves a record, ⌘Z takes the record back, and FRIDAY hears about it in get_project,
// get_verdicts and place_on_board. `bun test tests/canvas.test.ts`. No call to Claude.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { seedSaves, startPanel, type TestPanel } from "./helpers.ts";

let p: TestPanel;
let ids: string[];

beforeAll(async () => {
  p = await startPanel();
  ids = seedSaves(p, 12);
});
afterAll(async () => {
  await p?.stop();
});

const CLIENT = "canvas-test";
const ops = async (project: string, list: unknown[]) => (await p.send("POST", `/api/projects/${project}/ops`, { client: CLIENT, ops: list })).json();
const undo = async (project: string) => (await p.send("POST", `/api/projects/${project}/undo`, { client: CLIENT, who: "me" })).json();
const records = (project: string) =>
  p.db.query<{ kind: string; ref_id: string | null; node_id: string; topic_id: string | null; topic: string; was: string; reason: string }, [string]>(
    "SELECT kind, ref_id, node_id, topic_id, topic, was, reason FROM board_turned_down WHERE project_id = ?",
  ).all(project);

/** A tool's answer: the first part of it that is JSON (get_project starts with the design rules). */
async function tool(name: string, args: Record<string, unknown>) {
  const res = await p.send("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, { accept: "application/json, text/event-stream" });
  const out = (await res.json()) as any;
  const part = out.result.content.find((c: any) => c.type === "text" && c.text.startsWith("{"));
  return JSON.parse(part.text);
}

/** A project with a Color topic and one save under it in the given state; returns their ids. */
async function canvas(name: string, save: string, state: string, reason = "") {
  const proj = await (await p.send("POST", "/api/projects", { name })).json();
  const res = await ops(proj.id, [
    { op: "add_node", node: { kind: "topic", data: { title: "Color", facet: "color" }, x: 0, y: 0 } },
    { op: "add_node", node: { kind: "ref", ref_id: save, data: { state, ...(reason ? { reason } : {}) }, x: 0, y: 200 } },
  ]);
  const topic = res.ops[0].node.id as string;
  const node = res.ops[1].node.id as string;
  await ops(proj.id, [{ op: "add_edge", edge: { source: topic, target: node } }]);
  return { project: proj.id as string, topic, node };
}

describe("saying no counts", () => {
  test("removing a suggested save leaves a record, with its topic", async () => {
    const c = await canvas("No 1", ids[0]!, "proposed");
    await ops(c.project, [{ op: "remove_node", id: c.node }]);
    const r = records(c.project);
    expect(r.length).toBe(1);
    expect(r[0]).toMatchObject({ kind: "ref", ref_id: ids[0], node_id: c.node, topic_id: c.topic, topic: "Color", was: "proposed", reason: "" });
  });

  test("⌘Z brings the card back and the record goes", async () => {
    const c = await canvas("No 2", ids[1]!, "proposed");
    await ops(c.project, [{ op: "remove_node", id: c.node }]);
    expect(records(c.project).length).toBe(1);
    const back = await undo(c.project);
    expect(back.ops.some((o: any) => o.op === "add_node" && o.node.id === c.node)).toBe(true);
    const board = await p.get(`/api/projects/${c.project}`);
    expect(board.nodes.some((n: any) => n.id === c.node)).toBe(true);
    expect(board.edges.some((e: any) => e.target === c.node)).toBe(true);
    expect(records(c.project).length).toBe(0);
  });

  test("removing a kept save leaves no record", async () => {
    const c = await canvas("No 3", ids[2]!, "kept");
    await ops(c.project, [{ op: "remove_node", id: c.node }]);
    expect(records(c.project).length).toBe(0);
  });

  test("removing a save ruled out with a reason keeps the reason", async () => {
    const c = await canvas("No 4", ids[3]!, "ruled_out", "Too busy");
    await ops(c.project, [{ op: "remove_node", id: c.node }]);
    expect(records(c.project)[0]).toMatchObject({ was: "ruled_out", reason: "Too busy" });
  });

  test("a reason given afterwards is kept, and offered among the reasons", async () => {
    const c = await canvas("No 5", ids[4]!, "proposed");
    await ops(c.project, [{ op: "remove_node", id: c.node }]);
    const res = await (await p.send("POST", `/api/projects/${c.project}/turned-down`, { nodes: [c.node], reason: "Feels dated" })).json();
    expect(res).toEqual({ ok: true, n: 1 });
    expect(records(c.project)[0]!.reason).toBe("Feels dated");
    const offered = await p.get("/api/projects/reasons");
    expect(offered.ruled_out).toContain("Feels dated");
  });

  test("place_on_board skips a save removed from the same topic, not from another", async () => {
    const c = await canvas("No 6", ids[5]!, "proposed");
    await ops(c.project, [{ op: "remove_node", id: c.node }]);
    const same = await tool("place_on_board", { project: c.project, topic: "Color", saves: [{ id: ids[5] }, { id: ids[6] }] });
    expect(same.placed.map((x: any) => x.id)).toEqual([ids[6]]);
    expect(same.removed_before).toEqual([{ id: ids[5] }]);
    expect(same.note).toContain("drag one back in from Saves");
    const other = await tool("place_on_board", { project: c.project, topic: "Typography", saves: [{ id: ids[5] }] });
    expect(other.placed.map((x: any) => x.id)).toEqual([ids[5]]);
    expect(other.removed_before).toBeUndefined();
  });

  test("get_verdicts counts quiet removals apart, and a reasoned one by its reason", async () => {
    const v = await tool("get_verdicts", {});
    // From the tests above: suggestions removed without a word (1, 6), and a reason given on one (5).
    expect(v.suggestions_removed.count).toBeGreaterThanOrEqual(2);
    expect(v.suggestions_removed.latest.some((l: string) => l.includes(ids[0]!) && l.includes("under Color"))).toBe(true);
    expect(v.by_reason.some((g: any) => g.verdict === "ruled out" && g.reason === "Feels dated")).toBe(true);
    expect(v.by_reason.some((g: any) => g.verdict === "ruled out" && g.reason === "Too busy")).toBe(true);
    expect(v.how_to_read).toContain("weak no");
  });

  test("get_project lists what was removed under its topic", async () => {
    const c = await canvas("No 8", ids[7]!, "proposed");
    await ops(c.project, [{ op: "remove_node", id: c.node }]);
    const s = await tool("get_project", { project: c.project });
    const color = s.decisions.find((d: any) => d.topic === "Color");
    expect(color.removed_by_designer).toEqual([{ id: ids[7], title: expect.any(String) }]);
    expect(s.removed_by_designer).toBeUndefined();
  });

  test("the designer adding the save again clears its records", async () => {
    const c = await canvas("No 9", ids[8]!, "proposed");
    await ops(c.project, [{ op: "remove_node", id: c.node }]);
    expect(records(c.project).length).toBe(1);
    await ops(c.project, [{ op: "add_node", node: { kind: "ref", ref_id: ids[8], x: 500, y: 500 } }]);
    expect(records(c.project).length).toBe(0);
  });
});
