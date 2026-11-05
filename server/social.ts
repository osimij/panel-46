import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MediaType } from "./db.ts";
import { fetchWithTimeout, run, ytDlpError, ytDlpInfo } from "./media.ts";

export type SocialKind = "instagram" | "youtube" | "pinterest";

/** What we keep from a post, whichever site it came from. */
export interface Post {
  handle: string | null;
  name: string | null;
  avatar: string | null;
  title: string | null;
  text: string | null;
  postedAt: string | null;
  items: PostItem[];
}

export interface PostItem {
  type: MediaType;
  /** Direct file URL, when the site hands one out. */
  url: string | null;
  /** A page yt-dlp can fetch a better copy from (e.g. full-quality video). */
  page?: string;
  /** yt-dlp format sort for that page. */
  sort?: string;
}

export const SITE_NAME: Record<SocialKind, string> = { instagram: "Instagram", youtube: "YouTube", pinterest: "Pinterest" };

// ---------- Recognizing links ----------

/** Recognize a post link and boil it down to the site's own id for it. */
export function parseSocial(input: string): { kind: SocialKind; id: string; url: string } | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|mobile\.)/, "");

  if (host === "instagram.com" || host === "instagr.am") {
    const m = u.pathname.match(/^\/(?:[^/]+\/)?(p|reels?|tv)\/([\w-]+)/);
    if (!m) return null;
    const path = m[1] === "p" ? "p" : m[1] === "tv" ? "tv" : "reel";
    return { kind: "instagram", id: m[2]!, url: `https://www.instagram.com/${path}/${m[2]}/` };
  }

  if (host === "youtube.com" || host === "music.youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com") {
    let id: string | null = null;
    let shorts = false;
    if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0] ?? null;
    else if (u.pathname === "/watch") id = u.searchParams.get("v");
    else {
      const m = u.pathname.match(/^\/(shorts|live|embed|v)\/([\w-]{11})/);
      if (m) {
        id = m[2]!;
        shorts = m[1] === "shorts";
      }
    }
    if (!id || !/^[\w-]{11}$/.test(id)) return null;
    return {
      kind: "youtube",
      id,
      url: shorts ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`,
    };
  }

  if (/^([a-z]{2}\.)?pinterest\.[a-z.]+$/.test(host)) {
    const m = u.pathname.match(/^\/pin\/(?:[^/]*--)?(\d+)/);
    if (!m) return null;
    return { kind: "pinterest", id: m[1]!, url: `https://www.pinterest.com/pin/${m[1]}/` };
  }
  return null;
}

/** Short links (pin.it) only say where they go once followed. */
export async function expandShortLink(input: string): Promise<string> {
  try {
    const u = new URL(input.trim());
    if (u.hostname.replace(/^www\./, "") !== "pin.it") return input;
    const res = await fetchWithTimeout(u.href, { method: "GET" }, 15_000);
    res.body?.cancel();
    return res.url || input;
  } catch {
    return input;
  }
}

export async function fetchPost(kind: SocialKind, id: string, url: string): Promise<Post> {
  if (kind === "instagram") return instagram(id, url);
  if (kind === "youtube") return youtube(url);
  return pinterest(id);
}

const clean = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);
const iso = (secs?: number | null) => (secs ? new Date(secs * 1000).toISOString() : null);

// ---------- Instagram ----------

interface IgMedia {
  code?: string;
  media_type?: number; // 1 image, 2 video, 8 carousel
  taken_at?: number;
  caption?: { text?: string } | null;
  user?: { username?: string; full_name?: string; profile_pic_url?: string };
  image_versions2?: { candidates?: { url: string; width?: number }[] };
  video_versions?: { url: string }[] | null;
  carousel_media?: IgMedia[] | null;
}

/**
 * Instagram serves logged-out visitors through a session handshake that yt-dlp
 * already knows how to do. We let it make the requests (writing what Instagram
 * sent back to disk) and read the post from that: unlike yt-dlp's own output,
 * this includes photos and every slide of a carousel, not only videos.
 */
async function instagram(code: string, url: string): Promise<Post> {
  const dir = mkdtempSync(join(tmpdir(), "panel-ig-"));
  try {
    const { err } = await run(["yt-dlp", "--write-pages", "--skip-download", "--no-warnings", url], 90_000, dir);
    const files = readdirSync(dir);
    // yt-dlp also looks up each carousel slide on its own; we want the post itself.
    const read = (pattern: RegExp) => {
      const f = files.find((n) => n.startsWith(`${code}_`) && pattern.test(n));
      if (!f) return null;
      try {
        return JSON.parse(readFileSync(join(dir, f), "utf8"));
      } catch {
        return null;
      }
    };
    const media = read(/_api_graphql\.dump$/)?.data?.xig_polaris_media?.if_not_gated_logged_out as IgMedia | undefined;
    if (!media?.code) {
      const ruling = read(/get_ruling_for_content/) as { title?: string; description?: string } | null;
      const why = [ruling?.title, ruling?.description].filter(Boolean).join(": ");
      throw new Error(why || ytDlpError(err) || "Instagram didn't share this post");
    }

    const slides = media.carousel_media?.length ? media.carousel_media : [media];
    const items: PostItem[] = slides.map((m) => {
      const isVideo = m.media_type === 2 || !!m.video_versions?.length;
      if (!isVideo) return { type: "image", url: largest(m.image_versions2?.candidates) };
      // The direct link is a 720p version; yt-dlp assembles the full-quality one.
      return { type: "video", url: m.video_versions?.[0]?.url ?? null, page: `https://www.instagram.com/p/${m.code}/` };
    });

    return {
      handle: clean(media.user?.username),
      name: clean(media.user?.full_name),
      avatar: media.user?.profile_pic_url ?? null,
      title: null,
      text: clean(media.caption?.text),
      postedAt: iso(media.taken_at),
      items,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Instagram lists the original first, but say so explicitly: pick the widest
 * size when sizes are given (a stable sort keeps the first one on ties or when they aren't).
 */
function largest(candidates?: { url: string; width?: number }[]) {
  return [...(candidates ?? [])].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? null;
}

// ---------- YouTube ----------

async function youtube(url: string): Promise<Post> {
  const info = await ytDlpInfo(url);
  return {
    handle: clean(info.uploader_id?.replace(/^@/, "")) ?? clean(info.channel_id),
    name: clean(info.channel ?? info.uploader),
    avatar: info.channel_url ? await youtubeAvatar(info.channel_url) : null,
    title: clean(info.title),
    text: clean(info.description),
    postedAt: iso(info.timestamp) ?? (info.upload_date ? `${info.upload_date.slice(0, 4)}-${info.upload_date.slice(4, 6)}-${info.upload_date.slice(6, 8)}T00:00:00.000Z` : null),
    // Up to 1080p (by the short side, so Shorts stay sharp too); plenty to study, and keeps the library lean.
    items: [{ type: "video", url: null, page: url, sort: "res:1080,vcodec:h264,acodec:aac" }],
  };
}

/** The channel page's preview image is its avatar. */
async function youtubeAvatar(channelUrl: string) {
  try {
    const res = await fetchWithTimeout(channelUrl, { headers: { "accept-language": "en" } }, 15_000);
    const html = await res.text();
    return html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ?? null;
  } catch {
    return null;
  }
}

// ---------- Pinterest ----------

interface PinUser {
  username?: string;
  full_name?: string;
  image_medium_url?: string;
  image_large_url?: string;
}
interface PinVideoList {
  video_list?: Record<string, { url?: string; width?: number }>;
}
interface PinImages {
  orig?: { url?: string };
  [size: string]: { url?: string; width?: number } | undefined;
}
interface Pin {
  id?: string;
  title?: string;
  grid_title?: string;
  description?: string;
  closeup_unified_description?: string;
  auto_alt_text?: string;
  created_at?: string;
  images?: PinImages;
  videos?: PinVideoList | null;
  pinner?: PinUser;
  native_creator?: PinUser | null;
  story_pin_data?: {
    pages?: { blocks?: { block_type?: number; video?: PinVideoList; image?: { images?: PinImages } }[] }[];
  } | null;
  carousel_data?: { carousel_slots?: { images?: PinImages }[] } | null;
}

/** Pinterest's own JSON for a pin: original image, MP4s, idea-pin pages, carousel slides. */
async function pinterest(id: string): Promise<Post> {
  const data = JSON.stringify({ options: { id, field_set_key: "unauth_react_main_pin" } });
  const res = await fetchWithTimeout(
    `https://www.pinterest.com/resource/PinResource/get/?data=${encodeURIComponent(data)}`,
    { headers: { "X-Pinterest-PWS-Handler": "www/[username].js", accept: "application/json" } },
  );
  if (!res.ok) throw new Error(res.status === 404 ? "This pin no longer exists" : `Pinterest returned HTTP ${res.status}`);
  const pin = ((await res.json()) as { resource_response?: { data?: Pin } }).resource_response?.data;
  if (!pin?.id) throw new Error("Pinterest didn't share this pin");

  const pinPage = `https://www.pinterest.com/pin/${id}/`;
  const bestMp4 = (v?: PinVideoList | null) =>
    Object.values(v?.video_list ?? {})
      .filter((x) => x.url?.endsWith(".mp4"))
      .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? null;
  const bestImage = (im?: PinImages) => {
    if (!im) return null;
    if (im.orig?.url) return im.orig.url;
    return Object.values(im).sort((a, b) => (b?.width ?? 0) - (a?.width ?? 0))[0]?.url ?? null;
  };
  // Some videos only come as streams; yt-dlp can stitch those together.
  const video = (v?: PinVideoList | null): PostItem => {
    const url = bestMp4(v);
    return { type: "video", url, ...(url ? {} : { page: pinPage }) };
  };

  let items: PostItem[] = [];
  if (pin.videos?.video_list) items = [video(pin.videos)];
  else if (pin.story_pin_data?.pages?.length) {
    for (const page of pin.story_pin_data.pages)
      for (const b of page.blocks ?? []) {
        if (b.video?.video_list) items.push(video(b.video));
        else if (b.image?.images) items.push({ type: "image", url: bestImage(b.image.images) });
      }
  } else if (pin.carousel_data?.carousel_slots?.length) {
    items = pin.carousel_data.carousel_slots.map((s) => ({ type: "image" as MediaType, url: bestImage(s.images) }));
  }
  if (!items.length) items = [{ type: "image", url: bestImage(pin.images) }];

  // Credit whoever made it when Pinterest knows; otherwise whoever pinned it.
  const who = pin.native_creator?.username ? pin.native_creator : pin.pinner;
  const avatar = who?.image_large_url ?? who?.image_medium_url?.replace("/75x75_RS/", "/280x280_RS/") ?? null;
  return {
    handle: clean(who?.username),
    name: clean(who?.full_name),
    avatar,
    title: clean(pin.title) ?? clean(pin.grid_title),
    text: clean(pin.description) ?? clean(pin.closeup_unified_description),
    postedAt: pin.created_at ? new Date(pin.created_at).toISOString() : null,
    items,
  };
}
