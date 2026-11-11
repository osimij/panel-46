export type RefStatus = "pending" | "archived" | "link_only" | "failed";

export interface Media {
  id: string;
  idx: number;
  type: "image" | "video" | "gif";
  status: "pending" | "archived" | "failed";
  error: string | null;
  url: string | null;
  thumb_url: string | null;
  /** A small silent copy of a video, for the grid. Missing when the original is small or it isn't made yet. */
  loop_url?: string | null;
  remote_url: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  bytes: number | null;
  sha256?: string | null;
  local_path?: string;
}

export interface Ref {
  id: string;
  /** "account": a person's Instagram or X profile. "skill": a Markdown file for AI agents; `text` holds the whole file. */
  kind: "x" | "instagram" | "youtube" | "pinterest" | "web" | "upload" | "account" | "skill";
  source_url: string | null;
  /** For a profile: "<network>:<handle>". */
  source_id: string | null;
  creator_handle: string | null;
  creator_name: string | null;
  title: string | null;
  text: string | null;
  note: string;
  favorite: boolean;
  hidden: boolean;
  /** A whole website: media[0] is the desktop page, media[1] the phone page. */
  site: boolean;
  /** Under People & Accounts: a profile, or a person's portfolio. */
  person: boolean;
  /** A person's other places you added: profiles, website, mailto: for email. */
  links: string[];
  /** What each added link showed, once read (a moment after adding it). */
  link_cards: Record<string, LinkCard>;
  status: RefStatus;
  status_detail: string | null;
  preview_url: string | null;
  avatar_url: string | null;
  posted_at: string | null;
  created_at: string;
  media: Media[];
  media_count: number;
  has_video: boolean;
  tags: string[];
  collections: { id: string; name: string }[];
  /** The AI's design read. Only on a single reference (api.ref), not in lists. */
  read?: DesignRead | null;
  /** A site's fonts and values, measured in the page. Only with the whole save. */
  measured?: Measured | null;
}

export interface Swatch {
  hex: string;
  share: number;
  name: string;
}

/** What the AI wrote about a reference. Every field can be missing on an older or damaged read. */
export interface Profile {
  summary?: string;
  format?: string[];
  mood?: string[];
  style_references?: string[];
  color?: { summary?: string; temperature?: string; contrast?: string; saturation?: string; roles?: { hex: string; role: string }[] };
  typography?: { present?: boolean; summary?: string; classification?: string[]; likely_fonts?: string[]; case?: string; scale_contrast?: string; tracking?: string };
  layout?: { summary?: string; density?: string; whitespace?: string; notable?: string[] };
  imagery?: { summary?: string; style?: string[] };
  motion?: { present?: boolean; summary?: string; pace?: string; techniques?: string[]; confidence?: string };
  components?: string[];
  worth_taking?: string[];
  search_terms?: string[];
  limits?: string;
}

export interface DesignRead {
  state: "queued" | "sent" | "done" | "failed";
  mode: "batch" | "now" | "subscription";
  model: string | null;
  model_label: string | null;
  palette: Swatch[];
  profile: Profile | null;
  /** The pictures the AI was shown. */
  visuals: { url: string; label: string }[];
  video: { duration: number; cuts: number; seconds_checked: number } | null;
  error: string | null;
  cost: number | null;
  read_at: string | null;
}

export interface ReadingStatus {
  key: boolean;
  /** "claude-code": through your Claude subscription. "api": an API key, in batches. */
  provider: "claude-code" | "api";
  /** Is the claude command line installed? */
  claude_code: boolean;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  subscription_reads: number;
  model: string;
  models: { id: string; label: string }[];
  auto: boolean;
  cap: number;
  spent_this_month: number;
  per_read: { cost: number; input_tokens: number; output_tokens: number; reads: number } | null;
  queued: number;
  sent: number;
  done: number;
  failed: number;
  unread: number;
  problem: string | null;
}

/** One of a person's links, read: a profile with their face, or a website with its icon. */
export interface LinkCard {
  kind: "profile" | "site";
  platform: string | null;
  name: string | null;
  handle: string | null;
  bio: string | null;
  stats: string | null;
  avatar_url: string | null;
}

export interface Collection {
  id: string;
  name: string;
  n: number;
  cover: string | null;
}

export interface Stats {
  total: number;
  favorites: number;
  hidden: number;
  sites: number;
  people: number;
  skills: number;
  videos: number;
  byStatus: Partial<Record<RefStatus, number>>;
  bytes: number;
  files: number;
  videoBytes: number;
  diskFree: number | null;
  libraryDir: string;
}

export interface TagInfo {
  name: string;
  n: number;
  group_id: string | null;
}

export interface TagGroup {
  id: string;
  name: string;
  position: number;
}

export interface Filters {
  q?: string;
  status?: RefStatus;
  type?: "image" | "video";
  favorite?: boolean;
  hidden?: boolean;
  site?: boolean;
  person?: boolean;
  skill?: boolean;
  /** The main library: everything except People & Accounts and Skills. */
  library?: boolean;
  collection?: string;
  /** Exactly these saves, in this order. */
  ids?: string[];
  tags?: string[];
  tagMode?: "all" | "any";
  /** At most this many (the server's own cap otherwise). */
  limit?: number;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

const body = (data: unknown) => JSON.stringify(data);

/** Search by meaning and by look: whether it's on, whether its models are here, how many saves are ready. */
export interface MeaningStatus {
  on: boolean;
  meaning_ready: boolean;
  look_ready: boolean;
  by_meaning: number;
  by_look: number;
  saves: number;
  working: boolean;
}

/** The library's snapshots: one a day on this Mac, and a second place for them and the media if set. */
export interface BackupStatus {
  snapshots: number;
  newest: string | null;
  last: string | null;
  bytes: number;
  folder: string;
  dir: string | null;
  dir_there: boolean;
  mirror_last: string | null;
  mirror_error: string | null;
  mirroring: boolean;
}

/** A website as measured in the page: the fonts it really uses, its sizes, colors and corner radii. */
export interface Measured {
  fonts: { family: string; role: "headings" | "text" | "both"; weights: number[]; share: number; cyrillic: boolean; tajik: boolean }[];
  sizes: number[];
  colors: { backgrounds: string[]; text: string[]; accents: string[] };
  radii: number[];
  smooth_corners: boolean;
  font_hosts: string[];
}

function filterParams(f: Filters) {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.status) p.set("status", f.status);
  if (f.type) p.set("type", f.type);
  if (f.favorite) p.set("favorite", "1");
  if (f.hidden) p.set("hidden", "1");
  if (f.site) p.set("site", "1");
  if (f.person) p.set("person", "1");
  if (f.skill) p.set("skill", "1");
  if (f.library) p.set("library", "1");
  if (f.collection) p.set("collection", f.collection);
  if (f.ids?.length) p.set("ids", f.ids.join(","));
  f.tags?.forEach((t) => p.append("tag", t));
  if (f.tagMode === "any") p.set("tagMode", "any");
  if (f.limit) p.set("limit", String(f.limit));
  return p;
}

/** The first saves of a view, with how many it has in all and the tags among all of them. */
export interface RefsPage {
  items: Ref[];
  total: number;
  tags: string[];
}

export const api = {
  /** The newest 200 that match (a picker's list, not the whole view). */
  refs: (f: Filters) => call<Ref[]>(`/api/refs?${filterParams(f)}`),
  /** The first `limit` saves of a view: the grid asks for more as it's scrolled. */
  refsPage(f: Filters, limit: number) {
    const p = filterParams(f);
    p.set("page", "1");
    p.set("limit", String(limit));
    return call<RefsPage>(`/api/refs?${p}`);
  },
  ref: (id: string) => call<Ref>(`/api/refs/${id}`),
  meaning: () => call<MeaningStatus>("/api/meaning"),
  setMeaning: (on: boolean) => call<MeaningStatus>("/api/meaning", { method: "PATCH", body: body({ on }) }),
  backup: () => call<BackupStatus>("/api/backup"),
  backupNow: () => call<BackupStatus>("/api/backup/run", { method: "POST" }),
  setBackupDir: (dir: string) => call<BackupStatus>("/api/backup", { method: "PATCH", body: body({ dir }) }),
  stats: () => call<Stats>("/api/stats"),
  revealLibrary: () => call<{ ok: boolean }>("/api/library/reveal", { method: "POST" }),
  collections: () => call<Collection[]>("/api/collections"),
  tags: (scope: Section) => call<TagInfo[]>(`/api/tags?scope=${scope}`),
  tagGroups: (scope: Section) => call<TagGroup[]>(`/api/tag-groups?scope=${scope}`),
  createTagGroup: (scope: Section, name: string, tags: string[] = []) =>
    call<TagGroup>(`/api/tag-groups?scope=${scope}`, { method: "POST", body: body({ name, tags }) }),
  renameTagGroup: (id: string, name: string) => call<{ ok: boolean }>(`/api/tag-groups/${id}`, { method: "PATCH", body: body({ name }) }),
  deleteTagGroup: (id: string) => call<{ ok: boolean }>(`/api/tag-groups/${id}`, { method: "DELETE" }),
  moveTag: (scope: Section, name: string, groupId: string | null) =>
    call<{ ok: boolean }>(`/api/tags/${encodeURIComponent(name)}/group?scope=${scope}`, { method: "PUT", body: body({ groupId }) }),
  capture: (url: string, opts: { person?: boolean } = {}) =>
    call<
      | { id: string; existing: boolean; ref: Ref; board?: undefined }
      | { id: null; board: { name: string; pins: number }; existing?: undefined; ref?: undefined }
    >("/api/capture", { method: "POST", body: body({ url, ...opts }) }),
  upload(files: File[]) {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    return call<{ ids: string[] }>("/api/upload", { method: "POST", body: form });
  },
  update: (id: string, patch: Partial<Pick<Ref, "title" | "note" | "favorite" | "hidden" | "person" | "links">>) =>
    call<Ref>(`/api/refs/${id}`, { method: "PATCH", body: body(patch) }),
  setTags: (id: string, tags: string[]) => call<Ref>(`/api/refs/${id}/tags`, { method: "PUT", body: body({ tags }) }),
  /** Media ids in the order to show them; the first becomes the card's cover. */
  reorder: (id: string, mediaIds: string[]) =>
    call<Ref>(`/api/refs/${id}/order`, { method: "PUT", body: body({ ids: mediaIds }) }),
  setCollections: (id: string, ids: string[]) =>
    call<Ref>(`/api/refs/${id}/collections`, { method: "PUT", body: body({ ids }) }),
  retry: (id: string) => call<Ref>(`/api/refs/${id}/retry`, { method: "POST" }),
  reveal: (id: string) => call<{ ok: boolean }>(`/api/refs/${id}/reveal`, { method: "POST" }),
  remove: (id: string) => call<{ ok: boolean }>(`/api/refs/${id}`, { method: "DELETE" }),
  hideMany: (ids: string[], hidden: boolean) =>
    call<{ ok: boolean; changed: number }>("/api/refs/hide", { method: "POST", body: JSON.stringify({ ids, hidden }) }),
  removeMany: (ids: string[]) =>
    call<{ ok: boolean; removed: number }>("/api/refs/delete", { method: "POST", body: JSON.stringify({ ids }) }),
  createCollection: (name: string) => call<Collection>("/api/collections", { method: "POST", body: body({ name }) }),
  renameCollection: (id: string, name: string) =>
    call<{ ok: boolean }>(`/api/collections/${id}`, { method: "PATCH", body: body({ name }) }),
  createTag: (scope: Section, name: string) => call<{ name: string }>(`/api/tags?scope=${scope}`, { method: "POST", body: body({ name }) }),
  deleteTag: (scope: Section, name: string) =>
    call<{ ok: boolean }>(`/api/tags/${encodeURIComponent(name)}?scope=${scope}`, { method: "DELETE" }),
  renameTag: (scope: Section, from: string, name: string) =>
    call<{ name: string }>(`/api/tags/${encodeURIComponent(from)}?scope=${scope}`, { method: "PATCH", body: body({ name }) }),
  ai: () => call<ReadingStatus>("/api/ai"),
  aiSettings: (patch: Partial<Pick<ReadingStatus, "model" | "auto" | "cap" | "provider" | "effort">>) =>
    call<ReadingStatus>("/api/ai", { method: "PATCH", body: body(patch) }),
  /** Read these references, or the next `limit` unread ones. "now" is full price, right away. */
  aiRead: (opts: { ids?: string[]; limit?: number; mode?: "batch" | "now" }) =>
    call<ReadingStatus & { added: number }>("/api/ai/read", { method: "POST", body: body(opts) }),
  deleteCollection: (id: string) => call<{ ok: boolean }>(`/api/collections/${id}`, { method: "DELETE" }),
  duplicateCollection: (id: string) => call<Collection>(`/api/collections/${id}/duplicate`, { method: "POST" }),
};

/**
 * Panel's four kinds of page. Each keeps its own tags, and asks for the note and
 * tags that make sense for what's in it.
 */
export type Section = "library" | "sites" | "people" | "skills";

export function sectionOf(r: Pick<Ref, "kind" | "person" | "site">): Section {
  if (r.kind === "skill") return "skills";
  if (r.person) return "people";
  if (r.site) return "sites";
  return "library";
}

export const SECTION_UI: Record<
  Section,
  { tagsLabel: string; tagsPlaceholder: string; starters: string[]; noteLabel: string; notePlaceholder: string; collections: boolean }
> = {
  library: {
    tagsLabel: "Tags",
    tagsPlaceholder: "typography, menu, dark…",
    starters: [],
    noteLabel: "Note",
    notePlaceholder: "What do you like about it? e.g. love how this menu opens",
    collections: true,
  },
  sites: {
    tagsLabel: "Kind of site",
    tagsPlaceholder: "portfolio, agency, webgl…",
    starters: [
      "portfolio", "agency", "studio", "e-commerce", "saas", "landing page", "editorial", "brand", "webgl", "3d", "motion",
      "scroll", "typography", "minimal", "dark", "experimental",
    ],
    noteLabel: "What stands out",
    notePlaceholder: "e.g. the scroll-driven 3D, the type pairing, how the menu opens",
    collections: false,
  },
  people: {
    tagsLabel: "Field",
    tagsPlaceholder: "web design, industrial design…",
    starters: [
      "web design", "product design", "brand identity", "industrial design", "motion", "3d", "typography", "illustration",
      "creative development", "art direction", "photography", "architecture", "graphic design", "ui design",
    ],
    noteLabel: "Why them",
    notePlaceholder: "What do you admire about them or their work?",
    collections: false,
  },
  skills: {
    tagsLabel: "Used for",
    tagsPlaceholder: "coding, writing, research…",
    starters: ["coding", "frontend", "backend", "design", "writing", "research", "data", "docs", "testing", "devops", "marketing"],
    noteLabel: "When to use it",
    notePlaceholder: "e.g. when building landing pages, before a code review",
    collections: false,
  },
};

export const STATUS_LABEL: Record<RefStatus, string> = {
  archived: "Archived",
  link_only: "Link only",
  failed: "Copy failed",
  pending: "Saving…",
};

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export function formatDuration(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export function displayTitle(r: Ref) {
  if (r.kind === "skill") return r.title || "Untitled skill";
  if (r.title || r.text) return r.title || r.text!.split("\n")[0]!;
  if (r.creator_handle) return `@${r.creator_handle}`;
  const handle = r.kind === "x" && r.source_url?.match(/x\.com\/([^/]+)\/status/)?.[1];
  if (handle && handle !== "i") return `Post by @${handle}`;
  return r.source_url ? new URL(r.source_url).hostname.replace(/^www\./, "") : "Untitled";
}

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Sites we read posts from properly: their name and where a creator's profile lives. */
const SITES = {
  x: { name: "X", label: "Post on X", profile: (h: string) => `https://x.com/${h}` },
  instagram: { name: "Instagram", label: "Post on Instagram", profile: (h: string) => `https://www.instagram.com/${h}/` },
  youtube: {
    name: "YouTube",
    label: "Video on YouTube",
    profile: (h: string) => (isChannelId(h) ? `https://www.youtube.com/channel/${h}` : `https://www.youtube.com/@${h}`),
  },
  pinterest: { name: "Pinterest", label: "Pin on Pinterest", profile: (h: string) => `https://www.pinterest.com/${h}/` },
};
const isChannelId = (h: string) => /^UC[\w-]{22}$/.test(h);

/** Networks a person can be saved from, by name. Profiles link back to the saved address. */
export const PLATFORM_NAME: Record<string, string> = {
  instagram: "Instagram", x: "X", threads: "Threads", tiktok: "TikTok", youtube: "YouTube", linkedin: "LinkedIn",
  dribbble: "Dribbble", behance: "Behance", pinterest: "Pinterest", vimeo: "Vimeo", arena: "Are.na", bluesky: "Bluesky", github: "GitHub",
};

export function site(r: Ref) {
  if (r.kind === "account") {
    const p = accountPlatform(r);
    const name = (p && PLATFORM_NAME[p]) ?? "Profile";
    return { name, label: `Profile on ${name}`, profile: () => r.source_url ?? "" };
  }
  return r.kind in SITES ? SITES[r.kind as keyof typeof SITES] : null;
}

/** Which network a saved profile is on. */
export function accountPlatform(r: Ref): string | null {
  if (r.kind !== "account") return null;
  return r.source_id?.split(":")[0] ?? null;
}

const LINK_HOSTS: [RegExp, string][] = [
  [/(^|\.)instagram\.com$/, "Instagram"], [/(^|\.)(x|twitter)\.com$/, "X"], [/(^|\.)threads\.(net|com)$/, "Threads"],
  [/(^|\.)tiktok\.com$/, "TikTok"], [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube"], [/(^|\.)linkedin\.com$/, "LinkedIn"],
  [/(^|\.)dribbble\.com$/, "Dribbble"], [/(^|\.)behance\.net$/, "Behance"], [/(^|\.)pinterest\.[a-z.]+$/, "Pinterest"],
  [/(^|\.)vimeo\.com$/, "Vimeo"], [/(^|\.)are\.na$/, "Are.na"], [/(^|\.)bsky\.app$/, "Bluesky"], [/(^|\.)github\.com$/, "GitHub"],
  [/(^|\.)read\.cv$/, "Read.cv"], [/(^|\.)cosmos\.so$/, "Cosmos"], [/(^|\.)medium\.com$/, "Medium"], [/(^|\.)substack\.com$/, "Substack"],
  [/(^|\.)figma\.com$/, "Figma"], [/(^|\.)framer\.(com|website)$/, "Framer"], [/(^|\.)savee\.it$/, "Savee"],
];

/** How to show one of a person's links: which place it is, and the short form of the address. */
export function describeLink(href: string): { kind: string; text: string; email: boolean } {
  try {
    const u = new URL(href);
    if (u.protocol === "mailto:") return { kind: "Email", text: decodeURIComponent(u.pathname), email: true };
    const host = u.hostname.replace(/^www\./, "");
    const kind = LINK_HOSTS.find(([re]) => re.test(host))?.[1] ?? "Website";
    const path = decodeURIComponent(u.pathname).replace(/\/$/, "");
    // On a network, the handle is what matters; on a website, the address.
    const handle = path.split("/").filter(Boolean).filter((p) => !/^(in|profile|company|channel|c|user)$/.test(p))[0];
    const text = kind !== "Website" && handle ? (handle.startsWith("@") ? handle : `@${handle}`) : host + path;
    return { kind, text, email: false };
  } catch {
    return { kind: "Link", text: href, email: false };
  }
}

/** A profile's text: the bio, then a line of counts ("12K followers · 300 following") when there is one. */
export function profileParts(r: Ref) {
  const paras = (r.text ?? "").split("\n\n").map((p) => p.trim()).filter(Boolean);
  const last = paras.at(-1);
  const hasStats = !!last && /\b(followers?|following|repos?|likes|posts|threads|connections)\b/i.test(last);
  return { bio: (hasStats ? paras.slice(0, -1) : paras).join("\n\n") || null, stats: hasStats ? last! : null };
}

/** A skill file's frontmatter fields and the Markdown after it. */
export function skillParts(markdown: string) {
  const fm = markdown.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const fields: [string, string][] = [];
  if (fm) {
    let last: [string, string] | null = null;
    for (const line of fm[1]!.split(/\r?\n/)) {
      const m = line.match(/^([\w-]+):\s*(.*)$/);
      if (m) fields.push((last = [m[1]!, m[2]!.replace(/^(?:[>|][+-]?|["'-])\s*|["']$/g, "")]));
      else if (last && line.trim()) last[1] = `${last[1]} ${line.trim()}`.trim();
    }
  }
  const body = fm ? markdown.slice(fm[0].length) : markdown;
  const para = body
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .find((b) => b && !/^(#|```|[-*]\s|\d+\.\s|>|\|)/.test(b));
  const get = (k: string) => fields.find(([key]) => key.toLowerCase() === k)?.[1] || null;
  return { fields, body, description: get("description") ?? para?.replace(/\s+/g, " ") ?? null };
}

/** "@name", unless the site only gave us an opaque id (or the network doesn't use @handles). */
export function atHandle(r: Ref) {
  if (r.kind === "account" && ["linkedin", "arena"].includes(accountPlatform(r) ?? "")) return null;
  return r.creator_handle && !isChannelId(r.creator_handle) ? `@${r.creator_handle}` : null;
}

export function sourceLabel(r: Ref) {
  const s = site(r);
  if (s) return s.label;
  if (r.kind === "upload") return "Added from this Mac";
  if (r.kind === "skill") return r.source_url ? r.creator_handle ?? "Skill" : "Skill file from this Mac";
  return r.creator_handle ?? "Website";
}

export const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Profiles whose photo best stands for the person, most personal first. */
const FACE_ORDER = ["instagram", "x", "threads", "bluesky", "linkedin", "tiktok", "dribbble", "behance", "github", "youtube", "vimeo", "arena", "pinterest"];

/**
 * Everything a person card shows, from whatever is known about them: the profile
 * they were saved from, profiles added under Links, or only their website. A real
 * photo wins; a website alone shows its icon in a rounded square instead of a face.
 */
export function personFace(r: Ref) {
  const cards = Object.entries(r.link_cards ?? {});
  const linked = cards
    .filter(([, c]) => c.kind === "profile" && c.avatar_url)
    .sort(([, a], [, b]) => FACE_ORDER.indexOf(a.platform ?? "") - FACE_ORDER.indexOf(b.platform ?? ""))[0]?.[1];
  const account = r.kind === "account";
  const own = account ? profileParts(r) : { bio: null, stats: null };
  const siteName = r.title?.split(/\s+[|–—·•-]\s+/)[0]?.trim() || null;
  const host = r.source_url ? new URL(r.source_url).hostname.replace(/^www\./, "") : null;

  const photo = account ? r.avatar_url : linked?.avatar_url ?? null;
  const name = account ? r.creator_name ?? atHandle(r) ?? displayTitle(r) : linked?.name ?? siteName ?? host ?? displayTitle(r);
  const sub = account ? [atHandle(r), site(r)?.name].filter(Boolean).join(" · ") : host ?? "";
  const bio = account ? own.bio : linked?.bio ?? (r.site ? r.text : null);
  const stats = account ? own.stats : linked?.stats ?? null;

  // Where they are, in order: where they were saved from, then each added place.
  const places = [account ? site(r)?.name : "Website", ...r.links.map((l) => describeLink(l).kind)].filter(
    (x, i, a): x is string => !!x && a.indexOf(x) === i,
  );
  return {
    photo,
    /** No face, only the site's icon: shown on a tile, not cropped into a circle. */
    logo: !photo ? (r.avatar_url ?? null) : null,
    name,
    sub,
    bio,
    stats,
    /** A portfolio's first screen, or a banner or piece of work from the profile. */
    cover: r.site ? r.media[0]?.thumb_url ?? null : r.preview_url,
    places,
  };
}

// ---------- The assistant ----------

export interface RefCard {
  id: string;
  title: string;
  type: string;
  thumb: string | null;
  /** Height over width. */
  ratio: number;
  palette: string[];
  by?: string;
}

export type ChatPart =
  | { type: "text"; text: string }
  // The conversation was summarized here to make room.
  | { type: "compact"; pre: number; post?: number; done: true; model?: string }
  // `model`: which model did it, when one plans and another builds.
  | { type: "thinking"; ms?: number; done?: boolean; model?: string }
  | { type: "tool"; id: string; name: string; model?: string; input?: Record<string, unknown>; refs?: string[]; total?: number; error?: string; done?: boolean };

/** A file attached to a message, as the conversation shows it. Its picture is at /api/chat-files/<id>/view. */
export interface ChatFileNote { id: string; name: string; picture: boolean }
/** A file just attached, back from the server. */
export interface ChatFile { id: string; name: string; mime: string | null; size: number | null; picture: boolean; url: string; thumb_url: string | null }

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  context: { open?: string; nodes?: string[]; label?: string; thumbs?: string[]; files?: ChatFileNote[] } | null;
  parts: ChatPart[];
  status: "done" | "streaming" | "stopped" | "error" | string;
  error: string | null;
  created_at: string;
}

/** project: the project the conversation belongs to, null for the library. */
export interface ChatSummary { id: string; title: string; updated_at: string; running: boolean; project: string | null; project_name: string | null }
/** One line of the context meter's panel (server/contextparts.ts). */
export interface ContextPart { name: string; tokens: number }
/** What fills a conversation: named rows, biggest first, the room left last. */
export interface ContextParts {
  rows: (ContextPart & { id: string; kind: "used" | "buffer" | "free" })[];
  /** What the conversation row is made of; null when Claude Code didn't say. */
  talk: (ContextPart & { id: "read" | "answers" | "yours"; tools?: ContextPart[] })[] | null;
}
/**
 * How full a conversation is, in tokens, where it gets summarized to make room, and what
 * fills it (null for a conversation whose answers were all made before the meter).
 */
export interface ContextUse { used: number; limit: number; parts?: ContextParts | null }
export interface ChatFull { id: string; title: string; project: string | null; messages: ChatMessage[]; cards: RefCard[]; running: boolean; seq: number; context: ContextUse | null }

export type ChatEvent =
  | { t: "start"; message: ChatMessage }
  | { t: "thinking"; on: boolean; ms?: number; model?: string }
  | { t: "tool"; id: string; name: string; model?: string }
  | { t: "tool_input"; id: string; input: Record<string, unknown>; partial?: boolean }
  | { t: "tool_result"; id: string; refs: string[]; cards: RefCard[]; total?: number; error?: string }
  // A sketch's page as written so far, while FRIDAY is still writing it.
  | { t: "draft"; id: string; html: string }
  | { t: "text"; delta: string }
  | { t: "compact"; pre: number; post?: number }
  | { t: "context"; used: number; limit: number; parts: ContextParts | null }
  | { t: "title"; title: string }
  | { t: "done"; status: "done" | "stopped" | "error"; error?: string }
  | { t: "idle" };

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
/** Which model answers and how hard it thinks; or, in "duo", which plans and which builds. */
export interface ChatSettings {
  mode: "solo" | "duo";
  model: string;
  effort: Effort;
  plan_model: string;
  plan_effort: Effort;
  build_model: string;
  build_effort: Effort;
  models: { id: string; name: string; note: string }[];
}

export const chatApi = {
  list: () => call<ChatSummary[]>("/api/chats"),
  create: (project?: string | null) => call<{ id: string }>("/api/chats", { method: "POST", body: body({ project: project ?? null }) }),
  get: (id: string) => call<ChatFull>(`/api/chats/${id}`),
  remove: (id: string) => call<{ ok: boolean }>(`/api/chats/${id}`, { method: "DELETE" }),
  attach: (files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append("file", f, f.name);
    return call<{ added: ChatFile[]; failed: string[] }>("/api/chat-files", { method: "POST", body: form });
  },
  unattach: (fid: string) => call<{ ok: boolean }>(`/api/chat-files/${fid}`, { method: "DELETE" }),
  send: (id: string, text: string, context: { open?: string; project?: string; nodes?: string[]; label?: string; thumbs?: string[]; point?: SketchPoint; fan?: number; files?: string[]; figma?: CanvasSelection["figma"] }) =>
    call<{ user: ChatMessage; assistant: ChatMessage }>(`/api/chats/${id}/messages`, { method: "POST", body: body({ text, context }) }),
  stop: (id: string) => call<{ stopped: boolean }>(`/api/chats/${id}/stop`, { method: "POST" }),
  cards: (ids: string[]) => call<RefCard[]>(`/api/cards?ids=${ids.join(",")}`),
  settings: () => call<ChatSettings>("/api/chat/settings"),
  setSettings: (patch: Partial<Omit<ChatSettings, "models">>) =>
    call<ChatSettings>("/api/chat/settings", { method: "PATCH", body: body(patch) }),
  /**
   * Follow a running answer from event `after` on. Calls `on` for each event with its
   * number; resolves when the answer ends (or there's nothing running).
   */
  async follow(id: string, after: number, on: (e: ChatEvent, seq: number) => void, signal: AbortSignal) {
    const res = await fetch(`/api/chats/${id}/stream?after=${after}`, { signal });
    if (!res.body) return;
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    let seq = after;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let end: number;
      while ((end = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, end);
        buf = buf.slice(end + 2);
        let data = "";
        for (const line of chunk.split("\n")) {
          if (line.startsWith("id: ")) seq = Number(line.slice(4));
          else if (line.startsWith("data: ")) data += line.slice(6);
        }
        if (data) on(JSON.parse(data) as ChatEvent, seq);
      }
    }
  },
};


// ---------- Projects: a canvas per piece of work ----------

export type TopicFacet = "typography" | "color" | "layout" | "imagery" | "motion" | "components" | "other";
export type RefState = "proposed" | "kept" | "chosen" | "ruled_out";

export interface BoardNode {
  id: string;
  kind: "topic" | "ref" | "note" | "sketch" | "build";
  ref_id: string | null;
  /** topic: { title, facet, status, summary } · ref: { state, taking } · note: { text } · sketch: { title, tries, state, version } */
  data: Record<string, unknown>;
  x: number;
  y: number;
  origin?: string;
  created_at?: string;
}
export interface BoardEdge { id: string; source: string; target: string; label: string }

export interface ProjectSummary {
  id: string;
  name: string;
  brief: string;
  nodes: number;
  refs: number;
  topics: number;
  locked: number;
  created_at: string;
  updated_at: string;
  /** When it was archived; null while it is in use. */
  archived_at: string | null;
}
export interface ProjectFull {
  id: string;
  name: string;
  brief: string;
  seq: number;
  nodes: BoardNode[];
  edges: BoardEdge[];
  cards: RefCard[];
}

export type BoardOp =
  | { op: "add_node"; node: { id?: string; kind: BoardNode["kind"]; ref_id?: string | null; data?: Record<string, unknown>; x: number; y: number } }
  | { op: "update_node"; id: string; data?: Record<string, unknown>; x?: number; y?: number }
  | { op: "remove_node"; id: string }
  | { op: "add_edge"; edge: { id?: string; source: string; target: string; label?: string } }
  | { op: "remove_edge"; id: string }
  | { op: "update_project"; name?: string; brief?: string };

export interface BoardEvent {
  seq: number;
  at: string;
  /** designer · assistant (Claude, from Ask or any MCP app) */
  actor: string;
  client: string | null;
  /** What the change did, in a few words ("Placed 6 saves under Typography"). */
  label?: string | null;
  /** This change undid that one. */
  undo_of?: number | null;
  ops: BoardOp[];
}

/** Ids made here, so a node can be drawn before the companion has answered. Same shape as the companion's. */
export const localId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 16);

/** What's selected on a project's canvas, for Ask to talk about. */
export interface CanvasSelection {
  project: string;
  /** Canvas node ids. */
  nodes: string[];
  /** In a few words: “Typography”, “a save”, “Color, 3 saves and a note”. */
  label: string;
  /** Up to 3 small pictures of the saves in it. */
  thumbs: string[];
  /** A part of a sketch pointed at in the studio. */
  point?: SketchPoint;
  /** Make this many alternates of the sketch, each by its own run, at the same time. */
  fan?: number;
  /** Bring a sketch back from Figma: the reading of its frame Panel just made. */
  figma?: { sketch: string; read: string; version?: number };
}

/** A part of a sketch the designer pointed at in the studio, for FRIDAY to change. */
export interface SketchPoint {
  sketch: string;
  version?: number;
  label: string;
  selector: string;
  text?: string;
  html?: string;
  style?: Record<string, string>;
  state?: string;
  device?: string;
  mode?: "change" | "alternates";
}

export type Device = "desktop" | "tablet" | "phone";

/** Where a sketch breaks or brushes against the designer's rules, as measured in the page. */
export interface RuleFinding {
  rule: string;
  level: "breaks" | "check";
  what: string;
  where?: string[];
}

export interface SketchInfo {
  /**
   * Oldest first. `at`: when it was made; `by`: who made it ("you" by hand, "friday" for
   * FRIDAY or Claude Code; absent when no one knows); `what`: what it changed, in a line.
   */
  versions: { v: number; errors: number; height: number; rules?: RuleFinding[]; at: string; by?: "you" | "friday"; what: string }[];
  states: { name: string; slug: string }[];
  family: { id: string; parent: string | null; depth: number; title: string; tries?: string; state: string; version: number; reason?: string }[];
  /** The Figma frame it was last brought back from. */
  figma?: { node: string; name: string; at: string };
}

/** A frame read from the Figma app, for FRIDAY to rebuild the sketch from (figma.ts). */
export interface FigmaRead {
  read: string;
  node: string;
  frame: string;
  width?: number;
  height?: number;
  base_version: number;
  assets: string[];
  /** The frame as Figma draws it, relative to the sketch's page. */
  picture?: string;
  found: "selected" | "last time" | "asked for";
  at: string;
}

export interface Build {
  id: string;
  project: string;
  sketch: string;
  version: number;
  title: string;
  folder: string;
  workdir: string;
  branch: string | null;
  status: "working" | "done" | "failed" | "stopped";
  steps: { kind: "read" | "edit" | "run" | "look" | "plan" | "say" | "other"; text: string }[];
  plan: { content: string; status: "pending" | "in_progress" | "completed" }[] | null;
  reply: string | null;
  preview: { command: string; url: string } | null;
  serving: boolean;
  shot: string | null;
  error: string | null;
  turns: number;
  resume: string | null;
  updated_at: string;
}

/** Words the designer edited in place in the studio: where, and the HTML and words before and after. */
export interface WordEdit { path: string; before: string; after: string; before_text: string; after_text: string }

/**
 * A part of a sketch changed by hand in the studio: where it sits (body > main:nth-child(2) > …)
 * and what the studio saw there (its class, id and first words), so the server can be sure the
 * file's part is the same one. `label` is its name as the page shows it (heading “Документы”).
 */
export interface PartSeen { path: string; cls: string; id: string; text: string; label: string }
/** A part's own look changed by hand: CSS properties on that part only. */
export interface PartStyleEdit extends PartSeen { props: Record<string, string> }

/**
 * The studio's own address for a sketch page (…/v3.html?studio=6), shared by the studio and
 * Compare, so a copy a browser kept from before the kit last changed (sketches.ts) is never
 * used. Bump it whenever the kit changes.
 */
export const STUDIO_PAGE = "studio=7";

export const studioApi = {
  sketch: (project: string, sketch: string) => call<SketchInfo>(`/api/projects/${project}/sketches/${sketch}`),
  /** Keep the knobs as they are now: a new version with these :root variables changed. */
  setVars: (project: string, sketch: string, vars: Record<string, string>, from_version: number) =>
    call<{ version: number }>(`/api/projects/${project}/sketches/${sketch}/vars`, { method: "POST", body: body({ vars, from_version }) }),
  /** One version on one screen and in one state, as Figma pastes it (editable layers). */
  figmaCopy: async (project: string, sketch: string, o: { version: number; device: Device; state?: string }) => {
    const res = await fetch(`/api/projects/${project}/sketches/${sketch}/figma/copy`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(o) });
    if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't copy it for Figma.");
    return res.blob();
  },
  figmaRead: (project: string, sketch: string, version: number) =>
    call<FigmaRead>(`/api/projects/${project}/sketches/${sketch}/figma/read`, { method: "POST", body: body({ version }) }),
  /**
   * Save: every word edited in place and every knob moved on this version, as one new version.
   * With check, nothing is written; it only fails if a change can't be kept.
   */
  saveChanges: (
    project: string,
    sketch: string,
    changes: { edits: WordEdit[]; vars: Record<string, string>; styles?: PartStyleEdit[]; removes?: PartSeen[] },
    from_version: number,
    check = false,
  ) => {
    const seen = (x: PartSeen) => ({ path: x.path, cls: x.cls, id: x.id, text: x.text });
    const sent = { edits: changes.edits, vars: changes.vars, styles: (changes.styles ?? []).map((x) => ({ ...seen(x), props: x.props })), removes: (changes.removes ?? []).map(seen) };
    return call<{ version?: number; ok?: boolean; new_errors?: number }>(`/api/projects/${project}/sketches/${sketch}/changes`, { method: "POST", body: body({ ...sent, from_version, check }) });
  },
  /** Bring an older version back: its file becomes the newest version, and the sketch shows it. */
  restore: (project: string, sketch: string, version: number) =>
    call<{ version: number }>(`/api/projects/${project}/sketches/${sketch}/restore`, { method: "POST", body: body({ version }) }),
  folders: () => call<{ recent: string[]; found: string[]; home: string }>("/api/builds/folders"),
  build: (o: { project: string; sketch: string; folder: string; note?: string }) => call<Build>("/api/builds", { method: "POST", body: body(o) }),
  getBuild: (id: string) => call<Build>(`/api/builds/${id}`),
  message: (id: string, text: string) => call<Build>(`/api/builds/${id}/message`, { method: "POST", body: body({ text }) }),
  stop: (id: string) => call<{ stopped: boolean }>(`/api/builds/${id}/stop`, { method: "POST" }),
  preview: (id: string) => call<Build>(`/api/builds/${id}/preview`, { method: "POST" }),
  stopPreview: (id: string) => call<Build>(`/api/builds/${id}/preview`, { method: "DELETE" }),
};

export interface Material {
  id: string;
  kind: "file" | "link";
  name: string;
  note: string;
  url: string | null;
  mime: string | null;
  size: number | null;
  /** Characters of text Claude can read; 0 for a picture or when none could be read. */
  chars: number;
  picture: boolean;
  file_url: string | null;
  thumb_url: string | null;
  created_at: string;
  /** The page Claude wrote on what a long one says: '' not yet · working · done · error · short (read whole). */
  summary_state: "" | "working" | "done" | "error" | "short";
  summary: string;
  summary_error: string | null;
}

export const projectApi = {
  list: () => call<ProjectSummary[]>("/api/projects"),
  /** Reasons to offer when choosing or ruling out: the designer's own most used, then a few starters. */
  reasons: () => call<{ chosen: string[]; ruled_out: string[] }>("/api/projects/reasons"),
  create: (name: string, brief = "") => call<{ id: string; name: string; brief: string }>("/api/projects", { method: "POST", body: body({ name, brief }) }),
  get: (id: string) => call<ProjectFull>(`/api/projects/${id}`),
  remove: (id: string) => call<{ ok: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),
  /** Rename it, or archive it (and bring it back), from the sidebar. */
  update: (id: string, patch: { name?: string; archived?: boolean }) =>
    call<ProjectSummary>(`/api/projects/${id}`, { method: "PATCH", body: body(patch) }),
  ops: (id: string, ops: BoardOp[], client: string) =>
    call<{ seq: number; ops: BoardOp[]; cards: RefCard[] }>(`/api/projects/${id}/ops`, { method: "POST", body: body({ ops, client }) }),
  /** Undo this window's last change (who: "me", ⌘Z) or the assistant's last change. */
  undo: (id: string, client: string, who: "me" | "assistant") =>
    call<{ seq: number | null; ops: BoardOp[]; cards: RefCard[]; undid: string | null }>(`/api/projects/${id}/undo`, { method: "POST", body: body({ client, who }) }),
  /** Why the designer took these cards off the canvas, said after they're gone. */
  whyRemoved: (id: string, nodes: string[], reason: string) =>
    call<{ ok: boolean; n: number }>(`/api/projects/${id}/turned-down`, { method: "POST", body: body({ nodes, reason }) }),
  /** Files and links that say what the project is, for Claude to read. */
  materials: (id: string) => call<Material[]>(`/api/projects/${id}/materials`),
  /** Write a material's summary (again) now. */
  summarize: (id: string, mid: string) => call<Material>(`/api/projects/${id}/materials/${mid}/summary`, { method: "POST" }),
  addFiles: (id: string, files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append("file", f, f.name);
    return call<{ added: Material[]; failed: string[] }>(`/api/projects/${id}/materials`, { method: "POST", body: form });
  },
  addLink: (id: string, url: string) =>
    call<{ added: Material[]; failed: string[] }>(`/api/projects/${id}/materials`, { method: "POST", body: body({ url }) }),
  updateMaterial: (id: string, mid: string, patch: { name?: string; note?: string }) =>
    call<Material>(`/api/projects/${id}/materials/${mid}`, { method: "PATCH", body: body(patch) }),
  removeMaterial: (id: string, mid: string) => call<{ ok: boolean }>(`/api/projects/${id}/materials/${mid}`, { method: "DELETE" }),
  /** Follow changes made anywhere (other windows, Claude over MCP) from `after` on, until `signal` aborts. */
  async follow(id: string, after: number, on: (e: BoardEvent | { gone: true }) => void, signal: AbortSignal) {
    const res = await fetch(`/api/projects/${id}/stream?after=${after}`, { signal });
    if (!res.body) return;
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let end: number;
      while ((end = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, end);
        buf = buf.slice(end + 2);
        const data = chunk.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("");
        if (data) on(JSON.parse(data));
      }
    }
  },
};

// ---------- Fonts ----------

/** One font file: a weight, upright or italic, or a variable font ("100 900"). */
export interface FontFace_ {
  id: string;
  family: string;
  style_name: string;
  weight: string;
  italic: boolean;
  format: string;
  size: number;
  original_name: string;
  url: string;
}
export interface FontFamily {
  family: string;
  faces: FontFace_[];
}

export const fontApi = {
  list: () => call<FontFamily[]>("/api/fonts"),
  add: (files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append("file", f, f.name);
    return call<{ added: FontFace_[]; failed: string[] }>("/api/fonts", { method: "POST", body: form });
  },
  rename: (family: string, name: string) =>
    call<{ family: string }>(`/api/fonts/family?name=${encodeURIComponent(family)}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  removeFamily: (family: string) => call<{ removed: number }>(`/api/fonts/family?name=${encodeURIComponent(family)}`, { method: "DELETE" }),
  remove: (id: string) => call<{ removed: number }>(`/api/fonts/${id}`, { method: "DELETE" }),
};

// ---------- Ready-made parts: loading animations, colour palettes and icons that come with Panel ----------

export const ICON_WEIGHTS = ["thin", "light", "regular", "bold", "fill", "duotone"] as const;
export type IconWeight = (typeof ICON_WEIGHTS)[number];
export interface ReadyLoading { name: string; title: string; line: string; duration_ms: number; html: string }
export interface ReadyPalette { name: string; title: string; kind: "scale" | "set"; source_url: string; light: string[]; dark: string[] }
export interface ReadyIcon { name: string; alias?: string; tags: string[]; categories: string[] }
export interface ReadyMade {
  loading: ReadyLoading[];
  palettes: { source: string; rights: string; steps: { step: number; for: string }[]; palettes: ReadyPalette[] };
  icons: { source: string; count: number; icons: ReadyIcon[] };
}
export const readyApi = {
  list: () => call<ReadyMade>("/api/ready"),
  /** One weight's drawings: each icon's name and the inside of its SVG. */
  icons: (weight: IconWeight) => call<Record<string, string>>(`/api/ready/icons/${weight}`),
};

/** A font file, by its name: what Panel can take as one of the designer's fonts. */
export const isFontFile = (f: File) => /\.(woff2?|ttf|otf)$/i.test(f.name);


// ---------- Brand assets: each project's logos, icons and files ----------

export const BRAND_KINDS = ["logo", "icon", "image", "pattern", "guide", "other"] as const;
export type BrandKind = (typeof BRAND_KINDS)[number];
/** How each kind is named where assets are grouped. */
export const BRAND_KIND_LABEL: Record<BrandKind, string> = {
  logo: "Logos", icon: "Icons", image: "Images", pattern: "Patterns", guide: "Guidelines", other: "Other files",
};
/** One of a kind, for menus ("Make it a logo"). */
export const BRAND_KIND_ONE: Record<BrandKind, string> = {
  logo: "Logo", icon: "Icon", image: "Image", pattern: "Pattern", guide: "Guideline", other: "Other",
};

export interface BrandAsset {
  id: string;
  project_id: string | null;
  project_name: string | null;
  kind: BrandKind;
  name: string;
  format: string;
  size: number;
  width: number | null;
  height: number | null;
  original_name: string;
  url: string;
  thumb_url: string | null;
  created_at: string;
}

export const brandApi = {
  /** All of them, or one project's ("none": those in no project). */
  list: (project?: string) => call<BrandAsset[]>(`/api/brand${project ? `?project=${encodeURIComponent(project)}` : ""}`),
  add: (files: File[], project: string | null, kind?: BrandKind) => {
    const form = new FormData();
    form.append("project", project ?? "none");
    if (kind) form.append("kind", kind);
    for (const f of files) form.append("file", f, f.name);
    return call<{ added: BrandAsset[]; failed: string[] }>("/api/brand", { method: "POST", body: form });
  },
  update: (id: string, patch: { name?: string; kind?: BrandKind; project_id?: string | null }) =>
    call<BrandAsset>(`/api/brand/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  remove: (id: string) => call<{ removed: number }>(`/api/brand/${id}`, { method: "DELETE" }),
};

// ---------- Skills: which of the designer's skill files FRIDAY uses, and when ----------

export type SkillWhen = "always" | "applies" | "asked";
export type SkillAbout = "motion" | "phone" | "forms";
/** A skill as Panel read it, with what the designer set for it and what FRIDAY gets. */
export interface SkillUse {
  id: string;
  name: string;
  line: string;
  on: boolean;
  when: SkillWhen;
  about: SkillAbout[];
  /** Characters in each section Panel reads (0: not there). */
  parts: { decide: number; build: number; check: number };
  /** No Decide or Build heading: FRIDAY gets the whole file. */
  whole: boolean;
  checks: { name: string; min?: number; max?: number; level: "breaks" | "check"; plain: string }[];
  /** Check lines Panel can't measure yet. */
  unknown: string[];
  tokens: number;
  /** off · every (in every message) · listed (read when needed) · dropped (too long for every message) */
  given: "off" | "every" | "listed" | "dropped";
  /** In plain words, what FRIDAY gets from it. */
  gets: string;
  /** Who it is for, from its read (null: not read, or its own headings come first). */
  forUse: SkillFor | null;
  /** The pack it came from. */
  pack: string | null;
  /** Where its read stands. older: read with Panel's older instructions, so it counts as not read yet. */
  read: { state: SkillReadState; changed: boolean; older: boolean; cost: number; for: SkillFor | null; subjects: string[]; one_line: string | null } | null;
  /** From its read: its subjects, the main one first ([] with no read in use). */
  subjects: string[];
}
/** Who leads a subject two or more skills that are on speak to (server/skillleads.ts). */
export interface SkillLead {
  subject: string;
  id: string;
  name: string;
  by: "designer" | "panel";
  /** Panel's own pick. */
  panel: string;
  /** Panel's pick was level with this skill on main subject and lines (decided by when each is used, then by name). */
  tie?: string;
  speakers: { id: string; name: string; lines: number }[];
}
export interface SkillsPage {
  skills: SkillUse[]; on: number; tokens: number; budget: number;
  leads: SkillLead[];
  /** Skills are read by themselves ("read automatically" is on). */
  auto: boolean;
  /** How many skills aren't read yet. */
  not_read: number;
}

// The skills page's state, shared by the grid's cards, the detail view and the page's top line.
let skillsNow: SkillsPage | null = null;
const skillListeners = new Set<() => void>();
export const skillStore = {
  get: () => skillsNow,
  subscribe: (fn: () => void) => {
    skillListeners.add(fn);
    return () => void skillListeners.delete(fn);
  },
  refresh: async () => {
    skillsNow = await call<SkillsPage>("/api/skills");
    skillListeners.forEach((f) => f());
    return skillsNow;
  },
};

export const skillApi = {
  set: async (id: string, patch: { on?: boolean; when?: SkillWhen; about?: SkillAbout[] }) => {
    const one = await call<SkillUse>(`/api/skills/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    await skillStore.refresh().catch(() => {});
    return one;
  },
  /** Pick who leads a subject; null gives it back to Panel's pick. */
  setLead: async (subject: string, id: string | null) => {
    skillsNow = await call<SkillsPage>("/api/skills/leads", { method: "PUT", body: JSON.stringify({ subject, id }) });
    skillListeners.forEach((f) => f());
    return skillsNow;
  },
};

// ---------- Skill packs: skills from a GitHub project or a folder (server/skillpacks.ts) ----------

export type LeftOutWhy = "script" | "settings" | "picture" | "other" | "big" | "many";
/** One skill found in a project, as the chooser shows it. */
export interface FoundSkill {
  folder: string;
  name: string;
  line: string;
  kept: { path: string; bytes: number }[];
  bytes: number;
  leftOut: { path: string; bytes: number; why: LeftOutWhy }[];
  /** "3 files, 28 KB" */
  size: string;
  /** "2 scripts not kept", or "". */
  leftOutLine: string;
  digest: string;
  /** Why it can't be added. */
  problem?: string;
  /** Already in the library from this pack, and whether it is the same. */
  have?: { id: string; same: boolean; gone: boolean };
}
/** What the chooser shows: a pack and the skills found in it. Nothing is saved yet. */
export interface PackLook {
  source: "github" | "folder";
  key: string;
  name: string;
  url: string | null;
  author: string | null;
  license: string | null;
  version: { sha: string | null; date: string | null };
  link: { owner: string; repo: string; branch: string; path: string } | null;
  skills: FoundSkill[];
  pack: { id: string; sha: string | null; date: string | null } | null;
  gone: { id: string; name: string; folder: string }[];
  partial?: boolean;
}
/** A dropped folder as the browser read it: text files with their text, the rest by name and size. */
export interface DroppedFolder {
  name: string;
  files: { path: string; bytes: number; text?: string; modified?: number }[];
}
/** A pack in the library, for the Skills page. */
export interface SkillPack {
  id: string;
  source: "github" | "folder";
  name: string;
  url: string | null;
  author: string | null;
  license: string | null;
  version: { sha: string | null; date: string | null };
  checked: string | null;
  skills: string[];
  gone: string[];
}
/** Where a skill came from, its other files, and what was left out. */
export interface SkillOrigin {
  pack: { id: string; source: "github" | "folder"; name: string; url: string | null; author: string | null; license: string | null; hasLicenseText: boolean } | null;
  folder?: string;
  version?: { sha: string | null; date: string | null };
  link?: string | null;
  gone?: boolean;
  files: { path: string; bytes: number }[];
  leftOut: { path: string; bytes: number; why: LeftOutWhy }[];
  leftOutLine: string;
}
export interface PackAdded { pack: string; added: number; updated: number; same: number; ids: string[]; /** Put in line to be read ("read automatically" on). */ reading: string[] }

// The packs in the library, shared by the Skills page's headings and a skill's detail view.
let packsNow: SkillPack[] | null = null;
const packListeners = new Set<() => void>();
export const packStore = {
  get: () => packsNow,
  subscribe: (fn: () => void) => {
    packListeners.add(fn);
    return () => void packListeners.delete(fn);
  },
  refresh: async () => {
    packsNow = await call<SkillPack[]>("/api/skills/packs");
    packListeners.forEach((f) => f());
    return packsNow;
  },
};

export const packApi = {
  /** Look at a GitHub project, or a folder in it: what could be added. Nothing is saved. */
  look: (url: string) => call<PackLook>("/api/skills/packs/look", { method: "POST", body: body({ url }) }),
  lookFolder: (folder: DroppedFolder) => call<PackLook>("/api/skills/packs/look", { method: "POST", body: body({ folder }) }),
  /** Add the chosen skills at the exact version looked at. */
  add: (look: PackLook, folders: string[], folder?: DroppedFolder) =>
    call<PackAdded>("/api/skills/packs/add", {
      method: "POST",
      body: body(folder ? { folder, folders } : { ...look.link, sha: look.version.sha, folders }),
    }),
  /** Ask GitHub whether the pack has a newer version. */
  check: (id: string) => call<{ same: true; date: string | null } | ({ same: false } & PackLook)>(`/api/skills/packs/${id}/check`, { method: "POST", body: "{}" }),
  origin: (id: string) => call<SkillOrigin>(`/api/skills/${id}/origin`),
  file: (id: string, path: string) => call<{ text: string }>(`/api/skills/${id}/file?path=${encodeURIComponent(path)}`),
};

/** A link to a GitHub project or a folder in one (not to one file): those open the skill chooser. */
export function isGithubProject(s: string) {
  const t = s.trim();
  return /^(https?:\/\/)?(www\.)?github\.com\/[\w.-]+\/[\w.-]+(\.git)?(\/tree\/\S+)?\/?$/i.test(t);
}

// ---------- Skill reads: Claude reads a skill once (server/skillread.ts) ----------

export type SkillFor = "sketches" | "builds" | "both" | "neither";
export type SkillReadState = "none" | "waiting" | "reading" | "done" | "failed";
export interface SkillReadLine { subject: string; text: string }
export interface SkillReadAnswer {
  one_line: string;
  subjects: string[];
  for: SkillFor;
  about: SkillAbout[];
  when: SkillWhen;
  decide: SkillReadLine[];
  build: SkillReadLine[];
  checks: { name: string; min?: number; max?: number; must: boolean }[];
  could_measure: { what: string; value: string }[];
  look_for: string[];
  conflicts: { skill_says: string; rule_says: string; rule: string }[];
  points_to: string[];
}
/** One skill's read as its detail view shows it. */
export interface SkillReadView {
  state: SkillReadState;
  error: string | null;
  model: string | null;
  read_at: string | null;
  changed: boolean;
  /** Read with Panel's older instructions. */
  older: boolean;
  /** Rough tokens a read of it uses. */
  cost: number;
  answer: SkillReadAnswer | null;
  edits: { decide?: string; build?: string } | null;
  own_parts: boolean;
  /** What FRIDAY carries (with the designer's changes) and Panel's own version. */
  carries: { decide: string; build: string } | null;
  panel: { decide: string; build: string } | null;
  edited: boolean;
  /** Line by line, each with its subject; led_by names the skill that leads that subject (it wins where the two differ). */
  lines: { decide: SkillLine[]; build: SkillLine[] } | null;
  /** Rough tokens of what really reaches FRIDAY. */
  tokens: number;
  points_to: { name: string; id: string | null; on: boolean }[];
}
export interface SkillLine { subject: string; text: string; led_by: string | null }
export const skillReadApi = {
  get: (id: string) => call<SkillReadView>(`/api/skills/${id}/read`),
  /** Put one skill in line to be read. */
  read: async (id: string) => {
    const v = await call<SkillReadView>(`/api/skills/${id}/read`, { method: "POST", body: "{}" });
    await skillStore.refresh().catch(() => {});
    return v;
  },
  /** Put several in line: they are read a few at a time. */
  readMany: async (ids: string[]) => {
    const r = await call<{ queued: string[]; reading: string[]; waiting: string[] }>("/api/skills/reads", { method: "POST", body: JSON.stringify({ ids }) });
    await skillStore.refresh().catch(() => {});
    return r;
  },
  /** "Read them": every skill not read yet. */
  readUnread: async () => {
    const r = await call<{ queued: string[]; reading: string[]; waiting: string[] }>("/api/skills/reads/unread", { method: "POST", body: "{}" });
    await skillStore.refresh().catch(() => {});
    return r;
  },
  stop: async () => {
    const r = await call<{ reading: string[]; waiting: string[] }>("/api/skills/reads/stop", { method: "POST", body: "{}" });
    await skillStore.refresh().catch(() => {});
    return r;
  },
  /** The designer's own Decide or Build (null puts Panel's back), or `reset` for all of it. */
  edit: async (id: string, patch: { decide?: string | null; build?: string | null; reset?: boolean }) => {
    const v = await call<SkillReadView>(`/api/skills/${id}/read`, { method: "PATCH", body: JSON.stringify(patch) });
    await skillStore.refresh().catch(() => {});
    return v;
  },
};
