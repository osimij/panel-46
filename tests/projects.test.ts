// The sidebar's project menu: rename, archive and bring back, delete.
// `bun test tests/projects.test.ts`. No call to Claude.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startPanel, type TestPanel } from "./helpers.ts";

let p: TestPanel;

beforeAll(async () => {
  p = await startPanel();
});
afterAll(async () => {
  await p?.stop();
});

const make = async (name: string) => (await (await p.send("POST", "/api/projects", { name })).json()) as { id: string };
const patch = (id: string, b: unknown) => p.send("PATCH", `/api/projects/${id}`, b);
const list = async () => (await (await p.send("GET", "/api/projects")).json()) as { id: string; name: string; archived_at: string | null }[];

describe("project menu", () => {
  test("rename: the new name shows in the list and on the canvas's log", async () => {
    const { id } = await make("Old name");
    const res = await patch(id, { name: "  New name " });
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe("New name");
    expect((await list()).find((x) => x.id === id)?.name).toBe("New name");
    // Logged like a canvas change, so an open canvas follows it.
    const ev = p.db.query<{ ops: string }, [string]>("SELECT ops FROM project_events WHERE project_id = ? ORDER BY seq DESC LIMIT 1").get(id);
    expect(JSON.parse(ev!.ops)[0]).toMatchObject({ op: "update_project", name: "New name" });
  });

  test("an empty name is refused", async () => {
    const { id } = await make("Keeps its name");
    expect((await patch(id, { name: "  " })).status).toBe(400);
    expect((await list()).find((x) => x.id === id)?.name).toBe("Keeps its name");
  });

  test("archive and bring back, without touching when it was last worked on", async () => {
    const { id } = await make("Finished");
    const before = p.db.query<{ updated_at: string }, [string]>("SELECT updated_at FROM projects WHERE id = ?").get(id)!.updated_at;
    const a = await (await patch(id, { archived: true })).json();
    expect(a.archived_at).toBeTruthy();
    expect(a.updated_at).toBe(before);
    expect((await list()).find((x) => x.id === id)?.archived_at).toBeTruthy();
    const b = await (await patch(id, { archived: false })).json();
    expect(b.archived_at).toBeNull();
  });

  test("FRIDAY's list says which projects are archived", async () => {
    const { id } = await make("Put away");
    await patch(id, { archived: true });
    const res = await p.send("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_projects", arguments: {} } }, { accept: "application/json, text/event-stream" });
    const out = (await res.json()) as any;
    const projects = JSON.parse(out.result.content[0].text) as { id: string; archived?: boolean }[];
    expect(projects.find((x) => x.id === id)?.archived).toBe(true);
  });

  test("a project that is gone answers 404", async () => {
    const { id } = await make("Short lived");
    await p.send("DELETE", `/api/projects/${id}`);
    expect((await patch(id, { archived: true })).status).toBe(404);
    expect((await list()).some((x) => x.id === id)).toBe(false);
  });
});
