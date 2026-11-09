// The designer's own fonts: files they upload (a licensed typeface, a client's brand font), so
// sketches can use type that isn't on Google Fonts. Each file is one face (a weight, upright or
// italic, or a variable font covering a range of weights) of a family.
//
// The files live in <library>/fonts/<id>.<ext>. Every sketch Panel serves gets an @font-face for
// each of them (servedSketch in sketches.ts), so a sketch only has to write
// font-family: "The Family" and it works, in the canvas, the studio, its own tab and the
// pictures Claude looks at. FRIDAY is told which families there are (fontsNote, in chat.ts).
//
// The family, weight and style are read from the file itself (its name and OS/2 tables), so
// "Söhne-Halbfett.woff2" lands as Söhne 600 without anyone typing it. The designer can rename a
// family; that name is what sketches write.

import { brotliDecompressSync, inflateSync } from "node:zlib";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { extname, join } from "node:path";
import { db, newId, now } from "./db.ts";
import { LIBRARY_DIR } from "./config.ts";

export const FONTS_DIR = join(LIBRARY_DIR, "fonts");
const MAX_FONT = 30 * 1024 * 1024;
const FORMATS: Record<string, { css: string; mime: string }> = {
  ".woff2": { css: "woff2", mime: "font/woff2" },
  ".woff": { css: "woff", mime: "font/woff" },
  ".ttf": { css: "truetype", mime: "font/ttf" },
  ".otf": { css: "opentype", mime: "font/otf" },
};

db.exec(`CREATE TABLE IF NOT EXISTS fonts (
  id TEXT PRIMARY KEY,
  family TEXT NOT NULL,
  style_name TEXT NOT NULL DEFAULT '',
  weight TEXT NOT NULL DEFAULT '400',
  italic INTEGER NOT NULL DEFAULT 0,
  file TEXT NOT NULL,
  original_name TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
)`);

interface FontRow {
  id: string;
  family: string;
  style_name: string;
  weight: string;
  italic: number;
  file: string;
  original_name: string;
  size: number;
  created_at: string;
}

export interface Face {
  id: string;
  family: string;
  style_name: string;
  /** "400", or "100 900" for a variable font. */
  weight: string;
  italic: boolean;
  format: string;
  size: number;
  original_name: string;
  url: string;
}

const face = (r: FontRow): Face => ({
  id: r.id,
  family: r.family,
  style_name: r.style_name,
  weight: r.weight,
  italic: !!r.italic,
  format: extname(r.file).slice(1),
  size: r.size,
  original_name: r.original_name,
  url: `/fonts/${r.file}`,
});

const rows = () => db.query<FontRow, []>("SELECT * FROM fonts ORDER BY family COLLATE NOCASE, italic, CAST(weight AS INTEGER)").all();

/** Every face, grouped by family in the order shown. */
export function listFonts() {
  const families = new Map<string, Face[]>();
  for (const r of rows()) {
    const list = families.get(r.family) ?? [];
    list.push(face(r));
    families.set(r.family, list);
  }
  return [...families].map(([family, faces]) => ({ family, faces }));
}

/** Save an uploaded font file, reading its family, weight and style from inside it. */
export async function addFont(file: File) {
  const ext = extname(file.name).toLowerCase();
  if (!FORMATS[ext]) throw new Error(`${file.name} isn't a font file Panel can use (.woff2, .woff, .ttf or .otf).`);
  if (file.size > MAX_FONT) throw new Error(`${file.name} is over ${MAX_FONT / 1024 / 1024} MB.`);
  if (!file.size) throw new Error(`${file.name} is empty.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let info: FontInfo;
  try {
    info = readFont(bytes);
  } catch {
    throw new Error(`${file.name} doesn't open as a font.`);
  }
  const fallback = guessFromName(file.name);
  const family = (info.family || fallback.family).trim().slice(0, 120) || "Untitled font";
  const style = (info.style || fallback.style).trim().slice(0, 80);
  // Some older fonts say 400 inside even for their Bold; the style's own name is right then.
  const named = WEIGHT_WORDS.find(([re]) => re.test(style))?.[1];
  const weight = info.weightRange ?? String(info.weight && !(info.weight === 400 && named) ? info.weight : (named ?? fallback.weight));
  const italic = info.italic ?? /italic|oblique/i.test(style || file.name);
  const id = newId();
  const name = `${id}${ext}`;
  mkdirSync(FONTS_DIR, { recursive: true });
  await Bun.write(join(FONTS_DIR, name), bytes);
  db.run(
    "INSERT INTO fonts (id, family, style_name, weight, italic, file, original_name, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, family, style, weight, italic ? 1 : 0, name, file.name.replace(/[\u0000-\u001f]/g, "").slice(0, 200), file.size, now()],
  );
  return face(db.query<FontRow, [string]>("SELECT * FROM fonts WHERE id = ?").get(id)!);
}

/** Rename a family: the name sketches write in font-family. Joining an existing family is fine. */
export function renameFamily(from: string, to: string) {
  const clean = to.trim().replace(/["\\;{}<>]/g, "").slice(0, 120);
  if (!clean) throw new Error("The family needs a name.");
  db.run("UPDATE fonts SET family = ? WHERE family = ?", [clean, from]);
  return { family: clean };
}

/** Delete one face, or a whole family. The files go too. */
export function removeFonts(where: { id?: string; family?: string }) {
  const gone = where.id
    ? db.query<FontRow, [string]>("SELECT * FROM fonts WHERE id = ?").all(where.id)
    : db.query<FontRow, [string]>("SELECT * FROM fonts WHERE family = ?").all(where.family ?? "");
  for (const r of gone) {
    db.run("DELETE FROM fonts WHERE id = ?", [r.id]);
    rmSync(join(FONTS_DIR, r.file), { force: true });
  }
  return { removed: gone.length };
}

/** A font file to serve, if it's one of ours. */
export function fontFile(name: string) {
  if (!/^[0-9a-f]{16}\.(woff2|woff|ttf|otf)$/.test(name)) return null;
  const path = join(FONTS_DIR, name);
  if (!existsSync(path)) return null;
  return { path, mime: FORMATS[extname(name)]!.mime };
}

/** The @font-face rules for every face, as sketches get them. */
export function fontFaceCss(base = "") {
  return rows()
    .map((r) => {
      const fmt = FORMATS[extname(r.file)]!.css;
      return `@font-face{font-family:"${r.family}";src:url("${base}/fonts/${r.file}") format("${fmt}");font-weight:${r.weight};font-style:${r.italic ? "italic" : "normal"};font-display:swap}`;
    })
    .join("\n");
}

/** One line per family, the way FRIDAY and other AI tools read them. */
export function fontLines() {
  return listFonts().map(({ family, faces }) => {
    const weights = [...new Set(faces.filter((f) => !f.italic).map((f) => f.weight))];
    const italics = [...new Set(faces.filter((f) => f.italic).map((f) => f.weight))];
    return `“${family}”: ${weights.length ? `weights ${weights.join(", ")}` : "no upright"}${italics.length ? `; italic ${italics.join(", ")}` : ""}`;
  });
}

// ---------- Reading a font file ----------

interface FontInfo {
  family?: string;
  style?: string;
  weight?: number;
  /** For a variable font: "100 900". */
  weightRange?: string;
  italic?: boolean;
}

/** WOFF2's table tags, by the index its directory stores instead of the tag. */
const WOFF2_TAGS = "cmap,head,hhea,hmtx,maxp,name,OS/2,post,cvt ,fpgm,glyf,loca,prep,CFF ,VORG,EBDT,EBLC,gasp,hdmx,kern,LTSH,PCLT,VDMX,vhea,vmtx,BASE,GDEF,GPOS,GSUB,EBSC,JSTF,MATH,CBDT,CBLC,COLR,CPAL,SVG ,sbix,acnt,avar,bdat,bloc,bsln,cvar,fdsc,feat,fmtx,fvar,gvar,hsty,just,lcar,mort,morx,opbd,prop,trak,Zapf,Silf,Glat,Gloc,Feat,Sill".split(",");

const tagAt = (b: Uint8Array, o: number) => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);

/** The tables we need (name, OS/2, fvar), unpacked from a TTF/OTF, WOFF or WOFF2 file. */
function tablesOf(b: Uint8Array): Map<string, Uint8Array> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const want = new Set(["name", "OS/2", "fvar"]);
  const out = new Map<string, Uint8Array>();
  const sig = tagAt(b, 0);
  if (sig === "wOFF") {
    const n = v.getUint16(12);
    for (let i = 0; i < n; i++) {
      const at = 44 + i * 20;
      const tag = tagAt(b, at);
      if (!want.has(tag)) continue;
      const off = v.getUint32(at + 4), comp = v.getUint32(at + 8), orig = v.getUint32(at + 12);
      const raw = b.subarray(off, off + comp);
      out.set(tag, comp < orig ? new Uint8Array(inflateSync(raw)) : raw);
    }
    return out;
  }
  if (sig === "wOF2") {
    const n = v.getUint16(12);
    const compressed = v.getUint32(20);
    let p = 48;
    const base128 = () => {
      let x = 0;
      for (let i = 0; i < 5; i++) {
        const c = b[p++]!;
        x = x * 128 + (c & 0x7f);
        if (!(c & 0x80)) return x;
      }
      throw new Error("bad number");
    };
    const dir: { tag: string; len: number }[] = [];
    for (let i = 0; i < n; i++) {
      const flags = b[p++]!;
      const tag = (flags & 0x3f) === 63 ? tagAt(b, (p += 4) - 4) : WOFF2_TAGS[flags & 0x3f]!;
      const version = (flags >> 6) & 3;
      const orig = base128();
      const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
      dir.push({ tag, len: transformed ? base128() : orig });
    }
    if (tagAt(b, 4) === "ttcf") throw new Error("collections aren't read");
    const data = new Uint8Array(brotliDecompressSync(b.subarray(p, p + compressed)));
    let at = 0;
    for (const t of dir) {
      if (want.has(t.tag)) out.set(t.tag, data.subarray(at, at + t.len));
      at += t.len;
    }
    return out;
  }
  // A plain TrueType or OpenType file.
  const n = v.getUint16(4);
  for (let i = 0; i < n; i++) {
    const at = 12 + i * 16;
    const tag = tagAt(b, at);
    if (want.has(tag)) out.set(tag, b.subarray(v.getUint32(at + 8), v.getUint32(at + 8) + v.getUint32(at + 12)));
  }
  return out;
}

export function readFont(b: Uint8Array): FontInfo {
  const t = tablesOf(b);
  const info: FontInfo = {};
  const name = t.get("name");
  if (name) {
    const v = new DataView(name.buffer, name.byteOffset, name.byteLength);
    const count = v.getUint16(2), strings = v.getUint16(4);
    const found = new Map<number, { score: number; text: string }>();
    for (let i = 0; i < count; i++) {
      const at = 6 + i * 12;
      const platform = v.getUint16(at), lang = v.getUint16(at + 4), id = v.getUint16(at + 6);
      if (![1, 2, 4, 16, 17].includes(id)) continue;
      const len = v.getUint16(at + 8), off = strings + v.getUint16(at + 10);
      const raw = name.subarray(off, off + len);
      let text = "";
      let score = 0;
      if (platform === 3 || platform === 0) {
        for (let j = 0; j + 1 < raw.length; j += 2) text += String.fromCharCode((raw[j]! << 8) | raw[j + 1]!);
        score = platform === 3 && lang === 0x409 ? 3 : 2;
      } else if (platform === 1) {
        text = String.fromCharCode(...raw);
        score = lang === 0 ? 1 : 0;
      } else continue;
      if (text.trim() && (found.get(id)?.score ?? -1) < score) found.set(id, { score, text: text.trim() });
    }
    // The typographic family (16) groups every weight under one name; the old one (1) often doesn't.
    info.family = found.get(16)?.text ?? found.get(1)?.text;
    info.style = found.get(17)?.text ?? found.get(2)?.text;
  }
  const os2 = t.get("OS/2");
  if (os2 && os2.length >= 64) {
    const v = new DataView(os2.buffer, os2.byteOffset, os2.byteLength);
    const w = v.getUint16(4);
    if (w >= 1 && w <= 1000) info.weight = w;
    info.italic = !!(v.getUint16(62) & 1);
  }
  const fvar = t.get("fvar");
  if (fvar && fvar.length >= 16) {
    const v = new DataView(fvar.buffer, fvar.byteOffset, fvar.byteLength);
    const axes = v.getUint16(4), count = v.getUint16(8), size = v.getUint16(10);
    for (let i = 0; i < count; i++) {
      const at = axes + i * size;
      if (at + 16 > fvar.length) break;
      if (tagAt(fvar, at) === "wght") {
        const min = Math.round(v.getInt32(at + 4) / 65536), max = Math.round(v.getInt32(at + 12) / 65536);
        if (min < max) info.weightRange = `${min} ${max}`;
      }
    }
  }
  return info;
}

const WEIGHT_WORDS: [RegExp, number][] = [
  [/hairline|thin/i, 100], [/extra.?light|ultra.?light/i, 200], [/light/i, 300], [/medium/i, 500],
  [/semi.?bold|demi/i, 600], [/extra.?bold|ultra.?bold/i, 800], [/black|heavy/i, 900], [/bold/i, 700],
];

/** When a file has no readable name: "Sohne-SemiBoldItalic.woff2" → Sohne, 600, SemiBold Italic. */
function guessFromName(fileName: string) {
  const stem = fileName.replace(/\.[a-z0-9]+$/i, "");
  const [fam, ...rest] = stem.split(/[-_]/);
  const style = rest.join(" ").replace(/([a-z])([A-Z])/g, "$1 $2");
  const weight = WEIGHT_WORDS.find(([re]) => re.test(style))?.[1] ?? 400;
  return { family: (fam ?? stem).replace(/([a-z])([A-Z])/g, "$1 $2"), style: style || "Regular", weight };
}
