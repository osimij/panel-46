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
  kind: "x" | "instagram" | "youtube" | "pinterest" | "web" | "upload";
  source_url: string | null;
  creator_handle: string | null;
  creator_name: string | null;
  title: string | null;
  text: string | null;
  note: string;
  favorite: boolean;
  hidden: boolean;
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
    if (f.collection) p.set("collection", f.collection);
    f.tags?.forEach((t) => p.append("tag", t));
    if (f.tagMode === "any") p.set("tagMode", "any");
    return call<Ref[]>(`/api/refs?${p}`);
  },
  ref: (id: string) => call<Ref>(`/api/refs/${id}`),
  stats: () => call<Stats>("/api/stats"),
  revealLibrary: () => call<{ ok: boolean }>("/api/library/reveal", { method: "POST" }),
  collections: () => call<Collection[]>("/api/collections"),
  tags: () => call<TagInfo[]>("/api/tags"),
  tagGroups: () => call<TagGroup[]>("/api/tag-groups"),
  createTagGroup: (name: string, tags: string[] = []) =>
    call<TagGroup>("/api/tag-groups", { method: "POST", body: body({ name, tags }) }),
  renameTagGroup: (id: string, name: string) => call<{ ok: boolean }>(`/api/tag-groups/${id}`, { method: "PATCH", body: body({ name }) }),
  deleteTagGroup: (id: string) => call<{ ok: boolean }>(`/api/tag-groups/${id}`, { method: "DELETE" }),
  moveTag: (name: string, groupId: string | null) =>
    call<{ ok: boolean }>(`/api/tags/${encodeURIComponent(name)}/group`, { method: "PUT", body: body({ groupId }) }),
  capture: (url: string) => call<{ id: string; existing: boolean; ref: Ref }>("/api/capture", { method: "POST", body: body({ url }) }),
  upload(files: File[]) {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    return call<{ ids: string[] }>("/api/upload", { method: "POST", body: form });
  },
  update: (id: string, patch: Partial<Pick<Ref, "title" | "note" | "favorite" | "hidden">>) =>
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
  createTag: (name: string) => call<{ name: string }>("/api/tags", { method: "POST", body: body({ name }) }),
  deleteTag: (name: string) => call<{ ok: boolean }>(`/api/tags/${encodeURIComponent(name)}`, { method: "DELETE" }),
  renameTag: (from: string, name: string) =>
    call<{ name: string }>(`/api/tags/${encodeURIComponent(from)}`, { method: "PATCH", body: body({ name }) }),
  deleteCollection:(id: string) => call<{ ok: boolean }>(`/api/collections/${id}`, { method: "DELETE" }),
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

export function site(r: Ref) {
  return r.kind in SITES ? SITES[r.kind as keyof typeof SITES] : null;
}

/** "@name", unless the site only gave us an opaque id. */
export function atHandle(r: Ref) {
  return r.creator_handle && !isChannelId(r.creator_handle) ? `@${r.creator_handle}` : null;
}

export function sourceLabel(r: Ref) {
  const s = site(r);
  if (s) return s.label;
  if (r.kind === "upload") return "Added from this Mac";
  return r.creator_handle ?? "Website";
}

export const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
