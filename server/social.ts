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
  /** yt-dlp format selection, when the default (mp4 only) would leave the best copy out. */
  format?: string;
  /** How long the download may take; big 4K/8K files need longer. */
  timeoutMs?: number;
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
    // Numeric ids, and the e1_… ids Pinterest gives pins seen while signed out.
    const m = u.pathname.match(/^\/pin\/(?:[^/]*--)?(\d+|e1_[\w-]+)/);
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
    // The best copy YouTube has: highest resolution (4K, 8K), then frame rate, then bitrate. 4K and up only
    // come as VP9 or AV1, so any codec is fine; at the same size normal colour (SDR) beats HDR, which looks
    // washed out on most screens. Original audio, not the volume-levelled "drc" track. Muxed into mp4.
    items: [{
      type: "video", url: null, page: url,
      format: "bv*+ba[format_id!*=drc]/bv*+ba/b",
      sort: "res,fps,+hdr,vcodec,acodec,br",
      timeoutMs: 3 * 60 * 60_000,
    }],
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
  originals?: { url?: string };
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
  // Pins handed over by a board listing or the extension. Stand-in ids (e1_…) can't be
  // looked up again, so use what came; a numeric id is read fresh (that has every page
  // of an idea pin), with what came as the fallback for secret boards.
  const known = knownPins.get(id);
  if (known && /^e1_/.test(id)) return pinToPost(known, id);
  const data = JSON.stringify({ options: { id, field_set_key: "unauth_react_main_pin" } });
  const res = await fetchWithTimeout(
    `https://www.pinterest.com/resource/PinResource/get/?data=${encodeURIComponent(data)}`,
    { headers: { "X-Pinterest-PWS-Handler": "www/[username].js", accept: "application/json" } },
  ).catch((e) => {
    if (known) return null;
    throw e;
  });
  if (!res?.ok && known) return pinToPost(known, id);
  if (!res) throw new Error("Pinterest didn't answer");
  if (!res.ok)
    throw new Error(
      res.status === 404
        ? /^e1_/.test(id)
          ? "Pinterest only shares this pin inside the board it came from. Paste the board link again"
          : "This pin no longer exists"
        : `Pinterest returned HTTP ${res.status}`,
    );
  const pin = ((await res.json()) as { resource_response?: { data?: Pin } }).resource_response?.data;
  if (!pin?.id) throw new Error("Pinterest didn't share this pin");
  return pinToPost(pin, id);
}

/** Pins handed over by a board listing, kept until each one is saved. */
const knownPins = new Map<string, Pin>();

async function pinToPost(pin: Pin, id: string): Promise<Post> {
  const pinPage = `https://www.pinterest.com/pin/${id}/`;
  const items: PostItem[] = [];
  if (pin.videos?.video_list) items.push(await pinVideo(pin.videos, pinPage));
  else if (pin.story_pin_data?.pages?.length) {
    for (const page of pin.story_pin_data.pages)
      for (const b of page.blocks ?? []) {
        if (b.video?.video_list) items.push(await pinVideo(b.video, pinPage));
        else if (b.image?.images) items.push({ type: "image", url: await pinImage(b.image.images) });
      }
  } else if (pin.carousel_data?.carousel_slots?.length) {
    for (const slot of pin.carousel_data.carousel_slots) items.push({ type: "image", url: await pinImage(slot.images) });
  }
  if (!items.length) items.push({ type: "image", url: await pinImage(pin.images) });

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

/**
 * The biggest copy of a pin image. Pinterest lists sizes up to 736px for some pins
 * (carousel slides especially) while the original sits at /originals/ under the same name.
 */
async function pinImage(im?: PinImages): Promise<string | null> {
  if (!im) return null;
  const listed = im.orig?.url ?? im.originals?.url;
  if (listed) return listed;
  const best = Object.values(im).sort((a, b) => (b?.width ?? 0) - (a?.width ?? 0))[0]?.url ?? null;
  const m = best?.match(/^(https:\/\/i\.pinimg\.com)\/[^/]+\/(.+?)\.(\w+)$/);
  if (!m) return best;
  for (const ext of [m[3]!, ...["jpg", "png", "webp", "gif"].filter((e) => e !== m[3])]) {
    const url = `${m[1]}/originals/${m[2]}.${ext}`;
    try {
      const res = await fetchWithTimeout(url, { headers: { range: "bytes=0-0" } }, 10_000);
      res.body?.cancel();
      if (res.ok) return url;
    } catch {
      break;
    }
  }
  return best;
}

/**
 * A pin video at the best quality offered. The MP4 Pinterest lists tops out at 720px;
 * its stream sometimes goes higher, and some videos only come as a stream. yt-dlp
 * stitches a stream into one file.
 */
async function pinVideo(v: PinVideoList, pinPage: string): Promise<PostItem> {
  const list = Object.values(v.video_list ?? {});
  const mp4 = list.filter((x) => x.url?.endsWith(".mp4")).sort((a, b) => mp4Width(b) - mp4Width(a))[0];
  const hls = list.find((x) => x.url?.endsWith(".m3u8"))?.url;
  const stream = { format: "bv*+ba/b", sort: "res,fps,br" };
  if (hls && (!mp4?.url || (await streamPixels(hls)) > (await filePixels(mp4.url))))
    return { type: "video", url: mp4?.url ?? null, page: hls, ...stream };
  if (mp4?.url) return { type: "video", url: mp4.url };
  return { type: "video", url: null, page: pinPage, ...stream };
}

/** Pinterest's listed width is the source's; the file name says what the MP4 really is (…_720w.mp4). */
const mp4Width = (x: { url?: string; width?: number }) => Number(x.url?.match(/_(\d+)w\.mp4$/)?.[1] ?? x.width ?? 0);

/** The biggest picture a stream offers, from its playlist. */
async function streamPixels(url: string): Promise<number> {
  try {
    const text = await (await fetchWithTimeout(url, {}, 10_000)).text();
    return Math.max(0, ...[...text.matchAll(/RESOLUTION=(\d+)x(\d+)/g)].map((m) => Number(m[1]) * Number(m[2])));
  } catch {
    return 0;
  }
}

/** A video file's picture size, read from its header without downloading it. */
async function filePixels(url: string): Promise<number> {
  const { out, code } = await run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", url], 20_000);
  const [w, h] = out.trim().split(",").map(Number);
  return code === 0 && w && h ? w * h : Number.MAX_SAFE_INTEGER; // unknown: keep the plain MP4
}

// ---------- Pinterest boards ----------

const BOARD_RESERVED = new Set(["pin", "pins", "ideas", "search", "today", "business", "settings", "_", "explore", "login", "signup", "about", "news", "homefeed", "resource", "_saved", "_created", "_profile", "boards", "followers", "following", "_shop", "more_ideas"]);

/** pinterest.com/{user}/{board}/ (a section, …/{board}/{section}/, saves the whole board). */
export function parsePinterestBoard(input: string): { username: string; slug: string; url: string } | null {
  try {
    const u = new URL(input.trim());
    if (!/^([a-z]{2}\.)?pinterest\.[a-z.]+$/.test(u.hostname.replace(/^www\./, ""))) return null;
    const [user, slug] = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (!user || !slug || BOARD_RESERVED.has(user.toLowerCase()) || BOARD_RESERVED.has(slug.toLowerCase())) return null;
    return { username: user, slug, url: `https://www.pinterest.com/${user}/${slug}/` };
  } catch {
    return null;
  }
}

async function pinResource<T>(name: string, handler: string, options: object): Promise<{ data?: T; bookmark?: string }> {
  const res = await fetchWithTimeout(
    `https://www.pinterest.com/resource/${name}/get/?data=${encodeURIComponent(JSON.stringify({ options }))}`,
    { headers: { "X-Pinterest-PWS-Handler": handler, accept: "application/json" } },
  );
  if (res.status === 404) throw new Error("Pinterest couldn't find this board. It may be secret or gone");
  if (!res.ok) throw new Error(`Pinterest returned HTTP ${res.status}`);
  const body = (await res.json()) as { resource_response?: { data?: T; bookmark?: string } };
  return body.resource_response ?? {};
}

/** A public board's name and size; `pins()` then reads every pin on it, newest first. */
export async function readBoard(board: { username: string; slug: string }) {
  const handler = "www/[username]/[slug].js";
  const info = (await pinResource<{ id?: string; name?: string; pin_count?: number }>("BoardResource", handler, {
    username: board.username, slug: board.slug, field_set_key: "detailed",
  })).data;
  if (!info?.id) throw new Error("Pinterest couldn't find this board. It may be secret or gone");
  const boardId = info.id;
  return {
    name: info.name ?? board.slug,
    count: info.pin_count ?? 0,
    /** Pinterest gives signed-out visitors stand-in ids (e1_…) here, so each pin's details are kept to save it from. */
    async pins() {
      const pins: { id: string; url: string }[] = [];
      let bookmark: string | undefined;
      for (let page = 0; page < 400; page++) {
        const r = await pinResource<(Pin & { type?: string })[]>("BoardFeedResource", handler, {
          board_id: boardId, board_url: `/${board.username}/${board.slug}/`, page_size: 50, field_set_key: "react_grid_pin",
          ...(bookmark ? { bookmarks: [bookmark] } : {}),
        });
        for (const p of r.data ?? []) {
          if (p.type !== "pin" || !p.id) continue;
          knownPins.set(p.id, p);
          pins.push({ id: p.id, url: `https://www.pinterest.com/pin/${p.id}/` });
        }
        bookmark = r.bookmark;
        if (!bookmark || bookmark === "-end-" || !r.data?.length) break;
      }
      return pins;
    },
  };
}

/** A pin's details as Pinterest gave them to the extension (signed in, so secret boards too). */
export function rememberPin(id: string, pin: unknown) {
  if (pin && typeof pin === "object" && (pin as Pin).id && knownPins.size < 20_000) knownPins.set(id, pin as Pin);
}

/** Once a pin is saved its listing details aren't needed any more. */
export const forgetPin = (id: string) => knownPins.delete(id);
