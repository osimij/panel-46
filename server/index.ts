import { join, normalize, basename } from "node:path";
import { existsSync, mkdirSync, renameSync, rmSync, statSync, statfsSync } from "node:fs";
import { homedir } from "node:os";
import { HOST, LIBRARY_DIR, MEDIA_DIR, PORT } from "./config.ts";
import { db, newId, now, refreshStatus, reindex, type MediaRow, type RefRow } from "./db.ts";
import { backfillAvatars, capture, fixEscapedText, mimeFromExt, registerLocalFile, retry, upgradeSocialLinks } from "./capture.ts";
import { abs } from "./media.ts";

const DIST = join(import.meta.dir, "..", "dist");

const json = (data: unknown, status = 200) => Response.json(data, { status });
const bad = (message: string, status = 400) => json({ error: message }, status);

// ---------- Serialization ----------

interface TagRow { ref_id: string; name: string; source: string }
interface ColRow { ref_id: string; id: string; name: string }

function hydrate(refs: RefRow[], full = false) {
  if (!refs.length) return [];
  const ids = refs.map((r) => r.id);
  const ph = ids.map(() => "?").join(",");
  const media = db.query<MediaRow, string[]>(`SELECT * FROM media WHERE ref_id IN (${ph}) ORDER BY idx`).all(...ids);
  const tags = db
    .query<TagRow, string[]>(
      `SELECT rt.ref_id, t.name, rt.source FROM ref_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.ref_id IN (${ph}) ORDER BY t.name`,
    )
    .all(...ids);
  const cols = db
    .query<ColRow, string[]>(
      `SELECT rc.ref_id, c.id, c.name FROM ref_collections rc JOIN collections c ON c.id = rc.collection_id WHERE rc.ref_id IN (${ph})`,
    )
    .all(...ids);

  return refs.map((r) => {
    const own = media.filter((m) => m.ref_id === r.id);
    return {
      ...r,
      favorite: !!r.favorite,
      preview_url: r.preview_path ? `/media/${r.preview_path}` : null,
      avatar_url: r.avatar_path ? `/media/${r.avatar_path}` : null,
      media: (full ? own : own.slice(0, 1)).map((m) => ({
        id: m.id,
        idx: m.idx,
        type: m.type,
        status: m.status,
        error: m.error,
        url: m.status === "archived" && m.local_path ? `/media/${m.local_path}` : null,
        thumb_url: m.thumb_path ? `/media/${m.thumb_path}` : null,
        remote_url: m.remote_url,
        width: m.width,
        height: m.height,
        duration: m.duration,
        bytes: m.bytes,
        sha256: full ? m.sha256 : undefined,
        local_path: full && m.local_path ? join(MEDIA_DIR, m.local_path) : undefined,
      })),
      media_count: own.length,
      has_video: own.some((m) => m.type !== "image"),
      tags: tags.filter((t) => t.ref_id === r.id).map((t) => t.name),
      collections: cols.filter((c) => c.ref_id === r.id).map((c) => ({ id: c.id, name: c.name })),
    };
  });
}

/** A file that vanished from disk is no longer archived. Say so. */
function checkFilesStillThere(refId: string) {
  const media = db.query<MediaRow, [string]>("SELECT * FROM media WHERE ref_id = ? AND status = 'archived'").all(refId);
  let changed = false;
  for (const m of media) {
    if (!m.local_path || !existsSync(abs(m.local_path))) {
      db.run("UPDATE media SET status = 'failed', error = 'File is missing from disk' WHERE id = ?", [m.id]);
      changed = true;
    }
  }
  if (changed) refreshStatus(refId);
}

function getRef(id: string) {
  return db.query<RefRow, [string]>("SELECT * FROM refs WHERE id = ?").get(id);
}

// ---------- Queries ----------

function ftsQuery(q: string) {
  const tokens = q.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  return tokens.map((t) => `"${t}"*`).join(" ");
}

function listRefs(params: URLSearchParams) {
  const where: string[] = [];
  const args: (string | number)[] = [];
  let from = "refs r";
  let order = "r.created_at DESC";

  const q = params.get("q")?.trim();
  if (q) {
    const match = ftsQuery(q);
    if (match) {
      from = "refs r JOIN refs_fts f ON f.ref_id = r.id";
      where.push("refs_fts MATCH ?");
      args.push(match);
      order = "bm25(refs_fts, 0, 4, 2, 3, 2, 3), r.created_at DESC";
    }
  }
  const status = params.get("status");
  if (status) {
    where.push("r.status = ?");
    args.push(status);
  }
  if (params.get("favorite") === "1") where.push("r.favorite = 1");
  const type = params.get("type");
  if (type === "video") where.push("EXISTS (SELECT 1 FROM media m WHERE m.ref_id = r.id AND m.type IN ('video','gif'))");
  if (type === "image")
    where.push("EXISTS (SELECT 1 FROM media m WHERE m.ref_id = r.id) AND NOT EXISTS (SELECT 1 FROM media m WHERE m.ref_id = r.id AND m.type IN ('video','gif'))");
  const collection = params.get("collection");
  if (collection) {
    where.push("EXISTS (SELECT 1 FROM ref_collections rc WHERE rc.ref_id = r.id AND rc.collection_id = ?)");
    args.push(collection);
  }
  // Several tags: "all" keeps references that have every one, "any" keeps those with at least one.
  const tags = params.getAll("tag").filter(Boolean);
  if (tags.length && params.get("tagMode") === "any") {
    where.push(`EXISTS (SELECT 1 FROM ref_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.ref_id = r.id AND t.name IN (${tags.map(() => "?").join(",")}))`);
    args.push(...tags);
  } else {
    for (const tag of tags) {
      where.push("EXISTS (SELECT 1 FROM ref_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.ref_id = r.id AND t.name = ?)");
      args.push(tag);
    }
  }
  const limit = Math.min(Number(params.get("limit") ?? 200), 500);
  const offset = Number(params.get("offset") ?? 0);
  const sql = `SELECT r.* FROM ${from} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`;
  return hydrate(db.query<RefRow, (string | number)[]>(sql).all(...args));
}

function stats() {
  const byStatus = Object.fromEntries(
    db.query<{ status: string; n: number }, []>("SELECT status, COUNT(*) n FROM refs GROUP BY status").all().map((r) => [r.status, r.n]),
  );
  const totals = db
    .query<{ n: number; fav: number }, []>("SELECT COUNT(*) n, COALESCE(SUM(favorite),0) fav FROM refs")
    .get()!;
  const videos = db
    .query<{ n: number }, []>("SELECT COUNT(DISTINCT ref_id) n FROM media WHERE type IN ('video','gif')")
    .get()!.n;
  const saved = db
    .query<{ files: number; bytes: number; videoBytes: number }, []>(
      `SELECT COUNT(*) files, COALESCE(SUM(bytes),0) bytes,
         COALESCE(SUM(CASE WHEN type IN ('video','gif') THEN bytes END),0) videoBytes
       FROM media WHERE status = 'archived'`,
    )
    .get()!;
  let diskFree: number | null = null;
  try {
    const fsStat = statfsSync(LIBRARY_DIR);
    diskFree = fsStat.bavail * fsStat.bsize;
  } catch {
    /* not available on this filesystem */
  }
  return {
    total: totals.n, favorites: totals.fav, videos, byStatus,
    bytes: saved.bytes, files: saved.files, videoBytes: saved.videoBytes, diskFree, libraryDir: LIBRARY_DIR,
  };
}

// ---------- Tags & collections ----------

function setTags(refId: string, names: string[]) {
  const clean = [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))];
  db.transaction(() => {
    db.run("DELETE FROM ref_tags WHERE ref_id = ?", [refId]);
    for (const name of clean) {
      db.run("INSERT OR IGNORE INTO tags (name) VALUES (?)", [name]);
      const tag = db.query<{ id: number }, [string]>("SELECT id FROM tags WHERE name = ?").get(name)!;
      db.run("INSERT OR IGNORE INTO ref_tags (ref_id, tag_id, source) VALUES (?, ?, 'user')", [refId, tag.id]);
    }
    db.run("DELETE FROM tags WHERE kept = 0 AND id NOT IN (SELECT tag_id FROM ref_tags)");
  })();
  reindex(refId);
}

function setCollections(refId: string, ids: string[]) {
  db.transaction(() => {
    db.run(`DELETE FROM ref_collections WHERE ref_id = ? AND collection_id NOT IN (${ids.map(() => "?").join(",") || "''"})`, [refId, ...ids]);
    for (const cid of ids) db.run("INSERT OR IGNORE INTO ref_collections (ref_id, collection_id, added_at) VALUES (?, ?, ?)", [refId, cid, now()]);
  })();
  reindex(refId);
}

function reindexCollection(collectionId: string) {
  const ids = db.query<{ ref_id: string }, [string]>("SELECT ref_id FROM ref_collections WHERE collection_id = ?").all(collectionId);
  for (const { ref_id } of ids) reindex(ref_id);
}

// ---------- Media file serving (Range-aware, straight from disk) ----------

function serveFile(path: string, req: Request, cacheForever: boolean) {
  const file = Bun.file(path);
  const size = file.size;
  const type = mimeFromExt(path) === "application/octet-stream" ? file.type : mimeFromExt(path);
  const headers: Record<string, string> = {
    "content-type": type,
    "accept-ranges": "bytes",
    "cache-control": cacheForever ? "private, max-age=31536000, immutable" : "no-cache",
  };
  const range = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    let start = range[1] ? Number(range[1]) : NaN;
    let end = range[2] ? Number(range[2]) : size - 1;
    if (Number.isNaN(start)) {
      start = size - end; // suffix range: last N bytes
      end = size - 1;
    }
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    }
    return new Response(file.slice(start, end + 1), {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
    });
  }
  return new Response(file, { headers: { ...headers, "content-length": String(size) } });
}

// ---------- Router ----------

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const m = req.method;

  if (path.startsWith("/media/")) {
    const rel = normalize(decodeURIComponent(path.slice("/media/".length)));
    if (rel.startsWith("..") || rel.startsWith("/")) return bad("Bad path", 400);
    const full = join(MEDIA_DIR, rel);
    if (!existsSync(full) || !statSync(full).isFile()) return bad("Not found", 404);
    return serveFile(full, req, true);
  }

  if (path === "/api/health") return json({ ok: true, libraryDir: LIBRARY_DIR });
  if (path === "/api/stats") return json(stats());
  if (path === "/api/library/reveal" && m === "POST") {
    Bun.spawn(["open", LIBRARY_DIR]);
    return json({ ok: true });
  }

  if (path === "/api/refs" && m === "GET") return json(listRefs(url.searchParams));

  if (path === "/api/capture" && m === "POST") {
    const body = (await req.json().catch(() => ({}))) as { url?: string; note?: string };
    if (!body.url) return bad("Paste a link to save.");
    try {
      const result = await capture(body.url, body.note ?? "");
      return json({ ...result, ref: hydrate([getRef(result.id)!], true)[0] });
    } catch (e) {
      return bad((e as Error).message);
    }
  }

  if (path === "/api/upload" && m === "POST") {
    const form = await req.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (!files.length) return bad("No files");
    const ids: string[] = [];
    for (const file of files) {
      const mime = file.type || mimeFromExt(file.name);
      if (!mime.startsWith("image/") && !mime.startsWith("video/")) continue;
      const id = newId();
      const ts = now();
      db.run(
        `INSERT INTO refs (id, kind, title, status, created_at, updated_at) VALUES (?, 'upload', ?, 'pending', ?, ?)`,
        [id, file.name.replace(/\.[^.]+$/, ""), ts, ts],
      );
      const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
      const rel = `${id}/0.${ext}`;
      mkdirSync(join(MEDIA_DIR, id), { recursive: true });
      await Bun.write(abs(rel), file);
      await registerLocalFile(id, 0, rel, mime);
      refreshStatus(id);
      reindex(id);
      ids.push(id);
    }
    return json({ ids });
  }

  const refMatch = path.match(/^\/api\/refs\/([a-z0-9]+)(\/[a-z]+)?$/);
  if (refMatch) {
    const [, id, action] = refMatch as unknown as [string, string, string | undefined];
    const ref = getRef(id);
    if (!ref) return bad("Not found", 404);

    if (!action && m === "GET") {
      checkFilesStillThere(id);
      return json(hydrate([getRef(id)!], true)[0]);
    }
    if (!action && m === "PATCH") {
      const body = (await req.json()) as Partial<{ title: string; note: string; favorite: boolean }>;
      if (body.title !== undefined) db.run("UPDATE refs SET title = ? WHERE id = ?", [body.title, id]);
      if (body.note !== undefined) db.run("UPDATE refs SET note = ? WHERE id = ?", [body.note, id]);
      if (body.favorite !== undefined) db.run("UPDATE refs SET favorite = ? WHERE id = ?", [body.favorite ? 1 : 0, id]);
      db.run("UPDATE refs SET updated_at = ? WHERE id = ?", [now(), id]);
      reindex(id);
      return json(hydrate([getRef(id)!], true)[0]);
    }
    if (!action && m === "DELETE") {
      // Move the files to the macOS Trash rather than erasing them.
      const dir = join(MEDIA_DIR, id);
      if (existsSync(dir)) {
        const trash = join(homedir(), ".Trash", `Panel ${id} ${Date.now()}`);
        try {
          renameSync(dir, trash);
        } catch {
          rmSync(dir, { recursive: true, force: true });
        }
      }
      db.run("DELETE FROM refs WHERE id = ?", [id]);
      db.run("DELETE FROM refs_fts WHERE ref_id = ?", [id]);
      db.run("DELETE FROM tags WHERE kept = 0 AND id NOT IN (SELECT tag_id FROM ref_tags)");
      return json({ ok: true });
    }
    if (action === "/tags" && m === "PUT") {
      const body = (await req.json()) as { tags: string[] };
      setTags(id, body.tags ?? []);
      return json(hydrate([getRef(id)!], true)[0]);
    }
    if (action === "/collections" && m === "PUT") {
      const body = (await req.json()) as { ids: string[] };
      setCollections(id, body.ids ?? []);
      return json(hydrate([getRef(id)!], true)[0]);
    }
    if (action === "/retry" && m === "POST") {
      retry(id);
      return json(hydrate([getRef(id)!], true)[0]);
    }
    if (action === "/reveal" && m === "POST") {
      const first = db.query<MediaRow, [string]>("SELECT * FROM media WHERE ref_id = ? AND local_path IS NOT NULL ORDER BY idx").get(id);
      const target = first?.local_path ? abs(first.local_path) : join(MEDIA_DIR, id);
      if (existsSync(target)) Bun.spawn(["open", "-R", target]);
      return json({ ok: existsSync(target) });
    }
  }

  if (path === "/api/tags" && m === "GET") {
    return json(
      db
        .query<{ name: string; n: number; group_id: string | null }, []>(
          "SELECT t.name, COUNT(rt.ref_id) n, t.group_id FROM tags t LEFT JOIN ref_tags rt ON rt.tag_id = t.id GROUP BY t.id ORDER BY n DESC, t.name",
        )
        .all(),
    );
  }
  if (path === "/api/tags" && m === "POST") {
    const body = (await req.json()) as { name?: string };
    const name = body.name?.trim().toLowerCase();
    if (!name) return bad("Name required");
    // Creating one that already exists just keeps it; no error for a duplicate.
    db.run("INSERT INTO tags (name, kept) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET kept = 1", [name]);
    return json(db.query<{ name: string }, [string]>("SELECT name FROM tags WHERE name = ?").get(name)!);
  }

  // ---- Tag groups ----
  if (path === "/api/tag-groups" && m === "GET") {
    return json(db.query<{ id: string; name: string; position: number }, []>("SELECT id, name, position FROM tag_groups ORDER BY position, name COLLATE NOCASE").all());
  }
  if (path === "/api/tag-groups" && m === "POST") {
    const body = (await req.json()) as { name?: string; tags?: string[] };
    const name = body.name?.trim();
    if (!name) return bad("Name required");
    const id = newId();
    const position = db.query<{ p: number }, []>("SELECT COALESCE(MAX(position), -1) + 1 p FROM tag_groups").get()!.p;
    db.transaction(() => {
      db.run("INSERT INTO tag_groups (id, name, position, created_at) VALUES (?, ?, ?, ?)", [id, name, position, now()]);
      for (const t of body.tags ?? []) db.run("UPDATE tags SET group_id = ? WHERE name = ?", [id, t]);
    })();
    return json({ id, name, position });
  }
  const groupMatch = path.match(/^\/api\/tag-groups\/([a-z0-9]+)$/);
  if (groupMatch && m === "PATCH") {
    const body = (await req.json()) as { name?: string; position?: number };
    if (body.name?.trim()) db.run("UPDATE tag_groups SET name = ? WHERE id = ?", [body.name.trim(), groupMatch[1]!]);
    if (typeof body.position === "number") db.run("UPDATE tag_groups SET position = ? WHERE id = ?", [body.position, groupMatch[1]!]);
    return json({ ok: true });
  }
  if (groupMatch && m === "DELETE") {
    // Removing a group never removes tags; they just become ungrouped.
    db.transaction(() => {
      db.run("UPDATE tags SET group_id = NULL WHERE group_id = ?", [groupMatch[1]!]);
      db.run("DELETE FROM tag_groups WHERE id = ?", [groupMatch[1]!]);
    })();
    return json({ ok: true });
  }
  const tagGroupMatch = path.match(/^\/api\/tags\/(.+)\/group$/);
  if (tagGroupMatch && m === "PUT") {
    const body = (await req.json()) as { groupId: string | null };
    const exists = body.groupId === null || db.query("SELECT 1 FROM tag_groups WHERE id = ?").get(body.groupId);
    if (!exists) return bad("No such group", 404);
    db.run("UPDATE tags SET group_id = ? WHERE name = ?", [body.groupId, decodeURIComponent(tagGroupMatch[1]!)]);
    return json({ ok: true });
  }

  const tagMatch = path.match(/^\/api\/tags\/(.+)$/);
  if (tagMatch && m === "DELETE") {
    const tag = db.query<{ id: number }, [string]>("SELECT id FROM tags WHERE name = ?").get(decodeURIComponent(tagMatch[1]!));
    if (!tag) return bad("Not found", 404);
    const refIds = db.query<{ ref_id: string }, [number]>("SELECT ref_id FROM ref_tags WHERE tag_id = ?").all(tag.id);
    db.run("DELETE FROM tags WHERE id = ?", [tag.id]); // ref_tags rows go with it
    for (const { ref_id } of refIds) reindex(ref_id);
    return json({ ok: true });
  }
  if (tagMatch && m === "PATCH") {
    const from = decodeURIComponent(tagMatch[1]!);
    const body = (await req.json()) as { name?: string };
    const to = body.name?.trim().toLowerCase();
    if (!to) return bad("Name required");
    const old = db.query<{ id: number }, [string]>("SELECT id FROM tags WHERE name = ?").get(from);
    if (!old) return bad("Not found", 404);
    const refIds = db.query<{ ref_id: string }, [number]>("SELECT ref_id FROM ref_tags WHERE tag_id = ?").all(old.id);
    db.transaction(() => {
      const target = db.query<{ id: number }, [string]>("SELECT id FROM tags WHERE name = ?").get(to);
      if (target && target.id !== old.id) {
        // Renaming onto an existing tag merges the two.
        db.run("INSERT OR IGNORE INTO ref_tags (ref_id, tag_id, source) SELECT ref_id, ?, source FROM ref_tags WHERE tag_id = ?", [target.id, old.id]);
        db.run("DELETE FROM tags WHERE id = ?", [old.id]);
      } else {
        db.run("UPDATE tags SET name = ? WHERE id = ?", [to, old.id]);
      }
    })();
    for (const { ref_id } of refIds) reindex(ref_id);
    return json({ name: to });
  }

  if (path === "/api/collections" && m === "GET") {
    return json(
      db
        .query<{ id: string; name: string; n: number; cover: string | null }, []>(
          `SELECT c.id, c.name, COUNT(rc.ref_id) n,
             (SELECT m.thumb_path FROM ref_collections rc2 JOIN media m ON m.ref_id = rc2.ref_id
              WHERE rc2.collection_id = c.id AND m.thumb_path IS NOT NULL ORDER BY rc2.added_at DESC LIMIT 1) cover
           FROM collections c LEFT JOIN ref_collections rc ON rc.collection_id = c.id
           GROUP BY c.id ORDER BY c.name COLLATE NOCASE`,
        )
        .all()
        .map((c) => ({ ...c, cover: c.cover ? `/media/${c.cover}` : null })),
    );
  }
  if (path === "/api/collections" && m === "POST") {
    const body = (await req.json()) as { name?: string };
    const name = body.name?.trim();
    if (!name) return bad("Name required");
    const id = newId();
    db.run("INSERT INTO collections (id, name, created_at) VALUES (?, ?, ?)", [id, name, now()]);
    return json({ id, name, n: 0, cover: null });
  }
  const colMatch = path.match(/^\/api\/collections\/([a-z0-9]+)$/);
  if (colMatch) {
    const cid = colMatch[1]!;
    if (m === "PATCH") {
      const body = (await req.json()) as { name?: string };
      if (body.name?.trim()) db.run("UPDATE collections SET name = ? WHERE id = ?", [body.name.trim(), cid]);
      reindexCollection(cid);
      return json({ ok: true });
    }
    if (m === "DELETE") {
      const members = db.query<{ ref_id: string }, [string]>("SELECT ref_id FROM ref_collections WHERE collection_id = ?").all(cid);
      db.run("DELETE FROM collections WHERE id = ?", [cid]);
      for (const { ref_id } of members) reindex(ref_id);
      return json({ ok: true });
    }
  }

  if (path.startsWith("/api/")) return bad("Not found", 404);

  // Built UI (bun run build). In development, Vite serves the UI instead.
  if (existsSync(join(DIST, "index.html"))) {
    const file = join(DIST, normalize(path).replace(/^\/+/, ""));
    if (file.startsWith(DIST) && existsSync(file) && statSync(file).isFile()) return serveFile(file, req, path.startsWith("/assets/"));
    return serveFile(join(DIST, "index.html"), req, false);
  }
  return new Response("Panel companion is running. Start the UI with `bun run dev` or build it with `bun run build`.", {
    headers: { "content-type": "text/plain" },
  });
}

// Anything left mid-download when the companion last stopped gets resumed.
for (const { id } of db.query<{ id: string }, []>("SELECT id FROM refs WHERE status = 'pending'").all()) retry(id);
fixEscapedText();
void backfillAvatars();
void upgradeSocialLinks();

Bun.serve({
  hostname: HOST,
  port: PORT,
  maxRequestBodySize: 4 * 1024 ** 3,
  idleTimeout: 120,
  fetch: (req) =>
    handle(req).catch((e) => {
      console.error(e);
      return bad("Something went wrong in the companion.", 500);
    }),
});

console.log(`Panel companion → http://${HOST}:${PORT}  (library: ${LIBRARY_DIR}, ${basename(MEDIA_DIR)}/)`);
