// How much FRIDAY has to read after each kind of search, measured on the COPY of the library.
// It calls Panel's own tools the way FRIDAY does and prints how long each answer is.
// Nothing here calls Claude, so it spends none of the plan and can be run as often as needed.
//
//   PANEL_PORT=4799 PANEL_LIBRARY_DIR=.copy/lib bun scripts/measure-search.ts
//
// Run it before a change and after it, and compare. The lines that start with ORDER list
// the saves each search found, best first: a change to how answers are written must leave
// those lines exactly as they were (the ranking is not what is being changed).

import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// The real library is never measured: this only runs on a copy.
const lib = resolve(process.env.PANEL_LIBRARY_DIR ?? "");
if (!process.env.PANEL_LIBRARY_DIR || !lib.includes(`${resolve(import.meta.dir, "..")}/.copy`)) {
  console.error("Run this on the copy: PANEL_PORT=4799 PANEL_LIBRARY_DIR=.copy/lib bun scripts/measure-search.ts");
  process.exit(1);
}
const { createMcpServer } = await import("../server/mcp-tools.ts");

// A rough count: answers are JSON full of ids, hex colors and quotes, which run near 3.2
// characters a token. Good for comparing before and after, not for exact billing.
const tokens = (chars: number) => Math.round(chars / 3.2);

const server = createMcpServer({ withRules: false });
const [a, b] = InMemoryTransport.createLinkedPair();
await server.connect(a);
const client = new Client({ name: "measure", version: "1" });
await client.connect(b);

const tools = (await client.listTools()).tools;
const defs = JSON.stringify(tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))).length;
console.log(`TOOLS  ${tools.length} tools · ${defs} chars · about ${tokens(defs)} tokens (read once per conversation)\n`);

type Block = { type: string; text?: string };
interface Answer { total?: number; results?: { id: string }[]; more?: unknown[]; like?: unknown; picks?: Record<string, { id: string }[]> }

async function call(label: string, name: string, args: Record<string, unknown>) {
  const r = (await client.callTool({ name, arguments: args })) as { content: Block[]; isError?: boolean };
  const text = r.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  const pictures = r.content.filter((c) => c.type === "image").length;
  let j: Answer = {};
  try { j = JSON.parse(text) as Answer; } catch { /* get_reference answers in several blocks */ }
  const cards = j.results?.length ?? (j.picks ? Object.values(j.picks).flat().length : undefined);
  const lines = Array.isArray(j.more) ? j.more.length : 0;
  console.log(
    `${label.padEnd(34)} ${String(text.length).padStart(6)} chars · about ${String(tokens(text.length)).padStart(5)} tokens` +
    (j.total !== undefined ? ` · found ${j.total}` : "") + (cards !== undefined ? ` · ${cards} cards` : "") + (lines ? ` · ${lines} lines` : "") +
    (pictures ? ` · ${pictures} pictures` : "") + (r.isError ? " · FAILED: " + text.slice(0, 120) : ""),
  );
  if (j.results) console.log(`ORDER ${label}: ${j.results.map((x) => x.id).join(" ")}`);
  return j;
}

// The same questions every time, so two runs can be laid side by side.
const first = await call("search energetic", "search_library", { query: "energetic" });
await call("search energetic, full cards", "search_library", { query: "energetic", detail: "full" });
await call("search energetic in mood", "search_library", { query: "energetic", facets: ["mood"] });
await call("search energetic in motion", "search_library", { query: "energetic fast", facets: ["motion"] });
await call("search dark (a common word)", "search_library", { query: "dark" });
await call("search bold (a common word)", "search_library", { query: "bold" });
await call("search calm editorial serif", "search_library", { query: "calm editorial serif" });
await call("search by look", "search_library", { look: "loud colorful poster with big type" });
await call("search words + look", "search_library", { query: "energetic bold fast", look: "loud colorful poster with big type" });
await call("search, no words (newest)", "search_library", {});
await call("find by color #e2372b", "find_by_color", { colors: ["#e2372b"] });
await call("gather for a brief", "gather_for_brief", { brief: "energetic, bold, fast" });

const id = first.results?.[0]?.id;
if (id) {
  await call("similar to the top save", "similar_to", { id });
  await call("similar in look and color", "similar_to", { id, facets: ["look", "color"] });
  await call("open one save, no pictures", "get_reference", { ids: [id], images: "none" });
  await call("open one save, type only", "get_reference", { ids: [id], images: "none", facets: ["typography"] });
  await call("open one save, first picture", "get_reference", { ids: [id] });
  const three = first.results!.slice(0, 3).map((x) => x.id);
  await call("open three saves, first picture", "get_reference", { ids: three });
}
process.exit(0);
