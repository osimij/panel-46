// Skills that come as a pack, from a GitHub project or a dropped folder (skillpacks.ts):
// finding them, what is kept and left out, adding (never doubled, always off), get_skill's
// other files, a newer version, and that nothing reaches FRIDAY until a skill is turned on.
//
// GitHub is played by a small server in this process, with a made-up project in two
// versions, so these tests never touch the internet. Panel runs as a test companion with an
// empty library of its own (helpers.ts), pointed at it with PANEL_GITHUB_API and _RAW.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { startPanel, type TestPanel } from "./helpers.ts";

const ROOT = join(import.meta.dir, "..");
const skillMd = (name: string, line: string, body = "Do it well.") => `---\nname: ${name}\ndescription: ${line}\n---\n\n# ${name}\n\n${body}\n`;

// ---------- The made-up project, in two versions ----------

type Files = Record<string, string>;
const V1: Files = {
  "LICENSE": "MIT License\n\nCopyright (c) 2026 Maker\n\nPermission is hereby granted…\n",
  "README.md": "# Maker's skills\n",
  "skills/animate/SKILL.md": skillMd("animate", "Make things move well.", "See RECIPES.md for more."),
  "skills/animate/RECIPES.md": "# Recipes\n\nEase out on enter.\n",
  "skills/animate/scripts/run.js": "console.log('never run');\n",
  "skills/animate/settings.json": "{}\n",
  "skills/review/SKILL.md": skillMd("review-animations", "Review motion against standards."),
  "skills/review/STANDARDS.md": "# Standards\n",
  "skills/deep/nested/inner/Skill.md": skillMd("inner", "A skill far down, its file in another case."),
  "skills/big/SKILL.md": skillMd("big", "A skill with too much."),
  "skills/big/huge.md": "x".repeat(310 * 1024),
  ...Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`skills/big/notes/n${String(i).padStart(2, "0")}.md`, `note ${i}\n`])),
};
const V2: Files = { ...V1, "skills/animate/RECIPES.md": "# Recipes\n\nEase out on enter. Spring on drag.\n", "skills/sound/SKILL.md": skillMd("sound", "When to make a sound.") };
delete V2["skills/review/SKILL.md"];
delete V2["skills/review/STANDARDS.md"];
const EMPTY: Files = { "README.md": "# Nothing here\n", "src/index.js": "1\n" };

const sha = (s: string) => createHash("sha1").update(s).digest("hex");
const COMMITS: Record<string, { files: Files; date: string }> = {
  [sha("v1")]: { files: V1, date: "2026-11-01T10:00:00Z" },
  [sha("v2")]: { files: V2, date: "2026-11-09T10:00:00Z" },
  [sha("e1")]: { files: EMPTY, date: "2026-10-01T10:00:00Z" },
};
const fake = { main: sha("v1"), apiCalls: 0 };

const gh = Bun.serve({
  port: 0,
  fetch(req) {
    const u = new URL(req.url);
    const json = (x: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(x, { status, headers });
    if (u.pathname.startsWith("/api/")) {
      fake.apiCalls++;
      const p = u.pathname.slice(4).split("/").filter(Boolean).map(decodeURIComponent);
      if (p[1] === "limited") return json({ message: "API rate limit exceeded" }, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.parse("2026-11-11T15:42:00Z") / 1000)) });
      const repo = p[1] === "maker" && p[2] === "skills" ? "maker" : p[1] === "empty" && p[2] === "skills" ? "empty" : null;
      if (!repo) return json({ message: "Not Found" }, 404);
      const head = repo === "maker" ? fake.main : sha("e1");
      if (p.length === 3) return json({ default_branch: "main", full_name: `${p[1]}/${p[2]}`, owner: { login: p[1] }, license: repo === "maker" ? { name: "MIT License", spdx_id: "MIT" } : null });
      if (p[3] === "commits") {
        const ref = p.slice(4).join("/");
        const at = ref === "main" ? head : COMMITS[ref] ? ref : null;
        if (!at) return json({ message: "No commit found" }, 422);
        return json({ sha: at, commit: { committer: { date: COMMITS[at]!.date } } });
      }
      if (p[3] === "git" && p[4] === "trees") {
        const c = COMMITS[p[5]!];
        if (!c) return json({ message: "Not Found" }, 404);
        return json({ truncated: false, tree: Object.entries(c.files).map(([path, text]) => ({ path, type: "blob", size: Buffer.byteLength(text), sha: sha(text) })) });
      }
      return json({ message: "Not Found" }, 404);
    }
    if (u.pathname.startsWith("/raw/")) {
      const [, , , , at, ...rest] = u.pathname.split("/").map(decodeURIComponent);
      const text = COMMITS[at!]?.files[rest.join("/")];
      return text === undefined ? new Response("404: Not Found", { status: 404 }) : new Response(text);
    }
    return new Response("", { status: 404 });
  },
});

// ---------- Panel ----------

let p: TestPanel;
const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
  const res = await p.send("POST", path, body, headers);
  return { status: res.status, body: (await res.json()) as any };
};
const look = (url: string) => post("/api/skills/packs/look", { url });
const call = async (name: string, args: unknown) => {
  const res = await p.send("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, { accept: "application/json, text/event-stream" });
  const out = ((await res.json()) as any).result;
  return { isError: !!out.isError, text: out.content?.[0]?.text ?? "" };
};
const skillRefs = () => p.db.query<{ id: string; title: string; status: string; text: string }, []>("SELECT id, title, status, text FROM refs WHERE kind = 'skill' ORDER BY title").all();
const idOf = (title: string) => skillRefs().find((r) => r.title === title)!.id;

/** FRIDAY's instructions for each reader, as chat.ts writes them on the companion's library. */
async function prompts() {
  const code = `const { systemPrompt } = await import(${JSON.stringify(join(ROOT, "server/chat.ts"))}); console.log(JSON.stringify({ solo: systemPrompt("solo"), planner: systemPrompt("planner"), builder: systemPrompt("builder") })); process.exit(0);`;
  const proc = Bun.spawn(["bun", "-e", code], { cwd: ROOT, env: { ...process.env, PANEL_LIBRARY_DIR: p.dir, PANEL_PORT: "1" }, stdout: "pipe", stderr: "inherit" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return JSON.parse(out.trim().split("\n").pop()!) as Record<string, string>;
}

let before: Record<string, string>;
beforeAll(async () => {
  p = await startPanel({ PANEL_GITHUB_API: `http://127.0.0.1:${gh.port}/api`, PANEL_GITHUB_RAW: `http://127.0.0.1:${gh.port}/raw` });
  before = await prompts();
}, 30_000);
afterAll(async () => {
  await p?.stop();
  void gh.stop(true);
});

// ---------- Finding ----------

describe("finding the skills in a GitHub project", () => {
  test("skills at several depths, with the pack's author, licence and version", async () => {
    const r = await look("https://github.com/maker/skills");
    expect(r.status).toBe(200);
    const l = r.body;
    expect(l.name).toBe("maker/skills");
    expect(l.author).toBe("maker");
    expect(l.license).toBe("MIT License");
    expect(l.version).toEqual({ sha: sha("v1"), date: "2026-11-01T10:00:00Z" });
    expect(l.skills.map((s: any) => s.folder)).toEqual(["skills/animate", "skills/big", "skills/deep/nested/inner", "skills/review"]);
    const by = Object.fromEntries(l.skills.map((s: any) => [s.name, s]));
    expect(by.animate.line).toBe("Make things move well.");
    expect(by.inner.line).toContain("far down");
    expect(by["review-animations"].size).toBe("2 files, 1 KB");
    // Nothing is saved by looking.
    expect(skillRefs().length).toBe(0);
  });

  test("a folder link, and a link without https://", async () => {
    const a = (await look("github.com/maker/skills/tree/main/skills/animate")).body;
    expect(a.skills.map((s: any) => s.name)).toEqual(["animate"]);
    expect(a.link.path).toBe("skills/animate");
    const b = (await look("www.github.com/maker/skills.git")).body;
    expect(b.skills.length).toBe(4);
  });

  test("failures in plain words: not GitHub, no skills, not public, the hourly limit", async () => {
    const notGh = await look("https://example.com/maker/skills");
    expect(notGh.status).toBe(400);
    expect(notGh.body.error).toContain("isn't a link to a GitHub project");
    const none = await look("https://github.com/empty/skills");
    expect(none.status).toBe(404);
    expect(none.body.error).toContain("No skills found in empty/skills");
    const missing = await look("https://github.com/someone/private");
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("That project isn't public, or doesn't exist.");
    const badFolder = await look("https://github.com/maker/skills/tree/nope/x");
    expect(badFolder.status).toBe(404);
    const limited = await look("https://github.com/limited/skills");
    expect(limited.status).toBe(429);
    expect(limited.body.error).toContain("60 lookups an hour");
    expect(limited.body.error).toMatch(/Try again after \d\d:\d\d/);
  });
});

describe("what is kept and what is left out", () => {
  test("text is kept; scripts and settings are only named", async () => {
    const l = (await look("https://github.com/maker/skills")).body;
    const animate = l.skills.find((s: any) => s.name === "animate");
    expect(animate.kept.map((f: any) => f.path)).toEqual(["SKILL.md", "RECIPES.md"]);
    expect(animate.leftOut).toEqual([
      { path: "scripts/run.js", bytes: 26, why: "script" },
      { path: "settings.json", bytes: 3, why: "settings" },
    ]);
    expect(animate.leftOutLine).toBe("1 script and 1 settings file not kept");
  });

  test("a file over 300 KB is left out, and no skill keeps more than 40 files", async () => {
    const big = (await look("https://github.com/maker/skills")).body.skills.find((s: any) => s.name === "big");
    expect(big.kept.length).toBe(40);
    expect(big.kept[0].path).toBe("SKILL.md");
    expect(big.leftOut.find((f: any) => f.path === "huge.md").why).toBe("big");
    expect(big.leftOut.filter((f: any) => f.why === "many").length).toBe(6);
    expect(big.leftOutLine).toBe("1 file over 300 KB and 6 files past the 40-file limit not kept");
  });
});

// ---------- Adding ----------

const V1_LINK = { owner: "maker", repo: "skills", branch: "main", path: "" };

describe("adding", () => {
  test("adding some: every skill arrives off, with its files kept and the rest named", async () => {
    const r = await post("/api/skills/packs/add", { ...V1_LINK, sha: sha("v1"), folders: ["skills/animate"] });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ added: 1, updated: 0, same: 0 });
    const id = idOf("animate");
    const page = await p.get("/api/skills");
    expect(page.skills.find((s: any) => s.id === id).on).toBe(false);
    expect(page.on).toBe(0);
    const origin = await p.get(`/api/skills/${id}/origin`);
    expect(origin.pack.name).toBe("maker/skills");
    expect(origin.pack.license).toBe("MIT License");
    expect(origin.folder).toBe("skills/animate");
    expect(origin.version).toEqual({ sha: sha("v1"), date: "2026-11-01T10:00:00Z" });
    expect(origin.files).toEqual([{ path: "RECIPES.md", bytes: 30 }]);
    expect(origin.leftOutLine).toBe("1 script and 1 settings file not kept");
    expect((await p.get(`/api/skills/${id}/file?path=RECIPES.md`)).text).toContain("Ease out on enter.");
    // The script's text was never kept.
    expect(p.db.query("SELECT text FROM skill_files WHERE path = 'scripts/run.js'").get()).toEqual({ text: null });
    const lic = await (await p.send("GET", `/api/skills/packs/${origin.pack.id}/license`)).text();
    expect(lic).toContain("Permission is hereby granted");
  });

  test("adding all, then again: nothing is doubled", async () => {
    const calls = fake.apiCalls;
    const all = await post("/api/skills/packs/add", { ...V1_LINK, sha: sha("v1"), folders: ["skills/animate", "skills/big", "skills/deep/nested/inner", "skills/review"] });
    expect(all.body).toMatchObject({ added: 3, same: 1 });
    // What was looked at is what is added: no new questions to GitHub's API.
    expect(fake.apiCalls).toBe(calls);
    const again = await post("/api/skills/packs/add", { ...V1_LINK, sha: sha("v1"), folders: ["skills/animate", "skills/review"] });
    expect(again.body).toMatchObject({ added: 0, updated: 0, same: 2 });
    expect(skillRefs().map((r) => r.title)).toEqual(["animate", "big", "inner", "review-animations"]);
    expect(skillRefs().every((r) => r.status === "archived")).toBe(true);
    const l = (await look("https://github.com/maker/skills")).body;
    expect(l.skills.every((s: any) => s.have?.same)).toBe(true);
    const packs = await p.get("/api/skills/packs");
    expect(packs.length).toBe(1);
    expect(packs[0].skills.length).toBe(4);
  });

  test("with packs added and nothing on, FRIDAY's instructions are exactly as with no skills", async () => {
    const now = await prompts();
    expect(now).toEqual(before);
    expect(now.solo).not.toContain("designer-skills");
  });

  test("re-check on a pack's skill does not turn it into a failed save", async () => {
    const id = idOf("animate");
    const text = skillRefs().find((r) => r.id === id)!.text;
    expect((await p.send("POST", `/api/refs/${id}/retry`)).status).toBe(200);
    await Bun.sleep(300);
    const after = skillRefs().find((r) => r.id === id)!;
    expect(after.status).toBe("archived");
    expect(after.text).toBe(text);
  });
});

describe("get_skill and a skill's other files", () => {
  test("with a name: the skill and a list of its files; with file: that file; a wrong file: the list", async () => {
    await p.send("PATCH", `/api/skills/${idOf("animate")}`, { on: true, when: "asked" });
    const one = await call("get_skill", { name: "animate" });
    expect(one.text).toContain("See RECIPES.md for more.");
    expect(one.text).toContain("Read one with get_skill, its name and file:\n- RECIPES.md (30 bytes)");
    const file = await call("get_skill", { name: "animate", file: "./recipes.md" });
    expect(file.isError).toBe(false);
    expect(file.text).toContain("The file “RECIPES.md” of the designer's skill “animate”.");
    expect(file.text).toContain("Ease out on enter.");
    const wrong = await call("get_skill", { name: "animate", file: "scripts/run.js" });
    expect(wrong.isError).toBe(true);
    expect(wrong.text).toContain("has no file “scripts/run.js”. Its files:\n- SKILL.md (95 bytes), the skill as its author wrote it\n- RECIPES.md");
  });
});

// ---------- A newer version ----------

describe("a newer version", () => {
  test("the same version says so", async () => {
    const pack = (await p.get("/api/skills/packs"))[0];
    const calls = fake.apiCalls;
    const r = await post(`/api/skills/packs/${pack.id}/check`, {});
    expect(r.body).toEqual({ same: true, date: "2026-11-01T10:00:00Z" });
    // Up to date costs one question to GitHub, of the 60 an hour it allows.
    expect(fake.apiCalls - calls).toBe(1);
  });

  test("changed, new and gone skills; updating keeps what the designer set", async () => {
    await p.send("PATCH", `/api/skills/${idOf("review-animations")}`, { on: true, when: "always" });
    fake.main = sha("v2");
    const pack = (await p.get("/api/skills/packs"))[0];
    const r = (await post(`/api/skills/packs/${pack.id}/check`, {})).body;
    expect(r.same).toBe(false);
    expect(r.version.sha).toBe(sha("v2"));
    const by = Object.fromEntries(r.skills.map((s: any) => [s.name, s]));
    expect(by.animate.have.same).toBe(false);
    expect(by.big.have.same).toBe(true);
    expect(by.sound.have).toBeUndefined();
    expect(r.gone.map((g: any) => g.name)).toEqual(["review-animations"]);

    const up = await post("/api/skills/packs/add", { ...r.link, sha: r.version.sha, folders: ["skills/animate", "skills/sound"] });
    expect(up.body).toMatchObject({ added: 1, updated: 1 });
    const animate = idOf("animate");
    expect((await p.get(`/api/skills/${animate}/file?path=RECIPES.md`)).text).toContain("Spring on drag.");
    const page = await p.get("/api/skills");
    expect(page.skills.find((s: any) => s.id === animate)).toMatchObject({ on: true, when: "asked" });
    // Gone from the project: kept, marked, and still set as it was.
    const review = idOf("review-animations");
    expect(page.skills.find((s: any) => s.id === review)).toMatchObject({ on: true, when: "always" });
    const packs = await p.get("/api/skills/packs");
    expect(packs[0].gone).toEqual([review]);
    expect(packs[0].version.sha).toBe(sha("v2"));
    expect((await p.get(`/api/skills/${review}/origin`)).gone).toBe(true);
    expect((await post(`/api/skills/packs/${pack.id}/check`, {})).body.same).toBe(true);
    await p.send("PATCH", `/api/skills/${review}`, { on: false });
  });
});

// ---------- A dropped folder ----------

describe("a dropped folder", () => {
  test("a folder with one SKILL.md is one skill", async () => {
    const folder = {
      name: "make-better",
      files: [
        { path: "SKILL.md", bytes: 0, text: skillMd("make-better", "Small things that make it feel better.") },
        { path: "examples.md", bytes: 0, text: "# Examples\n" },
        { path: "tool.py", bytes: 120 },
      ],
    };
    const l = (await post("/api/skills/packs/look", { folder })).body;
    expect(l.source).toBe("folder");
    expect(l.name).toBe("make-better");
    expect(l.skills).toHaveLength(1);
    expect(l.skills[0]).toMatchObject({ folder: "", name: "make-better", size: "2 files, 1 KB", leftOutLine: "1 script not kept" });
    const r = (await post("/api/skills/packs/add", { folder, folders: [""] })).body;
    expect(r.added).toBe(1);
    const origin = await p.get(`/api/skills/${idOf("make-better")}/origin`);
    expect(origin.pack.source).toBe("folder");
    expect(origin.files.map((f: any) => f.path)).toEqual(["examples.md"]);
  });

  test("a one line written as a folded YAML block (>-) reads as plain words", async () => {
    const folder = { name: "folded", files: [{ path: "SKILL.md", bytes: 0, text: "---\nname: folded\ndescription: >-\n  Design principles that\n  read as one line.\n---\n\n# Folded\n" }] };
    const l = (await post("/api/skills/packs/look", { folder })).body;
    expect(l.skills[0].line).toBe("Design principles that read as one line.");
  });

  test("a folder of folders is a pack named after it; dropped again, changed skills are marked", async () => {
    const files = (b: string) => [
      { path: "one/SKILL.md", bytes: 0, text: skillMd("one", "The first.") },
      { path: "two/SKILL.md", bytes: 0, text: skillMd("two", "The second.", b) },
      { path: "node_modules/x/SKILL.md", bytes: 0, text: skillMd("x", "Never.") },
      { path: "../escape/SKILL.md", bytes: 0, text: skillMd("escape", "Never.") },
    ];
    const l = (await post("/api/skills/packs/look", { folder: { name: "kit", files: files("A") } })).body;
    expect(l.skills.map((s: any) => s.name)).toEqual(["one", "two"]);
    expect((await post("/api/skills/packs/add", { folder: { name: "kit", files: files("A") }, folders: ["one", "two"] })).body.added).toBe(2);
    const again = (await post("/api/skills/packs/look", { folder: { name: "kit", files: files("B") } })).body;
    expect(again.skills.map((s: any) => s.have.same)).toEqual([true, false]);
    const up = (await post("/api/skills/packs/add", { folder: { name: "kit", files: files("B") }, folders: ["one", "two"] })).body;
    expect(up).toMatchObject({ added: 0, updated: 1, same: 1 });
    expect(skillRefs().filter((r) => r.title === "two").length).toBe(1);
  });
});

describe("only Panel may use these routes", () => {
  test("looking, adding, checking and reading are refused from elsewhere", async () => {
    const away = { origin: "http://evil.example" };
    expect((await post("/api/skills/packs/look", { url: "https://github.com/maker/skills" }, away)).status).toBe(403);
    expect((await post("/api/skills/packs/add", { ...V1_LINK, sha: sha("v1"), folders: ["skills/animate"] }, away)).status).toBe(403);
    const pack = (await p.get("/api/skills/packs"))[0];
    expect((await post(`/api/skills/packs/${pack.id}/check`, {}, away)).status).toBe(403);
    expect((await p.send("GET", `/api/skills/${idOf("animate")}/origin`, undefined, away)).status).toBe(403);
  });
});
