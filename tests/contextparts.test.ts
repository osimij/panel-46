// What fills a FRIDAY conversation (server/contextparts.ts): Claude Code's answer to "how full
// is it?" trimmed to the meter's rows. Pure: no Panel running, no Claude.
//
// The sample is a real answer (detail: "summary") from a copy conversation of sketches,
// 11 Nov 2026, with one deferred row and one unknown row added to check they're handled.

import { expect, test } from "bun:test";
import { contextParts, toolName, type ContextUsageIn } from "../server/contextparts.ts";

const sample = (): ContextUsageIn => ({
  categories: [
    { id: "system_prompt", name: "System prompt", tokens: 3876, kind: "used" },
    { id: "mcp_tools", name: "MCP tools", tokens: 16475, kind: "used" },
    { id: "mcp_tools_deferred", name: "MCP tools (deferred)", tokens: 9000, kind: "deferred", isDeferred: true },
    { id: "mcp_instructions", name: "MCP server instructions", tokens: 1373, kind: "used" },
    { id: "memory_files", name: "Memory files", tokens: 580, kind: "used" },
    { id: "messages", name: "Messages", tokens: 111414, kind: "used" },
    { name: "Something new", tokens: 120, kind: "used" },
    { id: "system_tools", name: "System tools", tokens: 0, kind: "used" },
    { id: "free_space", name: "Free space", tokens: 333162, kind: "free" },
    { id: "autocompact_buffer", name: "Autocompact buffer", tokens: 33000, kind: "buffer" },
  ],
  messageBreakdown: {
    toolCallTokens: 6939, toolResultTokens: 588168, assistantMessageTokens: 24172, userMessageTokens: 21338,
    toolCallsByType: [
      { name: "mcp__panel__get_project", callTokens: 120, resultTokens: 9137 },
      { name: "mcp__panel__edit_sketch", callTokens: 3100, resultTokens: 316837 },
      { name: "mcp__panel__get_verdicts", callTokens: 30, resultTokens: 292 },
      { name: "mcp__panel__get_sketch", callTokens: 400, resultTokens: 223894 },
      { name: "mcp__panel__add_note", callTokens: 100, resultTokens: 22 },
      { name: "mcp__panel__make_sketch", callTokens: 3000, resultTokens: 37146 },
      { name: "mcp__panel__get_fonts", callTokens: 40, resultTokens: 72 },
      { name: "mcp__panel__get_project_material", callTokens: 149, resultTokens: 768 },
    ],
  },
});

test("rows are named by id, biggest first, deferred and empty rows gone, room left last", () => {
  const { rows } = contextParts(sample());
  expect(rows.map((r) => r.name)).toEqual([
    "The conversation",
    "Panel's tools",
    "FRIDAY's instructions, your rules and skills",
    "How Panel's tools are used",
    "Notes",
    // A row Panel has no name for keeps Claude Code's.
    "Something new",
    "Kept free for summarizing",
    "Room left",
  ]);
  expect(rows.at(-1)).toMatchObject({ id: "free_space", kind: "free", tokens: 333162 });
  // The rows in the conversation add up to its total.
  const used = rows.filter((r) => r.kind === "used").reduce((s, r) => s + r.tokens, 0);
  expect(used).toBe(3876 + 16475 + 1373 + 580 + 111414 + 120);
});

test("the conversation's own parts add up to its row, with words kept and pictures given the rest", () => {
  const { talk } = contextParts(sample());
  expect(talk!.map((t) => t.id)).toEqual(["read", "answers", "yours"]);
  expect(talk!.find((t) => t.id === "answers")!.tokens).toBe(24172);
  expect(talk!.find((t) => t.id === "yours")!.tokens).toBe(21338);
  const sum = talk!.reduce((s, t) => s + t.tokens, 0);
  expect(Math.abs(sum - 111414)).toBeLessThanOrEqual(1);
});

test("the six biggest tools, by their plain names, biggest first", () => {
  const read = contextParts(sample()).talk!.find((t) => t.id === "read")!;
  expect(read.tools!.map((t) => t.name)).toEqual([
    "Sketches it changed",
    "Sketches it looked at",
    "Sketches it made",
    "Projects it read",
    "The project's materials",
    // A note's words (100) outweigh the verdicts' short answer once pictures are scaled down.
    "Notes it wrote",
  ]);
  // All the tools together are what was read; the six shown are nearly all of it.
  const shown = read.tools!.reduce((s, t) => s + t.tokens, 0);
  expect(shown).toBeLessThanOrEqual(read.tokens);
  expect(shown).toBeGreaterThan(read.tokens * 0.99);
});

test("an answer without a breakdown still gives the rows", () => {
  const u = sample();
  delete u.messageBreakdown;
  const parts = contextParts(u);
  expect(parts.talk).toBeNull();
  expect(parts.rows[0]!.name).toBe("The conversation");
  expect(parts.rows.at(-1)!.name).toBe("Room left");
});

test("words bigger than the whole: everything is shared out by the estimates", () => {
  const u = sample();
  u.messageBreakdown!.userMessageTokens = 200_000;
  const talk = contextParts(u).talk!;
  const sum = talk.reduce((s, t) => s + t.tokens, 0);
  expect(Math.abs(sum - 111414)).toBeLessThanOrEqual(2);
  // Shared by the estimates, the pictures FRIDAY looked at stay the biggest part.
  expect(talk.map((t) => t.id)).toEqual(["read", "yours", "answers"]);
});

test("tool names lose their server and keep the chat's words", () => {
  expect(toolName("mcp__panel__get_reference")).toBe("Saves it looked at");
  expect(toolName("mcp__plan__hand_to_builder")).toBe("Plans for the builder");
  expect(toolName("mcp__panel__get_skill")).toBe("get skill");
});
