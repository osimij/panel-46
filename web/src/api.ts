export type RefStatus = "pending" | "archived" | "link_only" | "failed";

export interface Media {
  id: string;
  idx: number;
  type: "image" | "video" | "gif";
  status: "pending" | "archived" | "failed";
  error: string | null;
  url: string | null;
  thumb_url: string | null;
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

export const api = {
  refs(f: Filters) {
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
    f.tags?.forEach((t) => p.append("tag", t));
    if (f.tagMode === "any") p.set("tagMode", "any");
    return call<Ref[]>(`/api/refs?${p}`);
  },
  ref: (id: string) => call<Ref>(`/api/refs/${id}`),
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
