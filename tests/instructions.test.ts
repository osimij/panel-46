// What Panel tells an AI app when it connects must arrive whole. Claude Code cuts a server's
// instructions off after 4,096 characters, and a tool's description after 2,048, without
// saying so: for a long time the second half of Panel's instructions never reached anyone.
// These tests fail when either grows past what arrives. `bun test tests/instructions.test.ts`.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { startPanel, type TestPanel } from "./helpers.ts";

let p: TestPanel;

beforeAll(async () => {
  p = await startPanel();
});
afterAll(async () => {
  await p.stop();
});

/** One call to Panel's MCP route, as FRIDAY makes it (rules=0) or as any other AI app does. */
const mcp = async (path: string, method: string, params: Record<string, unknown>) => {
  const res = await p.send("POST", path, { jsonrpc: "2.0", id: 1, method, params }, { accept: "application/json, text/event-stream" });
  return ((await res.json()) as { result: any }).result;
};

const hello = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } };

// Room is left under the 4,096 where Claude Code cuts, so a small addition doesn't tip it over.
const INSTRUCTIONS_ROOM = 4000;
const DESCRIPTION_ROOM = 2000;

test("the instructions arrive whole, for FRIDAY and for other AI apps", async () => {
  const friday = (await mcp("/mcp?rules=0", "initialize", hello)).instructions as string;
  const others = (await mcp("/mcp", "initialize", hello)).instructions as string;
  expect(friday.length).toBeLessThanOrEqual(INSTRUCTIONS_ROOM);
  expect(others.length).toBeLessThanOrEqual(INSTRUCTIONS_ROOM);
  // The last lines are the ones that used to be lost.
  expect(friday).toContain("get_handoff");
  expect(others).toContain("get_design_rules");
  // FRIDAY writes a save as [[id]], never as a link, so only other apps are told about links.
  expect(friday).not.toContain("\"open\" link");
  expect(others).toContain("\"open\" link");
});

test("every tool's description arrives whole", async () => {
  const tools = (await mcp("/mcp", "tools/list", {})).tools as { name: string; description: string }[];
  expect(tools.length).toBeGreaterThan(30);
  const long = tools.filter((t) => t.description.length > DESCRIPTION_ROOM).map((t) => `${t.name} (${t.description.length})`);
  expect(long).toEqual([]);
});

test("what left the instructions is said by the tool it is about", async () => {
  const tools = (await mcp("/mcp", "tools/list", {})).tools as { name: string; description: string }[];
  const says = (name: string) => tools.find((t) => t.name === name)!.description;
  expect(says("make_sketch")).toContain("panel:states");
  expect(says("make_sketch")).toContain("CSS variables on :root");
  expect(says("get_ready_made")).toContain("<panel-icon");
  expect(says("get_ready_made")).toContain("never use or imitate");
  expect(says("get_reference")).toContain("measured_in_page");
});
