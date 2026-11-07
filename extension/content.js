// Notices when you bookmark a post on X, save one on Instagram or save a pin on
// Pinterest and sends it to Panel. On X it asks first: a bookmark there isn't always
// a design reference.
const onX = location.hostname === "x.com";
const onPinterest = /(^|\.)pinterest\.com$/.test(location.hostname);

/**
 * Talks to the extension. After the extension is reloaded or updated, a page that was
 * already open keeps this script but loses the extension, and Chrome throws right away
 * ("Extension context invalidated") instead of failing the promise; this turns that
 * into a normal failure so the page just asks to be reloaded.
 */
function tell(message) {
  try {
    if (!chrome.runtime?.id) throw new Error("Extension context invalidated.");
    return chrome.runtime.sendMessage(message);
  } catch (e) {
    return Promise.reject(e);
  }
}

document.addEventListener(
  "click",
  (e) => {
    // Runs before the site's own handler, so the button still shows its "not saved yet" state.
    if (onX) {
      const url = xBookmarked(e.target);
      if (url)
        tell({ type: "is-on", site: "x" })
          .then((r) => r?.on && askAboutBookmark(url))
          .catch(() => toast("Reload this page to keep saving to Panel", "bad"));
    } else if (!onPinterest) {
      const url = instagramSaved(e.target);
      if (url) save(url);
    }
  },
  true,
);

function xBookmarked(target) {
  const button = target.closest?.('[data-testid="bookmark"]');
  if (!button) return null;
  const article = button.closest("article");
  // On a post's own page, the main post is the one article that isn't a link elsewhere.
  const here = location.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
  if (here && article?.getAttribute("tabindex") === "-1") return `https://x.com/${here[1]}/status/${here[2]}`;
  const link = article?.querySelector('a[href*="/status/"] time')?.closest("a");
  return link ? new URL(link.getAttribute("href"), location.origin).href : null;
}

function instagramSaved(target) {
  const button = target.closest?.('[role="button"], button');
  if (!button?.querySelector('svg[aria-label="Save"]') || button.querySelectorAll("svg").length !== 1) return null;
  const article = button.closest("article");
  const link =
    article?.querySelector('a[href*="/p/"] time, a[href*="/reel/"] time')?.closest("a") ??
    article?.querySelector('a[href*="/p/"], a[href*="/reel/"]');
  if (link) return new URL(link.getAttribute("href"), location.origin).href;
  // A post opened on its own (or in the overlay) has its link in the address bar.
  return /^\/(?:[^/]+\/)?(p|reels?)\/[\w-]+/.test(location.pathname) ? location.href : null;
}

async function save(url, message = { type: "save", url, site: onX ? "x" : "instagram" }) {
  let reply = null;
  try {
    reply = await tell(message);
  } catch {
    // The extension was reloaded since this page opened.
  }
  if (!reply) return toast("Reload this page to keep saving to Panel", "bad");
  if (reply.off) return;
  if (reply.later) toast(`Panel will pick it up if it goes in ${reply.folder}`, "wait");
  else if (reply.ok) toast(reply.existing ? "Already in Panel" : "Saved to Panel", "ok");
  else if (reply.queued) toast("Panel is closed · it'll be saved when it's back", "wait");
  else toast(reply.error || "Couldn't save to Panel", "bad");
}

// X tells x-page.js (which runs inside X's own page) how it loads bookmarks; pass that on.
if (onX)
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.panel !== "x-bookmarks") return;
    tell({ type: "x-template", template: e.data.template }).catch(() => {});
  });

// pin-page.js (inside Pinterest's own page) sees each save go through; send that pin.
if (onPinterest)
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.panel !== "pin-saved") return;
    save(null, { type: "pin-saved", id: e.data.id, boardId: e.data.boardId });
  });

// Your Saved page lists your folders; remember them so the popup can offer them.
if (!onX && !onPinterest) {
  let last = "";
  setInterval(() => {
    if (!location.pathname.includes("/saved/")) return;
    const folders = [];
    for (const a of document.querySelectorAll('a[href*="/saved/"]')) {
      const id = a.getAttribute("href").match(/\/saved\/[^/]+\/(\d+)\/?$/)?.[1];
      if (id && !folders.some((f) => f.id === id)) folders.push({ id, name: a.textContent.trim() });
    }
    const key = JSON.stringify(folders);
    if (!folders.length || key === last) return;
    last = key;
    tell({ type: "ig-folders", folders }).catch(() => {});
  }, 2000);
}

// ---------- Ask: "Add to Panel?" ----------

const ASK_SECONDS = 5;

/** Five seconds to say yes. No answer, or Skip, leaves it out of Panel for good. */
function askAboutBookmark(url) {
  const root = ui();
  const ask = root.querySelector(".ask");
  ask.cancel?.();
  const ring = ask.querySelector(".ring .fill");
  let left = ASK_SECONDS * 1000;
  let last = performance.now();
  let paused = false;
  let frame = 0;
  const finish = (add) => {
    cancelAnimationFrame(frame);
    ask.cancel = null;
    ask.classList.remove("in");
    ask.onmouseenter = ask.onmouseleave = null;
    if (add) save(url);
    else tell({ type: "skip", url }).catch(() => {});
  };
  // Hovering holds the clock, so reaching for the button never loses the race.
  ask.onmouseenter = () => (paused = true);
  ask.onmouseleave = () => {
    paused = false;
    last = performance.now();
  };
  const tick = (now) => {
    if (!paused) left -= now - last;
    last = now;
    ring.style.strokeDashoffset = String(100 * (1 - Math.max(0, left) / (ASK_SECONDS * 1000)));
    if (left <= 0) return finish(false);
    frame = requestAnimationFrame(tick);
  };
  ask.querySelector(".yes").onclick = () => finish(true);
  ask.querySelector(".no").onclick = () => finish(false);
  // A newer bookmark replaces this question; this one counts as a no.
  ask.cancel = () => finish(false);
  toastEl?.classList.remove("in");
  ring.style.strokeDashoffset = "0";
  requestAnimationFrame(() => ask.classList.add("in"));
  frame = requestAnimationFrame(tick);
}

// ---------- Toast ----------

let rootEl = null;
let toastEl = null;
let hideTimer = 0;

function ui() {
  if (rootEl) return rootEl;
  const host = document.createElement("div");
  rootEl = host.attachShadow({ mode: "closed" });
  rootEl.innerHTML = `<style>
    .t, .ask { position: fixed; left: 50%; bottom: 28px; z-index: 2147483647; transform: translate(-50%, 12px); opacity: 0;
      display: flex; align-items: center; gap: 8px; border-radius: 999px;
      font: 500 13px/1.2 -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif; letter-spacing: -0.005em;
      color: #fff; background: rgb(24 24 24 / 0.92); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      box-shadow: 0 8px 28px rgb(0 0 0 / 0.28), inset 0 0 0 0.5px rgb(255 255 255 / 0.12);
      transition: opacity .18s cubic-bezier(.2,0,0,1), transform .5s cubic-bezier(.34,1.56,.64,1); pointer-events: none; }
    .t { padding: 9px 14px 9px 11px; }
    .t.in, .ask.in { opacity: 1; transform: translate(-50%, 0); }
    .ask.in { pointer-events: auto; }
    .ask { padding: 6px 6px 6px 16px; gap: 12px; }
    .ask button { all: unset; cursor: pointer; height: 30px; padding: 0 14px; border-radius: 999px; font-weight: 550;
      display: inline-flex; align-items: center; transition: background .12s; }
    .ask .yes { color: #111; background: #fff; }
    .ask .yes:hover { background: #e9e9e9; }
    .ask .no { color: rgb(255 255 255 / 0.7); margin-left: -8px; gap: 8px; padding: 0 10px 0 12px; }
    .ask .no:hover { color: #fff; background: rgb(255 255 255 / 0.1); }
    .ring { width: 16px; height: 16px; flex: none; transform: rotate(-90deg); overflow: visible; }
    .ring circle { fill: none; stroke-width: 2; }
    .ring .track { stroke: rgb(255 255 255 / 0.16); }
    .ring .fill { stroke: currentColor; stroke-linecap: round; stroke-dasharray: 100; }
    .d { width: 7px; height: 7px; border-radius: 50%; flex: none; }
    .ok .d { background: #3ecf8e; } .wait .d { background: #f5b83d; } .bad .d { background: #ff6b5e; }
  </style>
  <div class="t"><span class="d"></span><span class="m"></span></div>
  <div class="ask" role="dialog" aria-label="Add this bookmark to Panel?">
    <span>Add to Panel?</span><button class="yes">Add</button><button class="no">Skip<svg class="ring" viewBox="0 0 16 16" aria-hidden="true"><circle class="track" cx="8" cy="8" r="6.5"/><circle class="fill" cx="8" cy="8" r="6.5" pathLength="100"/></svg></button>
  </div>`;
  document.documentElement.append(host);
  toastEl = rootEl.querySelector(".t");
  return rootEl;
}

function toast(text, tone) {
  ui();
  toastEl.className = `t ${tone}`;
  toastEl.querySelector(".m").textContent = text;
  requestAnimationFrame(() => toastEl.classList.add("in"));
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => toastEl.classList.remove("in"), 2400);
}
