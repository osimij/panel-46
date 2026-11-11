import { join, normalize, basename, resolve } from "node:path";
import { existsSync, mkdirSync, renameSync, rmSync, statSync, statfsSync } from "node:fs";
import { homedir } from "node:os";
import { HOST, LIBRARY_DIR, MEDIA_DIR, PORT } from "./config.ts";
import { cleanLinks, db, newId, now, parseLinks, refreshStatus, reindex, retag, SECTIONS, setSetting, setTags, type MediaRow, type RefRow, type Section } from "./db.ts";
import { backfillAvatars, capture, fixEscapedText, parseXStatus, mimeFromExt, enrichLinks, registerLocalFile, retry, saveSkillText, upgradeSocialLinks, type LinkCard } from "./capture.ts";
import { parseSocial, rememberPin } from "./social.ts";
import { abs, makeLoop } from "./media.ts";
import { MODELS, queue, readOf, startReading, startRemeasuring, status as readingStatus, unreadIds } from "./read.ts";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "./mcp-tools.ts";
import { addFile, addLink, listMaterials, materialFile, removeMaterial, rereadCut, updateMaterial } from "./materials.ts";
import { startSummaries, summarize } from "./digest.ts";
import { apply, createProject, deleteProject, follow as followProject, getProject, listProjects, setTurnedDownReason, undoLast, verdictReasons, type Op } from "./projects.ts";
import { captureForFigma, readSketch, SKETCH_CSP, servedSketch, sketchFile, statesOf } from "./sketches.ts";
import { frameName, readFrame } from "./figma.ts";
import { addFont, fontFile, listFonts, removeFonts, renameFamily } from "./fonts.ts";
import { addBrandAsset, brandFile, listBrand, removeBrandAsset, updateBrandAsset } from "./brand.ts";
import { setSketchText, setSketchVars, sketchInfo, sketchMeta } from "./board.ts";
import { buildShot, folderSuggestions, getBuild, messageBuild, startBuild, startPreview, stopBuild, stopPreview } from "./builds.ts";
import { parseMeasured } from "./sitefacts.ts";
import { startMeasuring } from "./measure.ts";
import { indexForMeaning, meaningStatus } from "./embed.ts";
import { forMeaning, load as loadLibrary } from "./library.ts";
import { backupStatus, mirror, setBackupDir, snapshot, startBackups } from "./backup.ts";
import { addChatFile, chatFile, removeChatFile } from "./chatfiles.ts";
import { cards, chatSettings, createChat, deleteChat, follow, getChat, listChats, send, setChatSettings, stop as stopChat, type SendContext } from "./chat.ts";
import { listening, VOICE_LANGUAGES, type Listening, type VoiceLanguage } from "./voice.ts";
import { ICON_WEIGHTS, iconDrawings, loadingPiece, readyMade, type IconWeight } from "./ready.ts";
import { describeOne, readView, setLead, setSkillUse, skillsPageNow } from "./skilluse.ts";
import { notReadYet, queueReads, readIfAuto, readQueue, setReadEdits, startSkillReads, stopReads } from "./skillreads.ts";
import { addFromFolder, addFromGithub, checkPack, listPacks, lookAtFolder, lookAtGithub, packLicense, PackError, skillFileText, skillOrigin } from "./skillpacks.ts";

const DIST = resolve(process.env.PANEL_DIST ?? join(import.meta.dir, "..", "dist"));

const json = (data: unknown, status = 200) => Response.json(data, { status });
const bad = (message: string, status = 400) => json({ error: message }, status);

// ---------- Serialization ----------

/** A person's link cards, with their saved photo or icon as a URL. */
function linkCards(json: string | null) {
  try {
    const cards = JSON.parse(json ?? "{}") as Record<string, LinkCard>;
    return Object.fromEntries(
      Object.entries(cards).map(([url, c]) => [url, { ...c, avatar: undefined, avatar_url: c.avatar ? `/media/${c.avatar}` : null }]),
    );
  } catch {
    return {};
  }
}

interface TagRow { ref_id: string; name: string; source: string }
interface ColRow { ref_id: string; id: string; name: string }

function hydrate(refs: RefRow[], full = false) {
  if (!refs.length) return [];
  // Each save's media, tags and collections, grouped by save. Asked for a few hundred saves
  // at a time, so a long grid (thousands of saves) stays within SQLite's limit on "?"s.
  const mediaBy = new Map<string, MediaRow[]>(), tagsBy = new Map<string, TagRow[]>(), colsBy = new Map<string, ColRow[]>();
  const into = <T extends { ref_id: string }>(by: Map<string, T[]>, rows: T[]) => {
    for (const x of rows) {
      const list = by.get(x.ref_id);
      if (list) list.push(x);
      else by.set(x.ref_id, [x]);
    }
  };
  for (let i = 0; i < refs.length; i += 500) {
    const ids = refs.slice(i, i + 500).map((r) => r.id);
    const ph = ids.map(() => "?").join(",");
    into(mediaBy, db.query<MediaRow, string[]>(`SELECT * FROM media WHERE ref_id IN (${ph}) ORDER BY COALESCE(position, idx), idx`).all(...ids));
    into(
      tagsBy,
      db
        .query<TagRow, string[]>(
          `SELECT rt.ref_id, t.name, rt.source FROM ref_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.ref_id IN (${ph}) ORDER BY t.name`,
        )
        .all(...ids),
    );
    into(
      colsBy,
      db
        .query<ColRow, string[]>(
          `SELECT rc.ref_id, c.id, c.name FROM ref_collections rc JOIN collections c ON c.id = rc.collection_id WHERE rc.ref_id IN (${ph})`,
        )
        .all(...ids),
    );
  }

  return refs.map((r) => {
    const own = mediaBy.get(r.id) ?? [];
    return {
      ...r,
      favorite: !!r.favorite,
      hidden: !!r.hidden,
      site: !!r.site,
      person: !!r.person,
      links: parseLinks(r.links),
      link_cards: linkCards(r.link_profiles),
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
        loop_url: m.loop_path ? `/media/${m.loop_path}` : null,
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
      tags: (tagsBy.get(r.id) ?? []).map((t) => t.name),
      collections: (colsBy.get(r.id) ?? []).map((c) => ({ id: c.id, name: c.name })),
      read: full ? readOf(r.id) : undefined,
      // A site's fonts and values as measured in the page: only with the whole save, never in lists.
      measured: full ? parseMeasured(r.measured) : undefined,
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

/** A whole number from the address, or the fallback when it's missing or not a number. */
function whole(v: string | null, fallback: number, max: number) {
  const n = Math.floor(Number(v ?? fallback));
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : fallback;
}

/**
 * The saves a view shows. Plain: just the list (200 unless a limit is given). With `page`:
 * the first `limit` of them, plus how many there are in all and the tags among all of
 * them, so the grid can load more as it's scrolled and still say what's there.
 */
function listRefs(params: URLSearchParams, page = false) {
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
      order = "bm25(refs_fts, 0, 4, 2, 3, 2, 3, 1.5), r.created_at DESC";
    }
  }
  const status = params.get("status");
  if (status) {
    where.push("r.status = ?");
    args.push(status);
  }
  where.push(params.get("hidden") === "1" ? "r.hidden = 1" : "r.hidden = 0");
  if (params.get("favorite") === "1") where.push("r.favorite = 1");
  if (params.get("site") === "1") where.push("r.site = 1");
  // People & Accounts and Skills are pages of their own, apart from the main library.
  if (params.get("person") === "1") where.push("r.person = 1");
  if (params.get("skill") === "1") where.push("r.kind = 'skill'");
  if (params.get("library") === "1") where.push("r.person = 0 AND r.kind != 'skill'");
  const type = params.get("type");
  if (type === "video") where.push("EXISTS (SELECT 1 FROM media m WHERE m.ref_id = r.id AND m.type IN ('video','gif'))");
  if (type === "image")
    where.push("EXISTS (SELECT 1 FROM media m WHERE m.ref_id = r.id) AND NOT EXISTS (SELECT 1 FROM media m WHERE m.ref_id = r.id AND m.type IN ('video','gif'))");
  // A set picked elsewhere (by the assistant): just those, in the order given.
  const ids = (params.get("ids") ?? "").split(",").filter((x) => /^[0-9a-f]{16}$/.test(x));
  if (ids.length) {
    where.push(`r.id IN (${ids.map(() => "?").join(",")})`);
    args.push(...ids);
    order = `instr('${ids.join(",")}', r.id)`;
  }
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
  const limit = whole(params.get("limit"), 200, page ? 20_000 : 500);
  const offset = whole(params.get("offset"), 0, Number.MAX_SAFE_INTEGER);
  const matching = `FROM ${from} ${where.length ? "WHERE " + where.join(" AND ") : ""}`;
  const items = hydrate(db.query<RefRow, (string | number)[]>(`SELECT r.* ${matching} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`).all(...args));
  if (!page) return items;
  const total = db.query<{ n: number }, (string | number)[]>(`SELECT COUNT(*) n ${matching}`).get(...args)!.n;
  const tagNames = db
    .query<{ name: string }, (string | number)[]>(
      `SELECT DISTINCT t.name FROM ref_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.ref_id IN (SELECT r.id ${matching})`,
    )
    .all(...args)
    .map((t) => t.name);
  return { items, total, tags: tagNames };
}

function stats() {
  const byStatus = Object.fromEntries(
    db
      .query<{ status: string; n: number }, []>("SELECT status, COUNT(*) n FROM refs WHERE hidden = 0 GROUP BY status")
      .all()
      .map((r) => [r.status, r.n]),
  );
  // Counts describe what the views show, so hidden references only count towards Hidden.
  const totals = db
    .query<{ n: number; fav: number; hidden: number; sites: number; people: number; skills: number }, []>(
      `SELECT COALESCE(SUM(hidden = 0 AND person = 0 AND kind != 'skill'),0) n, COALESCE(SUM(favorite = 1 AND hidden = 0),0) fav,
         COALESCE(SUM(hidden),0) hidden, COALESCE(SUM(site = 1 AND hidden = 0 AND person = 0),0) sites,
         COALESCE(SUM(person = 1 AND hidden = 0),0) people, COALESCE(SUM(kind = 'skill' AND hidden = 0),0) skills FROM refs`,
    )
    .get()!;
  const videos = db
    .query<{ n: number }, []>(
      "SELECT COUNT(DISTINCT m.ref_id) n FROM media m JOIN refs r ON r.id = m.ref_id WHERE m.type IN ('video','gif') AND r.hidden = 0",
    )
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
    total: totals.n, favorites: totals.fav, hidden: totals.hidden, sites: totals.sites, people: totals.people, skills: totals.skills,
    videos, byStatus,
    bytes: saved.bytes, files: saved.files, videoBytes: saved.videoBytes, diskFree, libraryDir: LIBRARY_DIR,
  };
}

// ---------- Tags & collections ----------


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

/** Moves the files to the macOS Trash rather than erasing them, then forgets the reference. */
function removeRef(id: string) {
  const ref = getRef(id);
  if (ref?.source_id && ref.kind !== "upload")
    db.run("INSERT OR REPLACE INTO dismissed (kind, source_id, at) VALUES (?, ?, ?)", [ref.kind, ref.source_id, now()]);
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
}

/** A request from Panel's own page (or a tool on this Mac with no Origin), not from another site. */
function fromPanel(req: Request) {
  const own = [`${HOST}:${PORT}`, `localhost:${PORT}`];
  const host = req.headers.get("host") ?? "";
  const origin = req.headers.get("origin");
  return own.includes(host) && (!origin || own.some((h) => origin === `http://${h}`));
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

  // Sketches: pages Claude made on a project's canvas, and their pictures. A page runs in a
  // sandbox of its own (no same-origin), so its scripts can't reach Panel, even opened in a tab.
  if (path.startsWith("/sketches/")) {
    if (![`${HOST}:${PORT}`, `localhost:${PORT}`].includes(req.headers.get("host") ?? "")) return bad("Not allowed from here.", 403);
    const f = sketchFile(path);
    if (!f) return bad("Not found", 404);
    if (f.figma) {
      // An image brought back from Figma: never run as a page here (an SVG could carry a script),
      // and readable by the sketch's own sandboxed page, which has no origin to match.
      const res = serveFile(f.file, req, true);
      res.headers.set("content-security-policy", SKETCH_CSP);
      res.headers.set("access-control-allow-origin", "*");
      res.headers.set("x-content-type-options", "nosniff");
      return res;
    }
    if (!f.html) return serveFile(f.file, req, true);
    return new Response(servedSketch(f.file), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": SKETCH_CSP,
        "x-content-type-options": "nosniff",
        // A version never changes once written, but the studio's kit added to it can.
        "cache-control": "no-cache",
      },
    });
  }

  // The designer's fonts, for sketches. A sketch runs with no origin of its own (its sandbox), so
  // the browser asks before loading a font from here: the CORS header says yes. Each file's name is
  // new with every upload, so it can be kept forever.
  if (path.startsWith("/fonts/")) {
    if (![`${HOST}:${PORT}`, `localhost:${PORT}`].includes(req.headers.get("host") ?? "")) return bad("Not allowed from here.", 403);
    const f = fontFile(path.slice("/fonts/".length));
    if (!f) return bad("Not found", 404);
    return new Response(Bun.file(f.path), {
      headers: { "content-type": f.mime, "access-control-allow-origin": "*", "cache-control": "public, max-age=31536000, immutable" },
    });
  }

  // Brand assets (brand.ts), for sketches and the app. Like fonts, a sketch in its sandbox asks
  // before loading one, and the CORS header says yes. An SVG opened by itself can't run scripts
  // as Panel (its own sandbox); files a browser can't show are downloaded under their own name.
  if (path.startsWith("/brand/")) {
    if (![`${HOST}:${PORT}`, `localhost:${PORT}`].includes(req.headers.get("host") ?? "")) return bad("Not allowed from here.", 403);
    const f = brandFile(path.slice("/brand/".length));
    if (!f) return bad("Not found", 404);
    const download = url.searchParams.has("download") || !f.showable;
    return new Response(Bun.file(f.path), {
      headers: {
        "content-type": f.mime,
        "content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(f.original_name || path.slice(7))}`,
        // (Chrome's PDF viewer doesn't open in a sandbox, and a PDF can't act as Panel anyway.)
        ...(f.format === "pdf" ? {} : { "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:" }),
        "access-control-allow-origin": "*",
        "x-content-type-options": "nosniff",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  }

  // The library for AI apps (MCP over HTTP). Stateless: each request gets its own server.
  // Only this Mac's own addresses are accepted, so a web page can't reach it by DNS tricks.
  if (path === "/mcp") {
    // AI apps send no Origin; a web page (or a sketch in its sandbox) does, and is turned away.
    const origin = req.headers.get("origin");
    if (origin && !fromPanel(req)) return bad("Not allowed from here.", 403);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts: [`${HOST}:${PORT}`, `localhost:${PORT}`],
    });
    // Ask asks with ?rules=0: the designer's rules are in its instructions already.
    await createMcpServer({ withRules: url.searchParams.get("rules") !== "0" }).connect(transport);
    return transport.handleRequest(req);
  }

  // ---- Skills: which of the designer's skill files FRIDAY uses, and when (skills.ts) ----
  // Turning one on changes FRIDAY's instructions, so only Panel's own page may.
  if (path.startsWith("/api/skills") && !fromPanel(req)) return bad("Not allowed from here.", 403);
  if (path === "/api/skills" && m === "GET") return json(skillsPageNow());
  // Reads: Claude reads a skill once (skillread.ts, skillreads.ts). By themselves with "read
  // automatically" on; otherwise when the designer presses Read. Three at a time; can be stopped.
  if (path === "/api/skills/reads" && m === "GET") return json(readQueue());
  // "Read them": every skill not read yet (never read, or read with older instructions).
  if (path === "/api/skills/reads/unread" && m === "POST") return json({ queued: queueReads(notReadYet()), ...readQueue() });
  // Who leads a subject when two skills that are on speak to it (skillleads.ts). id null: Panel's pick.
  if (path === "/api/skills/leads" && m === "PUT") {
    const body = (await req.json().catch(() => ({}))) as { subject?: unknown; id?: unknown };
    try {
      setLead(body.subject, body.id === undefined ? null : body.id);
      return json(skillsPageNow());
    } catch (e) {
      return bad((e as Error).message);
    }
  }
  if (path === "/api/skills/reads" && m === "POST") {
    const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string" && /^[0-9a-f]{16}$/.test(x)) : [];
    if (!ids.length) return bad("Choose a skill to read.");
    return json({ queued: queueReads(ids), ...readQueue() });
  }
  if (path === "/api/skills/reads/stop" && m === "POST") return json(stopReads());
  const readRoute = path.match(/^\/api\/skills\/([0-9a-f]{16})\/read$/);
  if (readRoute) {
    try {
      if (m === "GET") return json(readView(readRoute[1]!));
      if (m === "POST") {
        queueReads([readRoute[1]!]);
        return json(readView(readRoute[1]!));
      }
      if (m === "PATCH") {
        setReadEdits(readRoute[1]!, (await req.json().catch(() => ({}))) as Record<string, unknown>);
        return json(readView(readRoute[1]!));
      }
    } catch (e) {
      return bad((e as Error).message, 404);
    }
  }

  // Packs: skills from a GitHub project or a dropped folder (skillpacks.ts). Looking and
  // checking reach GitHub, and only when the designer asks; nothing is saved until they add.
  if (path.startsWith("/api/skills/packs") || /^\/api\/skills\/[0-9a-f]{16}\/(origin|file)$/.test(path)) {
    try {
      const body = m === "POST" ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {};
      if (path === "/api/skills/packs" && m === "GET") return json(listPacks());
      if (path === "/api/skills/packs/look" && m === "POST")
        return json(typeof body.url === "string" ? await lookAtGithub(body.url) : lookAtFolder(body.folder));
      if (path === "/api/skills/packs/add" && m === "POST") {
        const added = body.folder ? addFromFolder(body) : await addFromGithub(body);
        // With "read automatically" on, new skills and updated ones are put in line to be read.
        return json({ ...added, reading: readIfAuto(added.ids) });
      }
      const pack = path.match(/^\/api\/skills\/packs\/([0-9a-f]{16})\/(check|license)$/);
      if (pack && pack[2] === "check" && m === "POST") return json(await checkPack(pack[1]!));
      if (pack && pack[2] === "license" && m === "GET") {
        const text = packLicense(pack[1]!);
        return text === null ? bad("This pack has no licence file.", 404) : new Response(text, { headers: { "content-type": "text/plain; charset=utf-8" } });
      }
      const one = path.match(/^\/api\/skills\/([0-9a-f]{16})\/(origin|file)$/);
      if (one && one[2] === "origin" && m === "GET") return json(skillOrigin(one[1]!));
      if (one && one[2] === "file" && m === "GET") {
        const text = skillFileText(one[1]!, url.searchParams.get("path") ?? "");
        return text === null ? bad("That file isn't kept with this skill.", 404) : json({ text });
      }
    } catch (e) {
      return bad((e as Error).message, e instanceof PackError ? e.status : 500);
    }
  }
  const skillRoute = path.match(/^\/api\/skills\/([0-9a-f]{16})$/);
  if (skillRoute && (m === "GET" || m === "PATCH")) {
    try {
      if (m === "GET") return json(describeOne(skillRoute[1]!));
      return json(setSkillUse(skillRoute[1]!, (await req.json().catch(() => ({}))) as Record<string, unknown>));
    } catch (e) {
      return bad((e as Error).message, 404);
    }
  }

  // ---- Ready-made parts (ready.ts): files that ship with Panel, only ever read ----
  // A loading piece goes out as plain text, never as a page of Panel's own.
  if (path === "/api/ready" && m === "GET") return json(readyMade());
  const readyPart = path.match(/^\/api\/ready\/(icons|loading)\/([a-z0-9-]+)$/);
  if (readyPart && m === "GET") {
    if (readyPart[1] === "icons") {
      const weight = readyPart[2] as IconWeight;
      return ICON_WEIGHTS.includes(weight) ? json(iconDrawings(weight)) : bad("Not found", 404);
    }
    const piece = loadingPiece(readyPart[2]!);
    return piece === null ? bad("Not found", 404) : new Response(piece, { headers: { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" } });
  }

  // ---- Fonts: the designer's own, uploaded here and used by every sketch ----
  if (path.startsWith("/api/fonts") && !fromPanel(req)) return bad("Not allowed from here.", 403);
  if (path === "/api/fonts" && m === "GET") return json(listFonts());
  if (path === "/api/fonts" && m === "POST") {
    const form = await req.formData();
    const added = [];
    const failed: string[] = [];
    for (const f of form.getAll("file")) {
      if (typeof f === "string") continue;
      try {
        added.push(await addFont(f));
      } catch (e) {
        failed.push((e as Error).message);
      }
    }
    return json({ added, failed });
  }
  if (path === "/api/fonts/family" && (m === "PATCH" || m === "DELETE")) {
    const family = url.searchParams.get("name") ?? "";
    try {
      if (m === "DELETE") return json(removeFonts({ family }));
      const b = (await req.json().catch(() => ({}))) as { name?: string };
      return json(renameFamily(family, String(b.name ?? "")));
    } catch (e) {
      return bad((e as Error).message);
    }
  }
  const fontRoute = path.match(/^\/api\/fonts\/([0-9a-f]{16})$/);
  if (fontRoute && m === "DELETE") return json(removeFonts({ id: fontRoute[1]! }));

  // ---- Brand assets: each project's logos, icons and files, for sketches and builds ----
  if (path.startsWith("/api/brand") && !fromPanel(req)) return bad("Not allowed from here.", 403);
  if (path === "/api/brand" && m === "GET") return json(listBrand(url.searchParams.get("project") ?? undefined));
  if (path === "/api/brand" && m === "POST") {
    const form = await req.formData();
    const project = String(form.get("project") ?? "") || null;
    const kind = String(form.get("kind") ?? "") || undefined;
    const added = [];
    const failed: string[] = [];
    for (const f of form.getAll("file")) {
      if (typeof f === "string") continue;
      try {
        added.push(await addBrandAsset(f, project === "none" ? null : project, kind));
      } catch (e) {
        failed.push((e as Error).message);
      }
    }
    return json({ added, failed });
  }
  const brandRoute = path.match(/^\/api\/brand\/([0-9a-f]{16})$/);
  if (brandRoute && m === "PATCH") {
    try {
      return json(updateBrandAsset(brandRoute[1]!, (await req.json().catch(() => ({}))) as Record<string, unknown>));
    } catch (e) {
      return bad((e as Error).message);
    }
  }
  if (brandRoute && m === "DELETE") return json(removeBrandAsset(brandRoute[1]!));

  // ---- The assistant ----
  // It spends your Claude plan and can change collections, so only Panel's own page may use
  // it: not another website (Origin) and not one reached by DNS tricks (Host).
  if ((path.startsWith("/api/chat") || path === "/api/cards") && !fromPanel(req)) return bad("Not allowed from here.", 403);
  if (path === "/api/chats" && m === "GET") return json(listChats());
  if (path === "/api/chats" && m === "POST") {
    const b = (await req.json().catch(() => ({}))) as { project?: unknown };
    return json(createChat(typeof b.project === "string" ? b.project : null));
  }
  if (path === "/api/chat/settings" && m === "GET") return json(chatSettings.all());
  if (path === "/api/chat/settings" && m === "PATCH") {
    setChatSettings((await req.json().catch(() => ({}))) as Record<string, unknown>);
    return json(chatSettings.all());
  }
  if (path === "/api/cards" && m === "GET") {
    const ids = (url.searchParams.get("ids") ?? "").split(",").filter((x) => /^[0-9a-f]{16}$/.test(x)).slice(0, 200);
    return json(cards(ids));
  }
  // Files attached to a message for FRIDAY: added before it's sent, shown in the conversation after.
  if (path === "/api/chat-files" && m === "POST") {
    const form = await req.formData().catch(() => null);
    if (!form) return bad("No files came.");
    const added = [];
    const failed: string[] = [];
    for (const f of form.getAll("file")) {
      if (typeof f === "string") continue;
      try {
        added.push(await addChatFile(f));
      } catch (e) {
        failed.push((e as Error).message);
      }
    }
    return json({ added, failed });
  }
  const chatFileRoute = path.match(/^\/api\/chat-files\/([0-9a-f]{16})(\/view)?$/);
  if (chatFileRoute) {
    const [, fid, view] = chatFileRoute as unknown as [string, string, string | undefined];
    if (!view && m === "DELETE") return json({ ok: removeChatFile(fid) });
    if (m === "GET") {
      const f = chatFile(fid, view ? "view" : "file");
      if (!f) return bad("That file is gone.", 404);
      // Pages and drawings that could run scripts open as plain text, so a file can't act as Panel.
      const active = /html|xml|svg|javascript/.test(f.mime);
      return new Response(f.file, {
        headers: {
          "content-type": active ? "text/plain; charset=utf-8" : f.mime,
          "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
          "cache-control": "private, max-age=31536000, immutable",
          "x-content-type-options": "nosniff",
        },
      });
    }
  }
  const chatRoute = path.match(/^\/api\/chats\/([0-9a-f]{16})(\/messages|\/stream|\/stop)?$/);
  if (chatRoute) {
    const [, id, sub] = chatRoute as unknown as [string, string, string | undefined];
    if (!sub && m === "GET") {
      const c = getChat(id);
      return c ? json(c) : bad("That conversation is gone.", 404);
    }
    if (!sub && m === "DELETE") {
      deleteChat(id);
      return json({ ok: true });
    }
    if (sub === "/messages" && m === "POST") {
      const b = (await req.json().catch(() => ({}))) as { text?: string; context?: SendContext };
      try {
        return json(await send(id, String(b.text ?? ""), b.context ?? {}));
      } catch (e) {
        return bad((e as Error).message, 409);
      }
    }
    if (sub === "/stream" && m === "GET") {
      const after = Number(url.searchParams.get("after") ?? 0) || 0;
      return new Response(follow(id, after, req.signal), {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
      });
    }
    if (sub === "/stop" && m === "POST") return json({ stopped: stopChat(id) });
  }

  // ---- Projects: a canvas per piece of work ----
  // Only Panel's own page may change them (not another website, not DNS tricks).
  if (path.startsWith("/api/projects") && !fromPanel(req)) return bad("Not allowed from here.", 403);
  if (path === "/api/projects" && m === "GET") return json(listProjects());
  // The reasons offered when choosing or ruling out: the designer's most used, then a few starters.
  if (path === "/api/projects/reasons" && m === "GET") return json(verdictReasons());
  if (path === "/api/projects" && m === "POST") {
    const b = (await req.json().catch(() => ({}))) as { name?: string; brief?: string };
    try {
      return json(createProject(String(b.name ?? ""), String(b.brief ?? "")));
    } catch (e) {
      return bad((e as Error).message);
    }
  }
  // A material's summary, written (again) now: the About panel's "Summarize".
  const summaryRoute = path.match(/^\/api\/projects\/([0-9a-f]{16})\/materials\/([0-9a-f]{16})\/summary$/);
  if (summaryRoute && m === "POST") {
    try {
      await summarize(summaryRoute[1]!, summaryRoute[2]!);
      return json(listMaterials(summaryRoute[1]!).find((x) => x.id === summaryRoute[2]) ?? null);
    } catch (e) {
      return bad((e as Error).message);
    }
  }
  // Its materials: files and links that say what the project is.
  const materialRoute = path.match(/^\/api\/projects\/([0-9a-f]{16})\/materials(?:\/([0-9a-f]{16})(\/file|\/view)?)?$/);
  if (materialRoute) {
    const [, pid, mid, sub] = materialRoute as unknown as [string, string, string | undefined, string | undefined];
    if (!getProject(pid)) return bad("That project is gone.", 404);
    try {
      if (!mid && m === "GET") return json(listMaterials(pid));
      if (!mid && m === "POST") {
        if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
          const form = await req.formData();
          const added = [];
          const failed: string[] = [];
          for (const f of form.getAll("file")) {
            if (typeof f === "string") continue;
            try {
              added.push(await addFile(pid, f));
            } catch (e) {
              failed.push((e as Error).message);
            }
          }
          return json({ added, failed });
        }
        const b = (await req.json().catch(() => ({}))) as { url?: string; note?: string };
        return json({ added: [await addLink(pid, String(b.url ?? ""), String(b.note ?? ""))], failed: [] });
      }
      if (mid && !sub && m === "PATCH") {
        const b = (await req.json().catch(() => ({}))) as { name?: string; note?: string };
        return json(updateMaterial(pid, mid, b));
      }
      if (mid && !sub && m === "DELETE") {
        removeMaterial(pid, mid);
        return json({ ok: true });
      }
      if (mid && sub && m === "GET") {
        const f = materialFile(pid, mid, sub === "/view" ? "view" : "file");
        if (!f || !(await Bun.file(f.path).exists())) return bad("That file is gone.", 404);
        // Pages and drawings that could run scripts open as plain text, so a file can't act as Panel.
        const active = /html|xml|svg|javascript/.test(f.mime);
        return new Response(Bun.file(f.path), {
          headers: {
            "content-type": active ? "text/plain; charset=utf-8" : f.mime,
            "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
            "cache-control": "private, max-age=31536000, immutable",
            "x-content-type-options": "nosniff",
          },
        });
      }
    } catch (e) {
      return bad((e as Error).message);
    }
  }
  // A sketch, for the studio: its versions, states and family (the sketches branched from it).
  const sketchRoute = path.match(/^\/api\/projects\/([0-9a-f]{16})\/sketches\/([0-9a-f]{16})$/);
  if (sketchRoute && m === "GET") {
    if (!getProject(sketchRoute[1]!)) return bad("That project is gone.", 404);
    return json(sketchInfo(sketchRoute[1]!, sketchRoute[2]!));
  }

  // The studio's knobs: a new version with some of the page's variables changed, no AI involved.
  const varsRoute = path.match(/^\/api\/projects\/([0-9a-f]{16})\/sketches\/([0-9a-f]{16})\/vars$/);
  if (varsRoute && m === "POST") {
    const b = (await req.json().catch(() => ({}))) as { vars?: Record<string, string>; from_version?: number };
    try {
      return json(await setSketchVars(varsRoute[1]!, varsRoute[2]!, b.vars && typeof b.vars === "object" ? b.vars : {}, Number.isInteger(b.from_version) ? b.from_version : undefined));
    } catch (e) {
      return bad((e as Error).message);
    }
  }

  // The studio's text edits: words the designer changed in place, as a new version, no AI involved.
  const textRoute = path.match(/^\/api\/projects\/([0-9a-f]{16})\/sketches\/([0-9a-f]{16})\/text$/);
  if (textRoute && m === "POST") {
    const b = (await req.json().catch(() => ({}))) as Partial<Record<"path" | "before" | "after" | "before_text" | "after_text", unknown>> & { from_version?: number };
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    try {
      return json(await setSketchText(textRoute[1]!, textRoute[2]!, {
        path: str(b.path), before: str(b.before), after: str(b.after), beforeText: str(b.before_text), afterText: str(b.after_text),
      }, Number.isInteger(b.from_version) ? b.from_version : undefined));
    } catch (e) {
      return bad((e as Error).message);
    }
  }

  // Figma and back (figma.ts). Copy: one version on one screen and in one state, as Figma pastes
  // it (editable layers), for the studio to put on the clipboard. Read: the frame selected in the
  // Figma app, kept beside the sketch for FRIDAY to rebuild the page from.
  const figmaRoute = path.match(/^\/api\/projects\/([0-9a-f]{16})\/sketches\/([0-9a-f]{16})\/figma\/(copy|read)$/);
  if (figmaRoute && m === "POST") {
    const b = (await req.json().catch(() => ({}))) as { version?: number; device?: string; state?: string };
    try {
      const sk = sketchMeta(figmaRoute[1]!, figmaRoute[2]!);
      const version = Number.isInteger(b.version) ? b.version! : sk.version;
      if (figmaRoute[3] === "read") return json(await readFrame(sk.project, sk.id, version));
      const device = (["desktop", "tablet", "phone"] as const).find((d) => d === b.device) ?? sk.device;
      const slug = typeof b.state === "string" ? b.state.replace(/^#/, "") : "";
      const state = slug ? statesOf(readSketch(sk.project, sk.id, version)).find((x) => x.slug === slug) : undefined;
      const html = await captureForFigma(sk.project, sk.id, version, device, state?.slug ?? "", frameName(sk.title, version, state?.name, device));
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    } catch (e) {
      return bad((e as Error).message);
    }
  }

  // Builds: a sketch handed to Claude Code to make for real.
  if (path.startsWith("/api/builds") && !fromPanel(req) && !path.endsWith("/shot.jpg")) return bad("Not allowed from here.", 403);
  if (path === "/api/builds/folders" && m === "GET") return json(folderSuggestions());
  if (path === "/api/builds" && m === "POST") {
    const b = (await req.json().catch(() => ({}))) as { project?: string; sketch?: string; folder?: string; note?: string };
    try {
      return json(await startBuild({ project: String(b.project ?? ""), sketch: String(b.sketch ?? ""), folder: String(b.folder ?? ""), note: b.note ? String(b.note) : undefined }));
    } catch (e) {
      return bad((e as Error).message);
    }
  }
  const buildRoute = path.match(/^\/api\/builds\/([0-9a-f]{16})(\/message|\/stop|\/preview|\/shot\.jpg)?$/);
  if (buildRoute) {
    const [, bid, sub] = buildRoute as unknown as [string, string, string | undefined];
    try {
      if (!sub && m === "GET") {
        const b = getBuild(bid);
        return b ? json(b) : bad("That build is gone.", 404);
      }
      if (sub === "/shot.jpg" && m === "GET") {
        const f = buildShot(bid);
        return f ? serveFile(f, req, false) : bad("No picture yet.", 404);
      }
      if (sub === "/message" && m === "POST") {
        const b = (await req.json().catch(() => ({}))) as { text?: string };
        return json(messageBuild(bid, String(b.text ?? "")));
      }
      if (sub === "/stop" && m === "POST") return json({ stopped: stopBuild(bid) });
      if (sub === "/preview" && m === "POST") return json(await startPreview(bid, true));
      if (sub === "/preview" && m === "DELETE") {
        stopPreview(bid);
        return json(getBuild(bid));
      }
    } catch (e) {
      return bad((e as Error).message);
    }
  }

  const projectRoute = path.match(/^\/api\/projects\/([0-9a-f]{16})(\/ops|\/stream|\/undo|\/turned-down)?$/);
  if (projectRoute) {
    const [, id, sub] = projectRoute as unknown as [string, string, string | undefined];
    if (!sub && m === "GET") {
      const p = getProject(id);
      if (!p) return bad("That project is gone.", 404);
      const ids = [...new Set(p.nodes.flatMap((n) => (n.ref_id ? [n.ref_id] : [])))];
      return json({ ...p, cards: cards(ids) });
    }
    if (!sub && m === "DELETE") {
      deleteProject(id);
      return json({ ok: true });
    }
    if (sub === "/ops" && m === "POST") {
      const b = (await req.json().catch(() => ({}))) as { ops?: Op[]; client?: string };
      try {
        const res = apply(id, b.ops ?? [], "designer", { client: typeof b.client === "string" ? b.client.slice(0, 40) : null });
        const added = res.ops.flatMap((o) => (o.op === "add_node" && o.node.ref_id ? [o.node.ref_id] : []));
        return json({ ...res, cards: cards(added) });
      } catch (e) {
        return bad((e as Error).message, 409);
      }
    }
    if (sub === "/undo" && m === "POST") {
      // { client, who: "me" | "assistant" }: ⌘Z, or taking back what the assistant just did.
      const b = (await req.json().catch(() => ({}))) as { client?: string; who?: string };
      const client = typeof b.client === "string" ? b.client.slice(0, 40) : "";
      if (!client) return bad("Which window is asking?");
      try {
        const res = undoLast(id, b.who === "assistant" ? "assistant" : { client }, client);
        if (!res) return json({ seq: null, ops: [], cards: [], undid: null });
        const added = res.ops.flatMap((o) => (o.op === "add_node" && o.node.ref_id ? [o.node.ref_id] : []));
        return json({ ...res, cards: cards(added) });
      } catch (e) {
        return bad((e as Error).message, 409);
      }
    }
    if (sub === "/turned-down" && m === "POST") {
      // { nodes, reason }: why the designer took these cards off, said after they're gone.
      const b = (await req.json().catch(() => ({}))) as { nodes?: unknown; reason?: unknown };
      if (!Array.isArray(b.nodes)) return bad("Which cards?");
      return json({ ok: true, n: setTurnedDownReason(id, b.nodes as string[], String(b.reason ?? "")) });
    }
    if (sub === "/stream" && m === "GET") {
      const after = Number(url.searchParams.get("after") ?? 0) || 0;
      return new Response(followProject(id, after, req.signal), {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
      });
    }
  }

  if (path === "/api/health") return json({ ok: true, libraryDir: LIBRARY_DIR });
  if (path === "/api/stats") return json(stats());
  if (path === "/api/library/reveal" && m === "POST") {
    Bun.spawn(["open", LIBRARY_DIR]);
    return json({ ok: true });
  }

  // ---- Search by meaning and by look: on or off, and how far along it is ----
  if (path === "/api/meaning" && m === "GET") return json(meaningStatus(loadLibrary().docs.size));
  if (path === "/api/meaning" && m === "PATCH") {
    if (!fromPanel(req)) return bad("Not allowed from here.", 403);
    const b = (await req.json().catch(() => ({}))) as { on?: boolean };
    setSetting("meaning_search", b.on === false ? "0" : "1");
    if (b.on !== false) indexMeaning();
    return json(meaningStatus(loadLibrary().docs.size));
  }

  // ---- Backups: a daily snapshot, and a second place for it and the media ----
  if (path.startsWith("/api/backup") && !fromPanel(req)) return bad("Not allowed from here.", 403);
  if (path === "/api/backup" && m === "GET") return json(backupStatus());
  if (path === "/api/backup" && m === "PATCH") {
    const b = (await req.json().catch(() => ({}))) as { dir?: string };
    try {
      setBackupDir(String(b.dir ?? ""));
    } catch (e) {
      return bad((e as Error).message);
    }
    void mirror();
    return json(backupStatus());
  }
  if (path === "/api/backup/run" && m === "POST") {
    try {
      await snapshot(true);
    } catch (e) {
      return bad((e as Error).message, 500);
    }
    void mirror();
    return json(backupStatus());
  }

  if (path === "/api/refs" && m === "GET") return json(listRefs(url.searchParams, url.searchParams.get("page") === "1"));

  // ---- Design reads (AI) ----
  if (path === "/api/ai" && m === "GET") return json(await readingStatus());
  if (path === "/api/ai" && m === "PATCH") {
    const body = (await req.json().catch(() => ({}))) as { model?: string; auto?: boolean; cap?: number; provider?: string; effort?: string };
    if (body.provider !== undefined) {
      if (!["claude-code", "api"].includes(body.provider)) return bad("Unknown provider");
      setSetting("ai_provider", body.provider);
    }
    if (body.effort !== undefined) {
      if (!["low", "medium", "high", "xhigh", "max"].includes(body.effort)) return bad("Unknown effort");
      setSetting("ai_effort", body.effort);
    }
    if (body.model !== undefined) {
      if (!(body.model in MODELS)) return bad("Unknown model");
      setSetting("ai_model", body.model);
    }
    if (body.auto !== undefined) {
      setSetting("ai_auto", body.auto ? "1" : "0");
      // Skills follow the same setting: turned on, the ones not read yet are read (skillreads.ts).
      if (body.auto) readIfAuto();
    }
    if (body.cap !== undefined) {
      if (!(Number(body.cap) >= 0)) return bad("The budget has to be a number of dollars.");
      setSetting("ai_cap", String(Number(body.cap)));
    }
    return json(await readingStatus());
  }
  // Read these (ids), or the next `limit` unread ones. mode "now" is full price, right away.
  if (path === "/api/ai/read" && m === "POST") {
    const body = (await req.json().catch(() => ({}))) as { ids?: string[]; limit?: number; mode?: "batch" | "now" };
    const ids = body.ids?.length ? body.ids.filter((id) => typeof id === "string" && getRef(id)) : unreadIds(Math.max(0, Math.min(Number(body.limit ?? 10), 5000)));
    queue(ids, body.mode === "now" ? "now" : "batch");
    return json({ ...(await readingStatus()), added: ids.length });
  }

  if (path === "/api/refs/delete" && m === "POST") {
    const body = (await req.json().catch(() => ({}))) as { ids?: string[] };
    const ids = (body.ids ?? []).filter((id) => typeof id === "string" && getRef(id));
    for (const id of ids) removeRef(id);
    return json({ ok: true, removed: ids.length });
  }

  if (path === "/api/refs/hide" && m === "POST") {
    const body = (await req.json().catch(() => ({}))) as { ids?: string[]; hidden?: boolean };
    const ids = (body.ids ?? []).filter((id) => typeof id === "string");
    const ts = now();
    db.transaction(() => {
      for (const id of ids) db.run("UPDATE refs SET hidden = ?, updated_at = ? WHERE id = ?", [body.hidden === false ? 0 : 1, ts, id]);
    })();
    return json({ ok: true, changed: ids.length });
  }

  // "Not this one": an X post you bookmarked but chose not to keep. Background syncs skip it.
  if (path === "/api/dismiss" && m === "POST") {
    const body = (await req.json().catch(() => ({}))) as { url?: string };
    const x = parseXStatus(body.url ?? "");
    if (!x) return bad("That isn't an X post link.");
    const kept = db.query("SELECT 1 FROM refs WHERE kind = 'x' AND source_id = ?").get(x.id);
    if (!kept) db.run("INSERT OR REPLACE INTO dismissed (kind, source_id, at) VALUES ('x', ?, ?)", [x.id, now()]);
    return json({ ok: true, kept: !!kept });
  }

  if (path === "/api/capture" && m === "POST") {
    const body = (await req.json().catch(() => ({}))) as { url?: string; note?: string; auto?: boolean; person?: boolean; pin?: unknown };
    if (!body.url) return bad("Paste a link to save.");
    // The extension sends a pin's details along, read while you're signed in to Pinterest.
    if (body.pin) {
      const social = parseSocial(body.url);
      if (social?.kind === "pinterest") rememberPin(social.id, body.pin);
    }
    try {
      const result = await capture(body.url, body.note ?? "", { auto: !!body.auto, person: !!body.person });
      if (!result.id) return json(result);
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
      // A Markdown file is a skill: kept as text, under Skills.
      if (/\.(md|markdown)$/i.test(file.name)) {
        const id = newId();
        const ts = now();
        db.run(`INSERT INTO refs (id, kind, status, created_at, updated_at) VALUES (?, 'skill', 'pending', ?, ?)`, [id, ts, ts]);
        saveSkillText(id, await file.text(), file.name);
        ids.push(id);
        continue;
      }
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
      const body = (await req.json()) as Partial<{ title: string; note: string; favorite: boolean; hidden: boolean; person: boolean; links: string[] }>;
      if (body.links !== undefined) {
        db.run("UPDATE refs SET links = ? WHERE id = ?", [JSON.stringify(cleanLinks(body.links)), id]);
        void enrichLinks(id); // read the new ones in the background: photo, name, icon
      }
      if (body.person !== undefined) {
        db.run("UPDATE refs SET person = ? WHERE id = ?", [body.person ? 1 : 0, id]);
        retag(id);
      }
      if (body.title !== undefined) db.run("UPDATE refs SET title = ? WHERE id = ?", [body.title, id]);
      if (body.note !== undefined) db.run("UPDATE refs SET note = ? WHERE id = ?", [body.note, id]);
      if (body.favorite !== undefined) db.run("UPDATE refs SET favorite = ? WHERE id = ?", [body.favorite ? 1 : 0, id]);
      if (body.hidden !== undefined) db.run("UPDATE refs SET hidden = ? WHERE id = ?", [body.hidden ? 1 : 0, id]);
      db.run("UPDATE refs SET updated_at = ? WHERE id = ?", [now(), id]);
      reindex(id);
      return json(hydrate([getRef(id)!], true)[0]);
    }
    if (!action && m === "DELETE") {
      removeRef(id);
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
    // The first one in this order is the card's cover.
    if (action === "/order" && m === "PUT") {
      const body = (await req.json().catch(() => ({}))) as { ids?: string[] };
      const own = db.query<{ id: string }, [string]>("SELECT id FROM media WHERE ref_id = ?").all(id).map((r) => r.id);
      const ids = body.ids ?? [];
      if (ids.length !== own.length || new Set(ids).size !== ids.length || !ids.every((x) => own.includes(x)))
        return bad("That order doesn't match this reference's media.");
      db.transaction(() => ids.forEach((mid, i) => db.run("UPDATE media SET position = ? WHERE id = ?", [i, mid])))();
      db.run("UPDATE refs SET updated_at = ? WHERE id = ?", [now(), id]);
      return json(hydrate([getRef(id)!], true)[0]);
    }
    if (action === "/retry" && m === "POST") {
      retry(id);
      return json(hydrate([getRef(id)!], true)[0]);
    }
    if (action === "/reveal" && m === "POST") {
      const first = db.query<MediaRow, [string]>("SELECT * FROM media WHERE ref_id = ? AND local_path IS NOT NULL ORDER BY COALESCE(position, idx), idx").get(id);
      const target = first?.local_path ? abs(first.local_path) : join(MEDIA_DIR, id);
      if (existsSync(target)) Bun.spawn(["open", "-R", target]);
      return json({ ok: existsSync(target) });
    }
  }

  // Every tag and tag group belongs to one section (library, sites, people, skills); `?scope=` picks it.
  const scope: Section = SECTIONS.includes(url.searchParams.get("scope") as Section) ? (url.searchParams.get("scope") as Section) : "library";
  const tagId = (name: string) => db.query<{ id: number }, [string, string]>("SELECT id FROM tags WHERE scope = ? AND name = ?").get(scope, name);

  if (path === "/api/tags" && m === "GET") {
    return json(
      db
        .query<{ name: string; n: number; group_id: string | null }, [string]>(
          "SELECT t.name, COUNT(rt.ref_id) n, t.group_id FROM tags t LEFT JOIN ref_tags rt ON rt.tag_id = t.id WHERE t.scope = ? GROUP BY t.id ORDER BY n DESC, t.name",
        )
        .all(scope),
    );
  }
  if (path === "/api/tags" && m === "POST") {
    const body = (await req.json()) as { name?: string };
    const name = body.name?.trim().toLowerCase();
    if (!name) return bad("Name required");
    // Creating one that already exists just keeps it; no error for a duplicate.
    db.run("INSERT INTO tags (name, scope, kept) VALUES (?, ?, 1) ON CONFLICT(scope, name) DO UPDATE SET kept = 1", [name, scope]);
    return json({ name });
  }

  // ---- Tag groups ----
  if (path === "/api/tag-groups" && m === "GET") {
    return json(
      db
        .query<{ id: string; name: string; position: number }, [string]>(
          "SELECT id, name, position FROM tag_groups WHERE scope = ? ORDER BY position, name COLLATE NOCASE",
        )
        .all(scope),
    );
  }
  if (path === "/api/tag-groups" && m === "POST") {
    const body = (await req.json()) as { name?: string; tags?: string[] };
    const name = body.name?.trim();
    if (!name) return bad("Name required");
    const id = newId();
    const position = db.query<{ p: number }, [string]>("SELECT COALESCE(MAX(position), -1) + 1 p FROM tag_groups WHERE scope = ?").get(scope)!.p;
    db.transaction(() => {
      db.run("INSERT INTO tag_groups (id, name, position, scope, created_at) VALUES (?, ?, ?, ?, ?)", [id, name, position, scope, now()]);
      for (const t of body.tags ?? []) db.run("UPDATE tags SET group_id = ? WHERE scope = ? AND name = ?", [id, scope, t]);
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
    db.run("UPDATE tags SET group_id = ? WHERE scope = ? AND name = ?", [body.groupId, scope, decodeURIComponent(tagGroupMatch[1]!)]);
    return json({ ok: true });
  }

  const tagMatch = path.match(/^\/api\/tags\/(.+)$/);
  if (tagMatch && m === "DELETE") {
    const tag = tagId(decodeURIComponent(tagMatch[1]!));
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
    const old = tagId(from);
    if (!old) return bad("Not found", 404);
    const refIds = db.query<{ ref_id: string }, [number]>("SELECT ref_id FROM ref_tags WHERE tag_id = ?").all(old.id);
    db.transaction(() => {
      const target = tagId(to);
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
  // Collections are the designer's own: only Panel's page may make, change or delete them.
  if (path.startsWith("/api/collections") && m !== "GET" && !fromPanel(req)) return bad("Not allowed from here.", 403);
  if (path === "/api/collections" && m === "POST") {
    const body = (await req.json()) as { name?: string };
    const name = body.name?.trim();
    if (!name) return bad("Name required");
    const id = newId();
    db.run("INSERT INTO collections (id, name, created_at) VALUES (?, ?, ?)", [id, name, now()]);
    return json({ id, name, n: 0, cover: null });
  }
  // A copy of a collection: a new one with the same saves, named "… copy" (then "… copy 2"…).
  const dupMatch = path.match(/^\/api\/collections\/([a-z0-9]+)\/duplicate$/);
  if (dupMatch && m === "POST") {
    const from = db.query<{ name: string }, [string]>("SELECT name FROM collections WHERE id = ?").get(dupMatch[1]!);
    if (!from) return bad("That collection is gone.", 404);
    const taken = new Set(db.query<{ name: string }, []>("SELECT name FROM collections").all().map((c) => c.name.toLowerCase()));
    let name = `${from.name} copy`;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${from.name} copy ${n}`;
    const id = newId();
    db.transaction(() => {
      db.run("INSERT INTO collections (id, name, created_at) VALUES (?, ?, ?)", [id, name, now()]);
      db.run("INSERT INTO ref_collections (ref_id, collection_id, added_at) SELECT ref_id, ?, added_at FROM ref_collections WHERE collection_id = ?", [id, dupMatch[1]!]);
    })();
    reindexCollection(id);
    const n = db.query<{ n: number }, [string]>("SELECT COUNT(*) n FROM ref_collections WHERE collection_id = ?").get(id)!.n;
    return json({ id, name, n, cover: null });
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
// People whose added links were never read (added before links were read, or Panel quit meanwhile).
for (const { id } of db
  .query<{ id: string }, []>("SELECT id FROM refs WHERE person = 1 AND status != 'pending' AND links IS NOT NULL AND links != '[]'")
  .all())
  void enrichLinks(id);
fixEscapedText();
void backfillAvatars();
void upgradeSocialLinks();
startReading();
startRemeasuring();
// Skill reads that were under way when Panel stopped don't start again by themselves.
startSkillReads();
startBackups();
startMeasuring();
// Project documents: the ones cut at the old length are read again whole, then each long one gets its summary.
setTimeout(() => void rereadCut().catch((e) => console.error("Reading project documents again:", (e as Error).message)), 10_000);
startSummaries();

// Search by meaning and by look: the library's reads and pictures as numbers, kept up to
// date in the background (embed.ts). The first time, this fetches the two models.
const indexMeaning = () => void indexForMeaning(forMeaning()).catch(() => {});
setTimeout(indexMeaning, 15_000);
setInterval(indexMeaning, 90_000);

// Small copies of videos for the grid to play, made one at a time in the background: for
// videos saved before this existed, and for each new one once its file is in.
let makingLoops = false;
async function makeLoops() {
  if (makingLoops) return;
  makingLoops = true;
  try {
    for (;;) {
      const m = db
        .query<MediaRow, []>("SELECT * FROM media WHERE type IN ('video', 'gif') AND status = 'archived' AND local_path IS NOT NULL AND loop_path IS NULL LIMIT 1")
        .get();
      if (!m) break;
      // A small file plays as it is. '' means "looked at, nothing to make", so it isn't tried again.
      const small = (m.bytes ?? 0) < 1_500_000 && (m.width ?? 0) <= 720;
      const loop = small || !existsSync(abs(m.local_path!)) ? null : await makeLoop(m.local_path!).catch(() => null);
      db.run("UPDATE media SET loop_path = ? WHERE id = ?", [loop ?? "", m.id]);
    }
  } finally {
    makingLoops = false;
  }
}
setTimeout(() => void makeLoops(), 5_000);
setInterval(() => void makeLoops(), 30_000);

Bun.serve({
  hostname: HOST,
  port: PORT,
  maxRequestBodySize: 4 * 1024 ** 3,
  idleTimeout: 120,
  fetch: (req, server) => {
    // Speaking to FRIDAY: the page's microphone, passed on to Deepgram (voice.ts). Only Panel's own page may.
    const url = new URL(req.url);
    if (url.pathname === "/api/listen") {
      if (!fromPanel(req)) return bad("Only Panel can do this.", 403);
      const lang = (VOICE_LANGUAGES as readonly string[]).includes(url.searchParams.get("lang") ?? "") ? (url.searchParams.get("lang") as VoiceLanguage) : "en";
      return server.upgrade(req, { data: { lang, waiting: [] } satisfies Listening }) ? undefined : bad("Listening needs a WebSocket.", 400);
    }
    return handle(req).catch((e) => {
      console.error(e);
      return bad("Something went wrong in the companion.", 500);
    });
  },
  websocket: { ...listening, idleTimeout: 120 },
});

// Stopped or restarted (launchd sends SIGTERM): leave the normal way, so the headless Chrome
// kept warm for sketches is closed with Panel instead of being left running.
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(0));

console.log(`Panel companion → http://${HOST}:${PORT}  (library: ${LIBRARY_DIR}, ${basename(MEDIA_DIR)}/)`);
