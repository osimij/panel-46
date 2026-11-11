// Skills read by themselves, and one skill leading each subject (skills, part 4):
// - with "read automatically" on: a pack, a folder and one file put their skills in line; an
//   update reads again, unless the designer changed the read; unread skills (and reads made with
//   older instructions) are read at start; three are read at a time; a restart keeps the line; a failed read is tried once
//   more; nothing is ever turned on by reading;
// - with it off: nothing is read by itself, and the Skills page says how many aren't read yet;
// - get_skill: the short version of a read skill, the file as written with file "SKILL.md";
// - leads: only the lead's lines on a subject reach FRIDAY's three readers, get_skill,
//   get_design_rules and a build's HANDOFF.md, with a "follow …" line; a skill left with nothing
//   isn't listed; Panel's pick and its tie-breaks; the designer's pick; the lead turned off;
// - edits keep their subjects; a check without its number is dropped; the routes refuse callers
//   that aren't Panel; with every skill off, FRIDAY's instructions are as with no skills at all.
//
// No test calls Claude: `claude` is a stand-in (PANEL_CLAUDE_BIN) that answers by the skill's
// name, keeps a log of what it was asked to read, fails for "Fails", and takes its time for
// "Slow…" skills. GitHub is a small server in this process.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pickLeads } from "../server/skillleads.ts";
import { cleanRead, READ_VERSION, withRead, type SkillRead } from "../server/skillread.ts";
import { parseSkill, type Skill } from "../server/skills.ts";
import { startPanel, type TestPanel } from "./helpers.ts";

const ROOT = join(import.meta.dir, "..");
const md = (name: string, line: string, body = "Do it well.") => `---\nname: ${name}\ndescription: ${line}\n---\n\n# ${name}\n\n${body}\n`;
const L = (subject: string, text: string) => ({ subject, text }) as SkillRead["decide"][number];

/** A read as the stand-in answers it. */
const readOf = (name: string, subjects: string[], decide: SkillRead["decide"], build: SkillRead["build"], extra: Partial<SkillRead> = {}): SkillRead => ({
  one_line: `${name}, read.`, subjects: subjects as SkillRead["subjects"], for: "both", about: [], when: "always", decide, build,
  checks: [], could_measure: [], look_for: [], conflicts: [], points_to: [], ...extra,
});

// ---------- The stand-in for Claude, and GitHub ----------

let fake: string;
const calls = () => (existsSync(join(fake, "calls.txt")) ? readFileSync(join(fake, "calls.txt"), "utf8").trim().split("\n").filter(Boolean) : []);
const timesRead = (name: string) => calls().filter((c) => c === name).length;

const sha = (s: string) => createHash("sha1").update(s).digest("hex");
type Files = Record<string, string>;
const V1: Files = {
  "skills/animate/SKILL.md": md("animate", "Make things move well.", "Ease out on enter."),
  "skills/sound/SKILL.md": md("sound", "When to make a sound."),
};
const V2: Files = { ...V1, "skills/animate/SKILL.md": md("animate", "Make things move well.", "Ease out on enter. Spring on drag.") };
const V3: Files = { ...V1, "skills/animate/SKILL.md": md("animate", "Make things move well.", "Ease out on enter. Spring on drag. Never bounce.") };
const COMMITS: Record<string, Files> = { [sha("v1")]: V1, [sha("v2")]: V2, [sha("v3")]: V3 };
const gh = { main: sha("v1") };
const ghServer = Bun.serve({
  port: 0,
  fetch(req) {
    const u = new URL(req.url);
    if (u.pathname.startsWith("/api/")) {
      const p = u.pathname.slice(4).split("/").filter(Boolean).map(decodeURIComponent);
      if (p[1] !== "maker" || p[2] !== "skills") return Response.json({ message: "Not Found" }, { status: 404 });
      if (p.length === 3) return Response.json({ default_branch: "main", full_name: "maker/skills", owner: { login: "maker" }, license: null });
      if (p[3] === "commits") {
        const ref = p.slice(4).join("/");
        const at = ref === "main" ? gh.main : COMMITS[ref] ? ref : null;
        return at ? Response.json({ sha: at, commit: { committer: { date: "2026-11-11T10:00:00Z" } } }) : Response.json({ message: "No commit" }, { status: 422 });
      }
      if (p[3] === "git" && p[4] === "trees") {
        const files = COMMITS[p[5]!];
        if (!files) return Response.json({ message: "Not Found" }, { status: 404 });
        return Response.json({ truncated: false, tree: Object.entries(files).map(([path, text]) => ({ path, type: "blob", size: Buffer.byteLength(text), sha: sha(text) })) });
      }
    }
    if (u.pathname.startsWith("/raw/")) {
      const [, , , , at, ...rest] = u.pathname.split("/").map(decodeURIComponent);
      const text = COMMITS[at!]?.[rest.join("/")];
      return text === undefined ? new Response("404", { status: 404 }) : new Response(text);
    }
    return new Response("", { status: 404 });
  },
});

// ---------- Two companions: "read automatically" on, and off ----------

let on: TestPanel;
let off: TestPanel;

const call = async (p: TestPanel, name: string, args: unknown) => {
  const res = await p.send("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, { accept: "application/json, text/event-stream" });
  const out = ((await res.json()) as any).result;
  const first = out.content?.[0]?.type === "text" ? out.content[0].text : "";
  let json: any = null;
  try { json = JSON.parse(first); } catch { /* plain text */ }
  return { isError: !!out.isError, text: first as string, first: json };
};
const set = (p: TestPanel, id: string, patch: unknown) => p.send("PATCH", `/api/skills/${id}`, patch);
const view = (p: TestPanel, id: string) => p.get(`/api/skills/${id}/read`);
const page = (p: TestPanel) => p.get("/api/skills");
const idOf = (p: TestPanel, title: string) => p.db.query<{ id: string }, [string]>("SELECT id FROM refs WHERE kind = 'skill' AND title = ?").get(title)!.id;

/** Wait until nothing is being read and nothing waits. */
async function settle(p: TestPanel) {
  for (let i = 0; i < 200; i++) {
    const q = await p.get("/api/skills/reads");
    if (!q.reading.length && !q.waiting.length) return;
    await Bun.sleep(100);
  }
  throw new Error("The reads didn't finish.");
}

async function upload(p: TestPanel, name: string, text: string) {
  const form = new FormData();
  form.append("files", new File([text], name, { type: "text/markdown" }));
  const res = await fetch(`${p.url}/api/upload`, { method: "POST", body: form });
  expect(res.status).toBe(200);
}
const addFromGithub = async (p: TestPanel, at: string, folders: string[]) =>
  (await (await p.send("POST", "/api/skills/packs/add", { owner: "maker", repo: "skills", branch: "main", path: "", sha: at, folders })).json()) as any;

async function prompts(p: TestPanel) {
  const code = `const { systemPrompt } = await import(${JSON.stringify(join(ROOT, "server/chat.ts"))}); console.log(JSON.stringify({ solo: systemPrompt("solo"), planner: systemPrompt("planner"), builder: systemPrompt("builder") })); process.exit(0);`;
  const proc = Bun.spawn(["bun", "-e", code], { cwd: ROOT, env: { ...process.env, PANEL_LIBRARY_DIR: p.dir, PANEL_PORT: "1" }, stdout: "pipe", stderr: "inherit" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return JSON.parse(out.trim().split("\n").pop()!) as Record<"solo" | "planner" | "builder", string>;
}

// The skills that speak to motion, for the leads (their reads put straight into the library).
const EMIL = readOf("emil", ["motion", "gestures"], [L("motion", "E-MOTION-DECIDE")], [L("motion", "E-MOTION-BUILD"), L("gestures", "E-GESTURE-BUILD")], { when: "applies", about: ["motion"] });
const UI = readOf("better-ui", ["surfaces", "motion"], [L("surfaces", "U-SURF-DECIDE")], [L("surfaces", "U-SURF-BUILD"), L("motion", "U-MOTION-1"), L("motion", "U-MOTION-2")]);
const EXTRA = readOf("motion-extra", ["motion"], [], [L("motion", "X-MOTION-ONLY")]);

const answers: Record<string, SkillRead> = {
  animate: readOf("animate", ["motion"], [], [L("motion", "ANIMATE-LINE")]),
  sound: readOf("sound", ["other"], [], [L("other", "SOUND-LINE")]),
  folded: readOf("folded", ["layout"], [], [L("layout", "FOLDED-LINE")]),
  single: readOf("single", ["typography"], [], [L("typography", "SINGLE-LINE")]),
  never: readOf("never", ["color"], [], [L("color", "NEVER-LINE")]),
  older: readOf("older", ["color"], [], [L("color", "OLDER-NEW-LINE")]),
  Slow1: readOf("Slow1", ["color"], [], [L("color", "SLOW-1")]),
  Slow2: readOf("Slow2", ["color"], [], [L("color", "SLOW-2")]),
  Slow3: readOf("Slow3", ["color"], [], [L("color", "SLOW-3")]),
  Slow4: readOf("Slow4", ["color"], [], [L("color", "SLOW-4")]),
  plain: readOf("plain", ["writing"], [L("writing", "PLAIN-SHORT-DECIDE")], [L("writing", "PLAIN-SHORT-BUILD")]),
};

const at = "2026-11-11T00:00:00.000Z";
const ids = { emil: "5f00000000000001", ui: "5f00000000000002", extra: "5f00000000000003", whole: "5f00000000000004", plain: "5f00000000000005" };
let before: Record<string, string>;

beforeAll(async () => {
  fake = mkdtempSync(join(tmpdir(), "panel-fake-claude-"));
  writeFileSync(join(fake, "claude"), `#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
const prompt = args[args.indexOf("-p") + 1];
const name = prompt.match(/The skill “([^”]+)”/)?.[1] ?? "";
appendFileSync(${JSON.stringify(join(fake, "calls.txt"))}, name + "\\n");
if (name.startsWith("Slow")) await Bun.sleep(1500);
const answers = ${JSON.stringify(answers)};
const usage = { input_tokens: 1000, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
if (name === "Fails") console.log(JSON.stringify({ is_error: true, result: "Something went wrong upstream", usage }));
else console.log(JSON.stringify({ structured_output: answers[name] ?? answers.sound, usage }));
`);
  chmodSync(join(fake, "claude"), 0o755);
  const env = { PANEL_CLAUDE_BIN: join(fake, "claude"), CLAUDE_CODE_OAUTH_TOKEN: "test-token", PANEL_GITHUB_API: `http://127.0.0.1:${ghServer.port}/api`, PANEL_GITHUB_RAW: `http://127.0.0.1:${ghServer.port}/raw` };
  [on, off] = await Promise.all([startPanel(env, "UPDATE settings SET value = '1' WHERE key = 'ai_auto';"), startPanel(env)]);
  before = await prompts(off);
  // The skills for the leads, already read (the way part 3 reads them, with these instructions).
  const add = (id: string, name: string, text: string) =>
    off.db.run("INSERT INTO refs (id, kind, title, text, note, status, created_at, updated_at) VALUES (?, 'skill', ?, ?, '', 'archived', ?, ?)", [id, name, text, at, at]);
  const read = (id: string, r: SkillRead) =>
    off.db.run("INSERT INTO skill_reads (ref_id, state, model, answer, version, read_at, updated_at) VALUES (?, 'done', 'test', ?, ?, ?, ?)", [id, JSON.stringify(r), READ_VERSION, at, at]);
  add(ids.emil, "emil", md("emil", "Emil's motion.", "EMIL-WHOLE-FILE-TEXT"));
  add(ids.ui, "better-ui", md("better-ui", "Better UI.", "UI-WHOLE-FILE-TEXT"));
  add(ids.extra, "motion-extra", md("motion-extra", "More motion.", "EXTRA-WHOLE-FILE-TEXT"));
  add(ids.whole, "whole", md("whole", "Never read.", "WHOLE-UNREAD-FILE-TEXT"));
  read(ids.emil, EMIL);
  read(ids.ui, UI);
  read(ids.extra, EXTRA);
}, 60_000);
afterAll(async () => {
  await Promise.all([on?.stop(), off?.stop()]);
  void ghServer.stop(true);
  rmSync(fake, { recursive: true, force: true });
});

// ---------- 1. Reads that start by themselves ----------

describe("with read automatically on", () => {
  test("adding a pack from GitHub puts its skills in line; they're read, and stay off", async () => {
    const r = await addFromGithub(on, gh.main, ["skills/animate", "skills/sound"]);
    expect(r.added).toBe(2);
    expect(r.reading.length).toBe(2);
    await settle(on);
    for (const name of ["animate", "sound"]) {
      const v = await view(on, idOf(on, name));
      expect(v.state).toBe("done");
      expect(v.answer.build[0].text).toBe(answers[name]!.build[0]!.text);
    }
    expect((await page(on)).skills.every((s: any) => !s.on)).toBe(true);
    expect((await page(on)).auto).toBe(true);
  });

  test("updating a skill from its pack reads it again; with the designer's edits it is only marked", async () => {
    const animate = idOf(on, "animate");
    gh.main = sha("v2");
    expect((await addFromGithub(on, gh.main, ["skills/animate"])).updated).toBe(1);
    await settle(on);
    expect(timesRead("animate")).toBe(2);
    expect((await view(on, animate)).changed).toBe(false);
    // The designer changes what FRIDAY carries; the next update leaves the read alone.
    await on.send("PATCH", `/api/skills/${animate}/read`, { build: "- motion: MY-ANIMATE-EDIT" });
    gh.main = sha("v3");
    const r = await addFromGithub(on, gh.main, ["skills/animate"]);
    expect(r.updated).toBe(1);
    expect(r.reading).toEqual([]);
    await settle(on);
    expect(timesRead("animate")).toBe(2);
    const v = await view(on, animate);
    expect(v.changed).toBe(true);
    expect(v.edited).toBe(true);
  });

  test("a dropped folder and one .md file each put their skill in line", async () => {
    const folder = { name: "My folder", files: [{ path: "folded/SKILL.md", bytes: 60, text: md("folded", "A folder skill.") }] };
    const r = (await (await on.send("POST", "/api/skills/packs/add", { folder, folders: ["folded"] })).json()) as any;
    expect(r.reading.length).toBe(1);
    await upload(on, "single.md", md("single", "One file."));
    await settle(on);
    expect((await view(on, idOf(on, "folded"))).state).toBe("done");
    expect((await view(on, idOf(on, "single"))).state).toBe("done");
  });

  test("a failed read is tried once more by itself, then stays failed with its reason", async () => {
    await upload(on, "fails.md", md("Fails", "This one fails."));
    await settle(on);
    expect(timesRead("Fails")).toBe(2);
    const v = await view(on, idOf(on, "Fails"));
    expect(v.state).toBe("failed");
    expect(v.error).toContain("Something went wrong upstream");
  });

  test("at start, skills never read and reads made with older instructions are read; an edited older read is only marked", async () => {
    const add = (id: string, name: string) =>
      on.db.run("INSERT INTO refs (id, kind, title, text, note, status, created_at, updated_at) VALUES (?, 'skill', ?, ?, '', 'archived', ?, ?)", [id, name, md(name, `${name}.`), at, at]);
    add("5f000000000000a1", "never");
    add("5f000000000000a2", "older");
    add("5f000000000000a3", "older-edited");
    // Part 3's reads have no version: older than these instructions.
    const old = JSON.stringify(readOf("old", ["color"], [], [L("color", "OLD-LINE")]));
    on.db.run("INSERT INTO skill_reads (ref_id, state, answer, updated_at) VALUES ('5f000000000000a2', 'done', ?, ?)", [old, at]);
    on.db.run("INSERT INTO skill_reads (ref_id, state, answer, edits, updated_at) VALUES ('5f000000000000a3', 'done', ?, '{\"build\":\"- MINE\"}', ?)", [old, at]);
    expect((await view(on, "5f000000000000a2")).older).toBe(true);
    await on.restart();
    await settle(on);
    expect((await view(on, "5f000000000000a1")).state).toBe("done");
    const o = await view(on, "5f000000000000a2");
    expect(o.older).toBe(false);
    expect(o.answer.build[0].text).toBe("OLDER-NEW-LINE");
    const e = await view(on, "5f000000000000a3");
    expect(e.older).toBe(true);
    expect(e.edited).toBe(true);
    expect(timesRead("older-edited")).toBe(0);
  }, 30_000);

  test("three are read at a time; a restart doesn't lose the line: what waited carries on, the reads under way go back in line", async () => {
    for (const n of [1, 2, 3, 4]) await upload(on, `slow${n}.md`, md(`Slow${n}`, "Slow."));
    for (let i = 0; i < 60 && ["Slow1", "Slow2", "Slow3"].some((n) => !calls().includes(n)); i++) await Bun.sleep(50);
    const q = await on.get("/api/skills/reads");
    expect(q.reading.length).toBe(3);
    expect(new Set(q.reading)).toEqual(new Set(["Slow1", "Slow2", "Slow3"].map((n) => idOf(on, n))));
    expect(q.waiting).toEqual([idOf(on, "Slow4")]);
    expect(calls()).not.toContain("Slow4");
    await on.restart();
    await settle(on);
    for (const n of [1, 2, 3, 4]) expect((await view(on, idOf(on, `Slow${n}`))).state).toBe("done");
    for (const n of [1, 2, 3]) expect(timesRead(`Slow${n}`)).toBe(2);
    expect(timesRead("Slow4")).toBe(1);
  }, 30_000);
});

describe("with read automatically off", () => {
  test("nothing is read by itself; the Skills page says how many aren't read yet, and Read them reads them", async () => {
    await upload(off, "plain.md", md("plain", "A plain skill.", "PLAIN-WHOLE-FILE-TEXT"));
    await Bun.sleep(300);
    const plain = idOf(off, "plain");
    expect(off.db.query("SELECT COUNT(*) n FROM skill_reads WHERE ref_id = ?").get(plain)).toEqual({ n: 0 });
    const pg = await page(off);
    expect(pg.auto).toBe(false);
    // "whole" and "plain": never read. The three for the leads are read with these instructions.
    expect(pg.not_read).toBe(2);
    expect(calls()).not.toContain("plain");
  });

  test("get_skill: a skill not read gives its whole file", async () => {
    await set(off, ids.whole, { on: true, when: "asked" });
    const whole = await call(off, "get_skill", { name: "whole" });
    expect(whole.text).toContain("WHOLE-UNREAD-FILE-TEXT");
    expect(whole.text).not.toContain("short version");
    await set(off, ids.whole, { on: false });
  });

  test("Read them reads every skill not read yet; get_skill then gives the short version, and the file with file SKILL.md", async () => {
    const r = (await (await off.send("POST", "/api/skills/reads/unread", {})).json()) as any;
    expect(r.queued.length).toBe(2);
    await settle(off);
    expect((await page(off)).not_read).toBe(0);
    const plain = idOf(off, "plain");
    await set(off, plain, { on: true, when: "asked" });
    const short = await call(off, "get_skill", { name: "plain" });
    expect(short.text).toContain("This is its short version, as Panel read it for sketches.");
    expect(short.text).toContain("Decide:\n- PLAIN-SHORT-DECIDE");
    expect(short.text).toContain("Build:\n- PLAIN-SHORT-BUILD");
    expect(short.text).toContain("- SKILL.md (");
    expect(short.text).not.toContain("PLAIN-WHOLE-FILE-TEXT");
    const file = await call(off, "get_skill", { name: "plain", file: "SKILL.md" });
    expect(file.text).toContain("PLAIN-WHOLE-FILE-TEXT");
    await set(off, plain, { on: false });
    // Reading never turned anything on.
    expect((await page(off)).on).toBe(0);
  });
});

// ---------- 2 and 3. Leads ----------

describe("one skill leads each subject", () => {
  test("only the lead's lines on a subject reach the three readers; the others say whom to follow; a skill left with nothing isn't listed", async () => {
    await set(off, ids.emil, { on: true, when: "applies", about: ["motion"] });
    await set(off, ids.ui, { on: true, when: "always" });
    await set(off, ids.extra, { on: true, when: "always" });
    const pg = await page(off);
    expect(pg.leads.length).toBe(1);
    expect(pg.leads[0]).toMatchObject({ subject: "motion", id: ids.emil, name: "emil", by: "panel", panel: ids.emil });
    expect(pg.leads[0].speakers.length).toBe(3);
    expect(pg.leads[0].speakers).toEqual(expect.arrayContaining([
      { id: ids.emil, name: "emil", lines: 2 }, { id: ids.ui, name: "better-ui", lines: 2 }, { id: ids.extra, name: "motion-extra", lines: 1 },
    ]));
    const pr = await prompts(off);
    const follow = "On motion, follow emil (read it with get_skill when the page moves).";
    for (const k of ["solo", "planner", "builder"] as const) {
      expect(pr[k]).not.toContain("U-MOTION");
      expect(pr[k]).not.toContain("X-MOTION-ONLY");
      expect(pr[k]).not.toContain("motion-extra");
      expect(pr[k]).toContain("- emil: emil, read. (when the page moves)");
    }
    expect(pr.solo).toContain("U-SURF-DECIDE");
    expect(pr.solo).toContain("U-SURF-BUILD");
    expect(pr.solo).toContain(follow);
    expect(pr.builder).toContain(follow);
    // The planner gets Decide only, and better-ui's motion lines were all in Build.
    expect(pr.planner).toContain("U-SURF-DECIDE");
    expect(pr.planner).not.toContain(follow);
    // The Skills page and the detail view say so.
    const ui = pg.skills.find((s: any) => s.id === ids.ui);
    expect(ui.cut).toEqual([{ subject: "motion", lead: ids.emil, leadName: "emil", lines: 2 }]);
    expect(pg.skills.find((s: any) => s.id === ids.extra).given).toBe("led");
    const v = await view(off, ids.ui);
    expect(v.lines.build.map((l: any) => l.led_by)).toEqual([null, "emil", "emil"]);
    // What really reaches FRIDAY: without the two lines emil leads.
    expect(v.tokens).toBe(Math.round(("U-SURF-DECIDE".length + 3 + "U-SURF-BUILD".length + 3) / 4));
  });

  test("get_skill, get_design_rules and a build's HANDOFF.md carry the lead's lines only", async () => {
    const ui = await call(off, "get_skill", { name: "better-ui" });
    expect(ui.text).toContain("U-SURF-BUILD");
    expect(ui.text).not.toContain("U-MOTION");
    expect(ui.text).toContain("On motion, follow emil (read it with get_skill when the page moves).");
    const emil = await call(off, "get_skill", { name: "emil" });
    expect(emil.text).toContain("E-MOTION-BUILD");
    expect(emil.text).not.toContain("follow");
    const rules = await call(off, "get_design_rules", {});
    expect(rules.text).toContain("### better-ui");
    expect(rules.text).not.toContain("U-MOTION");
    expect(rules.text).toContain("On motion, follow emil (read it with get_skill).");
    expect(rules.text).not.toContain("motion-extra");
    const project = ((await (await off.send("POST", "/api/projects", { name: "Leads", brief: "A test." })).json()) as any).id;
    const made = await call(off, "make_sketch", { project, title: "Hand-off", html: "<!doctype html><html><body><h1>Hello there, a page</h1></body></html>" });
    expect(made.isError).toBe(false);
    const h = await call(off, "get_handoff", { project, sketch: made.first.sketch });
    expect(h.first.handoff).toContain("U-SURF-BUILD");
    expect(h.first.handoff).not.toContain("U-MOTION");
    expect(h.first.handoff).toContain("On motion, follow emil (read it with get_skill).");
    expect(h.first.handoff).not.toContain("X-MOTION-ONLY");
  }, 60_000);

  test("the designer picks the lead; turned off, Panel's pick takes over until it is back", async () => {
    let pg = (await (await off.send("PUT", "/api/skills/leads", { subject: "motion", id: ids.ui })).json()) as any;
    expect(pg.leads[0]).toMatchObject({ subject: "motion", id: ids.ui, by: "designer", panel: ids.emil });
    let pr = await prompts(off);
    expect(pr.builder).toContain("U-MOTION-1");
    const emil = await call(off, "get_skill", { name: "emil" });
    expect(emil.text).not.toContain("E-MOTION");
    expect(emil.text).toContain("E-GESTURE-BUILD");
    expect(emil.text).toContain("On motion, follow better-ui.");
    // Turned off: Panel's pick, while the designer's stays kept.
    await set(off, ids.ui, { on: false });
    pg = await page(off);
    expect(pg.leads[0]).toMatchObject({ id: ids.emil, by: "panel" });
    await set(off, ids.ui, { on: true });
    pg = await page(off);
    expect(pg.leads[0]).toMatchObject({ id: ids.ui, by: "designer" });
    // Given back to Panel.
    pg = (await (await off.send("PUT", "/api/skills/leads", { subject: "motion", id: null })).json()) as any;
    expect(pg.leads[0]).toMatchObject({ id: ids.emil, by: "panel" });
    pr = await prompts(off);
    expect(pr.builder).not.toContain("U-MOTION-1");
    expect((await off.send("PUT", "/api/skills/leads", { subject: "review", id: ids.ui })).status).toBe(400);
  });

  test("edits keep their subjects; a line without one takes the skill's main subject; part 3's plain edits still work", async () => {
    const v = (await (await off.send("PATCH", `/api/skills/${ids.ui}/read`, { build: "- motion: MY-MOTION-EDIT\n- MY-PLAIN-EDIT" })).json()) as any;
    expect(v.carries.build).toBe("- motion: MY-MOTION-EDIT\n- surfaces: MY-PLAIN-EDIT");
    expect(v.lines.build).toEqual([
      { subject: "motion", text: "MY-MOTION-EDIT", led_by: "emil" },
      { subject: "surfaces", text: "MY-PLAIN-EDIT", led_by: null },
    ]);
    const pr = await prompts(off);
    expect(pr.builder).toContain("- MY-PLAIN-EDIT");
    expect(pr.builder).not.toContain("MY-MOTION-EDIT");
    // An edit as part 3 kept it: plain text, no subjects.
    off.db.run("UPDATE skill_reads SET edits = ? WHERE ref_id = ?", [JSON.stringify({ build: "- OLD-PLAIN-EDIT\n- ANOTHER-OLD-ONE" }), ids.ui]);
    const old = await view(off, ids.ui);
    expect(old.lines.build.map((l: any) => [l.subject, l.text])).toEqual([["surfaces", "OLD-PLAIN-EDIT"], ["surfaces", "ANOTHER-OLD-ONE"]]);
    expect((await prompts(off)).builder).toContain("- OLD-PLAIN-EDIT\n- ANOTHER-OLD-ONE");
    await off.send("PATCH", `/api/skills/${ids.ui}/read`, { reset: true });
  });

  test("the new routes refuse a caller that isn't Panel", async () => {
    const away = { origin: "http://evil.example" };
    expect((await off.send("PUT", "/api/skills/leads", { subject: "motion", id: ids.ui }, away)).status).toBe(403);
    expect((await off.send("POST", "/api/skills/reads/unread", {}, away)).status).toBe(403);
  });

  test("with every skill off, FRIDAY's instructions are exactly what they are with no skills", async () => {
    await off.send("PUT", "/api/skills/leads", { subject: "motion", id: ids.ui });
    for (const id of [ids.emil, ids.ui, ids.extra]) await set(off, id, { on: false });
    expect(off.db.query("SELECT COUNT(*) n FROM skill_leads").get()).toEqual({ n: 1 });
    expect(await prompts(off)).toEqual(before);
  });
});

describe("Panel's pick", () => {
  const skill = (id: string, read: SkillRead): Skill => ({ id, on: true, when: "always", about: [], parsed: withRead(parseSkill(md(id, "x.")), read, null), text: "", forUse: read.for });
  const motion = (n: number) => Array.from({ length: n }, (_, i) => L("motion", `m${i}`));
  test("the skill whose main subject it is, before one with more lines on it", () => {
    const leads = pickLeads([skill("b", readOf("b", ["surfaces"], [], motion(5))), skill("a", readOf("a", ["motion"], [], motion(1)))], new Map(), new Map());
    expect(leads[0]).toMatchObject({ subject: "motion", id: "a", by: "panel" });
  });
  test("between several, the one with more lines on it", () => {
    const leads = pickLeads([skill("a", readOf("a", ["motion"], [], motion(2))), skill("b", readOf("b", ["motion"], motion(1), motion(2)))], new Map(), new Map());
    expect(leads[0]!.id).toBe("b");
  });
  test("then the one turned on first", () => {
    const both = [skill("a", readOf("a", ["motion"], [], motion(2))), skill("b", readOf("b", ["motion"], [], motion(2)))];
    expect(pickLeads(both, new Map(), new Map([["a", "2026-11-02"], ["b", "2026-11-01"]]))[0]!.id).toBe("b");
    expect(pickLeads(both, new Map(), new Map([["a", "2026-11-01"], ["b", "2026-11-02"]]))[0]!.id).toBe("a");
  });
  test("one skill alone on a subject has no lead; a skill only for real builds takes no part", () => {
    expect(pickLeads([skill("a", readOf("a", ["motion"], [], motion(2)))], new Map(), new Map())).toEqual([]);
    expect(pickLeads([skill("a", readOf("a", ["motion"], [], motion(2))), skill("b", readOf("b", ["motion"], [], motion(3), { for: "builds" }))], new Map(), new Map())).toEqual([]);
  });
});

// ---------- 4. Better reads ----------

describe("better reads", () => {
  test("a check that takes a number and comes back without one is dropped; line_length keeps its minimum", () => {
    const r = cleanRead({ checks: [{ name: "font_sizes", must: true }, { name: "overflow", must: false }, { name: "line_length", min: 45, must: false }, { name: "contrast", must: true }] });
    expect(r.checks).toEqual([{ name: "overflow", must: false }, { name: "line_length", min: 45, must: false }]);
  });
});
