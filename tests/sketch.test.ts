// Sketches are rendered in the Chrome on this Mac, so these run only where Chrome is installed.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { startPanel, type TestPanel } from "./helpers.ts";

const chrome = ["/Applications/Google Chrome.app", "/Applications/Chromium.app", "/Applications/Brave Browser.app", "/Applications/Microsoft Edge.app"].some((p) => existsSync(p));
const withChrome = chrome ? test : test.skip;

let p: TestPanel;
let project: string;
const tool = async (name: string, args: unknown) => {
  const res = await p.send("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, { accept: "application/json, text/event-stream" });
  const out = ((await res.json()) as any).result;
  return { ...out, first: out.content?.[0]?.type === "text" ? JSON.parse(out.content[0].text) : null };
};

beforeAll(async () => {
  p = await startPanel();
  project = ((await (await p.send("POST", "/api/projects", { name: "Sketch test", brief: "A test." })).json()) as any).id;
});
afterAll(async () => {
  await p?.stop();
});

const PAGE = (css: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Test</title><style>:root{--bg:#f4f1ea;--ink:#1a1a1a;--accent:#c8472b;--radius:16px}body{margin:0;font-family:system-ui;background:var(--bg);color:var(--ink)}${css}</style></head><body>${body}</body></html>`;

withChrome("a sketch comes back with pictures and with what breaks the designer's rules", async () => {
  const made = await tool("make_sketch", {
    project,
    title: "Breaks rules",
    html: PAGE(
      ".logo{letter-spacing:.4em;font-size:14px}.card{border-radius:var(--radius);background:#fff;padding:40px;margin:40px;width:400px}",
      `<nav style="padding:24px"><span class="logo">H U J J A T</span></nav><div class="card">Карточка</div>`,
    ),
  });
  expect(made.isError).toBeFalsy();
  expect(made.content.some((c: any) => c.type === "image")).toBe(true);
  const rules = (made.first.rule_checks ?? []).map((r: any) => `${r.rule}:${r.level}`);
  expect(rules).toContain("Wordmark:breaks");
  expect(rules).toContain("Corners:breaks");
}, 60_000);

withChrome("a sketch that follows them comes back clean", async () => {
  const made = await tool("make_sketch", {
    project,
    title: "Follows rules",
    html: PAGE(
      ".card{border-radius:var(--radius);corner-shape:squircle;background:#fff;padding:40px;margin:40px;width:400px}",
      `<nav style="padding:24px"><span>Hujjat</span></nav><div class="card">Карточка</div>`,
    ),
  });
  expect(made.first.rule_checks?.filter((r: any) => r.level === "breaks") ?? []).toEqual([]);
}, 60_000);

withChrome("words edited in the studio are kept as a new version", async () => {
  const made = await tool("make_sketch", { project, title: "Words", html: PAGE("", `<main><h1>Документы без очередей</h1><p>Подпись</p></main>`) });
  const id = made.first.sketch ?? made.first.id;
  const res = await p.send("POST", `/api/projects/${project}/sketches/${id}/text`, {
    path: "body > main:nth-child(1) > h1:nth-child(1)", before: "Документы без очередей", after: "Справки за минуту",
    before_text: "Документы без очередей", after_text: "Справки за минуту", from_version: 1,
  });
  expect(res.status).toBe(200);
  expect((await res.json()).version).toBe(2);
  const page = await (await fetch(`${p.url}/sketches/${project}/${id}/v2.html`)).text();
  expect(page).toContain("<h1>Справки за минуту</h1>");
  expect(page).toContain("<p>Подпись</p>");
}, 60_000);

withChrome("several word changes and a knob are saved as one version", async () => {
  const made = await tool("make_sketch", { project, title: "Many words", html: PAGE(":root{--accent:#111}", `<main><h1>Один</h1><p>Два</p><p>Три</p></main>`) });
  const id = made.first.sketch ?? made.first.id;
  const edit = (n: number, before: string, after: string) => ({ path: `body > main:nth-child(1) > ${n === 1 ? "h1" : "p"}:nth-child(${n})`, before, after, before_text: before, after_text: after });
  const edits = [edit(1, "Один", "One"), edit(2, "Два", "Two"), edit(3, "Три", "Three")];
  // Checking writes nothing.
  const checked = await p.send("POST", `/api/projects/${project}/sketches/${id}/changes`, { edits, from_version: 1, check: true });
  expect(checked.status).toBe(200);
  expect((await (await p.send("GET", `/api/projects/${project}/sketches/${id}`)).json()).versions.length).toBe(1);
  // Words that aren't in the file are turned down.
  const wrong = await p.send("POST", `/api/projects/${project}/sketches/${id}/changes`, { edits: [edit(2, "Нет", "No")], from_version: 1, check: true });
  expect(wrong.status).toBe(400);
  // Save: all of it, one new version.
  const res = await p.send("POST", `/api/projects/${project}/sketches/${id}/changes`, { edits, vars: { "--accent": "#e2372b" }, from_version: 1 });
  expect(res.status).toBe(200);
  expect((await res.json()).version).toBe(2);
  const page = await (await fetch(`${p.url}/sketches/${project}/${id}/v2.html`)).text();
  for (const w of ["<h1>One</h1>", "<p>Two</p>", "<p>Three</p>", "#e2372b"]) expect(page).toContain(w);
  expect((await (await p.send("GET", `/api/projects/${project}/sketches/${id}`)).json()).versions.length).toBe(2);
}, 60_000);

withChrome("an older version is brought back as a new one, byte for byte, and every version says when, who and what", async () => {
  const made = await tool("make_sketch", { project, title: "Bring back", tries: "A first try", html: PAGE("", `<main><h1>Первый</h1></main>`) });
  const id = made.first.sketch ?? made.first.id;
  const words = await p.send("POST", `/api/projects/${project}/sketches/${id}/changes`, {
    edits: [{ path: "body > main:nth-child(1) > h1:nth-child(1)", before: "Первый", after: "Второй", before_text: "Первый", after_text: "Второй" }], from_version: 1,
  });
  expect((await words.json()).version).toBe(2);
  const res = await p.send("POST", `/api/projects/${project}/sketches/${id}/restore`, { version: 1 });
  expect(res.status).toBe(200);
  expect((await res.json()).version).toBe(3);
  const file = (v: number) => fetch(`${p.url}/sketches/${project}/${id}/v${v}.html`).then((r) => r.arrayBuffer()).then((b) => Buffer.from(b));
  // Served pages carry the kit, so compare the files on disk.
  const { readFileSync } = await import("node:fs");
  const onDisk = (v: number) => readFileSync(`${p.dir}/projects/${project}/sketches/${id}/v${v}.html`);
  expect(onDisk(3).equals(onDisk(1))).toBe(true);
  expect((await file(3)).length).toBeGreaterThan(0);
  const info = await (await p.send("GET", `/api/projects/${project}/sketches/${id}`)).json();
  expect(info.versions.length).toBe(3);
  for (const v of info.versions) expect(Number.isNaN(Date.parse(v.at))).toBe(false);
  expect(info.versions.map((v: any) => v.by)).toEqual(["friday", "you", "you"]);
  expect(info.versions.map((v: any) => v.what)).toEqual(["A first try", "Changed the words to “Второй”", "Brought back v1"]);
  // The canvas shows the new one.
  expect((await p.get(`/api/projects/${project}`)).nodes.find((n: any) => n.id === id).data.version).toBe(3);
  // A version that isn't there is refused, in plain words.
  const none = await p.send("POST", `/api/projects/${project}/sketches/${id}/restore`, { version: 9 });
  expect(none.status).toBe(400);
  expect((await none.json()).error).toBe("That sketch has no version 9 to bring back.");
}, 90_000);

withChrome("a part's look and a part taken out are saved with the words as one version", async () => {
  const made = await tool("make_sketch", { project, title: "Parts", html: PAGE("", `<main><h1 class="t">Заголовок</h1><p class="m">Серые слова</p><div class="c">Лишнее</div><p>Последний</p></main>`) });
  const id = made.first.sketch ?? made.first.id;
  const at = (n: number, tag: string) => `body > main:nth-child(1) > ${tag}:nth-child(${n})`;
  const changes = {
    styles: [{ path: at(2, "p"), cls: "m", id: "", text: "Серые слова", props: { "font-weight": "300", color: "#6b6f76" } }],
    removes: [{ path: at(3, "div"), cls: "c", id: "", text: "Лишнее" }],
    edits: [{ path: at(4, "p"), before: "Последний", after: "Last", before_text: "Последний", after_text: "Last" }],
    from_version: 1,
  };
  // A part the file doesn't have there is turned down, in plain words, and nothing is written.
  const wrong = await p.send("POST", `/api/projects/${project}/sketches/${id}/changes`, { ...changes, removes: [{ path: at(3, "div"), cls: "other", text: "Лишнее" }], check: true });
  expect(wrong.status).toBe(400);
  expect((await wrong.json()).error).toContain("drawn by the page's script");
  const res = await p.send("POST", `/api/projects/${project}/sketches/${id}/changes`, changes);
  expect((await res.json()).version).toBe(2);
  const page = await (await fetch(`${p.url}/sketches/${project}/${id}/v2.html`)).text();
  expect(page).toContain(`<p class="m" style="font-weight: 300; color: #6b6f76">Серые слова</p>`);
  expect(page).not.toContain("Лишнее");
  expect(page).toContain("<p>Last</p>");
  const info = await (await p.send("GET", `/api/projects/${project}/sketches/${id}`)).json();
  expect(info.versions.at(-1).what).toBe("Changed the words to “Last” and the look of 1 part, removed 1 part");
}, 60_000);

withChrome("taking out a part the page's script needs is refused, or said after the save when it couldn't be seen coming", async () => {
  // The script reaches "hub" by its id in plain sight, and "dot1" through a list of names.
  const made = await tool("make_sketch", {
    project,
    title: "Drawn to",
    html: PAGE("", `<main><div class="n" id="hub">Hub</div><div class="n" id="dot1">Dot</div><p>Words</p></main><script>document.getElementById("hub").dataset.seen = "1"; for (const id of ["dot1"]) document.getElementById(id).dataset.seen = "1";</script>`),
  });
  const id = made.first.sketch ?? made.first.id;
  const at = (n: number, tag: string) => `body > main:nth-child(1) > ${tag}:nth-child(${n})`;
  const url = `/api/projects/${project}/sketches/${id}/changes`;
  // In plain sight: refused before anything is written, also when only asked whether it fits.
  for (const check of [true, false]) {
    const no = await p.send("POST", url, { removes: [{ path: at(1, "div"), cls: "n", id: "hub", text: "Hub" }], from_version: 1, check });
    expect(no.status).toBe(400);
    expect((await no.json()).error).toBe("The page's script uses this part, so taking it out by hand would break the page. Ask FRIDAY to remove it.");
  }
  // Not in plain sight: it saves, and the answer says the page now has an error it didn't have.
  const res = await (await p.send("POST", url, { removes: [{ path: at(2, "div"), cls: "n", id: "dot1", text: "Dot" }], from_version: 1 })).json();
  expect(res.version).toBe(2);
  expect(res.new_errors).toBe(1);
  // A save that breaks nothing says none.
  const fine = await (await p.send("POST", url, { removes: [{ path: at(3, "p"), text: "Words" }], from_version: 1 })).json();
  expect(fine.version).toBe(3);
  expect(fine.new_errors).toBe(0);
}, 90_000);
