// "Plan, then build": the decisions about the builder's own conversation, kept apart from
// chat.ts so they can be tested on their own (chat.ts opens the library the moment it loads).
// In this mode one model (the planner) reads, searches and decides in the chat's main
// conversation, and hands a plan to another (the builder), which works in a conversation of
// its own beside it. Each model's cache then stays warm with its own work, instead of the
// builder taking in the planner's whole conversation at full price on every hand-over.

import type { ContentBlockParam } from "@anthropic-ai/sdk/resources";
import type { Part } from "./chat.ts";

/** What a turn is asked: words, or words with pictures and documents attached. */
type Prompt = string | ContentBlockParam[];

/** Who the builder is and how it works, at the top of each hand-over it gets. */
const builderIntro = (planner: string, builder: string) => `<panel-context>You are the builder, ${builder}. ${planner}, the planner, has just read the project, looked at the references and written the plan at the end of this message, for the designer's message below; the designer has seen its note. You haven't seen the planner's conversation: you get the designer's message, the project card and the plan. Anything else you need, read with the tools: get_project for the canvas and its sketches, get_sketch for a sketch, get_reference for a save. Carry the plan out with the tools: make or change what it says, from the saves it names, then look at the pictures that come back and fix what breaks the plan or the designer's rules. Follow the plan's choices; where it's silent, or something in it doesn't work, use your judgment and say so. Don't look for other references. Then reply to the designer in a few lines: what you made, what to look at in it, and anything you did differently from the plan. Don't end with a question about going on, and don't move the steps: when the work is being made step by step, the planner has already asked the designer, and its questions show under your reply.</panel-context>`;

/** The kinds of job a message can be, which decide the conversation it runs on. */
export type Job = "plain" | "handover" | "pointed" | "figma" | "alternates" | "compact";

/**
 * Which conversation a run continues. One model: always the chat's main one. Plan, then
 * build: the planner (a plain message) and /compact the main one; everything the builder's
 * model does (a hand-over, a pointed edit, a rebuild from Figma, alternates) the builder's
 * own, so the builder never re-reads the planner's whole conversation at full price.
 */
export function whichConversation(o: { duo: boolean; job: Job; main: string | null; builder: string | null }): { on: "main" | "builder"; session: string | null } {
  const on = o.duo && (o.job === "handover" || o.job === "pointed" || o.job === "figma" || o.job === "alternates") ? "builder" : "main";
  return { on, session: on === "main" ? o.main : o.builder };
}

/** The project card, as a conversation is given it: the first time, or again when it has changed. */
const cardBlock = (text: string, again: boolean) =>
  `${again ? "The project card has changed since you were given it; this one replaces it." : "Here is the project card."}\n<project-card>\n${text}\n</project-card>`;

/**
 * Whether the builder's conversation gets the project card with this message: when it is new
 * or was given another version, and never when the message carries it already.
 */
export function builderCard(card: { text: string; hash: string } | null | undefined, given: { session: string | null; hash: string | null }, message = "") {
  if (!card || message.includes("<project-card>")) return null;
  if (given.session && given.hash === card.hash) return null;
  return { block: cardBlock(card.text, !!given.session), hash: card.hash };
}

/**
 * What the builder's conversation is given for one job, as one message. A hand-over: who it
 * is and how to work, the project card when it needs it, the designer's message with its
 * context and attachments, then the plan. A pointed edit or a rebuild from Figma: the card
 * when it needs it, then the message, which already says what to do. `card` is the version
 * given, to be marked once the answer is done.
 */
export function builderBrief(o: {
  job: "handover" | "pointed" | "figma";
  builder: string;
  planner?: string;
  /** The designer's message for this turn, its <panel-context> first. */
  message: string;
  /** Pictures and documents they attached. */
  blocks?: ContentBlockParam[];
  plan?: string;
  card?: { text: string; hash: string } | null;
  given: { session: string | null; hash: string | null };
}): { prompt: Prompt; card?: string } {
  const card = builderCard(o.card, o.given, o.message);
  const handover = o.job === "handover";
  const head = [
    handover ? builderIntro(o.planner ?? "The planner", o.builder) : "",
    card?.block ?? "",
    handover ? `The designer's message, as the planner got it:\n<designer-message>\n${o.message}\n</designer-message>` : o.message,
  ].filter(Boolean).join("\n\n");
  const plan = handover && o.plan ? `<plan>\n${o.plan}\n</plan>` : "";
  const prompt: Prompt = o.blocks?.length
    ? [{ type: "text", text: head }, ...o.blocks, ...(plan ? [{ type: "text" as const, text: plan }] : [])]
    : [head, plan].filter(Boolean).join("\n\n");
  return { prompt, ...(card ? { card: card.hash } : {}) };
}

/** Tools that change something on the canvas or elsewhere: the ones worth telling the planner about. */
const MAKING = new Set(["make_sketch", "edit_sketch", "place_on_board", "add_topic", "connect_topics", "add_note", "mark_saves", "lock_topic", "start_build", "message_build", "keep_part"]);

/**
 * What the builder did since the planner last heard, for the start of the planner's next
 * message: the builder works in a conversation of its own, so the planner's never saw it.
 * Built from the stored answers (newest first), so it holds across a restart of Panel and is
 * given once: it covers the answers back to the last one that ran on the main conversation,
 * which got any note before it. Short: names and ids, never a sketch's page or pictures.
 */
export function builderNews(answers: Part[][]): string {
  const work: Part[] = [];
  for (const parts of answers) {
    work.unshift(...parts.filter((p) => p.builder));
    // An answer the main conversation took part in: it was told about everything before it.
    if (parts.some((p) => !p.builder && (p.type === "tool" || p.type === "text"))) break;
  }
  if (!work.length) return "";
  const done: string[] = [];
  const edited = new Map<string, number>();
  for (const p of work) {
    if (p.type !== "tool") continue;
    const input = p.input ?? {};
    const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string).slice(0, 80) : "");
    if (p.error) {
      done.push(`${p.name} failed (${p.error.replace(/\s+/g, " ").slice(0, 100)})`);
      continue;
    }
    if (!MAKING.has(p.name)) continue;
    if (p.name === "make_sketch") done.push(`made the sketch “${str("title") || "untitled"}”${p.sketch ? ` (${p.sketch})` : ""}`);
    else if (p.name === "edit_sketch") edited.set(str("sketch"), (edited.get(str("sketch")) ?? 0) + 1);
    else if (p.name === "place_on_board") {
      const n = Array.isArray(input.saves) ? input.saves.length : 0;
      done.push(`placed ${n} save${n === 1 ? "" : "s"}${str("topic") ? ` under “${str("topic")}”` : ""}`);
    } else if (p.name === "add_topic") done.push(`added the topic “${str("name") || str("topic")}”`);
    else done.push(p.name.replace(/_/g, " "));
  }
  for (const [id, n] of edited) done.push(`edited the sketch ${id || "(unnamed)"}${n > 1 ? ` (${n} times)` : ""}`);
  // Its last words to the designer: what it says after its last step.
  const lastTool = work.findLastIndex((p) => p.type === "tool");
  const after = work.slice(lastTool + 1).filter((p) => p.type === "text");
  const words = (after.length ? after : work.filter((p) => p.type === "text").slice(-1))
    .map((p) => (p.type === "text" ? p.text : "")).join(" ").replace(/\s+/g, " ").trim();
  const said = words.length > 320 ? `${words.slice(0, 319).replace(/\s+\S*$/, "")}…` : words;
  return `Since your last message here, the builder, working in a conversation of its own, ${done.length ? done.join("; ") : "made no changes"}.${said ? ` It told the designer: “${said}”` : ""} get_project lists what's on the canvas; get_sketch shows a sketch.`;
}

// ---------- Which tools each run may use ----------

/** Panel's tools that only read: the planner's, beside the steps and its own. Making and changing things is the builder's. */
export const READ_TOOLS = new Set(
  ["get_design_rules", "get_skill", "get_fonts", "get_brand_assets", "get_ready_made", "get_verdicts", "library_overview", "search_library", "find_by_color", "similar_to", "gather_for_brief", "get_reference", "list_projects", "get_project", "get_project_material", "get_sketch", "get_handoff", "get_build", "see_build", "get_recipe"]
    .map((n) => `mcp__panel__${n}`),
);

/** The tools that move a project's steps on (steps.ts): the planner's in Plan, then build, never the builder's. */
export const STEP_TOOLS = new Set(["start_steps", "set_step", "stop_steps"].map((n) => `mcp__panel__${n}`));

/** FRIDAY's own tools, living in Panel for one turn: asking the designer, and the planner's hand-over. */
export const ASK_TOOL = "mcp__friday__ask_designer";
export const HANDOVER_TOOL = "mcp__friday__hand_to_builder";

/** Whether a tool may run: true, or why not. */
export type Allow = (name: string) => true | string;

/** One model: every one of Panel's tools, and asking the designer. */
export const oneModelAllows: Allow = (name) => (name.startsWith("mcp__panel__") || name === ASK_TOOL ? true : "FRIDAY only uses Panel's tools.");

/** The planner: reading, the steps, asking and handing over. What makes or changes things goes in the plan. */
export const plannerAllows = (builder: string): Allow => (name) =>
  READ_TOOLS.has(name) || STEP_TOOLS.has(name) || name === ASK_TOOL || name === HANDOVER_TOOL ? true : `You plan and ${builder} builds: put this in the plan for hand_to_builder instead.`;

/** The builder, and the side runs that make alternates: Panel's tools, but never the steps, and never asking. */
export const builderAllows: Allow = (name) =>
  STEP_TOOLS.has(name) ? "The planner moves the steps on." : name.startsWith("mcp__panel__") ? true : "FRIDAY only uses Panel's tools.";

// ---------- Asking the designer (ask_designer) ----------

/** How many saves a question can show above its choices. */
export const QUESTION_SAVES = 6;

/** The saves FRIDAY gave with its questions, in order, each once: the ones to show in rows. */
export function questionSaves(input: unknown): string[] {
  const qs = (input as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(qs)) return [];
  const ids = qs.flatMap((q) => {
    const saves = (q as { saves?: unknown } | null)?.saves;
    return Array.isArray(saves) ? saves.filter((s): s is string => typeof s === "string" && /^[0-9a-f]{16}$/.test(s)).slice(0, QUESTION_SAVES) : [];
  });
  return [...new Set(ids)];
}

/**
 * Whether FRIDAY's words for the designer come right before its questions: the last thing in
 * the answer (thinking and the question itself aside) is a few lines of its own. Short working
 * notes earlier on ("Checking it on a phone.") and the builder's words don't count: after a
 * run of tools with nothing said since, the designer hasn't been told what was made.
 */
export function hasWords(parts: Part[]): boolean {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]!;
    if (p.type === "thinking" || (p.type === "tool" && p.name === "ask_designer")) continue;
    return p.type === "text" && !p.builder && p.text.trim().length >= 150;
  }
  return false;
}

/**
 * What FRIDAY is told once its questions are with the designer. A model nearly always writes
 * some more words after a tool, so they are given a job: with nothing said yet, they say
 * what was made, show what the step asks to be shown (the three headlines, in full) and say
 * what to look at; with that already said, there is nothing left to say
 * (and what it writes anyway isn't shown, see reader in chat.ts). The planner can still hand
 * the making to the builder: the questions then wait under what the builder makes.
 */
export function askedNote(o: { said: boolean; planner: boolean; missing?: number }): string {
  return [
    "The designer sees the questions under your answer, with the choices as buttons, and can also write their own answer.",
    o.missing ? `${o.missing} of the saves you gave ${o.missing === 1 ? "isn't" : "aren't"} in the library, so ${o.missing === 1 ? "it isn't" : "they aren't"} shown.` : "",
    o.planner ? "If something has to be made for this step, call hand_to_builder now: the questions wait under what the builder makes." : "",
    o.said
      ? `${o.planner ? "Apart from that, your" : "Your"} turn is over. Write nothing more: words written after the questions aren't shown.`
      : "Now write your words for the designer: what you made or found, whatever this step asks you to show them written out in full (the three headlines, the three ideas: a choice's label is not enough to choose by), and what to look at. Don't repeat the questions or their choices, and don't say that you asked. Then stop.",
  ].filter(Boolean).join(" ");
}
