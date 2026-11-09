// Starts a Panel companion of its own on a spare port, with an empty library in a
// temporary folder, for the tests to talk to. Nothing here touches the real library.

import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TestPanel {
  url: string;
  host: string;
  dir: string;
  db: Database;
  get: (path: string) => Promise<any>;
  send: (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<Response>;
  stop: () => Promise<void>;
}

/** A port nothing is using right now. */
function sparePort() {
  const s = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = s.port!;
  void s.stop(true);
  return port;
}

export async function startPanel(): Promise<TestPanel> {
  const dir = mkdtempSync(join(tmpdir(), "panel-test-"));
  // Reading new saves by AI is off before Panel first looks, so a test never spends anything.
  const seed = new Database(join(dir, "library.sqlite"), { create: true });
  // (Nor does it fetch the models for search by meaning.)
  seed.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO settings VALUES ('ai_auto', '0'), ('meaning_search', '0');");
  seed.close();

  const port = sparePort();
  const proc = Bun.spawn(["bun", "server/index.ts"], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, PANEL_PORT: String(port), PANEL_LIBRARY_DIR: dir, PANEL_DIST: join(dir, "no-ui") },
    stdout: "ignore",
    stderr: "inherit",
  });
  const host = `127.0.0.1:${port}`;
  const url = `http://${host}`;
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) break;
    } catch {
      /* not up yet */
    }
    if (i > 100) throw new Error("The test companion didn't start.");
    await Bun.sleep(100);
  }
  const db = new Database(join(dir, "library.sqlite"));
  db.exec("PRAGMA busy_timeout = 4000");
  return {
    url, host, dir, db,
    get: async (path) => (await fetch(url + path)).json(),
    send: (method, path, body, headers = {}) =>
      fetch(url + path, {
        method,
        headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
    stop: async () => {
      db.close();
      proc.kill();
      await proc.exited;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const hex = (n: number) => n.toString(16).padStart(16, "0");

/**
 * Put `n` plain saves in the library, newest first by number: save 0 is the newest.
 * Every 10th is a site, every 7th is tagged "dark", and each has one picture row.
 */
export function seedSaves(p: TestPanel, n: number, from = 1) {
  const base = Date.parse("2026-01-01T00:00:00Z");
  const ids: string[] = [];
  p.db.transaction(() => {
    p.db.run("INSERT OR IGNORE INTO tags (name, scope) VALUES ('dark', 'library')");
    const tag = p.db.query<{ id: number }, []>("SELECT id FROM tags WHERE name = 'dark' AND scope = 'library'").get()!.id;
    for (let i = 0; i < n; i++) {
      const id = hex(from + i);
      const at = new Date(base - (from + i) * 60_000).toISOString();
      const site = i % 10 === 9 ? 1 : 0;
      const title = `Save ${from + i}${i % 5 === 0 ? " editorial poster" : ""}`;
      p.db.run(
        "INSERT INTO refs (id, kind, title, text, note, status, created_at, updated_at, site) VALUES (?, 'upload', ?, '', '', 'archived', ?, ?, ?)",
        [id, title, at, at, site],
      );
      p.db.run(
        "INSERT INTO media (id, ref_id, idx, type, local_path, thumb_path, mime, bytes, width, height, status) VALUES (?, ?, 0, 'image', ?, ?, 'image/jpeg', 1000, 800, 600, 'archived')",
        [hex(0x1000000 + from + i), id, `${id}/0.jpg`, `${id}/0.thumb.jpg`],
      );
      if (!site && i % 7 === 0) p.db.run("INSERT INTO ref_tags (ref_id, tag_id, source) VALUES (?, ?, 'user')", [id, tag]);
      p.db.run("INSERT INTO refs_fts (ref_id, title, text, note, creator, tags, design) VALUES (?, ?, '', '', '', ?, '')", [id, title, i % 7 === 0 ? "dark" : ""]);
      ids.push(id);
    }
  })();
  return ids;
}
