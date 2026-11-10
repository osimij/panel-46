// To Figma and back (figma.ts). Bringing a sketch back reads a frame from the Figma app's own
// MCP server; here a small stand-in plays the Figma app, so the tests never need Figma open.
// Copying for Figma runs Figma's capture script in Chrome, so that one runs only where Chrome
// is installed and Figma's script can be downloaded.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startPanel, type TestPanel } from "./helpers.ts";

// A 1×1 picture, for the frame's screenshot and its one image.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** What the stand-in Figma app does: who is selected, and whether it may write images. */
const figma = { selected: "12:34" as string | null, name: "Figma test · v1", kind: "frame", canWrite: true, failCode: false, calls: [] as string[] };

function fakeFigmaApp() {
  return Bun.serve({
    port: 0,
    async fetch(req) {
      const m = (await req.json()) as { id?: number; method: string; params?: { name: string; arguments: Record<string, any> } };
      const reply = (result: unknown) => new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: m.id, result })}\n\n`, { headers: { "content-type": "text/event-stream", "mcp-session-id": "fake" } });
      if (m.method === "initialize") return reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "Figma Dev Mode MCP Server", version: "1" } });
      if (m.method !== "tools/call") return new Response(null, { status: 202 });
      const { name, arguments: a } = m.params!;
      figma.calls.push(name);
      const text = (t: string) => reply({ content: [{ type: "text", text: t }, { type: "text", text: "Figma recommends using the remote MCP server for workflows between design and code." }] });
      const sel = figma.selected ? `Currently selected nodes:\n- ${figma.selected}: ${figma.name}\n\n` : "";
      if (name === "get_metadata") {
        if (!a.nodeId) return text(`${sel}No nodeId was provided. Listing the top-level pages of the document.\n\nTop-level pages of the document:\n- 0:1: Page 1`);
        if (a.nodeId === "0:1") return text(`${sel}<canvas id="0:1" name="Page 1" x="0" y="0" width="0" height="0"></canvas>`);
        return text(`${sel}<${figma.kind} id="${a.nodeId}" name="${figma.name.replace(/&/g, "&amp;")}" x="100" y="200" width="1440" height="900">\n  <text id="1:2" name="Title" x="140" y="240" width="200" height="40" />\n  <frame id="1:5" name="Hero" x="100" y="400" width="1440" height="500">\n    <rounded-rectangle id="1:3" name="Photo" x="100" y="400" width="600" height="400" />\n    <text id="1:6" name="Caption" x="800" y="420" width="300" height="24" />\n  </frame>\n  <vector id="1:4" name="Hidden" x="0" y="0" width="10" height="10" hidden="true" />\n</${figma.kind}>`);
      }
      if (name === "get_screenshot") return reply({ content: [{ type: "image", data: PNG, mimeType: "image/png" }] });
      if (name === "get_variable_defs") return text(JSON.stringify({ "color/accent": "#c8472b" }));
      if (name === "get_design_context") {
        if (figma.failCode) return new Response("gone", { status: 500 });
        // Like the real app: anything holding an image needs to write it, and may not.
        const holdsImage = !["1:2", "1:6"].includes(a.nodeId);
        if (!figma.canWrite && holdsImage) return reply({ content: [{ type: "text", text: "Cannot write to this directory. The user must add this directory to their allowed directories list in Figma Dev Mode settings (MCP panel > Allowed directories)." }], isError: true });
        if (!holdsImage) return text(`export default function Part() {\n  return <p className="text-[24px] text-[#1a1a1a]" data-node-id="${a.nodeId}">Words of ${a.nodeId}</p>;\n}`);
        writeFileSync(join(a.dirForAssetWrites, "a1b2c3 hero image.png"), Buffer.from(PNG, "base64"));
        writeFileSync(join(a.dirForAssetWrites, "b91bf744.svg"), `<svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><path id="Mark" d="M0 0H40V40Z" fill="#DBE7D2"/></svg>`);
        return text(`const hero = "${join(a.dirForAssetWrites, "a1b2c3 hero image.png")}";\nexport default function Frame() {\n  return <div className="bg-[#f4f1ea] p-10"><h1 className="text-[48px] text-[#1a1a1a]">Справки за минуту</h1><img src={hero} /></div>;\n}\nSUPER CRITICAL: The generated React+Tailwind code MUST be converted to match the target project's technology stack and styling system.\n1. Analyze the target codebase\nDO NOT install any Tailwind as a dependency unless the user instructs you to do so.\n\nImage assets should be read from disk. Images and SVGs will be stored as constants, e.g. const image = '${a.dirForAssetWrites}/x.png' This is true for both images and SVGs, so you can use the same approach for both types of assets.`);
      }
      return reply({ content: [{ type: "text", text: "unknown tool" }], isError: true });
    },
  });
}

let p: TestPanel;
let app: ReturnType<typeof Bun.serve>;
let project: string;
let sketch: string;
const tool = async (name: string, args: unknown) => {
  const res = await p.send("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, { accept: "application/json, text/event-stream" });
  return ((await res.json()) as any).result;
};
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Figma test</title><meta name="panel:states" content="home: Главная, error: Ошибка"><style>:root{--bg:#f4f1ea;--ink:#1a1a1a;--accent:#c8472b}body{margin:0;font-family:system-ui;background:var(--bg);color:var(--ink)}</style></head><body><main><h1>Документы без очередей</h1></main><script>addEventListener("hashchange",()=>{document.body.dataset.state=location.hash.slice(1)})</script></body></html>`;

beforeAll(async () => {
  app = fakeFigmaApp();
  p = await startPanel({ PANEL_FIGMA_APP: `http://127.0.0.1:${app.port}/mcp` });
  project = ((await (await p.send("POST", "/api/projects", { name: "Figma test", brief: "A test." })).json()) as any).id;
  const made = await tool("make_sketch", { project, title: "Figma test", html: PAGE });
  sketch = JSON.parse(made.content[0].text).sketch;
});
afterAll(async () => {
  await p?.stop();
  app?.stop(true);
});

test("bringing a sketch back reads the frame selected in Figma, with its images", async () => {
  const res = await p.send("POST", `/api/projects/${project}/sketches/${sketch}/figma/read`, { version: 1 });
  expect(res.status).toBe(200);
  const r = (await res.json()) as any;
  expect(r.node).toBe("12:34");
  expect(r.frame).toBe("Figma test · v1");
  expect(r.base_version).toBe(1);
  expect(r.width).toBe(1440);
  expect(r.assets.sort()).toEqual([`figma/${r.read}/a1b2c3-hero-image.png`, `figma/${r.read}/b91bf744.svg`]);
  expect(r.found).toBe("selected");
  expect(r.picture).toBe(`figma/${r.read}/picture.png`);
  expect((await fetch(`${p.url}/sketches/${project}/${sketch}/${r.picture}`)).status).toBe(200);
  expect(existsSync(join(p.dir, "projects", project, "sketches", sketch, "figma", r.read, "picture.png"))).toBe(true);

  // The image is served beside the page, so the rebuilt page can use it by a relative path, and never runs as a page.
  const img = await fetch(`${p.url}/sketches/${project}/${sketch}/${r.assets[0]}`);
  expect(img.status).toBe(200);
  expect(img.headers.get("content-type")).toContain("image/png");
  expect(img.headers.get("content-security-policy")).toContain("sandbox");
  expect((await fetch(`${p.url}/sketches/${project}/${sketch}/figma/${r.read}/read.json`)).status).toBe(404);

  // The studio is told where Bring back looks next time.
  const info = await p.get(`/api/projects/${project}/sketches/${sketch}`);
  expect(info.figma).toMatchObject({ node: "12:34", name: "Figma test · v1" });

  // FRIDAY gets the frame, the page it started from, and how to rebuild it.
  const out = await tool("get_figma_frame", { project, sketch, read: r.read });
  expect(out.isError).toBeFalsy();
  const head = JSON.parse(out.content[0].text);
  expect(head).toMatchObject({ sketch, figma_frame: "Figma test · v1", started_from_version: 1 });
  expect(head.images.sort()).toEqual(r.assets.sort());
  expect(head.how_to).toContain("edit_sketch");
  expect(head.figma_variables).toContain("#c8472b");
  expect(out.content.some((c: any) => c.type === "image")).toBe(true);
  const texts = out.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
  expect(texts).toContain(`figma/${r.read}/a1b2c3-hero-image.png`);
  expect(texts).not.toContain(p.dir);
  expect(texts).not.toContain("SUPER CRITICAL");
  // A drawing comes with what it draws, since Figma's code names no file for it.
  expect(texts).toContain(`figma/${r.read}/b91bf744.svg:\n<svg width="40"`);
  expect(texts).toContain('<path id="Mark"');
  expect(texts).toContain('<meta name="panel:states"');
});

test("with nothing selected in Figma, it reads the frame from last time; with neither, it says what to do", async () => {
  figma.selected = null;
  const again = await tool("get_figma_frame", { project, sketch });
  expect(again.isError).toBeFalsy();
  expect(JSON.parse(again.content[0].text).figma_frame).toBe("Figma test · v1");
  const last = (await (await p.send("POST", `/api/projects/${project}/sketches/${sketch}/figma/read`, { version: 1 })).json()) as any;
  expect(last.found).toBe("last time");

  const other = JSON.parse((await tool("make_sketch", { project, title: "Never in Figma", html: PAGE })).content[0].text).sketch;
  const res = await p.send("POST", `/api/projects/${project}/sketches/${other}/figma/read`, { version: 1 });
  expect(res.status).toBe(400);
  expect(((await res.json()) as any).error).toContain("Select the frame in Figma");
  figma.selected = "12:34";
});

test("a rebuilt page comes back as the next version, through edit_sketch", async () => {
  const r = (await (await p.send("POST", `/api/projects/${project}/sketches/${sketch}/figma/read`, { version: 1 })).json()) as any;
  const html = PAGE.replace("Документы без очередей", "Справки за минуту").replace("</main>", `<img src="${r.assets[0]}" alt=""></main>`);
  const out = await tool("edit_sketch", { project, sketch, from_version: r.base_version, html });
  expect(JSON.parse(out.content[0].text).version).toBe(2);
  const page = await (await fetch(`${p.url}/sketches/${project}/${sketch}/v2.html`)).text();
  expect(page).toContain("Справки за минуту");
  expect(page).toContain('<meta name="panel:states"');
});

test("when Figma won't hand over images, the frame comes back part by part, images as pictures", async () => {
  figma.canWrite = false;
  figma.calls = [];
  const res = await p.send("POST", `/api/projects/${project}/sketches/${sketch}/figma/read`, { version: 1 });
  figma.canWrite = true;
  expect(res.status).toBe(200);
  const r = (await res.json()) as any;
  // The photo is a picture of its own; the words came as Figma's code; the hidden layer was left out.
  expect(r.assets).toEqual([`figma/${r.read}/layer-1-3.png`]);
  expect(figma.calls.filter((c) => c === "get_design_context").length).toBe(5);
  expect((await fetch(`${p.url}/sketches/${project}/${sketch}/${r.assets[0]}`)).status).toBe(200);

  const out = await tool("get_figma_frame", { project, sketch, read: r.read });
  expect(out.isError).toBeFalsy();
  const texts = out.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
  expect(texts).toContain("part by part");
  expect(texts).toContain("Words of 1:2");
  expect(texts).toContain("Words of 1:6");
  expect(texts).toContain(`rounded-rectangle “Photo”, 600×400 at 0, 200 in the frame: has an image or drawing, so it came as a picture of that area (what lies over it shows too): figma/${r.read}/layer-1-3.png`);
  expect(texts).toContain("text “Caption” 300×24 at 700, 220 in the frame");
  expect(texts).not.toContain("Hidden”, 10×10");
  expect(texts).not.toContain(p.dir);
});

test("a reading that goes wrong halfway leaves nothing behind", async () => {
  const folder = join(p.dir, "projects", project, "sketches", sketch, "figma");
  const before = readdirSync(folder).sort();
  // Figma stops making sense after it has drawn the frame's picture.
  figma.failCode = true;
  const res = await p.send("POST", `/api/projects/${project}/sketches/${sketch}/figma/read`, { version: 1 });
  figma.failCode = false;
  expect(res.status).toBe(400);
  expect(readdirSync(folder).sort()).toEqual(before);
});

test("only Panel itself can copy or read for Figma", async () => {
  const res = await p.send("POST", `/api/projects/${project}/sketches/${sketch}/figma/read`, {}, { origin: "null" });
  expect(res.status).toBe(403);
});

// Copying runs Figma's own script in Chrome, so it needs Chrome and the internet.
const chrome = ["/Applications/Google Chrome.app", "/Applications/Chromium.app", "/Applications/Brave Browser.app", "/Applications/Microsoft Edge.app"].some((x) => existsSync(x));
const online = await fetch("https://mcp.figma.com/mcp/html-to-design/capture.js", { method: "HEAD", signal: AbortSignal.timeout(5000) }).then((r) => r.ok, () => false);
(chrome && online ? test : test.skip)("a version copies for Figma as layers, in the state shown, named after the sketch", async () => {
  const res = await p.send("POST", `/api/projects/${project}/sketches/${sketch}/figma/copy`, { version: 1, device: "phone", state: "error" });
  expect(res.status).toBe(200);
  const html = await res.text();
  const data = JSON.parse(Buffer.from(html.match(/\(figh2d\)(.*?)\(\/figh2d\)/)![1]!, "base64").toString("utf8"));
  expect(data.documentTitle).toBe("Figma test · v1 · Ошибка · phone");
  expect(data.viewportRect.width).toBe(390);
  expect(JSON.stringify(data.root)).toContain("Документы без очередей");
}, 90_000);

test("a word or a shape selected in Figma isn't taken for the frame", async () => {
  figma.kind = "text";
  const res = await p.send("POST", `/api/projects/${project}/sketches/${sketch}/figma/read`, { version: 1 });
  figma.kind = "frame";
  expect(res.status).toBe(400);
  expect(((await res.json()) as any).error).toContain("not a frame");
});
