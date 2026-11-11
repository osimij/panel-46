// Brand assets (brand.ts): each project's logos and files, served to sketches and named to AI tools.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startPanel, type TestPanel } from "./helpers.ts";

const trash = mkdtempSync(join(tmpdir(), "panel-trash-"));
let p: TestPanel;
beforeAll(async () => {
  p = await startPanel({ PANEL_TRASH_DIR: trash });
});
afterAll(async () => {
  await p?.stop();
});

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect width="120" height="40" fill="#111"/><script>alert(1)</script></svg>`;
// A 1×1 PNG.
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (c) => c.charCodeAt(0));

const mcp = async (name: string, args: Record<string, unknown>) =>
  JSON.stringify(await (await p.send("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, { accept: "application/json, text/event-stream" })).json());

test("brand assets are added per project, grouped by kind, served to sketches and named to AI tools", async () => {
  const project = ((await (await p.send("POST", "/api/projects", { name: "Navtech", brief: "" })).json()) as any).id;
  const form = new FormData();
  form.append("project", project);
  form.append("file", new File([LOGO], "navtech-logo_white.svg", { type: "image/svg+xml" }));
  form.append("file", new File([PNG], "app-icon@2x.png", { type: "image/png" }));
  form.append("file", new File(["just words"], "notes.txt"));
  form.append("file", new File([], "empty.svg"));
  const up = (await (await fetch(`${p.url}/api/brand`, { method: "POST", body: form })).json()) as any;
  expect(up.added).toHaveLength(3);
  expect(up.failed[0]).toContain("empty");
  const [logo, icon, notes] = up.added;
  expect(logo).toMatchObject({ kind: "logo", name: "navtech logo white", format: "svg", width: 120, height: 40, project_name: "Navtech" });
  expect(icon).toMatchObject({ kind: "icon", format: "png", width: 1, height: 1 });
  expect(notes).toMatchObject({ kind: "other", thumb_url: null });

  // Listed by project, logos first.
  const list = await p.get(`/api/brand?project=${project}`);
  expect(list.map((a: any) => a.kind)).toEqual(["logo", "icon", "other"]);

  // The file, with the header a sandboxed sketch needs; an SVG opened by itself can't run its script as Panel.
  const file = await fetch(p.url + logo.url);
  expect(file.headers.get("access-control-allow-origin")).toBe("*");
  expect(file.headers.get("content-type")).toBe("image/svg+xml");
  expect(file.headers.get("content-security-policy")).toContain("sandbox");
  // A file a browser can't show is downloaded under its own name.
  expect((await fetch(p.url + notes.url)).headers.get("content-disposition")).toContain("attachment; filename*=UTF-8''notes.txt");

  // Claude learns them from get_brand_assets and from the project itself, with the src a sketch uses.
  const said = await mcp("get_brand_assets", { project: "Navtech" });
  expect(said).toContain("navtech logo white");
  expect(said).toContain(`<img src=\\"${logo.url}\\">`);
  expect(said).toContain("as SVG code");
  expect(await mcp("get_project", { project })).toContain("Its brand assets");

  // Its kind changed, moved out of the project, renamed.
  await p.send("PATCH", `/api/brand/${notes.id}`, { kind: "guide", project_id: null, name: "Brand notes" });
  const moved = (await p.get("/api/brand?project=none"))[0];
  expect(moved).toMatchObject({ kind: "guide", project_id: null, name: "Brand notes" });
  expect((await p.send("PATCH", `/api/brand/${notes.id}`, { kind: "poster" })).status).toBe(400);

  // Deleting the project keeps its assets, in no project.
  await p.send("DELETE", `/api/projects/${project}`);
  expect((await p.get("/api/brand?project=none")).length).toBe(3);

  // Deleted, the file goes to the Trash and isn't served any more.
  await p.send("DELETE", `/api/brand/${logo.id}`);
  expect((await fetch(p.url + logo.url)).status).toBe(404);
  expect(readdirSync(trash).some((f) => f.includes("navtech-logo_white"))).toBe(true);

  // Only Panel's own page may change them.
  expect((await p.send("DELETE", `/api/brand/${icon.id}`, undefined, { origin: "https://example.com" })).status).toBe(403);
});
