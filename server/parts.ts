// Ready-made parts by name, inside a sketch's page.
//
// FRIDAY (or any AI app) writes a short tag where a ready-made part goes:
//   <panel-icon name="trash"></panel-icon>         (weight="bold" for another weight)
//   <panel-loading name="ring"></panel-loading>
// and Panel puts the real drawing in when it saves the page (fillParts, called by writeVersion).
// So the saved file is still one whole, self-contained page, and the studio, the knobs, Figma and
// a real build all get that page. Nobody types a drawing's numbers, so none can come back changed.
//
// When Panel hands a page back to an AI (get_sketch, a Figma rebuild, edits), every part that is
// still exactly what Panel put in is shown as its short tag again (shortParts). One the designer
// or anyone changed stays as it is. Filling the short form again gives the same page, byte for
// byte: that is what lets an edit leave the parts it didn't touch exactly as they were.
//
// Tags are only filled in the page's HTML, never inside a script, a style or a comment (a drawing
// dropped into a script's text could break it). Pure: it reads only ready/ (through ready.ts).

import { ICON_WEIGHTS, iconSvg, loadingParts, loadingPiece, nearLoading, nearNames, type IconWeight } from "./ready.ts";

/** What a part's tag may carry over to the drawing, in the order it is written. */
const CARRIED = ["class", "id", "style", "title", "aria-label"] as const;
type Carried = Partial<Record<(typeof CARRIED)[number], string>>;

/** Elements whose inside is text, not HTML: nothing in them is a tag. */
const RAW = new Set(["script", "style", "textarea", "title", "xmp", "noembed", "noframes"]);

interface Tag {
  /** Lower-case element name; "/name" for an end tag. */
  name: string;
  start: number;
  /** Just past its ">". */
  end: number;
  attrs: Map<string, string>;
  selfClosing: boolean;
  /** Where the outermost <template> around it starts, if it is inside one. */
  template?: number;
}

/** Where a start tag that begins at `i` (just past its name) ends: past its ">", minding quoted values. */
function tagEnd(html: string, i: number): number {
  let quote = "";
  let afterEquals = false;
  for (; i < html.length; i++) {
    const c = html[i]!;
    if (quote) {
      if (c === quote) quote = "";
      continue;
    }
    if (c === ">") return i + 1;
    if ((c === '"' || c === "'") && afterEquals) {
      quote = c;
      afterEquals = false;
      continue;
    }
    if (c === "=") afterEquals = true;
    else if (!/\s/.test(c)) afterEquals = false;
  }
  return -1;
}

/**
 * A tag's attributes as written: names in lower case, values as raw text (entities left as they
 * are). A value in single quotes that holds a double quote gets &quot;, so it can be written back
 * in double quotes.
 */
function parseAttrs(inside: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of inside.matchAll(/([^\s"'=<>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const key = m[1]!.toLowerCase();
    if (out.has(key)) continue;
    const value = m[2] ?? (m[3] !== undefined ? m[3].replace(/"/g, "&quot;") : m[4]) ?? "";
    out.set(key, value);
  }
  return out;
}

/** Every tag in the page's HTML, in order: comments, doctypes and the text inside scripts and styles are passed over. */
function tags(html: string): Tag[] {
  const out: Tag[] = [];
  const templates: number[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) break;
    if (html.startsWith("<!--", lt)) {
      const close = html.indexOf("-->", lt + 4);
      i = close < 0 ? html.length : close + 3;
      continue;
    }
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      const close = html.indexOf(">", lt);
      i = close < 0 ? html.length : close + 1;
      continue;
    }
    const m = /^<(\/?)([A-Za-z][^\s\/>]*)/.exec(html.slice(lt, lt + 80));
    if (!m) {
      i = lt + 1;
      continue;
    }
    const name = m[2]!.toLowerCase();
    const end = tagEnd(html, lt + m[0].length);
    if (end < 0) break;
    if (m[1]) {
      if (name === "template") templates.pop();
      out.push({ name: `/${name}`, start: lt, end, attrs: new Map(), selfClosing: false });
      i = end;
      continue;
    }
    const inside = html.slice(lt + m[0].length, end - 1);
    const tag: Tag = { name, start: lt, end, attrs: parseAttrs(inside), selfClosing: /\/\s*$/.test(inside), template: templates[0] };
    out.push(tag);
    i = end;
    if (name === "template" && !tag.selfClosing) templates.push(lt);
    if (RAW.has(name)) {
      // Its text runs to its own end tag; the end tag is listed, so a style can be read whole.
      const close = new RegExp(`</${name}[\\s>/]`, "ig");
      close.lastIndex = end;
      const c = close.exec(html);
      i = c ? c.index : html.length;
    }
  }
  return out;
}

/**
 * The attributes a part carries over, from its tag or from a filled drawing's own attributes.
 * A loading piece's own class (ownClass) comes first in a filled one, and only what was added
 * after it is carried; null when its own class is gone, so it isn't Panel's as it was.
 */
function carriedFrom(attrs: Map<string, string>, ownClass = ""): Carried | null {
  const out: Carried = {};
  for (const key of CARRIED) {
    let v = attrs.get(key);
    if (key === "class" && ownClass) {
      if (v === ownClass) v = "";
      else if (v?.startsWith(`${ownClass} `)) v = v.slice(ownClass.length + 1);
      else return null;
    }
    if (v) out[key] = v;
  }
  return out;
}

/**
 * A drawing's opening tag with its marks and carried attributes: the marks right after the
 * element's name, the class with it (after the piece's own), an aria-label in place of
 * aria-hidden (then it is announced as a picture), and id, style and title at the end.
 */
function opening(open: string, marks: string, c: Carried, ownClass = ""): string {
  const m = /^<([a-z]+)/.exec(open)!;
  let rest = open.slice(m[0].length, -1);
  let cls = "";
  if (c.class) {
    if (ownClass) rest = rest.replace(` class="${ownClass}"`, ` class="${ownClass} ${c.class}"`);
    else cls = ` class="${c.class}"`;
  }
  if (c["aria-label"]) rest = rest.replace(' aria-hidden="true"', ` role="img" aria-label="${c["aria-label"]}"`).replace(' role="presentation"', "");
  const tail = (["id", "style", "title"] as const).map((k) => (c[k] ? ` ${k}="${c[k]}"` : "")).join("");
  return `<${m[1]}${marks}${cls}${rest}${tail}>`;
}

/** An icon as Panel fills it in: iconSvg()'s drawing, marked with its name and weight. */
export function filledIcon(name: string, weight: IconWeight, c: Carried = {}): string | null {
  const svg = iconSvg(name, weight);
  if (!svg) return null;
  const open = svg.slice(0, svg.indexOf(">") + 1);
  return opening(open, ` data-panel-icon="${name}" data-panel-weight="${weight}"`, c) + svg.slice(open.length);
}

/** A loading piece split into its parts: the licence line, its CSS, its markup. */
function piece(name: string) {
  const html = loadingPiece(name);
  if (!html) return null;
  const credit = /^<!--\s*([\s\S]*?)\s*-->/.exec(html)?.[1] ?? "";
  const css = html.slice(html.indexOf("<style>") + 7, html.indexOf("</style>"));
  const markup = html.slice(html.indexOf("</style>") + 8).trim();
  return { credit, css, markup };
}

/** A loading animation's style as Panel puts it in the page, once however often it's used. */
export function loadingStyle(name: string): string | null {
  const p = piece(name);
  return p ? `<style data-panel-loading="${name}">\n/* ${p.credit} */${p.css}</style>` : null;
}

/** A loading animation's markup as Panel fills it in, marked with its name. */
export function filledLoading(name: string, c: Carried = {}): string | null {
  const p = piece(name);
  if (!p) return null;
  const open = p.markup.slice(0, p.markup.indexOf(">") + 1);
  return opening(open, ` data-panel-loading="${name}"`, c, `ld-${name}`) + p.markup.slice(open.length);
}

const attrText = (c: Carried) => CARRIED.map((k) => (c[k] ? ` ${k}="${c[k]}"` : "")).join("");
const iconTag = (name: string, weight: string, c: Carried) => `<panel-icon name="${name}"${weight === "regular" ? "" : ` weight="${weight}"`}${attrText(c)}></panel-icon>`;
const loadingTag = (name: string, c: Carried) => `<panel-loading name="${name}"${attrText(c)}></panel-loading>`;

interface Part {
  kind: "icon" | "loading";
  name: string;
  weight: IconWeight;
  start: number;
  end: number;
  anchor: number;
  carried: Carried;
}

/** The <panel-icon> and <panel-loading> tags in a page's HTML, and what is wrong with any of them. */
function partsIn(html: string, list = tags(html)) {
  const parts: Part[] = [];
  const wrong: string[] = [];
  for (let k = 0; k < list.length; k++) {
    const t = list[k]!;
    if (t.name !== "panel-icon" && t.name !== "panel-loading") continue;
    const kind = t.name === "panel-icon" ? "icon" : "loading";
    // Its end tag, right after it (spaces between are fine), goes with it.
    let end = t.end;
    const next = list[k + 1];
    if (!t.selfClosing && next?.name === `/${t.name}` && !html.slice(t.end, next.start).trim()) end = next.end;
    const name = (t.attrs.get("name") ?? "").trim().toLowerCase();
    const weight = (t.attrs.get("weight") ?? "regular").trim().toLowerCase();
    if (!name) {
      wrong.push(kind === "icon" ? `An icon tag has no name: write <panel-icon name="trash"></panel-icon>.` : `A loading tag has no name: write <panel-loading name="ring"></panel-loading>.`);
      continue;
    }
    if (kind === "icon") {
      if (!(ICON_WEIGHTS as readonly string[]).includes(weight)) {
        wrong.push(`There is no icon weight “${weight}”. The weights: ${ICON_WEIGHTS.join(", ")}.`);
        continue;
      }
      if (!iconSvg(name, weight as IconWeight)) {
        wrong.push(`There is no icon called “${name}”. Closest: ${nearNames(name, 3).join(", ")}.`);
        continue;
      }
    } else if (!loadingParts().loading.some((l) => l.name === name)) {
      wrong.push(`There is no loading animation called “${name}”. Closest: ${nearLoading(name).join(", ")}.`);
      continue;
    }
    parts.push({ kind, name, weight: weight as IconWeight, start: t.start, end, anchor: t.template ?? t.start, carried: carriedFrom(t.attrs)! });
  }
  return { parts, wrong };
}

/** The exact loading styles Panel put in a page, by name, with where each is. */
function stylesIn(html: string, list: Tag[]) {
  const found = new Map<string, { start: number; end: number }[]>();
  for (const t of list) {
    const name = t.name === "style" ? t.attrs.get("data-panel-loading") : undefined;
    if (!name) continue;
    const style = loadingStyle(name);
    if (style && html.startsWith(style, t.start)) found.set(name, [...(found.get(name) ?? []), { start: t.start, end: t.start + style.length }]);
  }
  return found;
}

/** Changes to a page: each replaces start..end with text. Insertions at a spot go before a replacement there. */
function apply(html: string, edits: { start: number; end: number; text: string }[]) {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - a.start - (b.end - b.start));
  let out = "";
  let at = 0;
  for (const e of sorted) {
    out += html.slice(at, e.start) + e.text;
    at = e.end;
  }
  return out + html.slice(at);
}

/**
 * Fill every part's tag in a page with Panel's own drawing. A loading animation's style goes in
 * once, just before its first use (before the <template> it's in, if it is in one), unless the
 * page has it already. A wrong name throws, in plain words, with the closest names: nothing is saved.
 */
export function fillParts(html: string): string {
  const list = tags(html);
  const { parts, wrong } = partsIn(html, list);
  if (wrong.length) throw new Error(`${wrong.join(" ")} Nothing was saved: fix the name and try again (get_ready_made find_icons finds icon names).`);
  if (!parts.length) return html;
  const styled = stylesIn(html, list);
  const edits: { start: number; end: number; text: string }[] = [];
  for (const p of parts) {
    if (p.kind === "loading" && !styled.has(p.name)) {
      edits.push({ start: p.anchor, end: p.anchor, text: loadingStyle(p.name)! });
      styled.set(p.name, []);
    }
    edits.push({ start: p.start, end: p.end, text: p.kind === "icon" ? filledIcon(p.name, p.weight, p.carried)! : filledLoading(p.name, p.carried)! });
  }
  return apply(html, edits);
}

/** A page still being written, with what can be filled in already (the live draft FRIDAY shows); never throws. */
export function draftWithParts<T extends string | null>(html: T): T {
  if (!html || !html.includes("<panel-")) return html;
  try {
    return fillParts(html) as T;
  } catch {
    return html;
  }
}

/**
 * A page as an AI should read it: every part still exactly as Panel filled it in is its short tag
 * again, so no drawing's numbers are shown. fillParts(shortParts(page)) gives the page back, byte
 * for byte. A part someone changed stays as it is. A loading animation is turned back only while
 * its style is in the page, and its style is taken out only when filling would put it back where it is.
 */
export function shortParts(html: string): string {
  if (!html.includes("data-panel-")) return html;
  const list = tags(html);
  const edits: { start: number; end: number; text: string }[] = [];
  const styled = stylesIn(html, list);
  const firstLoading = new Map<string, number>();
  let skipTo = 0;
  for (const t of list) {
    if (t.start < skipTo || t.name.startsWith("/")) continue;
    const icon = t.attrs.get("data-panel-icon");
    const loading = t.attrs.get("data-panel-loading");
    if (icon !== undefined && t.name === "svg") {
      const weight = t.attrs.get("data-panel-weight") ?? "";
      const c = carriedFrom(t.attrs)!;
      const filled = (ICON_WEIGHTS as readonly string[]).includes(weight) ? filledIcon(icon, weight as IconWeight, c) : null;
      if (filled && html.startsWith(filled, t.start)) {
        edits.push({ start: t.start, end: t.start + filled.length, text: iconTag(icon, weight, c) });
        skipTo = t.start + filled.length;
      }
    } else if (loading !== undefined && t.name !== "style" && styled.has(loading)) {
      const c = carriedFrom(t.attrs, `ld-${loading}`);
      const filled = c && filledLoading(loading, c);
      if (c && filled && html.startsWith(filled, t.start)) {
        edits.push({ start: t.start, end: t.start + filled.length, text: loadingTag(loading, c) });
        if (!firstLoading.has(loading)) firstLoading.set(loading, t.template ?? t.start);
        skipTo = t.start + filled.length;
      }
    }
  }
  // A style goes back out only when it is the one copy and sits right before the first use, where filling puts it.
  for (const [name, at] of firstLoading) {
    const copies = styled.get(name)!;
    if (copies.length === 1 && copies[0]!.end === at) edits.push({ start: copies[0]!.start, end: copies[0]!.end, text: "" });
  }
  return edits.length ? apply(html, edits) : html;
}

/**
 * The same, loosely, for a piece of a page as the browser has it (what the designer pointed at in
 * the studio): the browser writes a drawing a little differently from the file, so an icon or a
 * loading animation Panel marked is shown as its tag whatever is inside it. Only for reading, never
 * for saving.
 */
export function shortPartsLoosely(fragment: string): string {
  if (!fragment.includes("data-panel-")) return fragment;
  let out = fragment.replace(/<style\b[^>]*\bdata-panel-loading="[^"]*"[^>]*>[\s\S]*?<\/style>/gi, "");
  out = out.replace(/<svg\b([^>]*\bdata-panel-icon="[^"]*"[^>]*)>[\s\S]*?<\/svg>/gi, (_, inside: string) => {
    const a = parseAttrs(inside);
    return iconTag(a.get("data-panel-icon")!, a.get("data-panel-weight") ?? "regular", carriedFrom(a)!);
  });
  // A loading animation's root: the element marked, up to its own end tag (counting ones nested in it).
  for (;;) {
    const m = /<(svg|div)\b([^>]*\bdata-panel-loading="([^"]*)"[^>]*)>/i.exec(out);
    if (!m) break;
    const el = m[1]!.toLowerCase();
    const re = new RegExp(`<(/?)${el}\\b[^>]*>`, "gi");
    re.lastIndex = m.index + m[0].length;
    let depth = 1;
    let end = out.length;
    for (let x = re.exec(out); x; x = re.exec(out)) {
      depth += x[1] ? -1 : 1;
      if (!depth) {
        end = x.index + x[0].length;
        break;
      }
    }
    const a = parseAttrs(m[2]!);
    out = out.slice(0, m.index) + loadingTag(m[3]!, carriedFrom(a, `ld-${m[3]}`) ?? {}) + out.slice(end);
  }
  return out;
}
