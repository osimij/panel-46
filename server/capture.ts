import { rmSync } from "node:fs";
import { db, newId, now, refreshStatus, reindex, type MediaRow, type MediaType, type RefRow } from "./db.ts";
import {
  abs, describeLocal, downloadTo, fetchWithTimeout, makeThumb, mediaTypeFor, probe, ytDlp,
} from "./media.ts";

// ---------- URL parsing ----------

export function parseXStatus(input: string): { id: string; url: string } | null {
  try {
    const u = new URL(input.trim());
    const host = u.hostname.replace(/^(www\.|mobile\.)/, "");
    if (!["x.com", "twitter.com", "fixupx.com", "fxtwitter.com", "vxtwitter.com"].includes(host)) return null;
    const m = u.pathname.match(/^\/([^/]+)\/status(?:es)?\/(\d+)/);
    if (!m) return null;
    return { id: m[2]!, url: `https://x.com/${m[1]}/status/${m[2]}` };
  } catch {
    return null;
  }
}

// ---------- Job queue (a few downloads at a time) ----------

const queue: (() => Promise<void>)[] = [];
let active = 0;
const MAX_ACTIVE = 3;

function enqueue(job: () => Promise<void>) {
  queue.push(job);
  pump();
}
function pump() {
  while (active < MAX_ACTIVE && queue.length) {
    const job = queue.shift()!;
    active++;
    job()
      .catch((e) => console.error("[capture]", e))
      .finally(() => {
        active--;
        pump();
      });
  }
}

// ---------- Public entry points ----------

export function capture(input: string, note = ""): { id: string; existing: boolean } {
  const x = parseXStatus(input);
  let url: URL;
  try {
    url = new URL(x?.url ?? input.trim());
    if (!/^https?:$/.test(url.protocol)) throw new Error();
  } catch {
    throw new Error("That doesn't look like a link.");
  }
  const kind = x ? "x" : "web";
  const sourceId = x ? x.id : url.href;

  const existing = db
    .query<RefRow, [string, string]>("SELECT * FROM refs WHERE kind = ? AND source_id = ?")
    .get(kind, sourceId);
  if (existing) {
    if (existing.status === "failed") retry(existing.id);
    return { id: existing.id, existing: true };
  }

  const id = newId();
  const ts = now();
  db.run(
    `INSERT INTO refs (id, kind, source_url, source_id, note, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [id, kind, url.href, sourceId, note, ts, ts],
  );
  reindex(id);
  enqueue(() => (x ? captureX(id, x.id) : captureWeb(id, url.href)));
  return { id, existing: false };
}

export function retry(refId: string) {
  const ref = db.query<RefRow, [string]>("SELECT * FROM refs WHERE id = ?").get(refId);
  if (!ref || ref.kind === "upload") return;
  const media = db.query<MediaRow, [string]>("SELECT * FROM media WHERE ref_id = ? ORDER BY idx").all(refId);
  const failed = media.filter((m) => m.status === "failed" && m.remote_url);
  db.run("UPDATE refs SET status = 'pending', status_detail = NULL, updated_at = ? WHERE id = ?", [now(), refId]);

  if (failed.length) {
    // Re-download only what is missing; keep files we already verified.
    for (const m of failed) db.run("UPDATE media SET status = 'pending', error = NULL WHERE id = ?", [m.id]);
    enqueue(async () => {
      await Promise.all(failed.map((m) => saveRemote(m.id)));
      refreshStatus(refId);
    });
  } else {
    // We never got the post's contents: start over.
    db.run("DELETE FROM media WHERE ref_id = ?", [refId]);
    rmSync(abs(refId), { recursive: true, force: true });
    enqueue(() => (ref.kind === "x" ? captureX(refId, ref.source_id!) : captureWeb(refId, ref.source_url!)));
  }
}

/** Register a file that is already written inside media/<refId>/. */
export async function registerLocalFile(refId: string, idx: number, rel: string, mime: string) {
  const type = mediaTypeFor(mime) ?? "image";
  const mediaId = newId();
  db.run("INSERT INTO media (id, ref_id, idx, type, status) VALUES (?, ?, ?, ?, 'pending')", [mediaId, refId, idx, type]);
  await verifyAndStore(mediaId, await describeLocal(rel, mime), type);
}

// ---------- X / Twitter ----------

interface SyndicationTweet {
  id_str?: string;
  text?: string;
  created_at?: string;
  user?: { screen_name: string; name: string; profile_image_url_https?: string };
  entities?: { media?: { url: string }[] };
  mediaDetails?: {
    type: "photo" | "video" | "animated_gif";
    media_url_https: string;
    video_info?: { variants: { content_type: string; url: string; bitrate?: number }[] };
  }[];
  tombstone?: unknown;
}

// Token expected by X's public embed endpoint (same derivation as their widgets).
const syndicationToken = (id: string) =>
  ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");

async function captureX(refId: string, tweetId: string) {
  let tweet: SyndicationTweet | null = null;
  try {
    const res = await fetchWithTimeout(
      `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&token=${syndicationToken(tweetId)}&lang=en`,
    );
    if (res.ok) tweet = (await res.json()) as SyndicationTweet;
  } catch {
    /* fall through to yt-dlp */
  }

  if (tweet?.id_str) {
    let text = decodeEntities(tweet.text ?? "");
    for (const m of tweet.entities?.media ?? []) text = text.replace(m.url, "");
    db.run(
      `UPDATE refs SET creator_handle = ?, creator_name = ?, text = ?, posted_at = ?, updated_at = ? WHERE id = ?`,
      [
        tweet.user?.screen_name ?? null,
        tweet.user?.name ? decodeEntities(tweet.user.name) : null,
        text.trim(),
        tweet.created_at ? new Date(tweet.created_at).toISOString() : null,
        now(),
        refId,
      ],
    );
    reindex(refId);
    await saveAvatar(refId, tweet.user?.profile_image_url_https);

    const items = (tweet.mediaDetails ?? []).map((m) => {
      if (m.type === "photo") {
        const u = new URL(m.media_url_https);
        const ext = u.pathname.split(".").pop() ?? "jpg";
        u.pathname = u.pathname.replace(/\.[^.]+$/, "");
        u.search = `?format=${ext}&name=orig`;
        return { type: "image" as MediaType, url: u.href };
      }
      const best = (m.video_info?.variants ?? [])
        .filter((v) => v.content_type === "video/mp4")
        .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
      return { type: (m.type === "animated_gif" ? "gif" : "video") as MediaType, url: best?.url ?? null };
    });

    items.forEach((it, idx) => {
      db.run(
        `INSERT INTO media (id, ref_id, idx, type, remote_url, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [newId(), refId, idx, it.type, it.url, it.url ? "pending" : "failed", it.url ? null : "X did not provide a downloadable file"],
      );
    });
    const pending = db.query<MediaRow, [string]>("SELECT * FROM media WHERE ref_id = ? AND status = 'pending'").all(refId);
    await Promise.all(pending.map((m) => saveRemote(m.id)));
    refreshStatus(refId);
    return;
  }

  // Embed endpoint couldn't read it (deleted, protected, age-gated, rate limited). Try yt-dlp.
  const result = await ytDlp(`https://x.com/i/status/${tweetId}`, refId);
  if (result.files.length) {
    let idx = 0;
    for (const rel of result.files) await registerLocalFile(refId, idx++, rel, mimeFromExt(rel));
    refreshStatus(refId);
  } else {
    markFailed(refId, `Couldn't read this post. It may be deleted, private, or blocked by X. (${result.error ?? "no data"})`);
  }
}

/** Keep the creator's avatar locally too, so the grid never reaches out to X. */
async function saveAvatar(refId: string, url?: string) {
  if (!url) return;
  try {
    const saved = await downloadTo(url.replace(/_normal(\.\w+)$/, "_bigger$1"), `${refId}/avatar`);
    db.run("UPDATE refs SET avatar_path = ? WHERE id = ?", [saved.rel, refId]);
  } catch {
    /* avatar is decoration; never fail a capture over it */
  }
}

/** X sends post text HTML-escaped; fix rows saved before it was decoded. */
export function fixEscapedText() {
  const rows = db
    .query<{ id: string; text: string | null; creator_name: string | null }, []>(
      "SELECT id, text, creator_name FROM refs WHERE kind = 'x' AND (text LIKE '%&%;%' OR creator_name LIKE '%&%;%')",
    )
    .all();
  for (const r of rows) {
    db.run("UPDATE refs SET text = ?, creator_name = ? WHERE id = ?", [
      r.text && decodeEntities(r.text), r.creator_name && decodeEntities(r.creator_name), r.id,
    ]);
    reindex(r.id);
  }
}

/** Fill in avatars for posts saved before avatars were kept. Best effort, needs internet. */
export async function backfillAvatars() {
  const missing = db
    .query<{ id: string; source_id: string }, []>(
      "SELECT id, source_id FROM refs WHERE kind = 'x' AND avatar_path IS NULL AND creator_handle IS NOT NULL",
    )
    .all();
  for (const r of missing) {
    try {
      const res = await fetchWithTimeout(
        `https://cdn.syndication.twimg.com/tweet-result?id=${r.source_id}&token=${syndicationToken(r.source_id)}&lang=en`,
      );
      if (!res.ok) continue;
      const t = (await res.json()) as SyndicationTweet;
      await saveAvatar(r.id, t.user?.profile_image_url_https);
    } catch {
      return; // probably offline; try again next launch
    }
  }
}

// ---------- Any other link ----------

async function captureWeb(refId: string, url: string) {
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { method: "GET" });
  } catch (e) {
    return markFailed(refId, `Couldn't reach ${new URL(url).host}: ${(e as Error).message}`);
  }
  const mime = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();

  // A direct image or video link: save the file itself.
  const directType = mediaTypeFor(mime);
  if (res.ok && directType) {
    res.body?.cancel();
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    db.run("UPDATE refs SET title = ?, creator_handle = ?, updated_at = ? WHERE id = ?", [
      name || null, new URL(url).hostname, now(), refId,
    ]);
    const mediaId = newId();
    db.run("INSERT INTO media (id, ref_id, idx, type, remote_url, status) VALUES (?, ?, 0, ?, ?, 'pending')", [
      mediaId, refId, directType, url,
    ]);
    await saveRemote(mediaId);
    reindex(refId);
    refreshStatus(refId);
    return;
  }

  // A page: keep its title/description, try to pull real media with yt-dlp,
  // and fall back to a link-only bookmark with a cached preview image.
  const html = res.ok && mime.includes("html") ? await res.text() : "";
  const meta = readMeta(html, url);
  db.run("UPDATE refs SET title = ?, text = ?, creator_handle = ?, creator_name = ?, updated_at = ? WHERE id = ?", [
    meta.title, meta.description, new URL(url).hostname.replace(/^www\./, ""), meta.siteName, now(), refId,
  ]);
  reindex(refId);

  const result = await ytDlp(url, refId);
  if (result.files.length) {
    let idx = 0;
    for (const rel of result.files) await registerLocalFile(refId, idx++, rel, mimeFromExt(rel));
    refreshStatus(refId);
    return;
  }

  if (meta.image) {
    try {
      const saved = await downloadTo(meta.image, `${refId}/preview`);
      db.run("UPDATE refs SET preview_path = ? WHERE id = ?", [saved.rel, refId]);
    } catch {
      /* a missing preview is fine for a bookmark */
    }
  }
  if (!res.ok) return markFailed(refId, `${new URL(url).host} returned HTTP ${res.status}`);
  refreshStatus(refId); // no media rows -> link_only
}

function readMeta(html: string, base: string) {
  const pick = (re: RegExp) => {
    const m = html.match(re);
    return m ? decodeEntities(m[1]!.trim()) : null;
  };
  const og = (p: string) =>
    pick(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']*)["']`, "i")) ??
    pick(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${p}["']`, "i"));
  const image = og("og:image") ?? og("twitter:image");
  return {
    title: og("og:title") ?? pick(/<title[^>]*>([^<]*)<\/title>/i),
    description: og("og:description") ?? og("description"),
    siteName: og("og:site_name"),
    image: image ? new URL(image, base).href : null,
  };
}

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

// ---------- Saving + verification ----------

async function saveRemote(mediaId: string) {
  const m = db.query<MediaRow, [string]>("SELECT * FROM media WHERE id = ?").get(mediaId);
  if (!m?.remote_url) return;
  try {
    const saved = await downloadTo(m.remote_url, `${m.ref_id}/${m.idx}`);
    await verifyAndStore(mediaId, saved, m.type);
  } catch (e) {
    db.run("UPDATE media SET status = 'failed', error = ? WHERE id = ?", [(e as Error).message, mediaId]);
  }
}

async function verifyAndStore(mediaId: string, saved: Awaited<ReturnType<typeof describeLocal>>, type: MediaType) {
  try {
    const p = await probe(saved.rel);
    const finalType: MediaType = type === "gif" ? "gif" : p.hasVideo && saved.mime.startsWith("video/") ? "video" : type;
    const thumb = await makeThumb(saved.rel, finalType);
    db.run(
      `UPDATE media SET local_path = ?, thumb_path = ?, mime = ?, bytes = ?, sha256 = ?, width = ?, height = ?,
       duration = ?, type = ?, status = 'archived', error = NULL WHERE id = ?`,
      [saved.rel, thumb, saved.mime, saved.bytes, saved.sha256, p.width, p.height, p.duration, finalType, mediaId],
    );
  } catch (e) {
    db.run("UPDATE media SET local_path = ?, status = 'failed', error = ? WHERE id = ?", [
      saved.rel, (e as Error).message, mediaId,
    ]);
  }
}

function markFailed(refId: string, detail: string) {
  db.run("UPDATE refs SET status = 'failed', status_detail = ?, updated_at = ? WHERE id = ?", [detail, now(), refId]);
}

export function mimeFromExt(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
    avif: "image/avif", heic: "image/heic", svg: "image/svg+xml",
    mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska",
  };
  return map[ext] ?? "application/octet-stream";
}

