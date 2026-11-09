// The things that must keep working, checked against a throwaway library: `bun test tests`.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { seedSaves, startPanel, type TestPanel } from "./helpers.ts";

let p: TestPanel;
let ids: string[];

beforeAll(async () => {
  p = await startPanel();
  ids = seedSaves(p, 450);
});
afterAll(async () => {
  await p?.stop();
});

describe("the grid's list", () => {
  test("a page says how many there are in all, and never repeats a save", async () => {
    const first = await p.get("/api/refs?page=1&library=1&limit=200");
    expect(first.items.length).toBe(200);
    expect(first.total).toBe(450);
    expect(first.tags).toEqual(["dark"]);
    const more = await p.get("/api/refs?page=1&library=1&limit=400");
    expect(more.items.length).toBe(400);
    expect(new Set(more.items.map((r: any) => r.id)).size).toBe(400);
    // The longer list starts with the shorter one, in the same order.
    expect(more.items.slice(0, 200).map((r: any) => r.id)).toEqual(first.items.map((r: any) => r.id));
    expect(first.items[0].id).toBe(ids[0]);
  });

  test("asking for more than there are gives them all, each with its picture and tags", async () => {
    const all = await p.get("/api/refs?page=1&library=1&limit=5000");
    expect(all.items.length).toBe(450);
    expect(all.items.every((r: any) => r.media.length === 1 && r.media_count === 1)).toBe(true);
    expect(all.items.filter((r: any) => r.tags.includes("dark")).length).toBe(all.items.filter((r: any, i: number) => !r.site && i % 7 === 0).length);
  });

  test("without `page` it's still a plain list of 200, and a bad limit doesn't break it", async () => {
    const plain = await p.get("/api/refs?library=1");
    expect(Array.isArray(plain)).toBe(true);
    expect(plain.length).toBe(200);
    const odd = await p.get("/api/refs?page=1&library=1&limit=abc");
    expect(odd.items.length).toBe(200);
  });

  test("search and filters count the whole view", async () => {
    const found = await p.get("/api/refs?page=1&library=1&q=editorial&limit=20");
    expect(found.items.length).toBe(20);
    expect(found.total).toBe(90);
    const sites = await p.get("/api/refs?page=1&site=1&library=1&limit=20");
    expect(sites.total).toBe(45);
    const tagged = await p.get("/api/refs?page=1&library=1&tag=dark&limit=500");
    expect(tagged.total).toBe(tagged.items.length);
    expect(tagged.items.every((r: any) => r.tags.includes("dark"))).toBe(true);
  });
});

describe("changing saves", () => {
  test("favorite, hide, and stats follow", async () => {
    const id = ids[3]!;
    const fav = await (await p.send("PATCH", `/api/refs/${id}`, { favorite: true })).json();
    expect(fav.favorite).toBe(true);
    await p.send("POST", "/api/refs/hide", { ids: [ids[4], ids[5]], hidden: true });
    const stats = await p.get("/api/stats");
    expect(stats.total).toBe(448);
    expect(stats.favorites).toBe(1);
    expect(stats.hidden).toBe(2);
    await p.send("POST", "/api/refs/hide", { ids: [ids[4], ids[5]], hidden: false });
  });

  test("a collection can be made and filled", async () => {
    const col = await (await p.send("POST", "/api/collections", { name: "Test set" })).json();
    await p.send("PUT", `/api/refs/${ids[0]}/collections`, { ids: [col.id] });
    const inIt = await p.get(`/api/refs?page=1&collection=${col.id}&limit=50`);
    expect(inIt.total).toBe(1);
    expect(inIt.items[0].id).toBe(ids[0]);
  });
});

describe("projects", () => {
  test("a canvas takes changes and undoes them", async () => {
    const proj = await (await p.send("POST", "/api/projects", { name: "Test project", brief: "A test." })).json();
    const res = await (await p.send("POST", `/api/projects/${proj.id}/ops`, {
      client: "test",
      ops: [
        { op: "add_node", node: { kind: "topic", data: { title: "Typography", facet: "typography" }, x: 0, y: 0 } },
        { op: "add_node", node: { kind: "ref", ref_id: ids[1], data: { state: "kept" }, x: 100, y: 200 } },
      ],
    })).json();
    expect(res.ops.length).toBe(2);
    let board = await p.get(`/api/projects/${proj.id}`);
    expect(board.nodes.length).toBe(2);
    expect(board.cards.map((c: any) => c.id)).toEqual([ids[1]]);
    const undone = await (await p.send("POST", `/api/projects/${proj.id}/undo`, { client: "test", who: "me" })).json();
    expect(undone.ops.length).toBe(2);
    board = await p.get(`/api/projects/${proj.id}`);
    expect(board.nodes.length).toBe(0);
  });
});

describe("the library for AI apps (MCP)", () => {
  const rpc = async (method: string, params: unknown = {}) => {
    const res = await p.send("POST", "/mcp", { jsonrpc: "2.0", id: 1, method, params }, { accept: "application/json, text/event-stream" });
    return (await res.json()) as any;
  };

  test("lists its tools and answers a search", async () => {
    const tools = (await rpc("tools/list")).result.tools.map((t: any) => t.name);
    for (const name of ["search_library", "get_reference", "get_project", "make_sketch", "get_design_rules"]) expect(tools).toContain(name);
    const out = await rpc("tools/call", { name: "search_library", arguments: { query: "editorial poster", limit: 5 } });
    const found = JSON.parse(out.result.content[0].text);
    expect(found.total).toBe(90);
    expect(found.results.length).toBe(5);
  });

  test("a web page can't use it, or the assistant", async () => {
    const res = await p.send("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" }, { origin: "https://example.com", accept: "application/json, text/event-stream" });
    expect(res.status).toBe(403);
    expect((await p.send("GET", "/api/chats", undefined, { origin: "https://example.com" })).status).toBe(403);
  });
});

describe("backups", () => {
  test("a snapshot is a whole database that opens, with the saves in it", async () => {
    const s = await (await p.send("POST", "/api/backup/run")).json();
    expect(s.snapshots).toBe(1);
    const file = join(p.dir, "backups", s.newest, "library.sqlite");
    expect(existsSync(file)).toBe(true);
    const copy = new Database(file, { readonly: true });
    expect(copy.query<{ n: number }, []>("SELECT COUNT(*) n FROM refs").get()!.n).toBe(450);
    copy.close();
  });

  test("the second place has to be a real folder outside the library", async () => {
    expect((await p.send("PATCH", "/api/backup", { dir: "/no/such/folder" })).status).toBe(400);
    expect((await p.send("PATCH", "/api/backup", { dir: join(p.dir, "media") })).status).toBe(400);
  });
});
