// What fills a FRIDAY conversation, trimmed from Claude Code's answer to "how full is it?"
// (getContextUsage) down to what the meter by the message box shows: a few named rows, what
// the conversation itself is made of, and the six tools whose results take the most room.
// It is kept on the chat as a short JSON, so a pure function here, testable without Claude.
//
// Rows are named by Claude Code's stable `id`, never its English `name`, which may change.
//
// Inside the conversation, Claude Code's own split (messageBreakdown) is an estimate made on
// this Mac, and it counts a picture by the size of its file: a conversation of sketches that
// really holds 111K was estimated at 640K. Words are estimated well. So the designer's
// messages and FRIDAY's answers keep their estimates, and what FRIDAY read and looked at gets
// the rest of the real total, shared among the tools in proportion to their estimates.

/** One line of the meter's panel. */
export interface ContextPart { name: string; tokens: number }

export interface ContextRow extends ContextPart {
  /** Claude Code's id for the row (or its name, for a row without one). */
  id: string;
  /** used: in the conversation now · buffer: kept free for summarizing · free: room left. */
  kind: "used" | "buffer" | "free";
}

export interface ContextTalk extends ContextPart {
  id: "read" | "answers" | "yours";
  /** For "read": the six tools whose results take the most room, biggest first. */
  tools?: ContextPart[];
}

export interface ContextParts {
  rows: ContextRow[];
  /** What the conversation row is made of; null when Claude Code didn't say. */
  talk: ContextTalk[] | null;
}

/** The part of Claude Code's answer this reads (SDKControlGetContextUsageResponse). */
export interface ContextUsageIn {
  categories?: { id?: string; name: string; tokens: number; kind?: string; isDeferred?: boolean }[];
  messageBreakdown?: {
    toolCallTokens?: number;
    toolResultTokens?: number;
    assistantMessageTokens?: number;
    userMessageTokens?: number;
    toolCallsByType?: { name: string; callTokens: number; resultTokens: number }[];
  } | null;
}

const ROW_NAMES: Record<string, string> = {
  messages: "The conversation",
  system_prompt: "FRIDAY's instructions, your rules and skills",
  mcp_tools: "Panel's tools",
  mcp_instructions: "How Panel's tools are used",
  system_tools: "Claude's own tools",
  skills: "Claude Code's skills",
  memory_files: "Notes",
  custom_agents: "Helpers",
  free_space: "Room left",
  autocompact_buffer: "Kept free for summarizing",
  compact_buffer: "Kept free for summarizing",
};

/**
 * A tool by the words the chat's steps use for it (stepWords in web/src/Assistant.tsx), as a
 * thing rather than an act. A tool the steps have no words for keeps its own name, as there.
 */
const TOOL_NAMES: Record<string, string> = {
  search_library: "Searches of the library",
  find_by_color: "Color matches",
  similar_to: "Saves found like another",
  gather_for_brief: "References gathered for a brief",
  get_reference: "Saves it looked at",
  library_overview: "The whole library",
  save_to_collection: "Saves put in collections",
  list_projects: "Your projects",
  get_project: "Projects it read",
  get_project_material: "The project's materials",
  place_on_board: "Saves placed on the canvas",
  add_topic: "Topics it added",
  connect_topics: "Topics it connected",
  add_note: "Notes it wrote",
  mark_saves: "Saves it marked",
  lock_topic: "Topics it locked",
  make_sketch: "Sketches it made",
  edit_sketch: "Sketches it changed",
  get_sketch: "Sketches it looked at",
  get_ready_made: "Ready-made parts",
  hand_to_builder: "Plans for the builder",
};

/** "mcp__panel__get_sketch" → "Sketches it looked at"; an unknown tool → "get skill". */
export function toolName(full: string): string {
  const short = full.replace(/^mcp__.+?__/, "");
  return TOOL_NAMES[short] ?? short.replace(/_/g, " ");
}

const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : 0);
const kindOf = (k: unknown): ContextRow["kind"] | null => (k === "used" || k === "buffer" || k === "free" ? k : null);

export function contextParts(u: ContextUsageIn): ContextParts {
  const rows: ContextRow[] = [];
  for (const c of u.categories ?? []) {
    if (c.kind === "deferred" || c.isDeferred) continue;
    const tokens = Math.round(n(c.tokens));
    if (!tokens) continue;
    // A row from an older Claude Code may have no kind: its id still says.
    const kind = kindOf(c.kind) ?? (c.id === "free_space" ? "free" : /compact_buffer$/.test(c.id ?? "") ? "buffer" : "used");
    rows.push({ id: c.id ?? c.name, name: (c.id && ROW_NAMES[c.id]) || c.name, tokens, kind });
  }
  // Biggest first; what's kept free for summarizing after, and the room left always last.
  const order = { used: 0, buffer: 1, free: 2 } as const;
  rows.sort((a, b) => order[a.kind] - order[b.kind] || b.tokens - a.tokens);

  const talk = (() => {
    const mb = u.messageBreakdown;
    const total = rows.find((r) => r.id === "messages")?.tokens ?? 0;
    if (!mb || !total) return null;
    let answers = n(mb.assistantMessageTokens), yours = n(mb.userMessageTokens);
    const calls = n(mb.toolCallTokens), results = n(mb.toolResultTokens);
    let read: number;
    if (answers + yours <= total) read = total - answers - yours;
    else {
      // The words alone came out bigger than the whole: share the real total by the estimates.
      const all = answers + yours + calls + results;
      const k = total / all;
      answers *= k; yours *= k; read = (calls + results) * k;
    }
    // Calls are words, estimated well; the results' share is what's left of "read".
    const byType = (mb.toolCallsByType ?? []).map((t) => ({ name: t.name, call: n(t.callTokens), result: n(t.resultTokens) }));
    const callSum = byType.reduce((s, t) => s + t.call, 0), resultSum = byType.reduce((s, t) => s + t.result, 0);
    const k = callSum < read && resultSum ? (read - callSum) / resultSum : 0;
    let tools = byType.map((t) => ({ name: toolName(t.name), tokens: t.call + t.result * k }));
    // Even the calls came out bigger than "read": share it by the estimates.
    const sum = tools.reduce((s, t) => s + t.tokens, 0);
    if (sum > read && sum) tools = tools.map((t) => ({ ...t, tokens: (t.tokens * read) / sum }));
    tools = tools.map((t) => ({ ...t, tokens: Math.round(t.tokens) })).filter((t) => t.tokens > 0).sort((a, b) => b.tokens - a.tokens).slice(0, 6);
    const parts: ContextTalk[] = [
      { id: "read", name: "What FRIDAY read and looked at", tokens: Math.round(read), ...(tools.length ? { tools } : {}) },
      { id: "answers", name: "FRIDAY's answers", tokens: Math.round(answers) },
      { id: "yours", name: "Your messages and files", tokens: Math.round(yours) },
    ];
    return parts.filter((p) => p.tokens > 0).sort((a, b) => b.tokens - a.tokens);
  })();

  return { rows, talk };
}
