// A wireframe is a sketch that says it is one: a gray page of what each section is for, before
// any design. Panel treats it as a rough draft: it isn't checked against the designer's rules
// or skills, and its card says it is a wireframe. Rendered in the Chrome on this Mac, so these
// run only where Chrome is installed. `bun test tests/wireframe.test.ts`. No call to Claude.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { startPanel, type TestPanel } from "./helpers.ts";

const chrome = ["/Applications/Google Chrome.app", "/Applications/Chromium.app", "/Applications/Brave Browser.app", "/Applications/Microsoft Edge.app"].some((p) => existsSync(p));
const withChrome = chrome ? test : test.skip;

let p: TestPanel;
let project: string;
const tool = async (name: string, args: unknown) => {
  const res = await p.send("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, { accept: "application/json, text/event-stream" });
  const out = ((await res.json()) as any).result;
  const json = out.content?.find((c: any) => c.type === "text" && c.text.startsWith("{"));
  return { ...out, first: json ? JSON.parse(json.text) : null };
};

// The recipe's own starting page, with plain round corners on its buttons: a designed page with
// these would break the designer's rules, so the checks have something to find.
const WIRE = readFileSync(join(import.meta.dir, "..", "recipes", "wireframe.html"), "utf8")
  .replace(".wf-btn { padding: 9px 16px;", ".wf-btn { border-radius: 12px; padding: 9px 16px;");

beforeAll(async () => {
  p = await startPanel();
  project = ((await (await p.send("POST", "/api/projects", { name: "Wire test" })).json()) as any).id;
});
afterAll(async () => {
  await p?.stop();
});

withChrome("a wireframe isn't checked, says it is one, and stays one when changed", async () => {
  const made = await tool("make_sketch", { project, title: "Wireframe", kind: "wireframe", html: WIRE });
  expect(made.isError).toBeFalsy();
  expect(made.first.wireframe).toBe(true);
  for (const k of ["rule_checks", "skill_checks", "skills_checked", "skills_that_apply"]) expect(made.first[k]).toBeUndefined();
  expect(made.first.next).toContain("nothing is designed (gray only)");
  expect(made.content.some((c: any) => c.type === "image")).toBe(true);
  const id = made.first.sketch;

  const board = await p.get(`/api/projects/${project}`);
  expect(board.nodes.find((n: any) => n.id === id).data.wire).toBe(true);

  const edited = await tool("edit_sketch", { project, sketch: id, edits: [{ find: "NAME OF THE SITE: wireframe", replace: "Rohat: wireframe" }] });
  expect(edited.first.wireframe).toBe(true);
  expect(edited.first.rule_checks).toBeUndefined();
  expect(edited.first.version).toBe(2);

  const read = await tool("get_sketch", { project, sketch: id, html: false, pictures: false });
  expect(read.first.wireframe).toBe(true);
  expect(read.first.rule_checks).toBeUndefined();

  const summary = await tool("get_project", { project });
  expect(summary.first.sketches.find((s: any) => s.sketch === id).wireframe).toBe(true);

  // The studio counts no rule findings on its versions.
  const info = await p.get(`/api/projects/${project}/sketches/${id}`);
  expect(info.wire).toBe(true);
  expect(info.versions.every((v: any) => v.rules.length === 0)).toBe(true);
}, 90_000);

withChrome("the same page sent as a designed page still gets its checks", async () => {
  const made = await tool("make_sketch", { project, title: "Not a wireframe", html: WIRE });
  expect(made.first.wireframe).toBeUndefined();
  expect((made.first.rule_checks ?? []).map((r: any) => `${r.rule}:${r.level}`)).toContain("Corners:breaks");
  const board = await p.get(`/api/projects/${project}`);
  expect(board.nodes.find((n: any) => n.id === made.first.sketch).data.wire).toBeUndefined();
  // A sketch made from a wireframe is a wireframe only if it says so itself.
  const wire = board.nodes.find((n: any) => n.data.wire === true);
  const child = await tool("make_sketch", { project, title: "From the wireframe", from: wire.id, html: WIRE });
  expect(child.first.wireframe).toBeUndefined();
  expect(child.first.rule_checks).toBeTruthy();
}, 90_000);
