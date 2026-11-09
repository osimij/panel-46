import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abs, run } from "./media.ts";

/**
 * Full-page screenshots of a website, taken by the Chrome already on this Mac
 * running headless with a throwaway profile (none of your logins, cookies or
 * history). It talks to Chrome over the DevTools protocol directly, so there is
 * nothing extra to install.
 */

const BROWSERS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];
export const chromePath = () => BROWSERS.find((p) => existsSync(p)) ?? null;

export interface Viewport {
  name: "desktop" | "phone";
  width: number;
  height: number;
  scale: number;
  mobile: boolean;
  /** Longest page kept, in CSS pixels. */
  maxHeight: number;
}

/** Retina sharpness: desktop at 2×, phone at 3× like an iPhone. */
export const VIEWPORTS: Viewport[] = [
  { name: "desktop", width: 1440, height: 900, scale: 2, mobile: false, maxHeight: 20000 },
  { name: "phone", width: 390, height: 844, scale: 3, mobile: true, maxHeight: 12000 },
];

/** Chrome can't paint much past 16k device pixels at once, so long pages are taken in slices. */
const SLICE_DEVICE_PX = 12000;

const PHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

export interface Shot {
  viewport: Viewport;
  rel: string;
  width: number;
  height: number;
  /** True when the page was longer than we keep. */
  cut: boolean;
}

export interface SiteInfo {
  title: string | null;
  description: string | null;
  siteName: string | null;
  icon: string | null;
  finalUrl: string;
}

// One Chrome at a time: each is a few hundred MB.
let line: Promise<unknown> = Promise.resolve();
export function shootSite(url: string, dirRel: string) {
  const job = line.then(() => shootAll(url, dirRel));
  line = job.catch(() => {});
  return job;
}

async function shootAll(url: string, dirRel: string): Promise<{ shots: Shot[]; info: SiteInfo | null; errors: string[] }> {
  const exe = chromePath();
  if (!exe) throw new Error("Taking screenshots needs Google Chrome (or Chromium, Brave, Edge) in Applications.");
  mkdirSync(abs(dirRel), { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), "panel-chrome-"));
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
    await cdp.connect(await devtoolsUrl(proc.stderr));
    const shots: Shot[] = [];
    const errors: string[] = [];
    let info: SiteInfo | null = null;
    for (const vp of VIEWPORTS) {
      try {
        const r = await shootOne(cdp, url, vp, `${dirRel}/${vp.name}.jpg`);
        shots.push(r.shot);
        info ??= r.info;
      } catch (e) {
        errors.push(`${vp.name}: ${(e as Error).message}`);
      }
    }
    return { shots, info, errors };
  } finally {
    cdp.close();
    proc.kill();
    await Promise.race([proc.exited, Bun.sleep(3000)]);
    rmSync(profile, { recursive: true, force: true });
  }
}

async function shootOne(cdp: Cdp, url: string, vp: Viewport, rel: string) {
  const { targetId } = await cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
  const s = <T = unknown>(method: string, params: object = {}) => cdp.send<T>(method, params, sessionId);
  try {
    await s("Page.enable");
    await s("Emulation.setDeviceMetricsOverride", {
      width: vp.width, height: vp.height, deviceScaleFactor: vp.scale, mobile: vp.mobile,
    });
    if (vp.mobile) {
      await s("Emulation.setUserAgentOverride", { userAgent: PHONE_UA, platform: "iPhone" });
      await s("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    }
    await s("Network.enable");
    const net = trackNetwork(cdp, sessionId);
    try {
      // A slow page still gets its picture taken with whatever has arrived by then.
      const loaded = cdp.waitFor("Page.loadEventFired", sessionId, 30_000);
      const nav = await Promise.race([
        s<{ errorText?: string }>("Page.navigate", { url }),
        Bun.sleep(45_000).then(() => ({ errorText: "The site took too long to answer." })),
      ]);
      if (nav.errorText) throw new Error(friendlyNetError(nav.errorText));
      await loaded;

      // "Loaded" is often only the start: preloaders count to 100%, WebGL scenes fetch
      // textures and models, intro animations play. Wait for the site the way a person
      // would see it, within a time limit, so a stuck page still gets captured.
      await net.idle(1, 700, 15_000);
      await evaluate(s, READY_SCRIPT, 40_000).catch(() => {});
      await net.idle(1, 500, 8_000);
    } finally {
      net.stop();
    }

    // Walk down the page so lazy images and scroll animations show, then go back up.
    await evaluate(s, SETTLE_SCRIPT, 45_000).catch(() => {});
    const info = await evaluate<SiteInfo>(s, INFO_SCRIPT, 5000).catch(() => null);

    const m = await s<{ cssContentSize: { width: number; height: number } }>("Page.getLayoutMetrics");
    const full = Math.ceil(m.cssContentSize.height);
    const height = Math.max(vp.height, Math.min(full, vp.maxHeight));
    // Lossless slices, stacked and encoded to JPEG once at high quality with full colour detail.
    const sliceCss = Math.floor(SLICE_DEVICE_PX / vp.scale);
    const tmp = mkdtempSync(join(tmpdir(), "panel-slices-"));
    try {
      const files: string[] = [];
      for (let y = 0; y < height; y += sliceCss) {
        const shot = await s<{ data: string }>("Page.captureScreenshot", {
          format: "png", captureBeyondViewport: true, fromSurface: true,
          clip: { x: 0, y, width: vp.width, height: Math.min(sliceCss, height - y), scale: 1 },
        });
        const file = join(tmp, `${files.length}.png`);
        writeFileSync(file, Buffer.from(shot.data, "base64"));
        files.push(file);
      }
      const { code, err } = await run(
        [
          "ffmpeg", "-y", "-v", "error", ...files.flatMap((f) => ["-i", f]),
          ...(files.length > 1 ? ["-filter_complex", `vstack=inputs=${files.length}`] : []),
          "-pix_fmt", "yuvj444p", "-q:v", "2", "-frames:v", "1", abs(rel),
        ],
        180_000,
      );
      if (code !== 0) throw new Error(`Couldn't save the screenshot: ${err.trim().split("\n")[0]}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    return {
      shot: { viewport: vp, rel, width: vp.width * vp.scale, height: height * vp.scale, cut: full > vp.maxHeight },
      info: info ? { ...info, finalUrl: info.finalUrl || url } : null,
    };
  } finally {
    await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
  }
}

export async function evaluate<T>(s: (m: string, p?: object) => Promise<unknown>, expression: string, timeout: number) {
  const r = (await Promise.race([
    s("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }),
    Bun.sleep(timeout).then(() => {
      throw new Error("Page script timed out");
    }),
  ])) as { result?: { value?: T }; exceptionDetails?: unknown };
  if (r.exceptionDetails) throw new Error("Page script failed");
  return r.result?.value as T;
}

/**
 * Follows the page's requests so we can wait for it to stop fetching things.
 * WebSockets and long-lived streams don't count, and neither does a request
 * that has been open for over 10s (polling, analytics beacons that never close).
 */
export function trackNetwork(cdp: Cdp, sessionId: string) {
  const open = new Map<string, number>();
  const offs = [
    cdp.on("Network.requestWillBeSent", sessionId, (p) => {
      const { requestId, type } = p as { requestId: string; type?: string };
      if (type !== "WebSocket" && type !== "EventSource") open.set(requestId, Date.now());
    }),
    cdp.on("Network.loadingFinished", sessionId, (p) => open.delete((p as { requestId: string }).requestId)),
    cdp.on("Network.loadingFailed", sessionId, (p) => open.delete((p as { requestId: string }).requestId)),
  ];
  const busy = () => {
    const now = Date.now();
    let n = 0;
    for (const t of open.values()) if (now - t < 10_000) n++;
    return n;
  };
  return {
    /** Resolves once at most `max` requests have been open for `quietMs` in a row, or at `timeout`. */
    async idle(max: number, quietMs: number, timeout: number) {
      const end = Date.now() + timeout;
      let since = Date.now();
      while (Date.now() < end) {
        if (busy() > max) since = Date.now();
        else if (Date.now() - since >= quietMs) return true;
        await Bun.sleep(100);
      }
      return false;
    },
    stop: () => offs.forEach((off) => off()),
  };
}

/**
 * Wait until the page is showing itself rather than a loading screen:
 * - a preloader is up: a progress count ("42%") that's still moving, a layer
 *   covering most of the screen named like one (loader, preloader, splash,
 *   intro…), or <html>/<body> marked as loading. Wait for it to leave.
 * - a "click to enter" gate: press its button (it's a throwaway browser).
 * - then let the page calm down: no elements added or removed, and no
 *   one-off CSS animations still running, for a moment. Endless ones
 *   (marquees, spinning things, shaders) don't count.
 * - a <canvas> (WebGL, shaders) gets a little longer to draw its first frames.
 * Gives up after ~30s and lets the capture go ahead with what's there.
 */
export const READY_SCRIPT = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const start = Date.now();
  const vw = innerWidth, vh = innerHeight;
  const shown = (el) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity < 0.05) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
  };
  const covers = (el, share) => {
    const r = el.getBoundingClientRect();
    const w = Math.min(r.right, vw) - Math.max(r.left, 0), h = Math.min(r.bottom, vh) - Math.max(r.top, 0);
    return w > 0 && h > 0 && w * h >= vw * vh * share;
  };
  const nameOf = (el) => el.id + " " + (el.getAttribute("class") || "");
  const LOADER = /(^|[-_\\s])(pre-?loader|preloading|loader|loading|loading-?screen|splash|splash-?screen|intro-?(screen|overlay|loader)|curtain|page-?loader)([-_\\s]|$)/i;

  const seen = new Map();
  const percentMoving = () => {
    if (!document.body) return false;
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n, i = 0, moving = false;
    while ((n = walk.nextNode()) && i++ < 20000) {
      const t = n.textContent;
      if (t.length > 8 || !/^\\s*\\d{1,3}\\s*%\\s*$/.test(t)) continue;
      const el = n.parentElement;
      if (!el || !shown(el)) continue;
      // Keyed by element: many loaders replace the text node on every tick.
      const before = seen.get(el);
      seen.set(el, t);
      if (before !== undefined && before !== t) moving = true;
      // A count sitting on a full-screen layer is a loader even while it's stuck.
      if (before !== undefined) for (let e = el; e && e !== document.body; e = e.parentElement) {
        const p = getComputedStyle(e).position;
        if ((p === "fixed" || p === "absolute") && covers(e, 0.8) && parseFloat(t) < 100) { moving = true; break; }
      }
    }
    return moving;
  };
  const loaderLayer = () => {
    for (const el of document.querySelectorAll("body *")) {
      if (!LOADER.test(nameOf(el))) continue;
      if (covers(el, 0.6) && shown(el)) return true;
    }
    return false;
  };
  const rootLoading = () => /(^|\\s)(is-)?(pre)?loading(\\s|$)/i.test(document.documentElement.className + " " + (document.body?.className || ""));
  const loading = () => percentMoving() || loaderLayer() || rootLoading();

  const ENTER = /^(enter|enter site|enter website|enter the site|explore|start|begin|click to enter|tap to enter|let'?s go|continue)$/i;
  const pressEnter = () => {
    for (const el of document.querySelectorAll('button, [role="button"]')) {
      if (!ENTER.test((el.innerText || "").trim()) || !shown(el)) continue;
      for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
        const p = getComputedStyle(e).position;
        if ((p === "fixed" || p === "absolute") && covers(e, 0.6)) { el.click(); return true; }
      }
    }
    return false;
  };

  // 1. The loading screen.
  percentMoving();
  await wait(400);
  let pressed = false;
  while (Date.now() - start < 30000) {
    if (!pressed && pressEnter()) { pressed = true; await wait(800); continue; }
    if (!loading()) break;
    await wait(300);
  }
  const loaderGone = Date.now();

  // 2. Calm: nothing added or removed for a moment, and one-off animations done.
  let lastChange = Date.now();
  const mo = new MutationObserver((list) => {
    if (list.some((m) => m.type === "childList" || m.type === "characterData" || m.attributeName === "class")) lastChange = Date.now();
  });
  mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class"] });
  const finiteRunning = () => {
    try {
      return document.getAnimations().some((a) => a.playState === "running" && a.effect?.getComputedTiming().iterations !== Infinity
        && (a.effect.getComputedTiming().endTime ?? 0) < 8000);
    } catch { return false; }
  };
  const calmBy = loaderGone + 8000;
  while (Date.now() < calmBy && Date.now() - start < 38000) {
    if (Date.now() - lastChange >= 700 && !finiteRunning()) break;
    await wait(150);
  }
  mo.disconnect();

  // 3. Shaders and 3D scenes need a few frames after they get their textures.
  const canvas = [...document.querySelectorAll("canvas")].some((c) => shown(c) && covers(c, 0.15));
  const minAfterLoader = canvas ? 2000 : 800;
  await wait(Math.max(400, loaderGone + minAfterLoader - Date.now()));
  return { waited: Date.now() - start, pressed, canvas };
})()`;

/**
 * Scroll through once so lazy content loads, wait for fonts and images, then
 * pin anything sized to the window's height (100vh heroes and the like) to the
 * pixels it has now. Otherwise those sections stretch to the whole page's
 * height when the full page is painted at once.
 */
const SETTLE_SCRIPT = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const vh = innerHeight;
  for (let i = 0; i < 60; i++) {
    const before = scrollY;
    scrollBy(0, Math.round(vh * 0.85));
    await wait(160);
    if (scrollY === before) break;
  }
  await wait(500);
  scrollTo(0, 0);
  await wait(300);
  try { await Promise.race([document.fonts.ready, wait(4000)]); } catch {}
  const imgs = [...document.images].filter((i) => !i.complete);
  await Promise.race([Promise.all(imgs.map((i) => new Promise((r) => { i.onload = i.onerror = r; }))), wait(6000)]);
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.position === "fixed" || cs.display === "inline") continue;
    const h = el.getBoundingClientRect().height;
    if (h >= vh * 0.3 && Math.abs(h / vh * 100 - Math.round(h / vh * 100)) < 0.02) {
      el.style.setProperty("height", h + "px", "important");
      el.style.setProperty("min-height", h + "px", "important");
      el.style.setProperty("max-height", h + "px", "important");
    }
  }
  await wait(400);
})()`;

const INFO_SCRIPT = `(() => {
  const meta = (k) => document.querySelector('meta[property="' + k + '"], meta[name="' + k + '"]')?.content?.trim() || null;
  const icons = [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]')]
    .map((l) => ({ href: l.href, size: parseInt((l.sizes && l.sizes.value) || (l.rel.includes("apple") ? "180" : "16"), 10) || 16, svg: /svg/.test(l.type) || /\\.svg(\\?|$)/.test(l.href) }))
    .filter((i) => i.href && !i.href.startsWith("data:") && !i.svg)
    .sort((a, b) => b.size - a.size);
  return {
    title: meta("og:title") || document.title || null,
    description: meta("og:description") || meta("description"),
    siteName: meta("og:site_name") || meta("application-name"),
    icon: icons[0]?.href || new URL("/favicon.ico", location.href).href,
    finalUrl: location.href,
  };
})()`;

function friendlyNetError(code: string) {
  if (/NAME_NOT_RESOLVED/.test(code)) return "That site's address doesn't exist (or you're offline).";
  if (/CONNECTION_REFUSED|CONNECTION_RESET|TIMED_OUT/.test(code)) return "The site didn't answer.";
  if (/CERT/.test(code)) return "The site's security certificate is broken.";
  return code;
}

export async function devtoolsUrl(stderr: ReadableStream<Uint8Array>) {
  const reader = stderr.getReader();
  const dec = new TextDecoder();
  let text = "";
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const { value, done } = await Promise.race([
      reader.read(),
      Bun.sleep(deadline - Date.now()).then(() => ({ value: undefined, done: true })),
    ]);
    if (done) break;
    text += dec.decode(value);
    const m = text.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) {
      // Keep draining so Chrome never blocks on a full pipe.
      void (async () => { while (!(await reader.read().catch(() => ({ done: true }))).done); })();
      return m[1]!;
    }
  }
  throw new Error("Chrome didn't start.");
}

/** The smallest DevTools-protocol client that does the job. */
export class Cdp {
  private ws!: WebSocket;
  private next = 1;
  private calls = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void }>();
  private waiters: { method: string; sessionId?: string; ok: () => void }[] = [];
  private listeners = new Set<{ method: string; sessionId?: string; fn: (params: unknown) => void }>();

  connect(url: string) {
    return new Promise<void>((ok, fail) => {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => ok();
      this.ws.onerror = () => fail(new Error("Couldn't talk to Chrome."));
      this.ws.onclose = () => {
        for (const c of this.calls.values()) c.fail(new Error("Chrome closed."));
        this.calls.clear();
      };
      this.ws.onmessage = (e) => {
        const msg = JSON.parse(String(e.data)) as {
          id?: number; result?: unknown; error?: { message: string }; method?: string; sessionId?: string; params?: unknown;
        };
        if (msg.method)
          for (const l of this.listeners)
            if (l.method === msg.method && (!l.sessionId || l.sessionId === msg.sessionId)) l.fn(msg.params);
        if (msg.id) {
          const c = this.calls.get(msg.id);
          this.calls.delete(msg.id);
          if (msg.error) c?.fail(new Error(msg.error.message));
          else c?.ok(msg.result);
        } else if (msg.method) {
          this.waiters = this.waiters.filter((w) => {
            if (w.method !== msg.method || (w.sessionId && w.sessionId !== msg.sessionId)) return true;
            w.ok();
            return false;
          });
        }
      };
    });
  }

  send<T = unknown>(method: string, params: object = {}, sessionId?: string) {
    const id = this.next++;
    return new Promise<T>((ok, fail) => {
      this.calls.set(id, { ok: ok as (v: unknown) => void, fail });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  /** Calls `fn` for every such event until the returned function is called. */
  on(method: string, sessionId: string | undefined, fn: (params: unknown) => void) {
    const l = { method, sessionId, fn };
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }

  /** Resolves true when the event arrives, false when it doesn't in time. Never rejects. */
  waitFor(method: string, sessionId: string | undefined, timeout: number) {
    return new Promise<boolean>((done) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        done(false);
      }, timeout);
      const w = { method, sessionId, ok: () => (clearTimeout(timer), done(true)) };
      this.waiters.push(w);
    });
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      /* already gone */
    }
  }
}
