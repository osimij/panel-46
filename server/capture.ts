import { rmSync } from "node:fs";
import { db, newId, now, parseLinks, refreshStatus, reindex, retag, type MediaRow, type MediaType, type RefRow } from "./db.ts";
import {
  abs, describeLocal, downloadTo, fetchWithTimeout, makeThumb, mediaTypeFor, probe, run, ytDlp, type YtInfo,
} from "./media.ts";
import { shootSite, type Viewport } from "./site.ts";
import { saveMeasured } from "./sitefacts.ts";
import { readIfAuto } from "./skillreads.ts";
import { expandShortLink, fetchPost, forgetPin, parsePinterestBoard, parseSocial, readBoard, SITE_NAME, type Post, type PostItem, type SocialKind } from "./social.ts";

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

// ---------- Profiles and skill files ----------

/**
 * Networks a person can be saved from, by their profile link. Each knows which
 * part of the address is the handle and what isn't a profile (their own pages).
 */
export type ProfilePlatform =
  | "instagram" | "x" | "threads" | "tiktok" | "youtube" | "linkedin" | "dribbble" | "behance"
  | "pinterest" | "vimeo" | "arena" | "bluesky" | "github";

const reserved = (words: string) => new Set(words.split(" "));
const IG_RESERVED = reserved("p reel reels tv explore stories accounts direct about legal developer web challenge");
const X_RESERVED = reserved(
  "home explore i search settings notifications messages compose intent share hashtag login signup logout tos privacy jobs lists communities premium account",
);
const DRIBBBLE_RESERVED = reserved(
  "shots designers jobs tags search signup session stories learn hiring pro about colors following uploads resources freelance-jobs places teams pros account settings messages notifications marketplace",
);
const BEHANCE_RESERVED = reserved("gallery search joblist galleries assets about hire live onboarding for_you moodboards misc blog features privacy");
const PINTEREST_RESERVED = reserved("pin ideas search today business settings _ explore login signup about news homefeed");
const VIMEO_RESERVED = reserved(
  "channels groups categories watch search upload features pricing about log_in join blog help stock ott enterprise solutions create manage live showcase solutions",
);
const ARENA_RESERVED = reserved("about explore search sign_up log_in settings pricing blog notifications feed");
const GITHUB_RESERVED = reserved(
  "features pricing about orgs topics explore marketplace settings login join sponsors trending collections enterprise team customer-stories security readme pulls issues notifications new codespaces apps",
);

/** A person's profile link on one of the networks above (not one of their posts). */
export function parseProfile(input: string): { platform: ProfilePlatform; handle: string; url: string } | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|mobile\.)/, "");
  const parts = u.pathname.split("/").filter(Boolean).map((p) => decodeURIComponent(p));
  const one = parts.length === 1 ? parts[0]! : null;
  const ok = (h: string | null | undefined, set?: Set<string>): h is string => !!h && !(set?.has(h.toLowerCase()));
  const at = (h: string | null | undefined) => (h?.startsWith("@") && h.length > 1 ? h.slice(1) : null);

  if (host === "instagram.com" && ok(one, IG_RESERVED) && /^[\w.]{1,30}$/.test(one))
    return { platform: "instagram", handle: one, url: `https://www.instagram.com/${one}/` };
  if ((host === "x.com" || host === "twitter.com") && ok(parts[0], X_RESERVED) && /^\w{1,15}$/.test(parts[0]!) &&
    (parts.length === 1 || (parts.length === 2 && /^(with_replies|media|highlights|articles)$/.test(parts[1]!))))
    return { platform: "x", handle: parts[0]!, url: `https://x.com/${parts[0]}` };
  if ((host === "threads.net" || host === "threads.com") && parts.length === 1 && at(one))
    return { platform: "threads", handle: at(one)!, url: `https://www.threads.net/@${at(one)}` };
  if (host === "tiktok.com" && parts.length === 1 && at(one))
    return { platform: "tiktok", handle: at(one)!, url: `https://www.tiktok.com/@${at(one)}` };
  if (host === "youtube.com" && parts.length >= 1 && parts.length <= 2 && (parts.length === 1 || /^(videos|featured|shorts|streams|about|playlists)$/.test(parts[1]!))) {
    if (at(parts[0])) return { platform: "youtube", handle: at(parts[0])!, url: `https://www.youtube.com/@${at(parts[0])}` };
  }
  if (host === "youtube.com" && parts.length >= 2 && /^(channel|c|user)$/.test(parts[0]!))
    return { platform: "youtube", handle: parts[1]!, url: `https://www.youtube.com/${parts[0]}/${parts[1]}` };
  if (host.endsWith("linkedin.com") && parts.length >= 2 && (parts[0] === "in" || parts[0] === "company"))
    return { platform: "linkedin", handle: parts[1]!, url: `https://www.linkedin.com/${parts[0]}/${parts[1]}/` };
  if (host === "dribbble.com" && ok(one, DRIBBBLE_RESERVED))
    return { platform: "dribbble", handle: one, url: `https://dribbble.com/${one}` };
  if (host === "behance.net" && ok(one, BEHANCE_RESERVED))
    return { platform: "behance", handle: one, url: `https://www.behance.net/${one}` };
  if (/^([a-z]{2}\.)?pinterest\.[a-z.]+$/.test(host) && ok(one, PINTEREST_RESERVED))
    return { platform: "pinterest", handle: one, url: `https://www.pinterest.com/${one}/` };
  if (host === "vimeo.com" && ok(one, VIMEO_RESERVED) && !/^\d+$/.test(one))
    return { platform: "vimeo", handle: one, url: `https://vimeo.com/${one}` };
  if (host === "are.na" && ok(one, ARENA_RESERVED))
    return { platform: "arena", handle: one, url: `https://www.are.na/${one}` };
  if (host === "bsky.app" && parts.length === 2 && parts[0] === "profile")
    return { platform: "bluesky", handle: parts[1]!, url: `https://bsky.app/profile/${parts[1]}` };
  if (host === "github.com" && ok(one, GITHUB_RESERVED) && /^[\w-]{1,39}$/.test(one))
    return { platform: "github", handle: one, url: `https://github.com/${one}` };
  return null;
}

/** A link to a Markdown file. GitHub page links are turned into the raw file. */
export function skillUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (!/\.(md|markdown)$/i.test(u.pathname)) return null;
  if (u.hostname === "github.com") {
    const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/);
    if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
  }
  return u.href;
}

/** A skill's name and one-line description, from its frontmatter, else its first heading and paragraph. */
export function readSkill(markdown: string, fileName = "") {
  const fm = markdown.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const field = (k: string) => {
    const m = fm?.[1]!.match(new RegExp(`^${k}:\\s*(.+(?:\\n[ \\t]+.+)*)`, "mi"));
    return m ? m[1]!.replace(/\s*\n\s*/g, " ").replace(/^(?:[>|][+-]?|["'-])\s*|["']$/g, "").trim() || null : null;
  };
  const rest = fm ? markdown.slice(fm[0].length) : markdown;
  const heading = rest.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim() ?? null;
  const para = rest
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .find((b) => b && !/^(#|```|[-*]\s|\d+\.\s|>|\|)/.test(b));
  const base = fileName.replace(/\.(md|markdown)$/i, "");
  return {
    title: field("name") ?? field("title") ?? heading ?? (base && !/^(skill|readme)$/i.test(base) ? base : null),
    description: field("description") ?? para?.replace(/\s+/g, " ").slice(0, 400) ?? null,
  };
}

/**
 * Store a skill file's text; the whole file is searchable. With "read automatically" on, the
 * skill is put in line to be read (skillreads.ts), whether it came as a file or a link.
 */
export function saveSkillText(refId: string, markdown: string, fileName: string) {
  const { title } = readSkill(markdown, fileName);
  db.run("UPDATE refs SET title = COALESCE(title, ?), text = ?, updated_at = ? WHERE id = ?", [title, markdown, now(), refId]);
  reindex(refId);
  refreshStatus(refId);
  readIfAuto([refId]);
}

async function captureSkillUrl(refId: string, url: string) {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return markFailed(refId, `${new URL(url).host} returned HTTP ${res.status}`);
    const text = await res.text();
    if (/^\s*<(!doctype|html)/i.test(text)) return markFailed(refId, "That link is a web page, not a Markdown file.");
    db.run("UPDATE refs SET creator_handle = ? WHERE id = ?", [new URL(url).hostname.replace(/^www\./, ""), refId]);
    saveSkillText(refId, text, decodeURIComponent(new URL(url).pathname.split("/").pop() ?? ""));
  } catch (e) {
    markFailed(refId, `Couldn't download the file: ${(e as Error).message}`);
  }
}

/** What we learn about a person from their profile. `stats` is a line like "12K followers · 300 following". */
interface Profile {
  name: string | null;
  handle: string;
  bio: string | null;
  stats: string | null;
  avatar: string | null;
  /** A banner or a piece of their work, shown behind them on the card. */
  cover: string | null;
}

const BOT_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

/**
 * A person's profile: name, photo and bio, as each network shares them with
 * logged-out visitors. Bluesky, GitHub and X (through a public mirror) have
 * open APIs; the rest describe profiles to link previews.
 */
async function captureAccount(refId: string, platform: ProfilePlatform, handle: string) {
  // Keep the handle from the link, so a profile that can't be read still shows who it is.
  db.run("UPDATE refs SET creator_handle = COALESCE(creator_handle, ?) WHERE id = ?", [handle, refId]);
  try {
    const p = await readProfile(platform, handle, db.query<{ source_url: string }, [string]>("SELECT source_url FROM refs WHERE id = ?").get(refId)!.source_url);
    if (!p) {
      markFailed(refId, `${PLATFORM_NAME[platform]} didn't share this profile. It may be private, gone, or need a login.`);
      // Their other links can still fill in the card.
      void enrichLinks(refId);
      return;
    }
    db.run("UPDATE refs SET creator_handle = ?, creator_name = ?, title = COALESCE(title, ?), text = ?, updated_at = ? WHERE id = ?", [
      p.handle, p.name, p.name ?? `@${p.handle}`, [p.bio, p.stats].filter(Boolean).join("\n\n") || null, now(), refId,
    ]);
    reindex(refId);
    // A refresh starts clean: no photo or cover is kept from before unless the network still has one.
    db.run("UPDATE refs SET avatar_path = NULL, preview_path = NULL WHERE id = ?", [refId]);
    await saveAvatar(refId, p.avatar ?? undefined);
    if (p.cover) {
      try {
        const saved = await downloadTo(p.cover, `${refId}/cover`);
        db.run("UPDATE refs SET preview_path = ? WHERE id = ?", [saved.rel, refId]);
      } catch {
        /* a cover is decoration */
      }
    }
    refreshStatus(refId);
    void enrichLinks(refId);
  } catch (e) {
    markFailed(refId, `Couldn't read the profile: ${(e as Error).message}`);
  }
}

export const PLATFORM_NAME: Record<ProfilePlatform, string> = {
  instagram: "Instagram", x: "X", threads: "Threads", tiktok: "TikTok", youtube: "YouTube", linkedin: "LinkedIn",
  dribbble: "Dribbble", behance: "Behance", pinterest: "Pinterest", vimeo: "Vimeo", arena: "Are.na", bluesky: "Bluesky", github: "GitHub",
};

async function readProfile(platform: ProfilePlatform, handle: string, url: string): Promise<Profile | null> {
  const json = async <T>(u: string, headers: Record<string, string> = {}) => {
    const res = await fetchWithTimeout(u, { headers: { "user-agent": "Panel/1.0", accept: "application/json", ...headers } });
    return res.ok ? ((await res.json()) as T) : null;
  };
  const stats = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" · ") || null;

  if (platform === "x") {
    // A browser user agent gets redirected to x.com itself; ask as an app.
    const u = await json<{
      name?: string; screen_name?: string; description?: string; profile_image_url?: string;
      followers_count?: number; following_count?: number; location?: string;
    }>(`https://api.vxtwitter.com/${encodeURIComponent(handle)}`);
    if (!u?.screen_name) return null;
    return {
      name: u.name ?? null, handle: u.screen_name, bio: (await expandTco(u.description ?? "")) || null,
      stats: stats(u.followers_count != null && `${compact(u.followers_count)} followers`, u.following_count != null && `${compact(u.following_count)} following`, u.location),
      avatar: u.profile_image_url?.replace(/_normal(\.\w+)$/, "_400x400$1") ?? null, cover: null,
    };
  }
  if (platform === "bluesky") {
    const u = await json<{
      handle?: string; displayName?: string; description?: string; avatar?: string; banner?: string;
      followersCount?: number; followsCount?: number; postsCount?: number;
    }>(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`);
    if (!u?.handle) return null;
    return {
      name: u.displayName || null, handle: u.handle, bio: u.description?.trim() || null,
      stats: stats(u.followersCount != null && `${compact(u.followersCount)} followers`, u.followsCount != null && `${compact(u.followsCount)} following`),
      avatar: u.avatar ?? null, cover: u.banner ?? null,
    };
  }
  if (platform === "github") {
    const u = await json<{
      login?: string; name?: string; bio?: string; avatar_url?: string; followers?: number; public_repos?: number;
      location?: string; blog?: string; company?: string;
    }>(`https://api.github.com/users/${encodeURIComponent(handle)}`, { accept: "application/vnd.github+json" });
    if (!u?.login) return null;
    return {
      name: u.name || null, handle: u.login, bio: [u.bio?.trim(), u.company].filter(Boolean).join(" · ") || null,
      stats: stats(u.followers != null && `${compact(u.followers)} followers`, u.public_repos != null && `${u.public_repos} repos`, u.location,
        u.blog?.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")),
      avatar: u.avatar_url ?? null, cover: null,
    };
  }

  // Everyone else: the profile's link preview. Instagram, Threads and TikTok only describe profiles to
  // preview bots; the rest give browsers more (the real profile photo, a fuller headline).
  let html = "";
  const botFirst = platform === "instagram" || platform === "threads" || platform === "tiktok";
  for (const ua of botFirst ? [BOT_UA, undefined] : [undefined, BOT_UA]) {
    const res = await fetchWithTimeout(url, ua ? { headers: { "user-agent": ua } } : {});
    html = res.ok ? await res.text() : "";
    if (/og:title/.test(html)) break;
  }
  const meta = (k: string) => {
    const m =
      html.match(new RegExp(`<meta[^>]+(?:property|name)="og:${k}"[^>]*content="([^"]*)"`, "i")) ??
      html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]*(?:property|name)="og:${k}"`, "i"));
    return m ? decodeEntities(m[1]!).trim() || null : null;
  };
  const title = meta("title");
  if (!title) return null;
  if (platform === "instagram" && meta("type") !== "profile") return null;
  const desc = meta("description");
  const image = meta("image");

  // Names come wrapped in the network's own words; unwrap them.
  let name = title
    .split(/\s+\|\s+/)[0]!
    .replace(/\s+on TikTok$/i, "")
    .replace(/\s*\((?:&#064;|@)?[\w.-]+\)\s*.*$/, "")
    .replace(/\s+[•·]\s+.*$/, "")
    .trim();
  let headline: string | null = null;
  if (platform === "linkedin" || platform === "behance" || platform === "pinterest") {
    const [n, ...rest] = name.split(" - ");
    name = n!.trim();
    headline = rest.join(" - ").replace(/\s{2,}/g, " ").trim() || null;
    if (platform === "pinterest" && headline === "Profile") headline = null;
  }

  let bio: string | null = desc;
  let line: string | null = null;
  if (platform === "instagram") {
    line = desc?.replace(/\s*-\s*See Instagram photos.*$/i, "").trim() ?? null;
    bio = null;
  } else if (platform === "threads" && desc) {
    // "5.8M Followers • 174 Threads • Their bio. See the latest conversations with @zuck."
    const [followers, threads, ...rest] = desc.replace(/\s*See the latest conversations.*$/i, "").split(/\s+•\s+/);
    line = stats(followers, threads);
    bio = rest.join(" • ").trim() || null;
  } else if (platform === "tiktok" && desc) {
    // "@name 163.0m Followers, 82 Following, 2693.4m Likes - Watch awesome short videos…"
    line = desc.replace(/^@[\w.]+\s+/, "").replace(/\s+-\s+Watch.*$/i, "").replace(/,\s*/g, " · ").trim() || null;
    bio = null;
  } else if (platform === "linkedin" && desc) {
    bio = desc.replace(/\s*·\s*(Experience|Education|Location|Connections):.*$/i, "").trim();
  }
  // Don't say the headline twice when the description starts with it.
  if (headline && bio?.startsWith(headline)) bio = bio.slice(headline.length).replace(/^\s*[·|•-]\s*/, "").trim() || null;
  if (bio && /^(Pinterest \| Find your reason|Discover|Watch|See|Explore)\b/i.test(bio)) bio = null;

  // Where the preview image is their work rather than their face, it's the cover, and the face is found on the page.
  let avatar: string | null = image;
  let cover: string | null = null;
  if (platform === "dribbble" || platform === "behance") {
    // Dribbble's is one of their shots; Behance's is a generated card with their name printed on it.
    cover = platform === "dribbble" ? image : null;
    avatar = html.match(/https:\/\/cdn\.dribbble\.com\/users\/\d+\/avatars\/[^"'?\s]+/)?.[0]?.replace("/avatars/normal/", "/avatars/original/") ??
      html.match(/https:\/\/mir-s3-cdn-cf\.behance\.net\/user\/\d+\/[^"'\\\s]+/)?.[0] ?? null;
  }
  if (avatar && /default_open_graph|static\.licdn\.com\/aero|ghost/i.test(avatar)) avatar = null;

  return { name: name || null, handle, bio: [headline, bio].filter(Boolean).join("\n") || null, stats: line, avatar, cover };
}

const compact = (n: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** X shortens every link in a bio to t.co; show where they really go. */
async function expandTco(text: string) {
  for (const link of new Set(text.match(/https:\/\/t\.co\/\w+/g) ?? [])) {
    try {
      const res = await fetchWithTimeout(link, { method: "HEAD" }, 8000);
      const to = res.url !== link ? res.url : null;
      if (to) text = text.replaceAll(link, to.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""));
    } catch {
      /* keep the short link */
    }
  }
  return text;
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

/**
 * `auto` marks saves nobody asked for just now (the extension's background sync):
 * those skip posts you deleted. Saving one again yourself brings it back.
 */
export async function capture(
  input: string,
  note = "",
  { auto = false, person = false } = {},
): Promise<{ id: string; existing: boolean } | { id: null; skipped: true } | { id: null; board: { name: string; pins: number } }> {
  input = await expandShortLink(input);
  const board = parsePinterestBoard(input);
  if (board) return { id: null, board: await captureBoard(board) };
  const x = parseXStatus(input);
  const social = x ? null : parseSocial(input);
  const profile = x || social ? null : parseProfile(input);
  const skill = x || social || profile ? null : skillUrl(input);
  let url: URL;
  try {
    url = new URL(x?.url ?? social?.url ?? profile?.url ?? input.trim());
    if (!/^https?:$/.test(url.protocol)) throw new Error();
  } catch {
    throw new Error("That doesn't look like a link.");
  }
  const kind = x ? "x" : social ? social.kind : profile ? "account" : skill ? "skill" : "web";
  const sourceId = x ? x.id : social ? social.id : profile ? `${profile.platform}:${profile.handle.toLowerCase()}` : url.href;
  // Profiles always belong under People & Accounts; any other link does when saved from there.
  person ||= !!profile;

  if (db.query("SELECT 1 FROM dismissed WHERE kind = ? AND source_id = ?").get(kind, sourceId)) {
    if (auto) return { id: null, skipped: true };
    db.run("DELETE FROM dismissed WHERE kind = ? AND source_id = ?", [kind, sourceId]);
  }

  const existing = db
    .query<RefRow, [string, string]>("SELECT * FROM refs WHERE kind = ? AND source_id = ?")
    .get(kind, sourceId);
  if (existing) {
    if (person && !existing.person) db.run("UPDATE refs SET person = 1, updated_at = ? WHERE id = ?", [now(), existing.id]);
    if (existing.status === "failed") retry(existing.id);
    return { id: existing.id, existing: true };
  }

  const id = newId();
  const ts = now();
  db.run(
    `INSERT INTO refs (id, kind, source_url, source_id, note, person, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [id, kind, url.href, sourceId, note, person ? 1 : 0, ts, ts],
  );
  reindex(id);
  // Profiles and skill files are one quick request each: don't make them wait behind downloads and screenshots.
  if (profile) void captureAccount(id, profile.platform, profile.handle);
  else if (skill) void captureSkillUrl(id, skill);
  else enqueue(() => (x ? captureX(id, x.id) : social ? captureSocial(id, social.kind, social.id, social.url) : captureWeb(id, url.href)));
  return { id, existing: false };
}

/**
 * A Pinterest board: every pin on it, each saved like a pasted pin. Answers with the
 * board's name and size right away and reads the pins in the background. Oldest go in
 * first so the board's newest pins end up on top in Panel too. Pins you removed from
 * Panel before stay out.
 */
async function captureBoard(board: { username: string; slug: string }) {
  const b = await readBoard(board);
  void (async () => {
    try {
      for (const pin of (await b.pins()).reverse()) {
        await capture(pin.url, "", { auto: true });
        await Bun.sleep(2); // each its own moment, so they keep the board's order
      }
    } catch (e) {
      console.error(`Board ${board.username}/${board.slug}:`, (e as Error).message);
    }
  })();
  return { name: b.name, pins: b.count };
}

export function retry(refId: string) {
  const ref = db.query<RefRow, [string]>("SELECT * FROM refs WHERE id = ?").get(refId);
  if (!ref || ref.kind === "upload" || (ref.kind === "skill" && !ref.source_url)) return;
  // A skill from a pack (skillpacks.ts) is a folder of files at one version, not one Markdown
  // file at its link: it is brought up to date by checking its pack for a newer version.
  if (ref.kind === "skill" && ref.source_id?.startsWith("pack:")) return;
  const media = db.query<MediaRow, [string]>("SELECT * FROM media WHERE ref_id = ? ORDER BY idx").all(refId);
  const failed = media.filter((m) => m.status === "failed" && m.remote_url);
  db.run("UPDATE refs SET status = 'pending', status_detail = NULL, updated_at = ? WHERE id = ?", [now(), refId]);

  const social = ref.kind === "instagram" || ref.kind === "youtube" || ref.kind === "pinterest" ? ref.kind : null;
  if (social && media.length && media.some((m) => m.status === "failed")) {
    // These sites' file links expire, so ask for fresh ones; keep files we already verified.
    const redo = media.filter((m) => m.status === "failed");
    for (const m of redo) db.run("UPDATE media SET status = 'pending', error = NULL WHERE id = ?", [m.id]);
    enqueue(() => captureSocial(refId, social, ref.source_id!, ref.source_url!, redo));
  } else if (failed.length) {
    // Re-download only what is missing; keep files we already verified.
    for (const m of failed) db.run("UPDATE media SET status = 'pending', error = NULL WHERE id = ?", [m.id]);
    enqueue(async () => {
      await Promise.all(failed.map((m) => saveRemote(m.id)));
      refreshStatus(refId);
    });
  } else {
    // We never got the post's contents: start over.
    db.run("DELETE FROM media WHERE ref_id = ?", [refId]);
    db.run("UPDATE refs SET link_profiles = NULL WHERE id = ?", [refId]); // their files go with the folder; read again after
    rmSync(abs(refId), { recursive: true, force: true });
    // The saved link, not the lowercased key: some handles (YouTube channel ids) are case-sensitive.
    const profile = ref.kind === "account" ? parseProfile(ref.source_url ?? "") : null;
    if (profile) return void captureAccount(refId, profile.platform, profile.handle);
    if (ref.kind === "account") return markFailed(refId, "This profile link isn't one Panel can read any more.");
    if (ref.kind === "skill") return void captureSkillUrl(refId, skillUrl(ref.source_url!) ?? ref.source_url!);
    enqueue(() =>
      ref.kind === "x"
        ? captureX(refId, ref.source_id!)
        : social
          ? captureSocial(refId, social, ref.source_id!, ref.source_url!)
          : captureWeb(refId, ref.source_url!),
    );
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
  applyYtInfo(refId, result.info, { handle: true });
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

// ---------- Instagram, YouTube, Pinterest ----------

/**
 * Read the post from the site, keep who made it and what they wrote, then save
 * every photo and video in it. On a retry (`redo`), only the files that failed
 * are fetched again, with fresh links.
 */
async function captureSocial(refId: string, kind: SocialKind, id: string, url: string, redo?: MediaRow[]) {
  let post: Post;
  try {
    post = await fetchPost(kind, id, url);
    if (kind === "pinterest") forgetPin(id);
  } catch (e) {
    const why = (e as Error).message;
    if (redo) {
      // Couldn't get fresh links; the old ones might still work.
      await Promise.all(redo.map((m) => saveRemote(m.id)));
      return refreshStatus(refId);
    }
    // The site wouldn't talk to us directly: yt-dlp may still get the video.
    const result = await ytDlp(url, refId);
    if (result.files.length) {
      applyYtInfo(refId, result.info, { handle: true });
      let idx = 0;
      for (const rel of result.files) await registerLocalFile(refId, idx++, rel, mimeFromExt(rel));
      return refreshStatus(refId);
    }
    return markFailed(refId, `Couldn't read this ${SITE_NAME[kind]} post. It may be private or deleted. (${why})`);
  }

  if (!redo) applyPost(refId, post);
  await saveAvatar(refId, post.avatar ?? undefined);

  const rows = redo ?? post.items.map((it, idx) => {
    const mediaId = newId();
    db.run("INSERT INTO media (id, ref_id, idx, type, remote_url, status) VALUES (?, ?, ?, ?, ?, 'pending')", [
      mediaId, refId, idx, it.type, it.url,
    ]);
    return { id: mediaId, idx } as MediaRow;
  });
  await Promise.all(
    rows.map((m) => {
      const item = post.items[m.idx];
      if (!item) {
        db.run("UPDATE media SET status = 'failed', error = ? WHERE id = ?", ["This file is no longer in the post", m.id]);
        return;
      }
      return saveItem(m.id, refId, m.idx, item);
    }),
  );
  refreshStatus(refId);
}

/** Prefer yt-dlp's full-quality copy where there is one; otherwise the direct file. */
async function saveItem(mediaId: string, refId: string, idx: number, item: PostItem) {
  db.run("UPDATE media SET remote_url = ? WHERE id = ?", [item.url, mediaId]);
  let why = "The site did not provide a downloadable file";
  if (item.page) {
    const r = await ytDlp(item.page, refId, { name: String(idx), sort: item.sort, format: item.format, timeoutMs: item.timeoutMs ?? 30 * 60_000 });
    if (r.files[0]) {
      for (const extra of r.files.slice(1)) rmSync(abs(extra), { force: true });
      return verifyAndStore(mediaId, await describeLocal(r.files[0], mimeFromExt(r.files[0])), item.type);
    }
    why = r.error ?? why;
  }
  if (item.url) return saveRemote(mediaId);
  db.run("UPDATE media SET status = 'failed', error = ? WHERE id = ?", [why, mediaId]);
}

function applyPost(refId: string, p: Post) {
  db.run(
    `UPDATE refs SET creator_handle = ?, creator_name = ?, title = ?, text = ?, posted_at = ?, updated_at = ? WHERE id = ?`,
    [p.handle, p.name, p.title, p.text, p.postedAt, now(), refId],
  );
  reindex(refId);
}

/** Fill in who/what/when from yt-dlp's metadata, where the site gave any. */
function applyYtInfo(refId: string, info: YtInfo | undefined, opts: { handle: boolean }) {
  if (!info) return;
  const name = info.channel ?? info.uploader;
  const handle = info.uploader_id && !/^\d+$/.test(info.uploader_id) ? info.uploader_id.replace(/^@/, "") : null;
  const date = info.timestamp ? new Date(info.timestamp * 1000).toISOString() : null;
  db.run(
    `UPDATE refs SET creator_name = COALESCE(?, creator_name),
       creator_handle = CASE WHEN ? THEN COALESCE(?, creator_handle) ELSE creator_handle END,
       text = COALESCE(NULLIF(text, ''), ?), posted_at = COALESCE(posted_at, ?), updated_at = ? WHERE id = ?`,
    [name ?? null, opts.handle ? 1 : 0, handle, info.description?.trim() || null, date, now(), refId],
  );
  reindex(refId);
}

/**
 * Posts saved as plain web links before these sites had their own capture:
 * give them their proper kind and fill in creator, caption and avatar. Files
 * already on disk are kept; only posts with nothing saved get re-captured.
 */
export async function upgradeSocialLinks() {
  const rows = db.query<RefRow, []>("SELECT * FROM refs WHERE kind = 'web'").all();
  for (const r of rows) {
    const s = r.source_url ? parseSocial(r.source_url) : null;
    if (!s) continue;
    const taken = db.query<{ id: string }, [string, string]>("SELECT id FROM refs WHERE kind = ? AND source_id = ?").get(s.kind, s.id);
    if (taken) continue; // saved twice; leave the old copy as it is
    db.run("UPDATE refs SET kind = ?, source_id = ?, source_url = ? WHERE id = ?", [s.kind, s.id, s.url, r.id]);
    const hasFiles = db.query<{ n: number }, [string]>("SELECT COUNT(*) n FROM media WHERE ref_id = ? AND status = 'archived'").get(r.id)!.n > 0;
    if (!hasFiles) {
      retry(r.id);
      continue;
    }
    enqueue(async () => {
      try {
        const post = await fetchPost(s.kind, s.id, s.url);
        // The old capture titled these after the site ("Instagram"); that isn't a real title.
        const autoTitle = !r.title || /instagram|youtube|pinterest/i.test(r.title);
        applyPost(r.id, autoTitle ? post : { ...post, title: r.title });
        await saveAvatar(r.id, post.avatar ?? undefined);
      } catch (e) {
        console.error("[upgrade]", r.source_url, (e as Error).message);
      }
    });
  }
}

// ---------- Any other link ----------

async function captureWeb(refId: string, url: string) {
  // A site that turns away scripts may still open in Chrome, so a failed fetch isn't the end.
  let res: Response | null = null;
  let reachError = "";
  try {
    res = await fetchWithTimeout(url, { method: "GET" });
  } catch (e) {
    reachError = (e as Error).message;
  }
  const mime = (res?.headers.get("content-type") ?? "").split(";")[0]!.trim();

  // A direct image or video link: save the file itself.
  const directType = mediaTypeFor(mime);
  if (res?.ok && directType) {
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

  // A page: keep its title/description. A video site yt-dlp knows (Vimeo, TikTok…)
  // gets its video saved; any other page is a website, kept as full-page screenshots.
  const html = res?.ok && mime.includes("html") ? await res.text() : "";
  if (!html) res?.body?.cancel();
  const meta = readMeta(html, url);
  db.run("UPDATE refs SET title = ?, text = ?, creator_handle = ?, creator_name = ?, updated_at = ? WHERE id = ?", [
    meta.title, meta.description, new URL(url).hostname.replace(/^www\./, ""), meta.siteName, now(), refId,
  ]);
  reindex(refId);

  const result = await ytDlp(url, refId, { generic: false });
  if (result.files.length) {
    applyYtInfo(refId, result.info, { handle: false });
    let idx = 0;
    for (const rel of result.files) await registerLocalFile(refId, idx++, rel, mimeFromExt(rel));
    refreshStatus(refId);
    return;
  }

  if (await captureSite(refId, url)) return;

  // No Chrome to take screenshots with: keep a bookmark with the page's preview image.
  if (meta.image) {
    try {
      const saved = await downloadTo(meta.image, `${refId}/preview`);
      db.run("UPDATE refs SET preview_path = ? WHERE id = ?", [saved.rel, refId]);
    } catch {
      /* a missing preview is fine for a bookmark */
    }
  }
  if (!res) return markFailed(refId, `Couldn't reach ${new URL(url).host}: ${reachError}`);
  if (!res.ok) return markFailed(refId, `${new URL(url).host} returned HTTP ${res.status}`);
  refreshStatus(refId); // no media rows -> link_only
}

/**
 * Full-page screenshots of a website, desktop then phone, plus its name and icon.
 * Returns false only when there's no Chrome to take them with.
 */
async function captureSite(refId: string, url: string): Promise<boolean> {
  let result: Awaited<ReturnType<typeof shootSite>>;
  try {
    result = await shootSite(url, refId);
  } catch (e) {
    if (/needs Google Chrome/.test((e as Error).message)) return false;
    db.run("UPDATE refs SET site = 1 WHERE id = ?", [refId]);
    markFailed(refId, `Couldn't take screenshots: ${(e as Error).message}`);
    return true;
  }
  db.run("UPDATE refs SET site = 1 WHERE id = ?", [refId]);
  retag(refId); // now a site: any tags it got while saving belong to Sites
  const { shots, info, facts, errors } = result;
  // Its fonts, sizes, colors and radii, as measured in the page (sitefacts.ts).
  saveMeasured(refId, facts);
  if (info) {
    // The page as Chrome saw it fills anything the plain fetch couldn't read.
    db.run(
      `UPDATE refs SET title = COALESCE(title, ?), text = COALESCE(text, ?), creator_name = COALESCE(creator_name, ?)
       WHERE id = ?`,
      [info.title, info.description, info.siteName, refId],
    );
    reindex(refId);
    await saveAvatar(refId, info.icon ?? undefined);
  }
  if (!shots.length) {
    markFailed(refId, `Couldn't take screenshots: ${errors[0] ?? "unknown error"}`);
    return true;
  }
  for (const [i, shot] of shots.entries()) {
    const mediaId = newId();
    db.run("INSERT INTO media (id, ref_id, idx, type, status) VALUES (?, ?, ?, 'image', 'pending')", [mediaId, refId, i]);
    try {
      const saved = await describeLocal(shot.rel, "image/jpeg");
      const p = await probe(shot.rel);
      const thumb = await makeSiteThumb(shot.rel, shot.viewport);
      db.run(
        `UPDATE media SET local_path = ?, thumb_path = ?, mime = ?, bytes = ?, sha256 = ?, width = ?, height = ?,
         status = 'archived', error = NULL WHERE id = ?`,
        [saved.rel, thumb, saved.mime, saved.bytes, saved.sha256, p.width, p.height, mediaId],
      );
    } catch (e) {
      db.run("UPDATE media SET status = 'failed', error = ? WHERE id = ?", [(e as Error).message, mediaId]);
    }
  }
  refreshStatus(refId);
  void enrichLinks(refId);
  return true;
}

/** The card shows the site's first screen, not a sliver of the whole page. */
async function makeSiteThumb(rel: string, vp: Viewport) {
  const thumbRel = rel.replace(/\.jpg$/, ".thumb.jpg");
  const ratio = (vp.height / vp.width).toFixed(4);
  const { code } = await run([
    "ffmpeg", "-y", "-v", "error", "-i", abs(rel), "-frames:v", "1",
    "-vf", `crop=iw:'min(ih,trunc(iw*${ratio}/2)*2)':0:0,scale='min(1200,iw)':-2:flags=lanczos`, "-q:v", "2", abs(thumbRel),
  ]);
  return code === 0 ? thumbRel : null;
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
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
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


// ---------- A person's other links ----------

/** What one of a person's links showed: a profile (with their face) or a website (with its icon). */
export interface LinkCard {
  kind: "profile" | "site";
  platform: string | null;
  name: string | null;
  handle: string | null;
  bio: string | null;
  stats: string | null;
  /** Photo or icon, saved under media/<ref>/links/. */
  avatar: string | null;
}

const enriching = new Map<string, Promise<void>>();

/**
 * Read each link added to a person (profiles for their photo, name and bio; websites
 * for their title and icon) so they can be shown as cards and give the person a face.
 * Links already read are kept; removed ones are forgotten. One run per person at a time.
 */
export function enrichLinks(refId: string): Promise<void> {
  const run = (enriching.get(refId) ?? Promise.resolve()).then(() => enrichNow(refId)).catch((e) => console.error("[links]", e));
  enriching.set(refId, run);
  return run;
}

async function enrichNow(refId: string) {
  const row = db.query<{ links: string | null; link_profiles: string | null; source_url: string | null }, [string]>(
    "SELECT links, link_profiles, source_url FROM refs WHERE id = ?",
  ).get(refId);
  if (!row) return;
  const links = parseLinks(row.links).filter((l) => l !== row.source_url && !l.startsWith("mailto:"));
  let known: Record<string, LinkCard> = {};
  try {
    known = JSON.parse(row.link_profiles ?? "{}");
  } catch {
    /* read them again */
  }
  const next: Record<string, LinkCard> = {};
  for (const url of links) {
    if (known[url]) {
      next[url] = known[url]!;
      continue;
    }
    const card = await readLink(refId, url).catch(() => null);
    if (card) next[url] = card;
    // Save as we go, so cards appear one by one; stop if the person was deleted meanwhile.
    if (!db.query("SELECT 1 FROM refs WHERE id = ?").get(refId)) return;
    db.run("UPDATE refs SET link_profiles = ? WHERE id = ?", [JSON.stringify(next), refId]);
  }
  db.run("UPDATE refs SET link_profiles = ?, updated_at = ? WHERE id = ?", [JSON.stringify(next), now(), refId]);
}

async function readLink(refId: string, url: string): Promise<LinkCard | null> {
  const file = `${refId}/links/${new Bun.CryptoHasher("sha1").update(url).digest("hex").slice(0, 12)}`;
  const keep = async (src: string | null) => {
    if (!src) return null;
    try {
      return (await downloadTo(src, file)).rel;
    } catch {
      return null;
    }
  };
  const profile = parseProfile(url);
  if (profile) {
    const p = await readProfile(profile.platform, profile.handle, profile.url);
    if (!p) return { kind: "profile", platform: profile.platform, name: null, handle: profile.handle, bio: null, stats: null, avatar: null };
    return { kind: "profile", platform: profile.platform, name: p.name, handle: p.handle, bio: p.bio, stats: p.stats, avatar: await keep(p.avatar) };
  }
  // A website: its name and icon.
  const res = await fetchWithTimeout(url, {}, 15_000);
  const html = res.ok && (res.headers.get("content-type") ?? "").includes("html") ? await res.text() : "";
  const meta = readMeta(html, res.url || url);
  const icon = pageIcon(html, res.url || url);
  return {
    kind: "site", platform: null, name: meta.siteName ?? meta.title, handle: new URL(url).hostname.replace(/^www\./, ""),
    bio: meta.description, stats: null, avatar: await keep(icon),
  };
}

/** The biggest square-ish icon a page offers, else /favicon.ico. */
function pageIcon(html: string, base: string) {
  const icons = [...html.matchAll(/<link[^>]+rel=["'][^"']*(?:icon|apple-touch-icon)[^"']*["'][^>]*>/gi)]
    .map((m) => {
      const tag = m[0];
      const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
      const size = parseInt(tag.match(/sizes=["'](\d+)/i)?.[1] ?? (/apple-touch/i.test(tag) ? "180" : "16"), 10);
      return href && !href.startsWith("data:") && !/\.svg(\?|$)/i.test(href) ? { href: new URL(href, base).href, size } : null;
    })
    .filter((x): x is { href: string; size: number } => !!x)
    .sort((a, b) => b.size - a.size);
  return icons[0]?.href ?? new URL("/favicon.ico", base).href;
}
