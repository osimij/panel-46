// Notices when you bookmark a post on X or save one on Instagram and sends it to Panel.
const onX = location.hostname === "x.com";

document.addEventListener(
  "click",
  (e) => {
    // Runs before the site's own handler, so the button still shows its "not saved yet" state.
    const url = onX ? xBookmarked(e.target) : instagramSaved(e.target);
    if (url) save(url);
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

async function save(url) {
  let reply = null;
  try {
    reply = await chrome.runtime.sendMessage({ type: "save", url, site: onX ? "x" : "instagram" });
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
    chrome.runtime.sendMessage({ type: "x-template", template: e.data.template }).catch(() => {});
  });

// Your Saved page lists your folders; remember them so the popup can offer them.
if (!onX) {
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
    chrome.runtime.sendMessage({ type: "ig-folders", folders }).catch(() => {});
  }, 2000);
}

// ---------- Toast ----------

let toastEl = null;
let hideTimer = 0;

function toast(text, tone) {
  if (!toastEl) {
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>
      .t { position: fixed; left: 50%; bottom: 28px; z-index: 2147483647; transform: translate(-50%, 12px); opacity: 0;
        display: flex; align-items: center; gap: 8px; padding: 9px 14px 9px 11px; border-radius: 999px;
        font: 500 13px/1.2 -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif; letter-spacing: -0.005em;
        color: #fff; background: rgb(24 24 24 / 0.92); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
        box-shadow: 0 8px 28px rgb(0 0 0 / 0.28), inset 0 0 0 0.5px rgb(255 255 255 / 0.12);
        transition: opacity .18s cubic-bezier(.2,0,0,1), transform .5s cubic-bezier(.34,1.56,.64,1); pointer-events: none; }
      .t.in { opacity: 1; transform: translate(-50%, 0); }
      .d { width: 7px; height: 7px; border-radius: 50%; flex: none; }
      .ok .d { background: #3ecf8e; } .wait .d { background: #f5b83d; } .bad .d { background: #ff6b5e; }
    </style><div class="t"><span class="d"></span><span class="m"></span></div>`;
    document.documentElement.append(host);
    toastEl = root.querySelector(".t");
  }
  toastEl.className = `t ${tone}`;
  toastEl.querySelector(".m").textContent = text;
  requestAnimationFrame(() => toastEl.classList.add("in"));
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => toastEl.classList.remove("in"), 2400);
}
