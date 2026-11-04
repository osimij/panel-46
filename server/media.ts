import { join, dirname } from "node:path";
import { mkdirSync, renameSync, statSync, unlinkSync, existsSync } from "node:fs";
import { MEDIA_DIR } from "./config.ts";
import type { MediaType } from "./db.ts";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

export interface SavedFile {
  rel: string; // path relative to MEDIA_DIR
  bytes: number;
  sha256: string;
  mime: string;
}

export interface Probe {
  width: number | null;
  height: number | null;
  duration: number | null;
  hasVideo: boolean;
}

export const abs = (rel: string) => join(MEDIA_DIR, rel);

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

export function extFor(mime: string, url?: string) {
  const fromMime = EXT_BY_MIME[mime.split(";")[0]!.trim()];
  if (fromMime) return fromMime;
  const m = url && new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i);
  return m ? m[1]!.toLowerCase() : "bin";
}

export function mediaTypeFor(mime: string): MediaType | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return null;
}

export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 30_000) {
  return fetch(url, {
    ...init,
    headers: { "user-agent": UA, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(ms),
    redirect: "follow",
  });
}

/**
 * Download a remote file into the library. Writes to a .part file first and
 * only renames it into place once the full body arrived and the size checks out.
 */
export async function downloadTo(url: string, relBase: string): Promise<SavedFile> {
  const res = await fetchWithTimeout(url, {}, 10 * 60_000);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  const mime = (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0]!.trim();
  const rel = `${relBase}.${extFor(mime, url)}`;
  const target = abs(rel);
  const part = `${target}.part`;
  mkdirSync(dirname(target), { recursive: true });

  const hasher = new Bun.CryptoHasher("sha256");
  const writer = Bun.file(part).writer();
  let bytes = 0;
  try {
    for await (const chunk of res.body) {
      hasher.update(chunk);
      writer.write(chunk);
      bytes += chunk.byteLength;
    }
    await writer.end();
  } catch (e) {
    await Promise.resolve(writer.end()).catch(() => {});
    if (existsSync(part)) unlinkSync(part);
    throw new Error(`Download interrupted: ${(e as Error).message}`);
  }

  const expected = Number(res.headers.get("content-length") ?? 0);
  if (expected && !res.headers.get("content-encoding") && expected !== bytes) {
    unlinkSync(part);
    throw new Error(`Incomplete download (${bytes} of ${expected} bytes)`);
  }
  if (bytes === 0) {
    unlinkSync(part);
    throw new Error("Server returned an empty file");
  }
  renameSync(part, target);
  return { rel, bytes, sha256: hasher.digest("hex"), mime };
}

/** Hash and size a file that is already inside the library. */
export async function describeLocal(rel: string, mime: string): Promise<SavedFile> {
  const file = Bun.file(abs(rel));
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of file.stream()) hasher.update(chunk);
  return { rel, bytes: statSync(abs(rel)).size, sha256: hasher.digest("hex"), mime };
}

async function run(cmd: string[], timeoutMs = 60_000) {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  return { out, err, code };
}

/**
 * Decode-check a saved file with ffprobe. This is the proof that we hold a
 * usable copy, not just bytes: a corrupt or HTML-error-page file fails here.
 */
export async function probe(rel: string): Promise<Probe> {
  const { out, code, err } = await run([
    "ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", abs(rel),
  ]);
  if (code !== 0) throw new Error(`File is not readable media: ${err.trim().split("\n")[0] ?? "ffprobe failed"}`);
  const info = JSON.parse(out) as {
    streams?: { codec_type: string; width?: number; height?: number; duration?: string }[];
    format?: { duration?: string; format_name?: string };
  };
  const v = info.streams?.find((s) => s.codec_type === "video");
  if (!v) throw new Error("File has no image or video stream");
  const dur = Number(info.format?.duration ?? v.duration);
  const isStill = /image2|png_pipe|jpeg_pipe|webp_pipe|svg/.test(info.format?.format_name ?? "");
  return {
    width: v.width ?? null,
    height: v.height ?? null,
    duration: !isStill && Number.isFinite(dur) && dur > 0 ? dur : null,
    hasVideo: !isStill,
  };
}

/** Small JPEG for the grid, generated from our own copy. */
export async function makeThumb(rel: string, type: MediaType): Promise<string | null> {
  const thumbRel = rel.replace(/\.[^.]+$/, ".thumb.jpg");
  const out = abs(thumbRel);
  const cmd =
    type === "image"
      ? ["ffmpeg", "-y", "-v", "error", "-i", abs(rel), "-frames:v", "1", "-vf", "scale='min(800,iw)':-2", "-q:v", "3", out]
      : ["ffmpeg", "-y", "-v", "error", "-ss", "0.3", "-i", abs(rel), "-frames:v", "1", "-vf", "scale='min(800,iw)':-2", "-q:v", "3", out];
  const { code } = await run(cmd);
  return code === 0 && existsSync(out) ? thumbRel : null;
}

/**
 * Fallback downloader for posts and sites the direct path can't read.
 * Returns the files yt-dlp wrote into `dirRel`.
 */
export async function ytDlp(url: string, dirRel: string): Promise<{ files: string[]; error?: string }> {
  const dir = abs(dirRel);
  mkdirSync(dir, { recursive: true });
  const { code, err } = await run(
    [
      "yt-dlp", "--no-progress", "--no-warnings", "--restrict-filenames",
      "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
      "--merge-output-format", "mp4",
      "-o", join(dir, "yt-%(autonumber)s.%(ext)s"),
      "--print", "after_move:filepath",
      url,
    ],
    10 * 60_000,
  );
  const glob = new Bun.Glob("yt-*");
  const files = [...glob.scanSync({ cwd: dir })]
    .filter((f) => !f.endsWith(".part") && !f.endsWith(".ytdl"))
    .sort()
    .map((f) => `${dirRel}/${f}`);
  if (code !== 0 && files.length === 0) {
    const line = err.split("\n").find((l) => l.startsWith("ERROR")) ?? err.trim().split("\n").pop() ?? "";
    return { files, error: line.replace(/^ERROR:\s*/, "").slice(0, 300) || "yt-dlp failed" };
  }
  return { files };
}
