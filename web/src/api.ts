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
  deleteCollection:(id: string) => call<{ ok: boolean }>(`/api/collections/${id}`, { method: "DELETE" }),
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
      if (m) fields.push((last = [m[1]!, m[2]!.replace(/^["'>|-]\s*|["']$/g, "")]));
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
  | { type: "thinking"; ms?: number; done?: boolean }
  | { type: "tool"; id: string; name: string; input?: Record<string, unknown>; refs?: string[]; total?: number; error?: string; done?: boolean };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  context: { open?: string; nodes?: string[]; label?: string; thumbs?: string[] } | null;
  parts: ChatPart[];
  status: "done" | "streaming" | "stopped" | "error" | string;
  error: string | null;
  created_at: string;
}

export interface ChatSummary { id: string; title: string; updated_at: string; running: boolean }
export interface ChatFull { id: string; title: string; messages: ChatMessage[]; cards: RefCard[]; running: boolean; seq: number }

export type ChatEvent =
  | { t: "start"; message: ChatMessage }
  | { t: "thinking"; on: boolean; ms?: number }
  | { t: "tool"; id: string; name: string }
  | { t: "tool_input"; id: string; input: Record<string, unknown>; partial?: boolean }
  | { t: "tool_result"; id: string; refs: string[]; cards: RefCard[]; total?: number; error?: string }
  | { t: "text"; delta: string }
  | { t: "title"; title: string }
  | { t: "done"; status: "done" | "stopped" | "error"; error?: string }
  | { t: "idle" };

export const chatApi = {
  list: () => call<ChatSummary[]>("/api/chats"),
  create: () => call<{ id: string }>("/api/chats", { method: "POST" }),
  get: (id: string) => call<ChatFull>(`/api/chats/${id}`),
  remove: (id: string) => call<{ ok: boolean }>(`/api/chats/${id}`, { method: "DELETE" }),
  send: (id: string, text: string, context: { open?: string; project?: string; nodes?: string[]; label?: string; thumbs?: string[]; point?: SketchPoint }) =>
    call<{ user: ChatMessage; assistant: ChatMessage }>(`/api/chats/${id}/messages`, { method: "POST", body: body({ text, context }) }),
  stop: (id: string) => call<{ stopped: boolean }>(`/api/chats/${id}/stop`, { method: "POST" }),
  cards: (ids: string[]) => call<RefCard[]>(`/api/cards?ids=${ids.join(",")}`),
  settings: () => call<{ model: string; effort: string }>("/api/chat/settings"),
  setSettings: (patch: { model?: string; effort?: string }) =>
    call<{ model: string; effort: string }>("/api/chat/settings", { method: "PATCH", body: body(patch) }),
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

export interface SketchInfo {
  versions: { v: number; errors: number; height: number }[];
  states: { name: string; slug: string }[];
  family: { id: string; parent: string | null; depth: number; title: string; tries?: string; state: string; version: number; reason?: string }[];
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

export const studioApi = {
  sketch: (project: string, sketch: string) => call<SketchInfo>(`/api/projects/${project}/sketches/${sketch}`),
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
}

export const projectApi = {
  list: () => call<ProjectSummary[]>("/api/projects"),
  create: (name: string, brief = "") => call<{ id: string; name: string; brief: string }>("/api/projects", { method: "POST", body: body({ name, brief }) }),
  get: (id: string) => call<ProjectFull>(`/api/projects/${id}`),
  remove: (id: string) => call<{ ok: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),
  ops: (id: string, ops: BoardOp[], client: string) =>
    call<{ seq: number; ops: BoardOp[]; cards: RefCard[] }>(`/api/projects/${id}/ops`, { method: "POST", body: body({ ops, client }) }),
  /** Undo this window's last change (who: "me", ⌘Z) or the assistant's last change. */
  undo: (id: string, client: string, who: "me" | "assistant") =>
    call<{ seq: number | null; ops: BoardOp[]; cards: RefCard[]; undid: string | null }>(`/api/projects/${id}/undo`, { method: "POST", body: body({ client, who }) }),
  /** Files and links that say what the project is, for Claude to read. */
  materials: (id: string) => call<Material[]>(`/api/projects/${id}/materials`),
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
