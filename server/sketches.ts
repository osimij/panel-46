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
export function sketchFile(raw: string): { file: string; html: boolean } | null {
  let path = raw;
  try {
    path = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (path.includes("..")) return null;
  const m = path.match(/^\/sketches\/([0-9a-f]{16})\/([0-9a-f]{16})\/((?:views\/v\d{1,5}-(?:desktop|tablet|phone)(?:-[a-z0-9_-]{1,60})?(?:-\d)?\.(jpg))|(?:v\d{1,5}(?:-\d)?\.(html|jpg)))$/u);
  if (!m) return null;
  const file = join(sketchDir(m[1]!, m[2]!), m[3]!);
  return existsSync(file) ? { file, html: m[5] === "html" } : null;
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
  const move = (e) => { if (!picking || hold) return; const el = target(e); if (el && el !== over) { over = el; place(el); } };
  const click = (e) => {
    if (!picking) return;
    e.preventDefault(); e.stopPropagation();
    const el = target(e); if (!el) return;
    hold = el; place(el);
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const html = el.outerHTML;
    post({ t: "picked", label: name(el), selector: path(el), text: (el.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 300),
      html: html.length > 1600 ? html.slice(0, 1600) + "…" : html,
      style: { font: cs.fontFamily.split(",")[0].replace(/["']/g, "") + " " + cs.fontWeight + " " + cs.fontSize, color: cs.color, background: cs.backgroundColor, radius: cs.borderRadius, padding: cs.padding, size: Math.round(r.width) + "×" + Math.round(r.height) },
      rect: { x: r.left, y: r.top, w: r.width, h: r.height }, viewport: { w: innerWidth, h: innerHeight }, state: state() });
  };
  const stopEvent = (e) => { if (picking) { e.preventDefault(); e.stopPropagation(); } };
  addEventListener("mousemove", move, true);
  addEventListener("click", click, true);
  ["mousedown", "mouseup", "pointerdown", "pointerup", "submit", "dblclick"].forEach((t) => addEventListener(t, stopEvent, true));
  addEventListener("keydown", (e) => { if (picking && e.key === "Escape") post({ t: "cancel" }); }, true);
  addEventListener("scroll", () => { if (hold) place(hold); else if (over && picking) place(over); }, true);
  addEventListener("message", (e) => {
    if (e.source !== parent || !e.data || !e.data.panel) return;
    const m = e.data;
    if (m.t === "pick") { picking = !!m.on; hold = null; over = null; ui(); if (!picking) { box.style.display = "none"; tag.style.display = "none"; } document.documentElement.style.cursor = picking ? "crosshair" : ""; }
    if (m.t === "release") { hold = null; over = null; if (box) { box.style.display = "none"; tag.style.display = "none"; } }
    if (m.t === "state") { const h = m.slug ? "#" + m.slug : ""; if (location.hash !== h) { if (h) location.hash = h; else { history.replaceState(null, "", location.pathname + location.search); dispatchEvent(new HashChangeEvent("hashchange")); } } }
    if (m.t === "hello") hello();
  });
})();</script>`;

/** A sketch's page as Panel serves it: as Claude wrote it, with the studio's kit at the end. */
export function servedSketch(file: string) {
  const html = readFileSync(file, "utf8");
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
  /** Set when there's no picture at all (no Chrome, Panel not running). */
  failed?: string;
}

/** Save a new version of a sketch and render it. The number is one past the newest on disk. */
export async function writeVersion(projectId: string, sketchId: string, html: string, device: Device = "desktop") {
  if (!html.trim()) throw new Error("The sketch is empty.");
  if (html.length > MAX_HTML) throw new Error("That page is too big for a sketch (1.5 MB at most).");
  const dir = sketchDir(projectId, sketchId);
  mkdirSync(dir, { recursive: true });
  const version = (versionsOf(projectId, sketchId).at(-1) ?? 0) + 1;
  writeFileSync(join(dir, `v${version}.html`), html);
  const render = await renderSketch(projectId, sketchId, version, device);
  writeFileSync(join(dir, `v${version}.json`), JSON.stringify({ height: render.height, errors: render.errors, rules: render.rules, screens: render.screens.length, failed: render.failed }));
  return { version, render };
}

/** What the last render of a version saw, from disk. */
export function renderOf(projectId: string, sketchId: string, v: number): Render {
  const dir = sketchDir(projectId, sketchId);
  let meta: { height?: number; errors?: string[]; rules?: RuleFinding[]; screens?: number; failed?: string } = {};
  try {
    meta = JSON.parse(readFileSync(join(dir, `v${v}.json`), "utf8"));
  } catch {
    /* rendered before it was written down, or never */
  }
  const screens = Array.from({ length: MAX_SCREENS }, (_, i) => join(dir, `v${v}${i ? `-${i + 1}` : ""}.jpg`)).filter((f) => existsSync(f));
  return { screens, height: meta.height ?? 0, errors: meta.errors ?? [], rules: meta.rules, failed: meta.failed };
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
      if (screens.length) return { screens, height: m.height ?? 0, errors: m.errors ?? [], rules: m.rules };
    } catch {
      /* render it again */
    }
  }
  const url = fullUrl(sketchPath(projectId, sketchId, v)) + (slug ? `#${slug}` : "");
  const r = await queue(() => shoot(url, device, (i) => join(dir, `${base}${i ? `-${i + 1}` : ""}.jpg`)));
  if (!r.failed) writeFileSync(meta, JSON.stringify({ height: r.height, errors: r.errors, rules: r.rules, screens: r.screens.length }));
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

export type Device = "desktop" | "tablet" | "phone";
/** The screens a sketch is looked at on. A phone at 2×, so small type can be read. */
export const DEVICES: Record<Device, { width: number; height: number; scale: number; mobile: boolean }> = {
  desktop: { ...SCREEN, scale: 1, mobile: false },
  tablet: { width: 834, height: 1112, scale: 1, mobile: true },
  phone: { width: 390, height: 844, scale: 2, mobile: true },
};

async function shoot(url: string, device: Device, fileOf: (i: number) => string, maxScreens = MAX_SCREENS): Promise<Render> {
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
    const rules = await checkRules(s);
    const height = await evaluate<number>(s, "Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)", 3000).catch(() => screen.height);
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
    return { screens, height: Math.round(height), errors, rules };
  } finally {
    offs.forEach((off) => off());
    await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
    closeSoon();
  }
}
