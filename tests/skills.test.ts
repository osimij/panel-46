// The designer's skills: reading a skill file, what FRIDAY is given from it, the Skills page's
// routes, get_skill, and the checks Panel measures in a rendered sketch.
//
// Reading and the instructions block are plain functions (skills.ts never opens a library).
// Everything that keeps settings runs on a test companion with an empty library of its own
// (helpers.ts), never in this process: bun runs every test file in one process, and another
// file already opens a library through db.ts. The checks need Chrome, as the sketch tests do.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fitBudget, parseSkill, skillsBlock, SKILL_BUDGET, type Skill } from "../server/skills.ts";
import { startPanel, type TestPanel } from "./helpers.ts";

const ROOT = join(import.meta.dir, "..");
const TYPOGRAPHY = readFileSync(join(ROOT, "docs/skills/typography.md"), "utf8");
const MOTION = readFileSync(join(ROOT, "docs/skills/motion.md"), "utf8");
const PLAIN = `---\nname: Plain notes\ndescription: A skill with no Decide or Build.\n---\n\nAlways use real words. Never lorem ipsum.\n\n- Short lines.\n`;

const skill = (id: string, text: string, o: Partial<Skill> = {}): Skill => ({ id, on: true, when: "always", about: [], parsed: parseSkill(text), text, ...o });

describe("reading a skill", () => {
  const t = parseSkill(TYPOGRAPHY);

  test("its name, its line and its three parts", () => {
    expect(t.name).toBe("Typography");
    expect(t.line).toContain("How to choose and set type");
    expect(t.decide).toContain("**Families.**");
    expect(t.decide).not.toContain("## Build");
    expect(t.build).toContain("max-width: 65ch");
    expect(t.build).not.toContain("line_length");
    expect(t.whole).toBe(false);
    // Look for stays in the file, for get_skill, and out of the parts.
    expect(t.decide + t.build).not.toContain("Look for");
  });

  test("the checks with their numbers and (breaks)", () => {
    const by = Object.fromEntries(t.checks.map((c) => [c.name, c]));
    expect(by.line_length).toEqual({ name: "line_length", min: 45, max: 85, level: "check" });
    expect(by.font_sizes).toEqual({ name: "font_sizes", max: 7, level: "check" });
    expect(by.font_families).toEqual({ name: "font_families", max: 2, level: "check" });
    expect(by.line_height).toEqual({ name: "line_height", min: 1.35, max: 1.7, level: "check" });
    expect(by.contrast).toEqual({ name: "contrast", min: 4.5, level: "check" });
    expect(by.small_text).toEqual({ name: "small_text", min: 12, level: "check" });
    expect(by.overflow).toEqual({ name: "overflow", level: "breaks" });
    expect(parseSkill(MOTION).checks).toEqual([{ name: "reduced_motion", level: "check" }]);
  });

  test("check names Panel doesn't know are kept apart", () => {
    const p = parseSkill(`---\nname: X\n---\n### CHECK\n- vertical_rhythm: 4\n- contrast: 7 (breaks)\n- Make it feel calm\n`);
    expect(p.checks).toEqual([{ name: "contrast", min: 7, level: "breaks" }]);
    expect(p.unknown).toEqual(["vertical_rhythm", "Make it feel calm"]);
  });

  test("a file with none of the headings is given whole", () => {
    const p = parseSkill(PLAIN);
    expect(p.whole).toBe(true);
    expect(p.decide).toBe("");
    expect(p.build).toBe("");
    expect(p.body).toContain("Always use real words.");
    expect(p.checks).toEqual([]);
  });

  test("headings in a code block are not sections", () => {
    const p = parseSkill("## Build\n```md\n## Check\n- overflow\n```\nDone.\n");
    expect(p.build).toContain("Done.");
    expect(p.checks).toEqual([]);
  });
});

describe("what FRIDAY is given", () => {
  const typo = skill("t", TYPOGRAPHY);

  test("one model gets Decide and Build, the planner only Decide, the builder only Build", () => {
    const solo = skillsBlock("solo", [typo]), planner = skillsBlock("planner", [typo]), builder = skillsBlock("builder", [typo]);
    for (const b of [solo, planner, builder]) {
      expect(b.startsWith("<designer-skills>\nSkills are craft knowledge")).toBe(true);
      expect(b).toContain("the designer's rules come first, then a project's locked decisions, then these skills, then any reference");
    }
    expect(solo).toContain("**Families.**");
    expect(solo).toContain("max-width: 65ch");
    expect(planner).toContain("**Families.**");
    expect(planner).not.toContain("max-width: 65ch");
    expect(builder).not.toContain("**Families.**");
    expect(builder).toContain("max-width: 65ch");
    // Check and Look for are never in the instructions.
    expect(solo).not.toContain("line_length");
    expect(solo).not.toContain("Does the headline break");
  });

  test("a skill that is off, or not Always, is not in the block; the others are listed at the end", () => {
    expect(skillsBlock("solo", [skill("t", TYPOGRAPHY, { on: false })])).toBe("");
    const b = skillsBlock("solo", [skill("m", MOTION, { when: "applies", about: ["motion"] }), skill("p", PLAIN, { when: "asked" })]);
    expect(b).not.toContain("Animate `transform`");
    expect(b).not.toContain("Always use real words");
    expect(b).toContain("get_skill");
    expect(b).toContain("- Motion: How things move on a page");
    expect(b).toContain("(when the page moves)");
    expect(b).toContain("- Plain notes: A skill with no Decide or Build. (when the designer asks for it");
  });

  test("a file with no headings is given whole, as Build", () => {
    const p = skill("p", PLAIN);
    expect(skillsBlock("solo", [p])).toContain("Always use real words.");
    expect(skillsBlock("builder", [p])).toContain("Always use real words.");
    // The planner hears the builder follows it.
    expect(skillsBlock("planner", [p])).not.toContain("Always use real words.");
    expect(skillsBlock("planner", [p])).toContain("the builder follows it");
  });

  test("past the budget, the largest drop to the list", () => {
    const big = skill("big", `---\nname: Huge\ndescription: Very long.\n---\n## Build\n${"Write every line with care. ".repeat(700)}`);
    expect(fitBudget([big, typo]).dropped).toEqual(new Set(["big"]));
    const b = skillsBlock("solo", [big, typo]);
    expect(b.length).toBeLessThan(SKILL_BUDGET);
    expect(b).toContain("**Families.**");
    expect(b).toContain("- Huge: Very long. (for everything you make, but too long to give every time");
  });

  test("with no skill on, nothing at all", () => {
    expect(skillsBlock("solo", [])).toBe("");
    expect(skillsBlock("builder", [skill("t", TYPOGRAPHY, { on: false })])).toBe("");
  });
});

// ---------- On a companion: settings, routes, tools, instructions, checks ----------

let p: TestPanel;
let project: string;
const ids = { typography: "5a11000000000001", motion: "5a11000000000002", phone: "5a11000000000003" };
const PHONE = `---\nname: Phone\ndescription: Things to tap on a phone.\n---\n## Check\n- tap_targets: 44\n`;

const call = async (name: string, args: unknown) => {
  const res = await p.send("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, { accept: "application/json, text/event-stream" });
  const out = ((await res.json()) as any).result;
  const first = out.content?.[0]?.type === "text" ? out.content[0].text : "";
  let json: any = null;
  try { json = JSON.parse(first); } catch { /* plain text */ }
  return { ...out, text: first, first: json };
};
const set = async (id: string, patch: unknown) => (await p.send("PATCH", `/api/skills/${id}`, patch)).json() as Promise<any>;

/** FRIDAY's instructions for each reader, as chat.ts writes them on this companion's library. */
async function prompts(): Promise<Record<"solo" | "planner" | "builder", string>> {
  const code = `const { systemPrompt } = await import(${JSON.stringify(join(ROOT, "server/chat.ts"))}); console.log(JSON.stringify({ solo: systemPrompt("solo"), planner: systemPrompt("planner"), builder: systemPrompt("builder"), none: systemPrompt() })); process.exit(0);`;
  const proc = Bun.spawn(["bun", "-e", code], { cwd: ROOT, env: { ...process.env, PANEL_LIBRARY_DIR: p.dir, PANEL_PORT: "1" }, stdout: "pipe", stderr: "inherit" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  const j = JSON.parse(out.trim().split("\n").pop()!);
  expect(j.none).toBe(j.solo);
  return j;
}

beforeAll(async () => {
  p = await startPanel();
  const at = "2026-11-11T00:00:00.000Z";
  for (const [key, text] of [["typography", TYPOGRAPHY], ["motion", MOTION], ["phone", PHONE]] as const) {
    p.db.run("INSERT INTO refs (id, kind, title, text, note, status, created_at, updated_at) VALUES (?, 'skill', ?, ?, '', 'archived', ?, ?)", [ids[key], parseSkill(text).name, text, at, at]);
  }
  project = ((await (await p.send("POST", "/api/projects", { name: "Skills test", brief: "A test." })).json()) as any).id;
}, 30_000);
afterAll(async () => {
  await p?.stop();
});

describe("the routes", () => {
  test("listing: every skill, off at first, with what Panel read", async () => {
    const page = await p.get("/api/skills");
    expect(page.on).toBe(0);
    expect(page.tokens).toBe(0);
    const t = page.skills.find((s: any) => s.id === ids.typography);
    expect(t).toMatchObject({ name: "Typography", on: false, when: "always", given: "off", whole: false });
    expect(t.checks.map((c: any) => c.name)).toEqual(["line_length", "font_sizes", "font_families", "line_height", "contrast", "small_text", "overflow"]);
    expect(t.checks.find((c: any) => c.name === "line_length").plain).toBe("Lines of running text between 45 and 85 characters");
    expect(t.tokens).toBeGreaterThan(300);
  });

  test("refused from outside Panel", async () => {
    expect((await p.send("GET", "/api/skills", undefined, { origin: "https://example.com" })).status).toBe(403);
    expect((await p.send("PATCH", `/api/skills/${ids.typography}`, { on: true }, { origin: "https://example.com" })).status).toBe(403);
    expect((await p.get("/api/skills")).on).toBe(0);
  });

  test("turning on, and changing when", async () => {
    const on = await set(ids.typography, { on: true });
    expect(on).toMatchObject({ on: true, when: "always", given: "every" });
    expect(on.gets).toContain("Decide and Build are in FRIDAY's instructions on every message");
    const applies = await set(ids.motion, { on: true, when: "applies" });
    // Its first "When it applies" starts from a guess at what it's about.
    expect(applies).toMatchObject({ on: true, when: "applies", about: ["motion"], given: "listed" });
    expect(applies.gets).toBe("FRIDAY reads it when the page moves.");
    const page = await p.get("/api/skills");
    expect(page.on).toBe(2);
    expect(page.tokens).toBe(on.tokens);
    // Back off for what follows.
    await set(ids.typography, { on: false });
    await set(ids.motion, { on: false });
    expect((await p.send("PATCH", "/api/skills/0000000000000000", { on: true })).status).toBe(404);
  });
});

describe("FRIDAY's instructions", () => {
  test("with no skill on, every reader's are the same and carry nothing of skills", async () => {
    const j = await prompts();
    expect(j.planner).toBe(j.solo);
    expect(j.builder).toBe(j.solo);
    expect(j.solo).not.toContain("designer-skills");
    expect(j.solo).not.toContain("skill_checks");
  });

  test("with one on, each reader gets its part, and taking the skills out leaves the old text exactly", async () => {
    const off = (await prompts()).solo;
    await set(ids.typography, { on: true });
    const j = await prompts();
    expect(j.solo).toContain("**Families.**");
    expect(j.solo).toContain("max-width: 65ch");
    expect(j.planner).not.toContain("max-width: 65ch");
    expect(j.builder).not.toContain("**Families.**");
    for (const text of [j.solo, j.planner, j.builder]) {
      expect(text).toContain("skill_checks");
      // After the rules, at the very end.
      expect(text.indexOf("<designer-skills>")).toBeGreaterThan(text.indexOf("</designer-rules>"));
      const without = text.replace(/\n- With the designer's skills on, the answer also carries skill_checks:[^\n]*/, "").replace(/\n\n<designer-skills>[\s\S]*<\/designer-skills>$/, "");
      expect(without).toBe(off);
    }
    await set(ids.typography, { on: false });
  }, 30_000);
});

describe("get_skill", () => {
  test("with none on, says so; with a name, the whole skill; without, the list", async () => {
    expect((await call("get_skill", {})).text).toBe("The designer hasn't turned on any skills.");
    expect((await call("get_skill", { name: "Typography" })).isError).toBe(true);
    await set(ids.typography, { on: true });
    await set(ids.motion, { on: true, when: "applies" });
    const list = (await call("get_skill", {})).text;
    expect(list).toContain("- Typography: How to choose and set type");
    expect(list).toContain("- Motion: How things move on a page");
    expect(list).toContain("(when the page moves)");
    // Its own headings: the short version first (Decide, Build, what Panel checks, its files)…
    const one = (await call("get_skill", { name: "typography" })).text;
    expect(one).toContain("This is its short version: the Decide, Build and Check parts of its file.");
    expect(one).toContain("Build:\n- Sizes, line heights and families are knobs");
    expect(one).toContain("Panel checks every sketch for:\n- Lines of running text between 45 and 85 characters");
    expect(one).toContain("- SKILL.md (3 KB), the skill as its author wrote it");
    expect(one).not.toContain("## Look for");
    // …and the file as written when asked for.
    const whole = (await call("get_skill", { name: "typography", file: "SKILL.md" })).text;
    expect(whole).toContain("## Look for");
    expect(whole).toContain("- line_length: 45–85");
    // get_design_rules gives the Always ones' Decide and Build after the rules.
    const rules = (await call("get_design_rules", {})).text;
    expect(rules).toContain("## The designer's skills");
    expect(rules).toContain("### Typography");
    expect(rules).not.toContain("### Motion");
    await set(ids.typography, { on: false });
    await set(ids.motion, { on: false });
  });
});

// ---------- The checks, measured in Chrome ----------

const chrome = ["/Applications/Google Chrome.app", "/Applications/Chromium.app", "/Applications/Brave Browser.app", "/Applications/Microsoft Edge.app"].some((x) => existsSync(x));
const withChrome = chrome ? test : test.skip;

const PAGE = (css: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Test</title><style>:root{--bg:#fff;--ink:#1a1a1a}body{margin:0;font:16px/1.5 Georgia,serif;background:var(--bg);color:var(--ink)}main{padding:40px}p{max-width:60ch}${css}</style></head><body><main>${body}</main></body></html>`;
const WORDS = "Справки и документы приходят в один кабинет, где их можно подписать, отправить и найти через год без звонков и очередей. ";
const para = (n = 4) => `<p>${WORDS.repeat(n)}</p>`;

let n = 0;
async function sketch(html: string, device?: string) {
  const made = await call("make_sketch", { project, title: `Check ${++n}`, html, ...(device ? { device } : {}) });
  expect(made.isError).toBeFalsy();
  return made.first as { sketch: string; skill_checks?: { rule: string; check: string; level: string; what: string; where?: string[] }[]; skills_that_apply?: { name: string }[] };
}
const checks = (a: Awaited<ReturnType<typeof sketch>>) => (a.skill_checks ?? []).map((f) => f.check);

describe("the checks", () => {
  withChrome("with no skill on, a sketch's answer has no skill_checks, even on a page that would trip them", async () => {
    const a = await sketch(PAGE("p{max-width:none;font-size:10px;color:#ccc}", para(8)));
    expect("skill_checks" in a).toBe(false);
    expect("skills_that_apply" in a).toBe(false);
  }, 60_000);

  withChrome("typography on: each check trips on a page made to, and not on one made well", async () => {
    await set(ids.typography, { on: true });
    const cases: [string, string, string][] = [
      // [check, a page that trips it, a page that doesn't]
      ["line_length", PAGE("p{max-width:1100px}", para(6)), PAGE("", para(6))],
      ["line_height", PAGE("p{line-height:1.05}", para(4)), PAGE("p{line-height:1.5}", para(4))],
      ["font_sizes", PAGE("", [10, 12, 13, 14, 16, 18, 20, 24, 32].map((s) => `<div style="font-size:${s}px">Размер ${s}</div>`).join("")), PAGE("", `<h1 style="font-size:40px">Заголовок</h1>${para(2)}<small style="font-size:13px">Подпись</small>`)],
      ["font_families", PAGE("", `<h1 style="font-family:Arial">Заголовок</h1>${para(2)}<p style="font-family:'Courier New'">Третья гарнитура</p>`), PAGE("", `<h1 style="font-family:Arial">Заголовок</h1>${para(2)}<pre><code style="font-family:Menlo">const a = 1</code></pre><span style="font-family:'Courier New',monospace">12 450 ₽</span>`)],
      ["contrast", PAGE("p{color:#bbb}", para(2)), PAGE("", `${para(2)}<div style="position:relative;height:200px"><img alt="" style="position:absolute;inset:0;width:100%;height:100%" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10'%3E%3Crect width='10' height='10' fill='%23eee'/%3E%3C/svg%3E"><p style="position:relative;color:#ddd">Текст поверх картинки не судится</p></div>`)],
      ["small_text", PAGE("", `${para(2)}<p style="font-size:10px">Мелкий шрифт договора</p>`), PAGE(".av{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#e8e8e8;color:#888;font-size:10px}", `${para(2)}<p style="font-size:13px">Подпись под текстом</p><span class="av">MK</span> <span class="av">JS</span>`)],
      ["overflow", PAGE("", `${para(1)}<div style="width:2400px;height:40px;background:#eee">Широкая полоса</div>`), PAGE("body{overflow-x:hidden}.blob{position:absolute;right:-300px;top:0;width:600px;height:600px;border-radius:50%;background:#f3f3f3}", `<div class="blob"></div>${para(2)}`)],
    ];
    for (const [check, bad, good] of cases) {
      const tripped = await sketch(bad);
      expect({ check, found: checks(tripped).includes(check) }).toEqual({ check, found: true });
      const f = tripped.skill_checks!.find((x) => x.check === check)!;
      expect(f.rule).toBe("Typography");
      expect(f.level).toBe(check === "overflow" ? "breaks" : "check");
      const clean = await sketch(good);
      expect({ check, found: checks(clean).includes(check) }).toEqual({ check, found: false });
    }
    await set(ids.typography, { on: false });
  }, 240_000);

  withChrome("motion when it applies: listed for a page that moves, with reduced_motion checked", async () => {
    await set(ids.motion, { on: true, when: "applies", about: ["motion"] });
    const still = await sketch(PAGE("", para(2)));
    expect("skills_that_apply" in still).toBe(false);
    expect("skill_checks" in still).toBe(false);
    const MOVE = "@keyframes rise{from{transform:translateY(20px);opacity:0}to{transform:none;opacity:1}}h1{animation:rise .6s ease-out both}";
    const moving = await sketch(PAGE(MOVE, `<h1>Заголовок</h1>${para(2)}`));
    expect(moving.skills_that_apply?.map((x) => x.name)).toEqual(["Motion"]);
    expect(checks(moving)).toEqual(["reduced_motion"]);
    const careful = await sketch(PAGE(`${MOVE}@media (prefers-reduced-motion: reduce){h1{animation:none}}`, `<h1>Заголовок</h1>${para(2)}`));
    expect(careful.skills_that_apply?.map((x) => x.name)).toEqual(["Motion"]);
    expect(checks(careful)).toEqual([]);
    // A colour change on hover isn't motion.
    const hover = await sketch(PAGE("a{transition:color .2s}", `<a href="#">Ссылка</a>${para(1)}`));
    expect("skills_that_apply" in hover).toBe(false);
    await set(ids.motion, { on: false });
  }, 120_000);

  withChrome("tap targets: only on a phone, only for small things to tap", async () => {
    await set(ids.phone, { on: true });
    const btn = (s: number) => PAGE("", `${para(1)}<button style="width:${s}px;height:${s}px;padding:0">×</button><p>Текст со <a href="#">ссылкой внутри</a> предложения.</p>`);
    expect(checks(await sketch(btn(24), "phone"))).toEqual(["tap_targets"]);
    expect(checks(await sketch(btn(48), "phone"))).toEqual([]);
    expect(checks(await sketch(btn(24)))).toEqual([]);
    await set(ids.phone, { on: false });
  }, 90_000);

  withChrome("get_sketch measures a sketch made before the skill was on, and drops the checks when it's off again", async () => {
    const before = await sketch(PAGE("p{max-width:1100px}", para(6)));
    expect("skill_checks" in before).toBe(false);
    await set(ids.typography, { on: true });
    const read = await call("get_sketch", { project, sketch: before.sketch, html: false, pictures: false });
    expect(checks(read.first)).toContain("line_length");
    await set(ids.typography, { on: false });
    const again = await call("get_sketch", { project, sketch: before.sketch, html: false, pictures: false });
    expect("skill_checks" in again.first).toBe(false);
  }, 60_000);
});
