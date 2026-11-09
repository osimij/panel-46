// Search by meaning and by look, on this Mac. Two small models run locally (nothing about
// the library leaves the machine; the models themselves are downloaded once, about 300 MB,
// into <library>/models):
//
//   meaning  multilingual-e5-small turns what a save's read says (per facet: color, type,
//            layout…) into numbers, so "quiet and bookish" finds a save described as
//            "calm, literary" though they share no word. It knows Russian too.
//   look     CLIP turns each save's first picture into numbers, so saves can be found by
//            how they look ("a dark dashboard with glowing charts") and by likeness to
//            another picture, whatever was written about them.
//
// The numbers are kept in the library's database (table embeddings) and made in the
// background by Panel. Until the models are there, or with the setting off, search is by
// words alone, as before.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { LIBRARY_DIR } from "./config.ts";
import { db, getSetting } from "./db.ts";

const TEXT_MODEL = "Xenova/multilingual-e5-small";
const LOOK_MODEL = "Xenova/clip-vit-base-patch32";
const MODELS_DIR = join(LIBRARY_DIR, "models");

db.exec(`CREATE TABLE IF NOT EXISTS embeddings (
  ref_id TEXT NOT NULL,
  -- t:<facet> for what the read says about a facet · look for the first picture
  kind TEXT NOT NULL,
  -- of the text or file it was made from, so it's made again only when that changes
  hash TEXT NOT NULL,
  vec BLOB NOT NULL,
  PRIMARY KEY (ref_id, kind)
)`);

export const meaningOn = () => getSetting("meaning_search") !== "0";
const here = (model: string) => existsSync(join(MODELS_DIR, model, "onnx"));
/** The models are on this Mac (they're only ever fetched by Panel itself, in the background). */
export const meaningReady = () => meaningOn() && here(TEXT_MODEL);
export const lookReady = () => meaningOn() && here(LOOK_MODEL);

/* eslint-disable @typescript-eslint/no-explicit-any */
let lib: Promise<any> | null = null;
function transformers(download: boolean) {
  lib ??= import("@huggingface/transformers");
  return lib.then((t) => {
    t.env.cacheDir = MODELS_DIR;
    // Only Panel's background indexer asks for a model that isn't here yet; a search never does.
    if (download) t.env.allowRemoteModels = true;
    return t;
  });
}

let textPipe: Promise<any> | null = null;
async function texter(download: boolean) {
  if (!download && !here(TEXT_MODEL)) return null;
  textPipe ??= transformers(download).then((t) => t.pipeline("feature-extraction", TEXT_MODEL, { dtype: "q8" }));
  return textPipe.catch(() => ((textPipe = null), null));
}

let clip: Promise<{ processor: any; vision: any; tokenizer: any; text: any; RawImage: any }> | null = null;
async function looker(download: boolean) {
  if (!download && !here(LOOK_MODEL)) return null;
  clip ??= transformers(download).then(async (t) => {
    const [processor, vision, tokenizer, text] = await Promise.all([
      t.AutoProcessor.from_pretrained(LOOK_MODEL),
      t.CLIPVisionModelWithProjection.from_pretrained(LOOK_MODEL, { dtype: "q8" }),
      t.AutoTokenizer.from_pretrained(LOOK_MODEL),
      t.CLIPTextModelWithProjection.from_pretrained(LOOK_MODEL, { dtype: "q8" }),
    ]);
    return { processor, vision, tokenizer, text, RawImage: t.RawImage };
  });
  return clip.catch(() => ((clip = null), null));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function unit(v: Float32Array) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

/** Texts as vectors. e5 wants to know which side of a search each text is on. */
async function textVectors(texts: string[], side: "query" | "passage", download = false): Promise<Float32Array[] | null> {
  const pipe = await texter(download);
  if (!pipe) return null;
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += 32) {
    const batch = texts.slice(i, i + 32).map((t) => `${side}: ${t.slice(0, 1400)}`);
    const res = await pipe(batch, { pooling: "mean", normalize: true });
    const dim = res.dims[1] as number;
    const data = res.data as Float32Array;
    for (let j = 0; j < batch.length; j++) out.push(data.slice(j * dim, (j + 1) * dim));
  }
  return out;
}

async function imageVector(file: string, download = false): Promise<Float32Array | null> {
  const c = await looker(download);
  if (!c) return null;
  const image = await c.RawImage.read(file);
  const { image_embeds } = await c.vision(await c.processor(image));
  return unit(Float32Array.from(image_embeds.data as Float32Array));
}

async function lookQueryVector(text: string): Promise<Float32Array | null> {
  const c = await looker(false);
  if (!c) return null;
  const { text_embeds } = await c.text(c.tokenizer([text.slice(0, 300)], { padding: true, truncation: true }));
  return unit(Float32Array.from(text_embeds.data as Float32Array));
}

// ---------- Kept vectors, in memory while they don't change ----------

const blob = (v: Float32Array) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
let held: { sig: string; by: Map<string, { ids: string[]; vecs: Float32Array[] }> } | null = null;
function vectors(kind: string) {
  const sig = db.query<{ s: string }, []>("SELECT COUNT(*) || ':' || COALESCE(MAX(rowid), 0) AS s FROM embeddings").get()!.s;
  if (held?.sig !== sig) held = { sig, by: new Map() };
  let k = held.by.get(kind);
  if (!k) {
    const rows = db.query<{ ref_id: string; vec: Uint8Array }, [string]>("SELECT ref_id, vec FROM embeddings WHERE kind = ?").all(kind);
    k = { ids: rows.map((r) => r.ref_id), vecs: rows.map((r) => new Float32Array(r.vec.buffer.slice(r.vec.byteOffset, r.vec.byteOffset + r.vec.byteLength))) };
    held.by.set(kind, k);
  }
  return k;
}
const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
};

/** Every save's closeness to a vector, in the given kinds (the best of them per save). */
function closest(q: Float32Array, kinds: string[]) {
  const best = new Map<string, number>();
  for (const kind of kinds) {
    const { ids, vecs } = vectors(kind);
    for (let i = 0; i < ids.length; i++) {
      if (vecs[i]!.length !== q.length) continue;
      const s = dot(q, vecs[i]!);
      if (s > (best.get(ids[i]!) ?? -1)) best.set(ids[i]!, s);
    }
  }
  return best;
}

const asked = new Map<string, Float32Array>();
/** How close each save is in meaning to these words, within these facets. Null when meaning search isn't available. */
export async function meaningRank(query: string, facets: string[]): Promise<Map<string, number> | null> {
  if (!meaningReady() || !query.trim()) return null;
  try {
    let q = asked.get(query);
    if (!q) {
      q = (await textVectors([query], "query"))?.[0];
      if (!q) return null;
      if (asked.size > 200) asked.clear();
      asked.set(query, q);
    }
    return closest(q, facets.map((f) => `t:${f}`));
  } catch {
    return null;
  }
}

/** How close each save's picture is to a description of a look. Null when it isn't available. */
export async function lookRank(description: string): Promise<Map<string, number> | null> {
  if (!lookReady() || !description.trim()) return null;
  try {
    const q = await lookQueryVector(description);
    return q ? closest(q, ["look"]) : null;
  } catch {
    return null;
  }
}

/** The saves nearest to one save, by one kind of vector ("t:mood", "look"…), nearest first. */
export function nearest(refId: string, kind: string, limit = 40): { id: string; score: number }[] {
  if (!meaningOn()) return [];
  const { ids, vecs } = vectors(kind);
  const at = ids.indexOf(refId);
  if (at < 0) return [];
  const base = vecs[at]!;
  return ids
    .map((id, i) => ({ id, score: i === at || vecs[i]!.length !== base.length ? -1 : dot(base, vecs[i]!) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ---------- Making the vectors (Panel itself, in the background) ----------

export interface ToIndex {
  id: string;
  /** What the read says, per facet. */
  texts: Record<string, string>;
  /** Its first picture, as a file. */
  image?: string;
}

let working = false;
/**
 * Bring the kept vectors up to date with the library: new and changed saves are done,
 * removed ones dropped. Fetches the models the first time. Safe to call often.
 */
export async function indexForMeaning(docs: ToIndex[]): Promise<{ made: number } | null> {
  if (working || !meaningOn()) return null;
  working = true;
  try {
    const have = new Map(db.query<{ ref_id: string; kind: string; hash: string }, []>("SELECT ref_id, kind, hash FROM embeddings").all().map((r) => [`${r.ref_id}|${r.kind}`, r.hash]));
    const todo: { id: string; kind: string; hash: string; text: string }[] = [];
    const pictures: { id: string; hash: string; file: string }[] = [];
    const live = new Set<string>();
    for (const d of docs) {
      live.add(d.id);
      for (const [facet, text] of Object.entries(d.texts)) {
        const clean = text.trim();
        if (clean.length < 3) continue;
        const hash = `${TEXT_MODEL}:${Bun.hash(clean).toString(36)}`;
        if (have.get(`${d.id}|t:${facet}`) !== hash) todo.push({ id: d.id, kind: `t:${facet}`, hash, text: clean });
      }
      if (d.image) {
        const hash = `${LOOK_MODEL}:${d.image}`;
        if (have.get(`${d.id}|look`) !== hash) pictures.push({ id: d.id, hash, file: d.image });
      }
    }
    // Saves that are gone take their vectors with them.
    const gone = [...new Set([...have.keys()].map((k) => k.split("|")[0]!))].filter((id) => !live.has(id));
    for (const id of gone) db.run("DELETE FROM embeddings WHERE ref_id = ?", [id]);
    if (!todo.length && !pictures.length) return { made: 0 };

    if (!here(TEXT_MODEL) || !here(LOOK_MODEL)) console.log("Search by meaning: fetching its two models (once, about 300 MB)…");
    const put = db.prepare("INSERT INTO embeddings (ref_id, kind, hash, vec) VALUES (?, ?, ?, ?) ON CONFLICT(ref_id, kind) DO UPDATE SET hash = excluded.hash, vec = excluded.vec");
    let made = 0;
    for (let i = 0; i < todo.length; i += 64) {
      const part = todo.slice(i, i + 64);
      const vecs = await textVectors(part.map((p) => p.text), "passage", true);
      if (!vecs) break;
      db.transaction(() => part.forEach((p, j) => put.run(p.id, p.kind, p.hash, blob(vecs[j]!))))();
      made += part.length;
      // Let requests through between batches.
      await Bun.sleep(5);
    }
    for (const p of pictures) {
      if (!existsSync(p.file)) continue;
      const v = await imageVector(p.file, true).catch(() => null);
      if (!v) continue;
      put.run(p.id, "look", p.hash, blob(v));
      made++;
      if (made % 16 === 0) await Bun.sleep(5);
    }
    if (made) console.log(`Search by meaning: ${made} new ${made === 1 ? "entry" : "entries"}.`);
    return { made };
  } catch (e) {
    console.error("Search by meaning:", (e as Error).message);
    return null;
  } finally {
    working = false;
  }
}

export function meaningStatus(total: number) {
  const n = (kind: string) => db.query<{ n: number }, [string]>("SELECT COUNT(DISTINCT ref_id) n FROM embeddings WHERE kind LIKE ?").get(kind)!.n;
  return { on: meaningOn(), meaning_ready: here(TEXT_MODEL), look_ready: here(LOOK_MODEL), by_meaning: n("t:%"), by_look: n("look"), saves: total, working };
}
