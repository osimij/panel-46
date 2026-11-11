// Words the designer changed themselves in the studio (pointed at a heading, double-clicked,
// typed), written back into the sketch's file as a new version. The studio edits the live
// page, which scripts may have changed since it loaded, so the file is changed carefully:
//
//   1. By where the part sits in the page (body > main:nth-child(2) > h1:nth-child(1)),
//      if exactly one element is there and its words are the ones the designer saw.
//   2. Else by its HTML, if that appears exactly once in the file.
//   3. Else, for plain words, by the words themselves, if they appear exactly once
//      (this also finds words a script writes from a string).
//
// Anything less certain is refused with a plain message: changing the wrong words is worse
// than asking FRIDAY.

export interface TextEdit {
  /** Where the part sits, as body > tag:nth-child(n) > … */
  path: string;
  /** Its HTML before and after the edit. */
  before: string;
  after: string;
  /** Its words before and after (textContent). */
  beforeText: string;
  afterText: string;
}

export const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Is this place in the file inside a <script> element? */
function inScript(html: string, at: number) {
  const opened = html.lastIndexOf("<script", at);
  return opened >= 0 && html.lastIndexOf("</script", at) < opened;
}

const NOT_FOUND = "Couldn't find those words in the sketch's file (the page's own script probably writes them). Ask FRIDAY to change them instead.";

/** Refuses an edit that isn't only words (typing can't add a script or an onclick). */
export function checkWords(e: TextEdit) {
  if (e.after.length > 20_000) throw new Error("That's too much text to change here.");
  // Typing can't add these; if they're there, it isn't a text edit.
  if (/<\/?(script|style|iframe|object|embed|link|meta)\b/i.test(e.after) || /\son[a-z]+\s*=/i.test(e.after)) throw new Error("Only words can be changed here.");
}

/**
 * The sketch's HTML with the edit made, or an error saying why it can't be. `byPlace` false
 * skips step 1: pageparts.ts has done that already, in one pass with the other changes.
 */
export function withText(html: string, e: TextEdit, byPlace = true): string {
  checkWords(e);
  if (e.after === e.before) return html;

  // 1. By its place in the page.
  if (byPlace && /^body( > [a-z][a-z0-9-]*:nth-child\(\d{1,4}\)){1,40}$/.test(e.path)) {
    let found = 0;
    let text = "";
    new HTMLRewriter()
      .on(e.path, {
        element() {
          found++;
        },
        text(t) {
          if (found === 1) text += t.text;
        },
      })
      .transform(html);
    if (found === 1 && squash(decode(text)) === squash(e.beforeText)) {
      return new HTMLRewriter()
        .on(e.path, {
          element(el) {
            el.setInnerContent(e.after, { html: true });
          },
        })
        .transform(html);
    }
  }

  // 2. By its HTML, as the browser wrote it out (not inside a script: step 3 handles that).
  if (e.before.trim()) {
    const at = html.indexOf(e.before);
    if (at >= 0 && html.indexOf(e.before, at + 1) < 0 && !inScript(html, at)) return html.slice(0, at) + e.after + html.slice(at + e.before.length);
  }

  // 3. Plain words, found by the words.
  const words = squash(e.beforeText);
  if (!/</.test(e.before) && words) {
    // In the file the same words may be split across lines or written with entities.
    const pattern = words
      .split(" ")
      .map((w) => [...w].map((ch) => (ch === "&" ? "(?:&amp;|&)" : ch === "<" ? "(?:&lt;|<)" : ch === ">" ? "(?:&gt;|>)" : reEscape(ch))).join(""))
      .join("(?:\\s|&nbsp;)+");
    const all = [...html.matchAll(new RegExp(pattern, "g"))];
    if (all.length === 1) {
      const m = all[0]!;
      const at = m.index!;
      const script = inScript(html, at);
      const next = squash(e.afterText);
      // In a script the words sit inside a string: only plain words can go there safely.
      if (script && /["'`\\<>\n]/.test(next)) throw new Error("These words are written by the page's script, and the new ones have quotes or brackets in them. Ask FRIDAY to change them instead.");
      return html.slice(0, at) + (script ? next : escapeText(next)) + html.slice(at + m[0].length);
    }
    if (all.length > 1) throw new Error("Those words appear more than once in the sketch, so it isn't clear which to change. Ask FRIDAY instead.");
  }
  throw new Error(NOT_FOUND);
}
