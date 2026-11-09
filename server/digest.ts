// A page on what each of a project's documents says, written once by Claude when the
// document arrives, so FRIDAY knows the project from the start of every conversation
// without reading a long spec each time. A spec can be hundreds of pages; FRIDAY gets
// this page with the project (see projectCard in chat.ts) and looks up details in the
// full text (get_project_material with find) only when a question needs them.
//
// It runs through Claude Code on the designer's plan, one document at a time, in the
// background. Like reading saves, it only starts on its own while "read new saves by AI"
// is on (ai_auto); the About panel can always ask for one.

import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { db, getSetting } from "./db.ts";
import { LIBRARY_DIR } from "./config.ts";
import { claudeBinary, claudeToken } from "./read.ts";

// The summary's columns are added with the table, in materials.ts.

/** Shorter than this, the whole text goes with the project and needs no summary. */
export const WHOLE = 2500;
/** As much of a document as one summary reads (about 600K tokens of Russian). */
const READ_AT_MOST = 1_800_000;

const SUMMARIZER = `You read a document a designer attached to a design project and write the page a design assistant will read at the start of every conversation about the project, instead of the whole document. The assistant helps design the product (references, type, color, layout, sketches of screens), so write what a designer needs to know, not what an engineer needs.

Write in English. Keep the project's own names, product terms, legal terms and any interface wording in their original language, in quotes. About 500 to 800 words. Plain sentences and short lists, no tables.

Use these headings, and only those the document gives something for:
## What it is
The product, what it does, for which market, country and languages.
## Who uses it
The kinds of users and roles, and what each needs.
## What it has to do
The main jobs and flows, the screens or parts it has, important states (empty, error, waiting, signed, rejected...).
## Words to use
Names, terms and wording the design must use, as written.
## Hard requirements
Legal, platform, language and script (e.g. Cyrillic, Tajik letters), accessibility, brand and technical limits that change the design.
## Still open
What the document leaves undecided or marks as a question.
## Where the details are
The sections worth reading for design work, by their titles as written in the document, so the assistant can look them up.

Say only what the document says. Don't add advice.`;

let busy = false;

/** Write (or write again) the summary of one material. */
export async function summarize(projectId: string, id: string) {
  const r = db.query<{ name: string; note: string; text: string }, [string, string]>("SELECT name, note, text FROM project_materials WHERE project_id = ? AND id = ?").get(projectId, id);
  if (!r) throw new Error("That material is gone.");
  if (r.text.length <= WHOLE) {
    db.run("UPDATE project_materials SET summary = '', summary_state = 'short', summary_error = NULL WHERE id = ?", [id]);
    return;
  }
  const bin = await claudeBinary();
  if (!bin) throw new Error("The claude command line isn't installed.");
  const token = await claudeToken();
  db.run("UPDATE project_materials SET summary_state = 'working', summary_error = NULL WHERE id = ?", [id]);
  const cwd = join(LIBRARY_DIR, "chat");
  mkdirSync(cwd, { recursive: true });
  try {
    const cut = r.text.length > READ_AT_MOST;
    const q = query({
      prompt: `The document “${r.name}”${r.note ? ` (the designer says: ${r.note})` : ""}${cut ? `; only its first ${READ_AT_MOST} characters are here` : ""}:\n\n<document>\n${r.text.slice(0, READ_AT_MOST)}\n</document>\n\nWrite the page.`,
      options: {
        pathToClaudeCodeExecutable: bin,
        cwd,
        env: { HOME: process.env.HOME ?? "", USER: process.env.USER ?? "", PATH: `${process.env.PATH ?? ""}:/usr/bin:/bin`, ...(token ? { CLAUDE_CODE_OAUTH_TOKEN: token } : {}) },
        model: "claude-opus-5-5",
        effort: "medium",
        systemPrompt: SUMMARIZER,
        tools: [],
        settingSources: [],
        persistSession: false,
      },
    });
    let text = "";
    let error = "";
    for await (const m of q) {
      if (m.type === "result") {
        if (m.subtype === "success" && !m.is_error) text = m.result;
        else error = ("result" in m && typeof m.result === "string" ? m.result : "") || m.subtype;
      }
    }
    if (!text.trim()) throw new Error(error || "Claude didn't write a summary.");
    db.run("UPDATE project_materials SET summary = ?, summary_state = 'done', summary_error = NULL WHERE id = ?", [text.trim(), id]);
  } catch (e) {
    db.run("UPDATE project_materials SET summary_state = 'error', summary_error = ? WHERE id = ?", [(e as Error).message.slice(0, 300), id]);
    throw e;
  }
}

/** The next document waiting for a summary, one at a time. */
async function next() {
  if (busy || getSetting("ai_auto") === "0") return;
  const r = db.query<{ id: string; project_id: string }, [number]>(
    "SELECT id, project_id FROM project_materials WHERE summary_state = '' AND length(text) > ? ORDER BY created_at DESC LIMIT 1",
  ).get(WHOLE);
  if (!r) return;
  busy = true;
  try {
    await summarize(r.project_id, r.id);
  } catch (e) {
    console.error("Summary of a project document:", (e as Error).message);
  } finally {
    busy = false;
  }
}

/** Soon after a document arrives, and every few minutes for any still waiting. */
export function summarizeSoon() {
  setTimeout(() => void next(), 2000);
}
export function startSummaries() {
  setTimeout(() => void next(), 30_000);
  setInterval(() => void next(), 300_000);
}
