// Where a skill's read is kept, and how one runs (skillread.ts says what is asked).
//
// One row per skill read: its state (waiting, reading, done, failed, with the reason), when, by
// which model, with which version of the read's instructions, a fingerprint of the text that was
// read (so a skill updated from its pack shows as "changed since it was read"), the answer, and
// separately what the designer changed in it. Deleting the skill deletes its read.
//
// Skill reads follow the setting saves already have, "read automatically" (ai_auto). When it is
// on, every skill that arrives is put in line (a pack, a folder, one file, a link); a skill
// updated from its pack is read again, unless the designer changed what FRIDAY carries (then it
// is only marked); and skills never read, or read with older instructions, are read once when
// Panel starts and when the setting is turned on. A restart keeps the line: what waited carries
// on, and the read under way goes back in line. When the setting is off, a read starts only
// when the designer presses Read (one skill, "Read these", or "Read them" for all not read yet).
//
// Reads run up to three at a time (READS_AT_ONCE), the rest waiting in line, through Claude Code with no tools, with
// the model and effort the designer set for reading saves. Each is counted in ai_usage as a
// subscription read. A failed read is tried once more by itself, then stays failed with its
// reason. The line can be stopped. Reading a skill never turns it on.
//
// Each waiting or running read keeps the process id of the Panel that put it in line or is
// running it (pid). A test copy can have two Panels on one library; at start, and when picking
// the next read, a Panel leaves alone the reads of another Panel that is still running, so it
// never marks them failed or reads them twice. The real library has one Panel that reads.
//
// The table is only ever added to the library; a Panel still on older code works beside it.

import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, getSetting, now } from "./db.ts";
import { designRules } from "./rules.ts";
import { skillFilesOf, skillFileText } from "./skillpacks.ts";
import { buildReadPrompt, cleanRead, READ_LIMIT, READ_SCHEMA, READ_VERSION, readCost, type ReadEdits, type SkillRead } from "./skillread.ts";
import { parseSkill } from "./skills.ts";

db.exec(`
CREATE TABLE IF NOT EXISTS skill_reads (
  ref_id TEXT PRIMARY KEY REFERENCES refs(id) ON DELETE CASCADE,
  -- waiting · reading · done · failed
  state TEXT NOT NULL,
  -- Why it failed, in plain words.
  error TEXT,
  model TEXT,
  effort TEXT,
  -- A fingerprint of the files that were read: another one now means the skill changed since.
  fingerprint TEXT,
  -- The answer, checked and trimmed (skillread.ts cleanRead), as JSON.
  answer TEXT,
  -- What the designer changed in it: {"decide": "…", "build": "…"}, as JSON.
  edits TEXT,
  queued_at TEXT,
  read_at TEXT,
  updated_at TEXT NOT NULL
);
`);
// Added in place (empty on older rows). version: of the read's instructions the answer was made
// with (empty: part 3's, version 1). tries: failed attempts since it was last put in line. pid:
// the process of the Panel that put it in line or is reading it.
{
  const cols = db.query<{ name: string }, []>("PRAGMA table_info(skill_reads)").all().map((c) => c.name);
  if (!cols.includes("version")) db.exec("ALTER TABLE skill_reads ADD COLUMN version INTEGER");
  if (!cols.includes("tries")) db.exec("ALTER TABLE skill_reads ADD COLUMN tries INTEGER NOT NULL DEFAULT 0");
  if (!cols.includes("pid")) db.exec("ALTER TABLE skill_reads ADD COLUMN pid INTEGER");
}

interface ReadRow {
  ref_id: string; state: "waiting" | "reading" | "done" | "failed"; error: string | null; model: string | null; effort: string | null;
  fingerprint: string | null; answer: string | null; edits: string | null; queued_at: string | null; read_at: string | null;
  version: number | null; tries: number; pid: number | null;
}

/** Skills are read by themselves: the "read automatically" setting saves have (read.ts settings.auto). */
export const autoReads = () => getSetting("ai_auto") !== "0";

/** Whether the designer changed what FRIDAY carries of a read. */
const hasEdits = (r: Pick<ReadRow, "edits"> | null | undefined) => {
  const e = parse<ReadEdits>(r?.edits ?? null);
  return !!e && Object.keys(e).length > 0;
};
/** A read made with older instructions than these. */
const isOlder = (r: Pick<ReadRow, "answer" | "version"> | null | undefined) => !!r?.answer && (r.version ?? 1) < READ_VERSION;

const parse = <T,>(s: string | null): T | null => {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};

// ---------- What a read is given ----------

/** A skill's files as a read is given them: SKILL.md, then its other kept files. Null when it isn't a skill. */
function materialOf(id: string) {
  const r = db.query<{ title: string | null; text: string | null }, [string]>("SELECT title, text FROM refs WHERE id = ? AND kind = 'skill'").get(id);
  if (!r || r.text === null) return null;
  const files = skillFilesOf(id).flatMap((f) => {
    const text = skillFileText(id, f.path);
    return text === null ? [] : [{ path: f.path, text }];
  });
  return { name: parseSkill(r.text, r.title || "Untitled skill").name, main: r.text, files };
}

/** What the files hold, as one short hash. */
const fingerprintOf = (m: { main: string; files: { path: string; text: string }[] }) =>
  createHash("sha1").update([m.main, ...m.files.map((f) => `${f.path}\u0000${f.text}`)].join("\u0001")).digest("hex").slice(0, 16);

/** Rough tokens one read of this skill uses. */
function costOf(m: { main: string; files: { text: string }[] }) {
  const chars = Math.min(READ_LIMIT, m.main.length + m.files.reduce((a, f) => a + f.text.length + 40, 0)) + designRules().length;
  return readCost(chars, getSetting("ai_effort") ?? "high");
}

// ---------- What is kept ----------

export interface ReadState {
  state: ReadRow["state"] | "none";
  error: string | null;
  model: string | null;
  read_at: string | null;
  /** The skill's files changed since it was read (updated from its pack, say). */
  changed: boolean;
  /** Read with older instructions than Panel's now: it counts as not read yet. */
  older: boolean;
  /** Rough tokens a read of it uses. */
  cost: number;
  answer: SkillRead | null;
  edits: ReadEdits | null;
}

/** Every skill's read, by skill: what the Skills page and FRIDAY's instructions need. */
export function readsNow(): Map<string, { answer: SkillRead | null; edits: ReadEdits | null }> {
  const out = new Map<string, { answer: SkillRead | null; edits: ReadEdits | null }>();
  for (const r of db.query<{ ref_id: string; answer: string | null; edits: string | null }, []>("SELECT ref_id, answer, edits FROM skill_reads WHERE answer IS NOT NULL").all())
    out.set(r.ref_id, { answer: parse<SkillRead>(r.answer), edits: parse<ReadEdits>(r.edits) });
  return out;
}

/** One skill's read as the detail view shows it. */
export function readStateOf(id: string): ReadState {
  const m = materialOf(id);
  if (!m) throw new Error("That skill is gone.");
  const row = db.query<ReadRow, [string]>("SELECT * FROM skill_reads WHERE ref_id = ?").get(id);
  return {
    state: row?.state ?? "none",
    error: row?.error ?? null,
    model: row?.model ?? null,
    read_at: row?.read_at ?? null,
    changed: !!row?.fingerprint && !!row.answer && row.fingerprint !== fingerprintOf(m),
    older: isOlder(row),
    cost: costOf(m),
    answer: parse<SkillRead>(row?.answer ?? null),
    edits: parse<ReadEdits>(row?.edits ?? null),
  };
}

/** Every skill's read state in short, for the cards and the pack headings. */
export function readSummaries() {
  const rows = new Map(db.query<ReadRow, []>("SELECT * FROM skill_reads").all().map((r) => [r.ref_id, r]));
  const out = new Map<string, { state: ReadState["state"]; changed: boolean; older: boolean; cost: number; for: SkillRead["for"] | null; subjects: string[]; one_line: string | null }>();
  for (const r of db.query<{ id: string }, []>("SELECT id FROM refs WHERE kind = 'skill' AND text IS NOT NULL").all()) {
    const m = materialOf(r.id);
    if (!m) continue;
    const row = rows.get(r.id);
    const answer = parse<SkillRead>(row?.answer ?? null);
    out.set(r.id, {
      state: row?.state ?? "none",
      changed: !!row?.fingerprint && !!answer && row.fingerprint !== fingerprintOf(m),
      older: isOlder(row),
      cost: costOf(m),
      for: answer?.for ?? null,
      // Where the Skills page puts it, also for a file whose own headings come before its read.
      subjects: answer?.subjects ?? [],
      // What it is for, in the read's own short words: the card shows this, not the author's description.
      one_line: answer?.one_line || null,
    });
  }
  return out;
}

/** The designer's own Decide and Build over the read. `null` for one puts Panel's version back. */
export function setReadEdits(id: string, patch: { decide?: unknown; build?: unknown; reset?: unknown }) {
  const row = db.query<ReadRow, [string]>("SELECT * FROM skill_reads WHERE ref_id = ?").get(id);
  if (!row?.answer) throw new Error("This skill hasn't been read yet.");
  const edits: ReadEdits = patch.reset === true ? {} : { ...(parse<ReadEdits>(row.edits) ?? {}) };
  for (const k of ["decide", "build"] as const) {
    const v = patch[k];
    if (v === null) delete edits[k];
    else if (typeof v === "string") edits[k] = v.slice(0, 8000);
  }
  db.run("UPDATE skill_reads SET edits = ?, updated_at = ? WHERE ref_id = ?", [Object.keys(edits).length ? JSON.stringify(edits) : null, now(), id]);
}

// ---------- Running reads, a few at a time ----------

/** Whether a process is still running (one we may not signal is running too). */
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as { code?: string }).code === "EPERM";
  }
}

/**
 * The waiting and running reads that belong to another Panel still running on this library: left
 * exactly as they are. As SQL to add to a WHERE, with its values.
 */
function notOthers() {
  const theirs = db
    .query<{ ref_id: string; pid: number }, [number]>("SELECT ref_id, pid FROM skill_reads WHERE state IN ('waiting', 'reading') AND pid IS NOT NULL AND pid != ?")
    .all(process.pid)
    .filter((r) => alive(r.pid))
    .map((r) => r.ref_id);
  return { sql: theirs.length ? `AND ref_id NOT IN (${theirs.map(() => "?").join(", ")})` : "", args: theirs };
}

/**
 * How many skills are read at the same time. A pack of fifteen is read in a third of the time;
 * the tokens spent are the same, only sooner, so a usage limit is reached sooner too (a read
 * that fails on it is tried once more, then waits for Try again).
 */
export const READS_AT_ONCE = 3;

/** The reads under way, by skill. */
const running = new Map<string, { id: string; proc: { kill: () => void } | null; stopped: boolean }>();

/**
 * Put skills in line to be read, and start reading if nothing is. Skills already waiting or
 * being read are left as they are. Answers the ids put in line.
 */
export function queueReads(ids: string[]) {
  const ts = now();
  const queued: string[] = [];
  for (const id of ids) {
    if (!materialOf(id)) continue;
    const row = db.query<{ state: string }, [string]>("SELECT state FROM skill_reads WHERE ref_id = ?").get(id);
    if (row?.state === "waiting" || row?.state === "reading") continue;
    db.run(
      `INSERT INTO skill_reads (ref_id, state, queued_at, updated_at, tries, pid) VALUES (?, 'waiting', ?, ?, 0, ?)
       ON CONFLICT(ref_id) DO UPDATE SET state = 'waiting', error = NULL, tries = 0, queued_at = excluded.queued_at, updated_at = excluded.updated_at, pid = excluded.pid`,
      [id, ts, ts, process.pid],
    );
    queued.push(id);
  }
  drain();
  return queued;
}

/**
 * Whether a skill would be read by itself: never read; read with older instructions; or
 * changed since it was read: each only while the designer hasn't changed what FRIDAY carries
 * (then it is only marked). A read that failed twice waits for the designer's Try again.
 */
function wantsRead(row: ReadRow | null, m: NonNullable<ReturnType<typeof materialOf>>) {
  if (row?.state === "waiting" || row?.state === "reading" || row?.state === "failed") return false;
  if (!row?.answer) return true;
  if (hasEdits(row)) return false;
  return isOlder(row) || (!!row.fingerprint && row.fingerprint !== fingerprintOf(m));
}

/** The skills no read of which is in use yet: never read (or the read failed), or read with older instructions. */
export function notReadYet(): string[] {
  const rows = new Map(db.query<ReadRow, []>("SELECT * FROM skill_reads").all().map((r) => [r.ref_id, r]));
  return db
    .query<{ id: string }, []>("SELECT id FROM refs WHERE kind = 'skill' AND text IS NOT NULL AND status != 'pending' ORDER BY created_at")
    .all()
    .map((r) => r.id)
    .filter((id) => {
      const row = rows.get(id);
      if (row?.state === "waiting" || row?.state === "reading") return false;
      return !row?.answer || (isOlder(row) && !hasEdits(row));
    });
}

/**
 * With "read automatically" on: put in line every skill (or just these) that wants a read. Off,
 * nothing. Answers the ids put in line.
 */
export function readIfAuto(ids?: string[]): string[] {
  if (!autoReads()) return [];
  const rows = new Map(db.query<ReadRow, []>("SELECT * FROM skill_reads").all().map((r) => [r.ref_id, r]));
  const all = ids ?? db.query<{ id: string }, []>("SELECT id FROM refs WHERE kind = 'skill' AND text IS NOT NULL ORDER BY created_at").all().map((r) => r.id);
  const want = all.filter((id) => {
    const m = materialOf(id);
    return !!m && wantsRead(rows.get(id) ?? null, m);
  });
  return want.length ? queueReads(want) : [];
}

/** What is being read now, and what waits. */
export function readQueue() {
  return {
    reading: [...running.keys()],
    waiting: db.query<{ ref_id: string }, []>("SELECT ref_id FROM skill_reads WHERE state = 'waiting' ORDER BY queued_at, ref_id").all().map((r) => r.ref_id),
  };
}

/** A read that didn't finish goes back to how it was: its last answer if it had one, else none. */
function putBack(where: string) {
  db.run(`UPDATE skill_reads SET state = 'done', error = NULL, updated_at = ? WHERE ${where} AND answer IS NOT NULL`, [now()]);
  db.run(`DELETE FROM skill_reads WHERE ${where} AND answer IS NULL`);
}

/** Stop: nothing more is read, and the read under way is stopped too. */
export function stopReads() {
  putBack("state = 'waiting'");
  for (const run of running.values()) {
    run.stopped = true;
    run.proc?.kill();
  }
  return readQueue();
}

/**
 * At start. With "read automatically" on, the line carries on: what waited keeps waiting, the
 * read under way goes back in line (first, where it was), and skills that want a read are put
 * in line too. Off, reads that were waiting or under way don't start again by themselves.
 */
export function startSkillReads() {
  // Another Panel still running on this library keeps its own line.
  const o = notOthers();
  if (autoReads()) {
    db.run(`UPDATE skill_reads SET state = 'waiting' WHERE state = 'reading' ${o.sql}`, o.args);
    readIfAuto();
    drain();
    return;
  }
  db.run(`UPDATE skill_reads SET state = 'done', error = NULL WHERE state IN ('waiting', 'reading') AND answer IS NOT NULL ${o.sql}`, o.args);
  db.run(`UPDATE skill_reads SET state = 'failed', error = 'Panel was restarted before this read finished. Read it again.' WHERE state IN ('waiting', 'reading') AND answer IS NULL ${o.sql}`, o.args);
}

/** Start reads from the front of the line until READS_AT_ONCE are under way; each one done starts the next. */
function drain() {
  while (running.size < READS_AT_ONCE) {
    // Not one already under way here, nor one another running Panel put in line.
    const busy = [...running.keys(), ...notOthers().args];
    const next = db
      .query<{ ref_id: string }, string[]>(
        `SELECT ref_id FROM skill_reads WHERE state = 'waiting' ${busy.length ? `AND ref_id NOT IN (${busy.map(() => "?").join(", ")})` : ""} ORDER BY queued_at, ref_id LIMIT 1`,
      )
      .get(...busy);
    if (!next) break;
    const run = { id: next.ref_id, proc: null as { kill: () => void } | null, stopped: false };
    running.set(run.id, run);
    db.run("UPDATE skill_reads SET state = 'reading', pid = ?, updated_at = ? WHERE ref_id = ?", [process.pid, now(), run.id]);
    void readOne(run).finally(() => {
      running.delete(run.id);
      drain();
    });
  }
}

/** One skill through Claude Code: build the prompt, ask, check the answer, keep it. */
async function readOne(run: { id: string; proc: { kill: () => void } | null; stopped: boolean }) {
  const id = run.id;
  // Only when a read runs: read.ts brings the Anthropic SDK and the save-reading machinery.
  const { claudeBinary, claudeToken, settings } = await import("./read.ts");
  const model = settings.model();
  const effort = settings.effort();
  const dir = mkdtempSync(join(tmpdir(), "panel-skill-read-"));
  try {
    const m = materialOf(id);
    if (!m) throw new Error("That skill is gone.");
    const bin = await claudeBinary();
    if (!bin) throw new Error("The claude command line isn't installed.");
    const token = await claudeToken();
    const { system, prompt } = buildReadPrompt({ ...m, rules: designRules() });
    // A clean environment and an empty folder: nothing from a shell or a project changes the read.
    const env: Record<string, string> = {
      HOME: process.env.HOME ?? "",
      USER: process.env.USER ?? "",
      PATH: `${process.env.PATH ?? ""}:/usr/bin:/bin`,
      ...(token ? { CLAUDE_CODE_OAUTH_TOKEN: token } : {}),
    };
    const proc = Bun.spawn(
      [
        bin, "-p", prompt,
        "--model", model, "--effort", effort,
        "--output-format", "json", "--json-schema", JSON.stringify(READ_SCHEMA),
        "--system-prompt", system,
        "--tools", "",
        "--no-session-persistence", "--strict-mcp-config", "--setting-sources", "",
      ],
      { cwd: dir, env, stdout: "pipe", stderr: "pipe" },
    );
    run.proc = proc;
    const timer = setTimeout(() => proc.kill(), 12 * 60_000);
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    clearTimeout(timer);
    if (run.stopped) throw new Error("stopped");
    let res: { is_error?: boolean; result?: string; structured_output?: unknown; usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } };
    try {
      res = JSON.parse(out);
    } catch {
      throw new Error(`Claude Code didn't answer: ${(err || out).trim().split("\n").pop()?.slice(0, 200) || "no output"}`);
    }
    if (res.usage)
      db.run(
        `INSERT INTO ai_usage (at, ref_id, model, mode, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost) VALUES (?, ?, ?, 'subscription', ?, ?, ?, ?, 0)`,
        [now(), id, model, res.usage.input_tokens, res.usage.output_tokens, res.usage.cache_read_input_tokens ?? 0, res.usage.cache_creation_input_tokens ?? 0],
      );
    if (res.is_error) throw new Error(`Claude Code: ${res.result?.slice(0, 300) ?? "failed"}`);
    let answer = res.structured_output;
    if (!answer && res.result) answer = parse(res.result.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    if (!answer || typeof answer !== "object") throw new Error("Claude Code's answer wasn't a read of the skill.");
    const read = cleanRead(answer);
    if (!read.one_line) throw new Error("The answer didn't say what the skill is for.");
    // A new read starts clean: the designer's changes were to the old one.
    db.run(
      "UPDATE skill_reads SET state = 'done', error = NULL, tries = 0, version = ?, model = ?, effort = ?, fingerprint = ?, answer = ?, edits = NULL, read_at = ?, updated_at = ? WHERE ref_id = ?",
      [READ_VERSION, model, effort, fingerprintOf(m), JSON.stringify(read), now(), now(), id],
    );
    console.log(`Skill read: ${m.name} (${res.usage?.output_tokens ?? "?"} tokens out)`);
  } catch (e) {
    if (run.stopped) putBack(`ref_id = '${id.replace(/[^0-9a-f]/g, "")}'`);
    else {
      // The first failure goes to the back of the line once more; the second stays, with its reason.
      const tries = (db.query<{ tries: number }, [string]>("SELECT tries FROM skill_reads WHERE ref_id = ?").get(id)?.tries ?? 0) + 1;
      const again = tries < 2 && !!materialOf(id);
      db.run("UPDATE skill_reads SET state = ?, error = ?, tries = ?, queued_at = CASE WHEN ? THEN ? ELSE queued_at END, updated_at = ? WHERE ref_id = ?", [
        again ? "waiting" : "failed", (e as Error).message.slice(0, 400), tries, again ? 1 : 0, now(), now(), id,
      ]);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
