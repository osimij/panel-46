// Sketches: quick, throwaway web pages on a project's canvas, for trying a direction before
// anyone builds it. Each is one HTML file Claude writes. Panel renders it in headless Chrome
// and hands Claude the pictures, so Claude sees what it made before the designer does.
//
// A sketch keeps every version as its own file, never overwritten:
//   <library>/projects/<project>/sketches/<sketch>/v1.html, v1.jpg (first screen),
//   v1-2.jpg, v1-3.jpg (the screens below), v1.json (page height, errors the page threw)
// The canvas card only says which version it shows, so undo is just going back a number.
//
// The pages are served with a sandbox (no same-origin), so a sketch runs its scripts but
// can't reach Panel's library or API, in the canvas or in its own tab.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOST, LIBRARY_DIR, PORT } from "./config.ts";
import { Cdp, chromePath, devtoolsUrl, evaluate, READY_SCRIPT, trackNetwork } from "./site.ts";
import { checkRules, type RuleFinding } from "./rulecheck.ts";
import { checkSkills, skillKeyNow, type SkillFinding } from "./skillcheck.ts";
import { fontFaceCss } from "./fonts.ts";
import { fillParts } from "./parts.ts";

const ID = /^[0-9a-f]{16}$/;
/** The screen a sketch is looked at on: a laptop, at 1×. Claude sees screens of this size. */
export const SCREEN = { width: 1440, height: 900 };
/** How many screens down the page are kept and shown to Claude. */
const MAX_SCREENS = 3;
const MAX_HTML = 1_500_000;

/** What a sketch page may do in its sandbox. Everything but being Panel (same-origin). */
export const SKETCH_CSP = "sandbox allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock allow-downloads";

export function sketchDir(projectId: string, sketchId: string) {
  if (!ID.test(projectId) || !ID.test(sketchId)) throw new Error("Not a sketch.");
  return join(LIBRARY_DIR, "projects", projectId, "sketches", sketchId);
}

/** The versions on disk, oldest first. */
export function versionsOf(projectId: string, sketchId: string): number[] {
  const dir = sketchDir(projectId, sketchId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .flatMap((f) => {
      const m = f.match(/^v(\d+)\.html$/);
      return m ? [Number(m[1])] : [];
    })
    .sort((a, b) => a - b);
}

export const sketchPath = (projectId: string, sketchId: string, v: number) => `/sketches/${projectId}/${sketchId}/v${v}.html`;
export const picturePath = (projectId: string, sketchId: string, v: number, screen = 1) =>
  `/sketches/${projectId}/${sketchId}/v${v}${screen > 1 ? `-${screen}` : ""}.jpg`;
export const fullUrl = (path: string) => `http://${HOST}:${PORT}${path}`;

export function readSketch(projectId: string, sketchId: string, v: number) {
  const file = join(sketchDir(projectId, sketchId), `v${v}.html`);
  if (!existsSync(file)) throw new Error(`That sketch has no version ${v}.`);
  return readFileSync(file, "utf8");
}

/** The file behind a /sketches/… path, or null when there's no such file. */
export function sketchFile(raw: string): { file: string; html: boolean; figma?: boolean } | null {
  let path = raw;
  try {
    path = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (path.includes("..")) return null;
  const m = path.match(/^\/sketches\/([0-9a-f]{16})\/([0-9a-f]{16})\/((?:views\/v\d{1,5}-(?:desktop|tablet|phone)(?:-[a-z0-9_-]{1,60})?(?:-\d)?\.(jpg))|(?:v\d{1,5}(?:-\d)?\.(html|jpg))|(?:figma\/[0-9a-f]{12}\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}\.(?:png|jpe?g|svg|gif|webp)))$/u);
  if (!m) return null;
  const file = join(sketchDir(m[1]!, m[2]!), m[3]!);
  // Images brought back from Figma (figma.ts), which a rebuilt page uses by a relative path.
  return existsSync(file) ? { file, html: m[5] === "html", figma: m[3]!.startsWith("figma/") } : null;
}

/**
 * A small script Panel adds to every sketch page it serves (never to the file Claude wrote).
 * In the studio it lets the designer point at a part of the page, says which states the page
 * has, and switches between them. It talks only to the window around it, and does nothing
 * until that window asks; opened on its own, the page is just the page.
 */
const KIT = `<script data-panel-kit>(() => {
  if (window.parent === window) return;
  const post = (m) => parent.postMessage(Object.assign({ panel: 1 }, m), "*");
  const meta = () => { const m = document.querySelector('meta[name="panel:states"]'); return m ? m.content.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 16).map((part, i) => { const p = part.match(/^([A-Za-z0-9_-]{1,40})\\s*:\\s*(.+)$/); const name = (p ? p[2] : part).trim(); return { name, slug: p ? p[1].toLowerCase() : (name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "state-" + (i + 1)) }; }) : []; };
  const state = () => decodeURIComponent(location.hash.slice(1));
  const hello = () => post({ t: "hello", states: meta(), state: state(), title: document.title });
  addEventListener("hashchange", () => post({ t: "state", state: state() }));
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", hello); else hello();
  let picking = false, box = null, tag = null, hold = null, over = null;
  const ui = () => {
    if (box) return;
    box = document.createElement("div"); tag = document.createElement("div");
    box.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;border:1.5px solid #3b82f6;background:rgba(59,130,246,.08);border-radius:3px;transition:all .08s ease-out;display:none";
    tag.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;font:500 11px/1 -apple-system,system-ui,sans-serif;color:#fff;background:#3b82f6;padding:4px 6px;border-radius:4px;white-space:nowrap;display:none";
    document.documentElement.append(box, tag);
  };
  const name = (el) => {
    const t = (el.innerText || el.getAttribute("aria-label") || el.getAttribute("alt") || "").replace(/\\s+/g, " ").trim();
    const kind = { a: "link", button: "button", img: "image", input: "field", textarea: "field", select: "menu", h1: "heading", h2: "heading", h3: "heading", h4: "heading", p: "text", nav: "navigation", header: "header", footer: "footer", section: "section", ul: "list", li: "item", svg: "drawing", video: "video", form: "form", label: "label" }[el.tagName.toLowerCase()] || (el.className && typeof el.className === "string" ? el.className.split(/\\s+/)[0].replace(/[-_]/g, " ") : el.tagName.toLowerCase());
    return t && t.length < 60 ? kind + " “" + t + "”" : t ? kind + " “" + t.slice(0, 40) + "…”" : kind;
  };
  const path = (el) => {
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.documentElement && el !== document.body) {
      let p = el.tagName.toLowerCase();
      if (el.id) { parts.unshift(p + "#" + CSS.escape(el.id)); break; }
      const cls = [...el.classList].slice(0, 2).map((c) => "." + CSS.escape(c)).join("");
      const sib = el.parentElement ? [...el.parentElement.children].filter((c) => c.tagName === el.tagName) : [];
      if (sib.length > 1) p += ":nth-of-type(" + (sib.indexOf(el) + 1) + ")";
      parts.unshift(p + cls);
      el = el.parentElement;
    }
    return parts.join(" > ");
  };
  const place = (el) => {
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: "block", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    tag.textContent = name(el);
    Object.assign(tag.style, { display: "block", left: Math.max(4, r.left) + "px", top: (r.top > 26 ? r.top - 22 : r.bottom + 4) + "px" });
  };
  const target = (e) => { const el = e.target; return el && el !== document.documentElement && el !== document.body && el !== box ? el : null; };
  // Editing words in place: a heading, a button's label, a paragraph. Only parts made of words
  // (and inline tags like em or a) can be edited, so an edit never takes a layout apart.
  const INLINE = /^(A|ABBR|B|BR|CITE|CODE|DEL|EM|I|INS|KBD|MARK|Q|S|SAMP|SMALL|SPAN|STRONG|SUB|SUP|TIME|U|WBR)$/;
  const canEdit = (el) => !/^(INPUT|TEXTAREA|SELECT|IMG|SVG|VIDEO|CANVAS|IFRAME|SCRIPT|STYLE)$/i.test(el.tagName) && (el.textContent || "").trim().length > 0 && (el.textContent || "").length < 4000 && [...el.querySelectorAll("*")].every((c) => INLINE.test(c.tagName));
  // Where it sits, counted the way the file is read back on the server: body > main:nth-child(2) > h1:nth-child(1).
  const strict = (el) => { const parts = []; while (el && el.parentElement && el !== document.body) { parts.unshift(el.tagName.toLowerCase() + ":nth-child(" + ([...el.parentElement.children].indexOf(el) + 1) + ")"); el = el.parentElement; } return el === document.body ? ["body", ...parts].join(" > ") : ""; };
  let editing = null, orig = "", origText = "", origStyle = null;
  const startEdit = (el) => {
    if (editing || !el || !canEdit(el)) return;
    editing = el; orig = el.innerHTML; origText = el.textContent; origStyle = el.getAttribute("style");
    if (box) { box.style.display = "none"; tag.style.display = "none"; }
    el.contentEditable = "plaintext-only";
    el.style.outline = "1.5px solid #3b82f6"; el.style.outlineOffset = "3px"; el.style.cursor = "text";
    el.focus();
    const r = document.createRange(); r.selectNodeContents(el); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    post({ t: "editing", on: true });
  };
  const endEdit = (keep) => {
    const el = editing; if (!el) return;
    editing = null;
    if (!keep) el.innerHTML = orig;
    el.removeAttribute("contenteditable");
    if (origStyle == null) el.removeAttribute("style"); else el.setAttribute("style", origStyle);
    getSelection().removeAllRanges();
    if (keep && el.innerHTML !== orig) post({ t: "edited", path: strict(el), before: orig, after: el.innerHTML, beforeText: origText, afterText: el.textContent });
    else post({ t: "editing", on: false });
    if (hold === el && picking) place(el);
  };
  const move = (e) => { if (!picking || hold || editing) return; const el = target(e); if (el && el !== over) { over = el; place(el); } };
  const click = (e) => {
    if (!picking) return;
    if (editing && editing.contains(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    // A click outside the words being edited keeps them, like leaving a text box.
    if (editing) return endEdit(true);
    const el = target(e); if (!el) return;
    hold = el; place(el);
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const html = el.outerHTML;
    post({ t: "picked", label: name(el), selector: path(el), text: (el.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 300),
      html: html.length > 1600 ? html.slice(0, 1600) + "…" : html,
      style: { font: cs.fontFamily.split(",")[0].replace(/["']/g, "") + " " + cs.fontWeight + " " + cs.fontSize, color: cs.color, background: cs.backgroundColor, radius: cs.borderRadius, padding: cs.padding, size: Math.round(r.width) + "×" + Math.round(r.height) },
      rect: { x: r.left, y: r.top, w: r.width, h: r.height }, viewport: { w: innerWidth, h: innerHeight }, state: state(), editable: canEdit(el) });
  };
  const stopEvent = (e) => { if (picking && !(editing && editing.contains(e.target))) { e.preventDefault(); e.stopPropagation(); } };
  addEventListener("mousemove", move, true);
  addEventListener("click", click, true);
  ["mousedown", "mouseup", "pointerdown", "pointerup", "submit"].forEach((t) => addEventListener(t, stopEvent, true));
  // Double-click words while pointing: edit them right there.
  addEventListener("dblclick", (e) => {
    if (!picking || (editing && editing.contains(e.target))) return;
    e.preventDefault(); e.stopPropagation();
    const el = target(e);
    if (editing || !el || !canEdit(el)) return;
    hold = el; startEdit(el);
  }, true);
  addEventListener("keydown", (e) => {
    if (editing) {
      // The page's own shortcuts stay out of the way while typing.
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); endEdit(false); }
      else if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); endEdit(true); }
      return;
    }
    if (picking && e.key === "Escape") post({ t: "cancel" });
  }, true);
  // Escape on the page (after a click on it, the keys go here, not to the studio) steps back
  // in the studio too, unless the page used it itself, to close its own menu say.
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !picking && !e.defaultPrevented) post({ t: "cancel" }); });
  addEventListener("scroll", () => { if (editing) return; if (hold) place(hold); else if (over && picking) place(over); }, true);
  addEventListener("message", (e) => {
    if (e.source !== parent || !e.data || !e.data.panel) return;
    const m = e.data;
    if ((m.t === "pick" || m.t === "release") && editing) endEdit(false);
    if (m.t === "edit") startEdit(hold);
    if (m.t === "edit-end") endEdit(!!m.keep);
    if (m.t === "pick") { picking = !!m.on; hold = null; over = null; ui(); if (!picking) { box.style.display = "none"; tag.style.display = "none"; } document.documentElement.style.cursor = picking ? "crosshair" : ""; }
    if (m.t === "release") { hold = null; over = null; if (box) { box.style.display = "none"; tag.style.display = "none"; } }
    if (m.t === "state") { const h = m.slug ? "#" + m.slug : ""; if (location.hash !== h) { if (h) location.hash = h; else { history.replaceState(null, "", location.pathname + location.search); dispatchEvent(new HashChangeEvent("hashchange")); } } }
    if (m.t === "hello") hello();
    if (m.t === "vars") document.fonts.ready.then(() => { const v = vars(); post({ t: "vars", vars: v, fonts: found(v) }); });
    if (m.t === "show") show(m.name);
    if (m.t === "set") { const root = document.documentElement.style; for (const k in m.vars) { if (!/^--[A-Za-z0-9_-]+$/.test(k)) continue; if (m.vars[k] == null) root.removeProperty(k); else root.setProperty(k, String(m.vars[k])); } }
    if (m.t === "scroll") { quiet = true; scrollTo(0, m.y); requestAnimationFrame(() => requestAnimationFrame(() => { quiet = false; })); }
    if (m.t === "follow") following = !!m.on;
  });
  // The page's knobs: the CSS variables it declares on :root (its colors, fonts, sizes, radius, spacing).
  // With each, what the studio needs to make it a knob a designer understands: the note written
  // beside it (--c1: #e2372b; /* Cortex */), the lines it was grouped with in the page's own
  // :root (a blank line or a comment line starts a new group), and where the page uses it
  // (font-size, a "wght" axis, padding, the page's own script), so a weight gets a weight's
  // range and lands under Type whatever it's called.
  let usage = { rules: {}, via: {} };
  const vars = () => {
    const out = [], seen = new Set();
    const walk = (rules) => { for (const r of rules) { if (r.cssRules && !r.selectorText) { walk(r.cssRules); continue; } if (r.style && /^(:root|html)$/.test((r.selectorText || "").trim())) for (const n of r.style) if (n.startsWith("--") && !seen.has(n)) { seen.add(n); out.push({ name: n, value: r.style.getPropertyValue(n).trim() }); } } };
    for (const sh of document.styleSheets) { try { walk(sh.cssRules); } catch (e) {} }
    const list = out.slice(0, 80), about = notes(), used = uses();
    for (const v of list) { const a = about[v.name]; if (a) { if (a.note) v.note = a.note; v.group = a.group; if (a.heading) v.heading = a.heading; } v.uses = used(v.name); }
    return list;
  };
  const notes = () => {
    const out = {};
    let group = 0;
    for (const s of document.querySelectorAll("style:not([data-panel-fonts])")) {
      for (const m of (s.textContent || "").matchAll(/(?:^|[\\s},;])(?::root|html)\\s*\\{([^}]*)\\}/g)) {
        let heading = "";
        group++;
        for (const line of m[1].split("\\n")) {
          const t = line.trim();
          if (!t) { group++; heading = ""; continue; }
          const only = t.match(/^\\/\\*\\s*([\\s\\S]*?)\\s*\\*\\/$/);
          if (only) { group++; heading = only[1].slice(0, 60); continue; }
          for (const d of t.matchAll(/(--[A-Za-z0-9_-]+)\\s*:[^;]*;?\\s*(?:\\/\\*\\s*([\\s\\S]*?)\\s*\\*\\/)?/g)) out[d[1]] = { group, heading, note: (d[2] || "").slice(0, 80) };
        }
      }
    }
    return out;
  };
  // Every declaration that reads a variable, from the stylesheets and from style="" attributes.
  // Read from cssText, because a shorthand holding var() (padding: var(--pad) 0) has no
  // longhands to read until it's computed.
  const uses = () => {
    const props = {}, rules = {}, via = {};
    const add = (o, k, v) => { (o[k] = o[k] || new Set()).add(v); };
    const read = (css, where) => {
      for (const d of css.matchAll(/([-A-Za-z0-9_]+)\\s*:\\s*([^;]*)/g)) {
        const p = d[1].toLowerCase(), v = d[2];
        if (!v.includes("var(")) continue;
        for (const m of v.matchAll(/var\\(\\s*(--[A-Za-z0-9_-]+)/g)) {
          const n = m[1];
          if (p.startsWith("--")) add(via, n, p);
          else { const axis = p === "font-variation-settings" ? (v.slice(0, m.index).match(/["'](\\w{4})["']\\s*$/) || [])[1] : ""; add(props, n, axis ? p + ":" + axis : p); }
          if (where) add(rules, n, where);
        }
      }
    };
    const walk = (list) => { for (const r of list) { if (r.style) read(r.style.cssText, r.selectorText || ""); if (r.cssRules) walk(r.cssRules); } };
    for (const sh of document.styleSheets) { try { walk(sh.cssRules); } catch (e) {} }
    for (const el of document.querySelectorAll('[style*="var(--"]')) read(el.getAttribute("style") || "", "");
    const script = [...document.scripts].filter((s) => !s.hasAttribute("data-panel-kit")).map((s) => s.textContent).join("\\n");
    usage = { rules, via };
    // A variable's uses, through up to two variables in between (--w-text sets --wght, which sets the "wght" axis).
    return (n) => {
      const all = new Set(), seen = new Set([n]);
      let ring = [n];
      for (let i = 0; i < 3 && ring.length; i++) {
        const next = [];
        for (const x of ring) { for (const p of props[x] || []) all.add(p); for (const y of via[x] || []) if (!seen.has(y)) { seen.add(y); next.push(y); } }
        ring = next;
      }
      if (new RegExp("[\\"']" + n + "[\\"']").test(script)) all.add("script");
      return [...all].slice(0, 12);
    };
  };
  // Hovering a knob in the studio outlines what it changes on the page.
  let marks = null;
  const show = (n) => {
    if (!marks) { marks = document.createElement("div"); marks.style.cssText = "position:fixed;inset:0;z-index:2147483646;pointer-events:none"; document.documentElement.append(marks); }
    marks.replaceChildren();
    if (!n || !/^--[A-Za-z0-9_-]+$/.test(n)) return;
    const els = new Set();
    const take = (list) => { if (list.length > 60) return; for (const el of list) if (el !== document.documentElement && el !== document.body && !marks.contains(el)) els.add(el); };
    for (const sel of usage.rules[n] || []) { if (/^\\s*(\\*|:root|html|body)\\s*$/.test(sel)) continue; try { take([...document.querySelectorAll(sel)]); } catch (e) {} }
    take([...document.querySelectorAll('[style*="' + n + ')"]')]);
    let count = 0;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight) continue;
      const b = document.createElement("div");
      b.style.cssText = "position:fixed;border:1.5px solid #3b82f6;border-radius:3px;left:" + (r.left - 2) + "px;top:" + (r.top - 2) + "px;width:" + (r.width + 4) + "px;height:" + (r.height + 4) + "px";
      marks.append(b);
      if (++count >= 40) break;
    }
  };
  // For each font a knob names, whether the page really has it: a web font it loads, one of the
  // designer's fonts, or one installed on this computer. A missing one is drawn in a stand-in,
  // so the studio says so. Installed fonts are found by drawing a line in the font with two
  // different stand-ins behind it: if neither width changes, the font never showed up.
  const found = (list) => {
    const out = {}, unq = (s) => s.trim().replace(/^["']|["']$/g, "");
    const generic = /^(serif|sans-serif|monospace|system-ui|ui-sans-serif|ui-serif|ui-monospace|cursive|fantasy)$/;
    const ink = document.createElement("canvas").getContext("2d");
    const width = (font) => { ink.font = "40px " + font; return ink.measureText("mmmmmmmmmmlli1WQ@#").width; };
    for (const v of list) {
      if (!/font|typeface|family/i.test(v.name) || /size|weight|leading|tracking|spacing|height/i.test(v.name)) continue;
      const f = unq(v.value.split(",")[0] || "");
      if (!f || f in out || generic.test(f) || /var\\(/.test(f)) continue;
      let ok = false;
      for (const face of document.fonts) if (unq(face.family) === f && face.status !== "error") ok = true;
      if (!ok && ink) ok = ["monospace", "serif"].some((s) => width('"' + f + '", ' + s) !== width(s));
      out[f] = ok;
    }
    return out;
  };
  // Side by side with other sketches, the studio keeps them scrolled together.
  let following = false, quiet = false, said = 0;
  addEventListener("scroll", () => { if (!following || quiet) return; cancelAnimationFrame(said); said = requestAnimationFrame(() => post({ t: "scrolled", y: scrollY })); }, { passive: true });
})();</script>`;

/** A sketch's page as Panel serves it: as Claude wrote it, with the studio's kit at the end. */
export function servedSketch(file: string) {
  let html = readFileSync(file, "utf8");
  // The designer's own fonts (fonts.ts), so font-family: "Their Font" just works. At the end of
  // the head, so their file wins over a web font of the same name the page loads itself.
  const faces = fontFaceCss();
  if (faces) {
    const style = `<style data-panel-fonts>\n${faces}\n</style>`;
    const head = html.search(/<\/head>/i);
    html = head >= 0 ? html.slice(0, head) + style + html.slice(head) : style + html;
  }
  const at = html.search(/<\/body>/i);
  return at >= 0 ? html.slice(0, at) + KIT + html.slice(at) : html + KIT;
}

export interface Render {
  /** The pictures, top of the page first, as files on disk. */
  screens: string[];
  /** The page's whole height, in CSS pixels. */
  height: number;
  /** What went wrong in the page: script errors, failed fonts and images. */
  errors: string[];
  /** Where the page breaks or brushes against the designer's rules, as measured in Chrome (rulecheck.ts). */
  rules?: RuleFinding[];
  /** Where it falls short of the designer's skills that are on, as measured (skillcheck.ts). Absent with none on. */
  skills?: SkillFinding[];
  /** "When it applies" skills whose subject is in the page (it moves, it has a form…). */
  apply?: { name: string; line: string }[];
  /** Which skills' checks it was measured against: another key means it's out of date. */
  skillKey?: string;
  /** Set when there's no picture at all (no Chrome, Panel not running). */
  failed?: string;
}

/**
 * Save a new version of a sketch and render it. The number is one past the newest on disk.
 * Every way of saving comes through here, so this is where ready-made parts named by a tag
 * (<panel-icon>, <panel-loading>) get their real drawings (parts.ts); a wrong name saves nothing.
 */
export async function writeVersion(projectId: string, sketchId: string, given: string, device: Device = "desktop") {
  if (!given.trim()) throw new Error("The sketch is empty.");
  const html = fillParts(given);
  if (html.length > MAX_HTML) throw new Error("That page is too big for a sketch (1.5 MB at most).");
  const dir = sketchDir(projectId, sketchId);
  mkdirSync(dir, { recursive: true });
  const version = (versionsOf(projectId, sketchId).at(-1) ?? 0) + 1;
  writeFileSync(join(dir, `v${version}.html`), html);
  const render = await renderSketch(projectId, sketchId, version, device);
  writeFileSync(join(dir, `v${version}.json`), JSON.stringify({ height: render.height, errors: render.errors, rules: render.rules, ...skillsKept(render), screens: render.screens.length, failed: render.failed }));
  return { version, render };
}

/** What the last render of a version saw, from disk. */
export function renderOf(projectId: string, sketchId: string, v: number): Render {
  const dir = sketchDir(projectId, sketchId);
  let meta: { height?: number; errors?: string[]; rules?: RuleFinding[]; skills?: SkillFinding[]; apply?: Render["apply"]; skill_key?: string; screens?: number; failed?: string } = {};
  try {
    meta = JSON.parse(readFileSync(join(dir, `v${v}.json`), "utf8"));
  } catch {
    /* rendered before it was written down, or never */
  }
  const screens = Array.from({ length: MAX_SCREENS }, (_, i) => join(dir, `v${v}${i ? `-${i + 1}` : ""}.jpg`)).filter((f) => existsSync(f));
  return { screens, height: meta.height ?? 0, errors: meta.errors ?? [], rules: meta.rules, ...skillsRead(meta), failed: meta.failed };
}

/** A render's skill checks as kept on disk beside it: nothing at all when no skill was measured. */
function skillsKept(r: Render) {
  return r.skillKey ? { skills: r.skills, apply: r.apply, skill_key: r.skillKey } : {};
}
function skillsRead(m: { skills?: SkillFinding[]; apply?: Render["apply"]; skill_key?: string }): Partial<Render> {
  return m.skill_key ? { skills: m.skills ?? [], apply: m.apply ?? [], skillKey: m.skill_key } : {};
}

/** Skill checks measured again for a render kept from before (a page and a key each), so reading it twice costs one measure. */
const remeasured = new Map<string, Pick<Render, "skills" | "apply" | "skillKey">>();

/**
 * A render with its skill checks as the skills that are on would measure them now. A kept
 * render measured against other skills (or none) is measured again, without new pictures;
 * with no skill asking for anything, it carries none, exactly as before skills existed.
 */
export async function withSkillChecks(render: Render, url: string, device: Device): Promise<Render> {
  const key = skillKeyNow();
  const { skills: _s, apply: _a, skillKey: _k, ...plain } = render;
  if (!key) return plain;
  if (render.skillKey === key || render.failed) return render;
  const at = `${url}|${device}|${key}`;
  let fresh = remeasured.get(at);
  if (!fresh) {
    const r = await queue(() => shoot(url, device, null));
    if (r.failed || r.skillKey !== key) return plain;
    fresh = { skills: r.skills, apply: r.apply, skillKey: r.skillKey };
    if (remeasured.size > 200) remeasured.clear();
    remeasured.set(at, fresh);
  }
  return { ...plain, ...fresh };
}

// ---------- Rendering, in a Chrome kept warm between sketches ----------

// Iterating on a sketch means rendering it again and again, so one headless Chrome stays
// up while that's happening and closes itself after two quiet minutes.
let chrome: { proc: ReturnType<typeof Bun.spawn>; cdp: Cdp; profile: string; idle?: ReturnType<typeof setTimeout> } | null = null;
let line: Promise<unknown> = Promise.resolve();

async function browser() {
  if (chrome && chrome.proc.exitCode === null) {
    clearTimeout(chrome.idle);
    return chrome;
  }
  dropChrome();
  const exe = chromePath();
  if (!exe) throw new Error("Seeing a sketch needs Google Chrome (or Chromium, Brave, Edge) in Applications.");
  const profile = mkdtempSync(join(tmpdir(), "panel-sketch-"));
  const proc = Bun.spawn(
    [
      exe, "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
      "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--hide-scrollbars",
      "--mute-audio", "--disable-background-networking", "--disable-sync", "--force-color-profile=srgb",
      "about:blank",
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const cdp = new Cdp();
  try {
    await cdp.connect(await devtoolsUrl(proc.stderr as ReadableStream<Uint8Array>));
  } catch (e) {
    proc.kill();
    rmSync(profile, { recursive: true, force: true });
    throw e;
  }
  chrome = { proc, cdp, profile };
  return chrome;
}

function dropChrome() {
  const c = chrome;
  chrome = null;
  if (!c) return;
  clearTimeout(c.idle);
  c.cdp.close();
  c.proc.kill();
  rmSync(c.profile, { recursive: true, force: true });
}

function closeSoon() {
  const c = chrome;
  if (!c) return;
  clearTimeout(c.idle);
  c.idle = setTimeout(() => chrome === c && dropChrome(), 120_000);
}
process.on("exit", () => chrome?.proc.kill());

/** Render one version: its screens as pictures, and what went wrong in the page. Never throws. */
export function renderSketch(projectId: string, sketchId: string, v: number, device: Device = "desktop"): Promise<Render> {
  const dir = sketchDir(projectId, sketchId);
  return queue(() => shoot(fullUrl(sketchPath(projectId, sketchId, v)), device, (i) => join(dir, `v${v}${i ? `-${i + 1}` : ""}.jpg`)));
}

/** A state's id from its name, when the page gives none: Latin letters and digits only, as it goes in the address. */
export const stateSlug = (name: string, i = 0) =>
  name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `state-${i + 1}`;

/**
 * The states a sketch says it has (empty, loading, error…, or the screens of a flow), from
 * <meta name="panel:states" content="login: Вход, code: Код, error: Ошибка"> — an id, then
 * the name shown. The page shows each one when its address ends in #id; the first is what
 * shows with no #. An id can be left out ("Home, Detail") when the name is in Latin letters.
 */
export function statesOf(html: string): { name: string; slug: string }[] {
  const m = html.match(/<meta\s+name=["']panel:states["']\s+content=["']([^"']*)["']/i) ?? html.match(/<meta\s+content=["']([^"']*)["']\s+name=["']panel:states["']/i);
  if (!m) return [];
  const seen = new Set<string>();
  return m[1]!.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 16).flatMap((part, i) => {
    const pair = part.match(/^([A-Za-z0-9_-]{1,40})\s*:\s*(.+)$/);
    const name = (pair ? pair[2]! : part).trim();
    const slug = pair ? pair[1]!.toLowerCase() : stateSlug(name, i);
    if (seen.has(slug)) return [];
    seen.add(slug);
    return [{ name, slug }];
  });
}

/**
 * One version as it looks on another screen or in another state, rendered on asking and kept
 * (views/v3-phone-loading.jpg). The page and its states never change, so neither does this.
 */
export async function renderView(projectId: string, sketchId: string, v: number, device: Device, slug = ""): Promise<Render> {
  if (slug && !/^[a-z0-9_-]{1,40}$/.test(slug)) throw new Error("Not a state.");
  const dir = join(sketchDir(projectId, sketchId), "views");
  mkdirSync(dir, { recursive: true });
  const base = `v${v}-${device}${slug ? `-${slug}` : ""}`;
  const meta = join(dir, `${base}.json`);
  if (existsSync(meta)) {
    try {
      const m = JSON.parse(readFileSync(meta, "utf8"));
      const screens = Array.from({ length: m.screens ?? 0 }, (_, i) => join(dir, `${base}${i ? `-${i + 1}` : ""}.jpg`)).filter((f) => existsSync(f));
      if (screens.length) return { screens, height: m.height ?? 0, errors: m.errors ?? [], rules: m.rules, ...skillsRead(m) };
    } catch {
      /* render it again */
    }
  }
  const url = fullUrl(sketchPath(projectId, sketchId, v)) + (slug ? `#${slug}` : "");
  const r = await queue(() => shoot(url, device, (i) => join(dir, `${base}${i ? `-${i + 1}` : ""}.jpg`)));
  if (!r.failed) writeFileSync(meta, JSON.stringify({ height: r.height, errors: r.errors, rules: r.rules, ...skillsKept(r), screens: r.screens.length }));
  return r;
}

/** Any page on this Mac (a build's preview), as pictures. Never throws. */
export function renderUrl(url: string, device: Device, file: (i: number) => string, maxScreens = MAX_SCREENS): Promise<Render> {
  return queue(() => shoot(url, device, file, maxScreens));
}

/** One render at a time, retried once with a fresh Chrome. Never throws. */
function queue(run: () => Promise<Render>): Promise<Render> {
  const job = line
    .then(() =>
      run().catch((e: Error) => {
        // Panel not running isn't fixed by another try; a Chrome that went away is.
        if (/isn't running|isn't answering/.test(e.message)) throw e;
        dropChrome();
        return run();
      }),
    )
    .catch((e: Error) => ({ screens: [], height: 0, errors: [], failed: e.message }) as Render);
  line = job.catch(() => {});
  return job;
}

// ---------- Copying a sketch into Figma ----------

/**
 * Figma's own script for turning a web page into Figma layers (the one its MCP server hands
 * out for "send this page to Figma"). Run without a Figma file to send to, it puts the page on
 * the clipboard instead, in the form Figma pastes as editable frames, text and images.
 */
export const FIGMA_CAPTURE_SCRIPT = "https://mcp.figma.com/mcp/html-to-design/capture.js";

/**
 * Turns one version (on one screen, in one state) into what Figma pastes as layers. Panel's
 * own Chrome opens the page, loads Figma's script into it and lets it read the page; the
 * script would put the result on the clipboard, so the clipboard is swapped for a box that
 * keeps it. The studio then puts it on the designer's real clipboard, for ⌘V in Figma.
 * The frame is named after the sketch, its version and its id, so the way back finds it.
 */
export function captureForFigma(projectId: string, sketchId: string, v: number, device: Device, slug = "", name = ""): Promise<string> {
  if (slug && !/^[a-z0-9_-]{1,40}$/.test(slug)) throw new Error("Not a state.");
  if (!versionsOf(projectId, sketchId).includes(v)) throw new Error(`That sketch has no version ${v}.`);
  const url = fullUrl(sketchPath(projectId, sketchId, v)) + (slug ? `#${slug}` : "");
  let out = "";
  return queue(async () => {
    out = await capture(url, device, name);
    return { screens: [], height: 0, errors: [] };
  }).then((r) => {
    if (r.failed || !out) throw new Error(r.failed ?? "Figma's copy didn't work.");
    return out;
  });
}

async function capture(url: string, device: Device, name: string): Promise<string> {
  const screen = DEVICES[device];
  const { cdp } = await browser();
  const { targetId } = await cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
  const s = <T = unknown>(method: string, params: object = {}) => cdp.send<T>(method, params, sessionId);
  try {
    await s("Page.enable");
    await s("Runtime.enable");
    await s("Network.enable");
    // Not as a phone (mobile: false): a page with no viewport tag would be laid out 980 wide, and
    // the frame in Figma should be the screen's own width.
    await s("Emulation.setDeviceMetricsOverride", { width: screen.width, height: screen.height, deviceScaleFactor: 1, mobile: false });
    // Figma's script waits for the page to have focus before it copies; a hidden page never gets it.
    await s("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    const net = trackNetwork(cdp, sessionId);
    try {
      const loaded = cdp.waitFor("Page.loadEventFired", sessionId, 20_000);
      const nav = await s<{ errorText?: string }>("Page.navigate", { url });
      if (nav.errorText) throw new Error(/CONNECTION_REFUSED/.test(nav.errorText) ? "Panel isn't running, so the sketch can't be copied." : nav.errorText);
      await loaded;
      await net.idle(0, 400, 8000);
      await evaluate(s, READY_SCRIPT, 15_000).catch(() => {});
      await evaluate(s, "document.fonts.ready.then(() => true)", 5000).catch(() => {});
    } finally {
      net.stop();
    }
    const script = `(async () => {
      if (${JSON.stringify(name)}) document.title = ${JSON.stringify(name)};
      if (!(window.figma && window.figma.captureForDesign)) await new Promise((ok, no) => {
        const s = document.createElement("script");
        s.src = ${JSON.stringify(FIGMA_CAPTURE_SCRIPT)};
        s.onload = ok; s.onerror = () => no(new Error("load"));
        document.head.append(s);
      });
      let out = null, failed = null;
      const keep = async (items) => { out = await (await items[0].getType("text/html")).text(); };
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write: keep, writeText: async (t) => { out = t; } } });
      window.figma.captureForDesign({ selector: "body" }).then((r) => { if (r && r.success === false) failed = r.error || "failed"; }, (e) => { failed = String(e); });
      for (let i = 0; i < 600 && out == null && !failed; i++) await new Promise((r) => setTimeout(r, 100));
      return { out, failed };
    })()`;
    const r = await evaluate<{ out: string | null; failed: string | null }>(s, script, 70_000).catch((e: Error) => ({ out: null, failed: e.message }));
    if (!r?.out) throw new Error(r?.failed === "load" ? "Couldn't load Figma's copying script. Check the internet connection." : `Figma's copy didn't work${r?.failed ? `: ${r.failed}` : "."}`);
    return r.out;
  } finally {
    await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
    closeSoon();
  }
}

export type Device = "desktop" | "tablet" | "phone";
/** The screens a sketch is looked at on. A phone at 2×, so small type can be read. */
export const DEVICES: Record<Device, { width: number; height: number; scale: number; mobile: boolean }> = {
  desktop: { ...SCREEN, scale: 1, mobile: false },
  tablet: { width: 834, height: 1112, scale: 1, mobile: true },
  phone: { width: 390, height: 844, scale: 2, mobile: true },
};

/** `fileOf` null: only measure the page (its rule and skill checks), with no pictures. */
async function shoot(url: string, device: Device, fileOf: ((i: number) => string) | null, maxScreens = MAX_SCREENS): Promise<Render> {
  const screen = DEVICES[device];
  const { cdp } = await browser();
  const { targetId } = await cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
  const s = <T = unknown>(method: string, params: object = {}) => cdp.send<T>(method, params, sessionId);

  const errors: string[] = [];
  const say = (t: string) => {
    const x = t.replace(/\s+/g, " ").trim().slice(0, 300);
    if (x && !errors.includes(x) && errors.length < 12) errors.push(x);
  };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const offs = [
    cdp.on("Runtime.exceptionThrown", sessionId, (p: any) =>
      say(String(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? "A script failed").split("\n")[0]!)),
    cdp.on("Runtime.consoleAPICalled", sessionId, (p: any) => {
      if (p.type === "error") say(`console.error: ${(p.args ?? []).map((a: any) => a.value ?? a.description ?? "").join(" ")}`);
    }),
    cdp.on("Log.entryAdded", sessionId, (p: any) => {
      if (p.entry?.level === "error") say(`${p.entry.text}${p.entry.url ? ` (${p.entry.url})` : ""}`);
    }),
  ];
  /* eslint-enable @typescript-eslint/no-explicit-any */
  try {
    await s("Page.enable");
    await s("Runtime.enable");
    await s("Log.enable");
    await s("Network.enable");
    await s("Emulation.setDeviceMetricsOverride", { width: screen.width, height: screen.height, deviceScaleFactor: screen.scale, mobile: screen.mobile });
    if (screen.mobile) await s("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }).catch(() => {});
    const net = trackNetwork(cdp, sessionId);
    try {
      const loaded = cdp.waitFor("Page.loadEventFired", sessionId, 20_000);
      const nav = await s<{ errorText?: string }>("Page.navigate", { url });
      if (nav.errorText) {
        const own = url.startsWith(`http://${HOST}:${PORT}/`);
        throw new Error(/CONNECTION_REFUSED/.test(nav.errorText) ? (own ? "Panel isn't running, so the sketch can't be shown." : "The page isn't answering.") : nav.errorText);
      }
      await loaded;
      // Fonts and libraries from CDNs, then intro animations, the way a person would wait.
      await net.idle(0, 400, 8000);
      await evaluate(s, READY_SCRIPT, 15_000).catch(() => {});
      await evaluate(s, "document.fonts.ready.then(() => true)", 5000).catch(() => {});
    } finally {
      net.stop();
    }
    // The designer's rules, where they can be measured: corners, the wordmark, fonts' letters…
    // and Panel's ready-made parts: styled by a class, filled in, in one weight (rulecheck.ts).
    const rules = await checkRules(s);
    // The designer's skills that are on: line length, contrast, motion turned down… (skillcheck.ts)
    const skills = await checkSkills(s, device === "phone");
    const kept = skills ? { skills: skills.found, apply: skills.apply, skillKey: skills.key } : {};
    const height = await evaluate<number>(s, "Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)", 3000).catch(() => screen.height);
    if (!fileOf) return { screens: [], height: Math.round(height), errors, rules, ...kept };
    const count = Math.min(maxScreens, Math.max(1, Math.ceil((height - 40) / screen.height)));
    const screens: string[] = [];
    for (let i = 0; i < count; i++) {
      // Scrolled, not one tall picture: sticky headers and scroll-triggered animations show as they would.
      if (i) await evaluate(s, `scrollTo(0, ${i * screen.height}); new Promise((r) => setTimeout(r, 450))`, 3000).catch(() => {});
      const shot = await s<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 88, fromSurface: true });
      const file = fileOf(i);
      writeFileSync(file, Buffer.from(shot.data, "base64"));
      screens.push(file);
    }
    return { screens, height: Math.round(height), errors, rules, ...kept };
  } finally {
    offs.forEach((off) => off());
    await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
    closeSoon();
  }
}
