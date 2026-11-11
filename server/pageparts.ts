// A part of a sketch the designer changed by hand in the studio: its own look (a size, a
// weight, a color, on that part only), or taken out. Pure functions beside pagetext.ts, and
// the same care applies (read its opening comment): the studio changed the live page, which
// the page's own script may have changed since it loaded, so the file is changed only where
// it's certain.
//
//   - A part is found by where it sits (body > main:nth-child(2) > p:nth-child(3)), and only
//     if exactly one element is there. The studio also sends what it saw there: the part's
//     class, its id and its first words. The class and id must be the file's (a class the
//     page's script added as it ran doesn't count against it), and so must the words, unless a
//     word edit waiting in the same save is inside the part or around it.
//   - Anything less certain is refused in plain words: the part is the page script's own.
//
// The trap: places shift when a part is taken out (the next one becomes nth-child(2)). So
// every change found by its place (words, looks, removals) is made in ONE pass over the file
// as it was, where each place still means what it meant in the live page. Word edits that
// have to find their words another way (pagetext.ts steps 2 and 3) run after that pass.

import { checkWords, decode, squash, withText, type TextEdit } from "./pagetext.ts";

/** What the studio saw of the part, for making sure the file's part is the same one. */
export interface PartSeen {
  /** Where it sits, as body > tag:nth-child(n) > … */
  path: string;
  cls?: string;
  id?: string;
  /** Its words (the first 300 characters, spaces squashed). */
  text?: string;
}
export interface PartStyle extends PartSeen {
  /** CSS properties for the part's own style; null takes one away. */
  props: Record<string, string | null>;
}
export type PartRemove = PartSeen;

/** The properties a part's look can be changed by here: type, color, fill, corners, opacity. */
export const STYLEABLE = new Set(["font-family", "font-size", "font-weight", "font-variation-settings", "line-height", "letter-spacing", "color", "background-color", "border-radius", "opacity"]);

export const NOT_HERE = "This part is drawn by the page's script, so it can't be changed by hand here. Ask FRIDAY to change it.";
const PATH = /^body( > [a-z][a-z0-9-]*:nth-child\(\d{1,4}\)){1,40}$/;

/** A value that can go into a style attribute: short, and nothing that could end the rule or load anything. */
function checkValue(prop: string, v: string) {
  if (!STYLEABLE.has(prop)) throw new Error(`“${prop}” can't be changed here.`);
  if (v.length > 200 || /[;{}<>]|url\(/i.test(v)) throw new Error("That value can't be used here.");
}

/** A style attribute with these properties set (or taken away), keeping everything else in it. */
export function mergeStyle(style: string, props: Record<string, string | null>) {
  const decls: [string, string][] = [];
  // Split on semicolons outside quotes and brackets ("a;b" in a font name stays whole).
  let depth = 0, quote = "", cur = "";
  for (const ch of style) {
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ";" && !depth) {
      decls.push(split(cur));
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) decls.push(split(cur));
  const out = decls.filter(([k]) => k && !(k.toLowerCase() in props));
  for (const [k, v] of Object.entries(props)) if (v != null && v.trim()) out.push([k, v.trim()]);
  return out.map(([k, v]) => `${k}: ${v}`).join("; ");
}
function split(decl: string): [string, string] {
  const at = decl.indexOf(":");
  return at < 0 ? [decl.trim(), ""] : [decl.slice(0, at).trim(), decl.slice(at + 1).trim()];
}

const words300 = (s: string) => squash(s).slice(0, 300);
/** The file's classes are all on the live part (its script may have added more as it ran). */
const sameClass = (file: string, seen: string) => {
  const live = new Set(seen.split(/\s+/).filter(Boolean));
  const mine = file.split(/\s+/).filter(Boolean);
  return mine.every((c) => live.has(c));
};

/**
 * Every hand change of one save, made on the file at once: words, looks and removals found by
 * their place in one pass over the file as it was, then the word edits found another way.
 * Throws, in plain words, if any of it can't be made with certainty.
 */
export function withParts(html: string, changes: { words?: TextEdit[]; styles?: PartStyle[]; removes?: PartRemove[] }): string {
  const words = changes.words ?? [];
  const styles = changes.styles ?? [];
  const removes = changes.removes ?? [];
  for (const w of words) checkWords(w);
  for (const s of styles) for (const [k, v] of Object.entries(s.props)) if (v != null) checkValue(k, v);
  for (const p of [...styles, ...removes]) if (!PATH.test(p.path)) throw new Error(NOT_HERE);

  // What the file has at each place: how many elements, the first one's class, id and words.
  const paths = [...new Set([...styles.map((s) => s.path), ...removes.map((r) => r.path), ...words.filter((w) => PATH.test(w.path)).map((w) => w.path)])];
  const found = new Map<string, { count: number; cls: string; id: string; text: string }>();
  if (paths.length) {
    const rw = new HTMLRewriter();
    for (const path of paths) {
      const f = { count: 0, cls: "", id: "", text: "" };
      found.set(path, f);
      rw.on(path, {
        element(el) {
          f.count++;
          if (f.count === 1) {
            f.cls = el.getAttribute("class") ?? "";
            f.id = el.getAttribute("id") ?? "";
          }
        },
        text(t) {
          if (f.count === 1) f.text += t.text;
        },
      });
    }
    rw.transform(html);
  }

  // A word edit inside the part, or around it, changes its words: then they can't be compared.
  const wordsNear = (path: string) => words.some((w) => w.path === path || w.path.startsWith(`${path} > `) || path.startsWith(`${w.path} > `));
  const sure = (p: PartSeen) => {
    const f = found.get(p.path);
    if (!f || f.count !== 1) return false;
    if (p.cls !== undefined && !sameClass(f.cls, p.cls)) return false;
    if (p.id !== undefined && f.id !== p.id) return false;
    if (p.text !== undefined && !wordsNear(p.path) && words300(decode(f.text)) !== words300(p.text)) return false;
    return true;
  };
  for (const p of [...styles, ...removes]) if (!sure(p)) throw new Error(NOT_HERE);

  // Word edits that are certain by their place go in the one pass; the rest come after it.
  const placed = new Map<string, TextEdit>();
  const later: TextEdit[] = [];
  for (const w of words) {
    if (w.after === w.before) continue;
    const f = found.get(w.path);
    if (f && f.count === 1 && squash(decode(f.text)) === squash(w.beforeText) && !placed.has(w.path)) placed.set(w.path, w);
    else later.push(w);
  }

  // Looks for the same part, one after another, as one set of properties.
  const looks = new Map<string, Record<string, string | null>>();
  for (const s of styles) looks.set(s.path, { ...(looks.get(s.path) ?? {}), ...s.props });
  const gone = new Set(removes.map((r) => r.path));

  let out = html;
  if (placed.size || looks.size || gone.size) {
    const rw = new HTMLRewriter();
    for (const [path, w] of placed) rw.on(path, { element: (el) => void el.setInnerContent(w.after, { html: true }) });
    for (const [path, props] of looks) {
      rw.on(path, {
        element(el) {
          // The file may write quotes as &quot; (and HTMLRewriter writes them so), and its ";"
          // would split a font's name: the style is read as the browser would before merging.
          const style = mergeStyle(decode(el.getAttribute("style") ?? ""), props);
          if (style) el.setAttribute("style", style);
          else el.removeAttribute("style");
        },
      });
    }
    for (const path of gone) rw.on(path, { element: (el) => void el.remove() });
    out = rw.transform(html);
  }
  for (const w of later) out = withText(out, w, false);
  return out;
}

/** One part's look changed, on its own. */
export const withStyle = (html: string, s: PartStyle) => withParts(html, { styles: [s] });
/** One part taken out of the file, on its own. */
export const withoutPart = (html: string, r: PartRemove) => withParts(html, { removes: [r] });
