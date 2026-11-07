// Sends what you bookmark on X, save on Instagram or save on Pinterest to Panel: right
// away when you do it in this browser, and by checking those lists every few minutes,
// which also catches what you saved on your phone.

const PANEL = "http://127.0.0.1:4646";
const SYNC_MINUTES = 20;
const SITES = ["x", "instagram", "pinterest"];
const NAME = { x: "X", instagram: "Instagram", pinterest: "Pinterest" };

const get = async (key, fallback) => (await chrome.storage.local.get(key))[key] ?? fallback;
const set = (key, value) => chrome.storage.local.set({ [key]: value });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class PanelDown extends Error {
  constructor() {
    super("Panel isn't running");
  }
}
class Offline extends Error {
  constructor() {
    super("No internet. Trying again in a minute");
  }
}
class LoggedOut extends Error {
  constructor(site) {
    super(`Log in to ${NAME[site]} in Chrome`);
  }
}

/** fetch for X and Instagram: a network failure (offline, Mac just woke) becomes Offline. */
async function web(url, opts) {
  try {
    return await fetch(url, opts);
  } catch {
    throw new Offline();
  }
}

// ---------- Panel ----------

/**
 * `auto` is for posts found by syncing: Panel skips ones you deleted. `pin` is a
 * Pinterest pin's details as Pinterest gave them here, signed in, so pins on secret
 * boards can be saved too.
 */
async function send(url, auto = false, pin = null) {
  let res;
  try {
    res = await fetch(`${PANEL}/api/capture`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, auto, ...(pin ? { pin } : {}) }),
    });
  } catch {
    throw new PanelDown();
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Panel returned HTTP ${res.status}`);
  return { existing: !!body.existing || !!body.skipped, id: body.id ?? null };
}

/** Saves (and skips) made while Panel was closed wait here until it's back. */
async function flushPending() {
  const pending = await get("pending", []);
  while (pending.length) {
    await send(pending[0]);
    pending.shift();
    await set("pending", pending);
  }
  const skips = await get("pendingSkips", []);
  while (skips.length) {
    await tellSkip(skips[0]);
    skips.shift();
    await set("pendingSkips", skips);
  }
}

async function tellSkip(url) {
  try {
    await fetch(`${PANEL}/api/dismiss`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
  } catch {
    throw new PanelDown();
  }
}

/** You bookmarked an X post but said no: Panel remembers, so the sync won't add it either. */
async function skipBookmark(url) {
  try {
    await tellSkip(url);
  } catch {
    const skips = await get("pendingSkips", []);
    if (!skips.includes(url)) await set("pendingSkips", [...skips, url]);
  }
  return { ok: true };
}

async function saveFromClick(url, site) {
  if (!(await siteOn(site))) return { ok: false, off: true };
  // Saving on Instagram only puts a post in "All posts"; whether it belongs in the
  // folder is decided a moment later, so look at the folder shortly instead.
  const folder = site === "instagram" ? await get("igFolder", null) : null;
  if (folder) {
    chrome.alarms.create("instagram-soon", { delayInMinutes: 0.5 });
    chrome.alarms.create("instagram-later", { delayInMinutes: 2 });
    return { ok: true, later: true, folder: folder.name };
  }
  try {
    const { existing } = await send(url);
    return { ok: true, existing };
  } catch (e) {
    if (!(e instanceof PanelDown)) return { ok: false, error: e.message };
    const pending = await get("pending", []);
    if (!pending.includes(url)) await set("pending", [...pending, url]);
    return { ok: false, queued: true };
  }
}

/**
 * You saved a pin on Pinterest in this browser. `id` is your copy of it (the same
 * one a sync would find, so it's never sent twice). With one board picked in the
 * popup, pins saved to other boards stay out.
 */
async function savePin(id, boardId) {
  if (!/^\d+$/.test(String(id ?? ""))) return { ok: false, error: "Couldn't tell which pin that was" };
  if (!(await siteOn("pinterest"))) return { ok: false, off: true };
  const board = await get("pinBoard", null);
  if (board && boardId && String(boardId) !== board.id) return { ok: false, off: true };
  const url = `https://www.pinterest.com/pin/${id}/`;
  const seen = new Set(await get("seen.pinterest", []));
  seen.add(String(id));
  await set("seen.pinterest", [...seen].slice(-5000));
  try {
    const { existing } = await send(url, false, await pinterestPin(id));
    return { ok: true, existing };
  } catch (e) {
    if (!(e instanceof PanelDown)) return { ok: false, error: e.message };
    const pending = await get("pending", []);
    if (!pending.includes(url)) await set("pending", [...pending, url]);
    return { ok: false, queued: true };
  }
}

/** "Save this site" from the popup or the right-click menu: any page or link. */
async function savePage(url) {
  if (!/^https?:\/\//.test(url ?? "") || url.startsWith(PANEL)) return { ok: false, error: "Only web pages can be saved" };
  try {
    const { existing, id } = await send(url);
    return { ok: true, existing, id };
  } catch (e) {
    if (!(e instanceof PanelDown)) return { ok: false, error: e.message };
    const pending = await get("pending", []);
    if (!pending.includes(url)) await set("pending", [...pending, url]);
    return { ok: false, queued: true };
  }
}

/** A short mark on the toolbar icon after a right-click save, then back to normal. */
async function flashBadge(result) {
  const [text, color] = result.ok ? ["✓", "#30a46c"] : result.queued ? ["…", "#8d8d8d"] : ["!", "#e5484d"];
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  await sleep(2500);
  const failing = Object.values(await get("status", {})).some((s) => s.error);
  chrome.action.setBadgeBackgroundColor({ color: "#e5484d" });
  chrome.action.setBadgeText({ text: failing ? "!" : "" });
}

// ---------- X ----------

// How X's web app asked for bookmarks when this was written. When X changes it,
// x-page.js notices the new way the next time you open your bookmarks.
const X_DEFAULT = {
  queryId: "jbqsfdzI0EMFHAtpEC6vyA",
  features: Object.fromEntries([
    ...["rweb_cashtags_enabled", "profile_label_improvements_pcf_label_in_post_enabled", "responsive_web_profile_redirect_enabled",
      "creator_subscriptions_tweet_preview_api_enabled", "responsive_web_graphql_timeline_navigation_enabled",
      "communities_web_enable_tweet_community_results_fetch", "c9s_tweet_anatomy_moderator_badge_enabled",
      "responsive_web_grok_analyze_post_followups_enabled", "rweb_cashtags_composer_attachment_enabled", "responsive_web_jetfuel_frame",
      "rweb_sports_post_context_enabled", "x_elections_post_context_enabled", "responsive_web_grok_share_attachment_enabled",
      "responsive_web_grok_annotations_enabled", "articles_preview_enabled", "responsive_web_edit_tweet_api_enabled",
      "graphql_is_translatable_rweb_tweet_is_translatable_enabled", "view_counts_everywhere_api_enabled",
      "longform_notetweets_consumption_enabled", "responsive_web_twitter_article_tweet_consumption_enabled",
      "content_disclosure_indicator_enabled", "content_disclosure_ai_generated_indicator_enabled",
      "responsive_web_grok_show_grok_translated_post", "responsive_web_grok_analysis_button_from_backend",
      "freedom_of_speech_not_reach_fetch_enabled", "standardized_nudges_misinfo",
      "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled", "longform_notetweets_rich_text_read_enabled",
      "responsive_web_nested_quote_preview_enabled", "responsive_web_grok_image_annotation_enabled",
      "responsive_web_grok_imagine_annotation_enabled", "responsive_web_grok_community_note_auto_translation_is_enabled",
    ].map((k) => [k, true]),
    ...["rweb_video_screen_enabled", "rweb_tipjar_consumption_enabled", "verified_phone_label_enabled", "premium_content_api_read_enabled",
      "responsive_web_grok_analyze_button_fetch_trends_enabled", "rweb_conversational_replies_downvote_enabled", "post_ctas_fetch_enabled",
      "longform_notetweets_inline_media_enabled", "responsive_web_made_on_x_label_enabled", "responsive_web_enhance_cards_enabled",
    ].map((k) => [k, false]),
  ]),
};

/** The web app's own public client token, read from its script so it stays current. */
async function xBearer() {
  const html = await (await web("https://x.com/", { credentials: "include" })).text();
  const main = html.match(/https:\/\/abs\.twimg\.com\/responsive-web\/client-web[\w-]*\/main\.[\w]+\.js/)?.[0];
  const js = main ? await (await web(main)).text() : "";
  const bearer = js.match(/"(AAAAAAAAAAAAAAAAAAAAA[\w%]+)"/)?.[1];
  if (!bearer) throw new Error("X changed its app. Open your X bookmarks once so Panel can catch up.");
  return bearer;
}

async function xPage(cursor) {
  const ct0 = (await chrome.cookies.get({ url: "https://x.com", name: "ct0" }))?.value;
  if (!ct0) throw new LoggedOut("x");
  const t = { ...X_DEFAULT, ...(await get("xTemplate", {})) };
  t.bearer ??= await xBearer();

  const q = new URL(`https://x.com/i/api/graphql/${t.queryId}/Bookmarks`);
  q.searchParams.set("variables", JSON.stringify({ count: 20, includePromotedContent: false, ...(cursor ? { cursor } : {}) }));
  q.searchParams.set("features", JSON.stringify(t.features));
  const res = await web(q, {
    credentials: "include",
    headers: {
      authorization: `Bearer ${t.bearer}`,
      "x-csrf-token": ct0,
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-active-user": "yes",
      "content-type": "application/json",
    },
  });
  if (res.status === 401 || res.status === 403) throw new LoggedOut("x");
  if (!res.ok)
    throw new Error(res.status === 400 || res.status === 404
      ? "X changed how bookmarks load. Open your X bookmarks once so Panel can catch up."
      : `X returned HTTP ${res.status}`);

  const json = await res.json();
  const entries = (json.data?.bookmark_timeline_v2?.timeline?.instructions ?? []).flatMap((i) => i.entries ?? []);
  const posts = entries
    .filter((e) => /^tweet-\d+$/.test(e.entryId))
    .map((e) => {
      const id = e.entryId.slice("tweet-".length);
      let tweet = e.content?.itemContent?.tweet_results?.result;
      if (tweet?.tweet) tweet = tweet.tweet; // posts with limited visibility come wrapped
      const user = tweet?.core?.user_results?.result;
      const handle = user?.core?.screen_name ?? user?.legacy?.screen_name ?? "i";
      return { id, url: `https://x.com/${handle}/status/${id}` };
    });
  const next = entries.find((e) => e.entryId?.startsWith("cursor-bottom"))?.content?.value;
  return { posts, next: posts.length ? next : null };
}

// ---------- Instagram ----------

async function instagramPage(maxId) {
  if (!(await chrome.cookies.get({ url: "https://www.instagram.com", name: "sessionid" }))) throw new LoggedOut("instagram");
  const folder = await get("igFolder", null);
  const u = new URL(
    folder ? `https://www.instagram.com/api/v1/feed/collection/${folder.id}/posts/` : "https://www.instagram.com/api/v1/feed/saved/posts/",
  );
  if (maxId) u.searchParams.set("max_id", maxId);
  // The app id is the one Instagram's own website identifies itself with.
  const res = await web(u, { credentials: "include", headers: { "X-IG-App-ID": "936619743392459", "X-Requested-With": "XMLHttpRequest" } });
  const json = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 403 || json?.require_login || json?.message === "login_required") throw new LoggedOut("instagram");
  if (!res.ok || !json) throw new Error(`Instagram returned HTTP ${res.status}`);
  const posts = (json.items ?? [])
    .map((i) => i.media)
    .filter((m) => m?.code)
    .map((m) => ({ id: m.code, url: `https://www.instagram.com/p/${m.code}/` }));
  return { posts, next: json.more_available ? json.next_max_id : null };
}

// ---------- Pinterest ----------

/** Pinterest's own web API, as its website calls it, with your sign-in. */
async function pinResource(name, handler, options) {
  const u = new URL(`https://www.pinterest.com/resource/${name}/get/`);
  u.searchParams.set("source_url", "/");
  u.searchParams.set("data", JSON.stringify({ options, context: {} }));
  const res = await web(u, {
    credentials: "include",
    headers: { accept: "application/json", "X-Requested-With": "XMLHttpRequest", "X-Pinterest-PWS-Handler": handler },
  });
  if (res.status === 401 || res.status === 403) throw new LoggedOut("pinterest");
  if (!res.ok) throw new Error(`Pinterest returned HTTP ${res.status}`);
  const json = await res.json().catch(() => null);
  if (!json?.resource_response) throw new Error("Pinterest changed how it loads pins");
  return json.resource_response;
}

/** Who you are on Pinterest, from the page Pinterest serves you. */
async function pinterestUser() {
  const html = await (await web("https://www.pinterest.com/", { credentials: "include" })).text();
  const raw = html.match(/<script[^>]+id="__PWS_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  let ctx = null;
  try {
    ctx = JSON.parse(raw ?? "null")?.context;
  } catch {
    // handled below
  }
  const username = ctx?.user?.username;
  if (!ctx?.is_authenticated || !username) throw new LoggedOut("pinterest");
  await set("pinUser", username);
  return username;
}

/** Your boards, newest pinned-to first, for the popup's board picker. */
async function pinterestBoards(username) {
  const r = await pinResource("BoardsResource", "www/[username]/boards.js", {
    username, page_size: 100, field_set_key: "profile_grid_item", sort: "last_pinned_to", privacy_filter: "all", include_archived: true,
  });
  const boards = (r.data ?? [])
    .filter((b) => b?.id && b.name)
    .map((b) => ({ id: String(b.id), name: String(b.name).slice(0, 80) }));
  if (boards.length) await set("pinBoards", boards);
}

/**
 * Your pins, newest first: every board, or just the one picked in the popup. Each
 * comes with its details, which Panel uses for pins it can't read on its own.
 */
async function pinterestPage(bookmark) {
  const username = await pinterestUser();
  if (!bookmark) await pinterestBoards(username).catch(() => {});
  const board = await get("pinBoard", null);
  const r = await pinResource("UserPinsResource", "www/[username]/pins.js", {
    username, page_size: 25, field_set_key: "grid_item", ...(bookmark ? { bookmarks: [bookmark] } : {}),
  });
  const posts = (r.data ?? [])
    .filter((p) => p?.type === "pin" && p.id && (!board || String(p.board?.id) === board.id))
    .map((p) => ({ id: String(p.id), url: `https://www.pinterest.com/pin/${p.id}/`, pin: p }));
  const next = r.bookmark && r.bookmark !== "-end-" && r.data?.length ? r.bookmark : null;
  // With one board picked, a page can hold none of its pins and still not be the end.
  return { posts, next, keepGoing: !!board };
}

/** One pin you just saved, read with your sign-in so a secret board is no problem. */
async function pinterestPin(id) {
  try {
    const r = await pinResource("PinResource", "www/pin/[id].js", { id, field_set_key: "detailed" });
    return r.data?.id ? r.data : null;
  } catch {
    return null;
  }
}

const PAGE = { x: xPage, instagram: instagramPage, pinterest: pinterestPage };

const siteOn = async (site) => (await get("sites", {}))[site] !== false;

// ---------- Syncing ----------

/**
 * Sends saved posts Panel hasn't been given yet, newest first. A regular sync
 * stops at the first post it has seen before; `all` walks back through everything.
 */
async function syncSite(site, all = false) {
  const stored = await get(`seen.${site}`, null);
  const seen = new Set(stored ?? []);
  // The very first sync brings in only your latest saves; the popup offers the rest.
  const maxPages = all ? 200 : stored ? 5 : 1;
  let cursor = null;
  let added = 0;
  let pages = 0;
  try {
    do {
      const { posts, next, keepGoing } = await PAGE[site](cursor);
      const fresh = posts.filter((p) => !seen.has(p.id));
      for (const p of fresh) {
        if (!(await send(p.url, true, p.pin)).existing) added++;
        seen.add(p.id);
      }
      cursor = next;
      pages++;
      if (all) {
        await setStatus(site, { importing: true, added });
        await sleep(1500); // unhurried, like scrolling
      } else if (fresh.length < posts.length || (!posts.length && !keepGoing)) break;
    } while (cursor && pages < maxPages);
  } finally {
    await set(`seen.${site}`, [...seen].slice(-5000));
  }
  return added;
}

async function setStatus(site, patch) {
  const status = await get("status", {});
  status[site] = { ...status[site], ...patch };
  await set("status", status);
  const failing = Object.values(status).some((s) => s.error);
  chrome.action.setBadgeText({ text: failing ? "!" : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#e5484d" });
}

let running = null;

function sync(only, all = false) {
  running ??= (async () => {
    try {
      await flushPending();
    } catch {
      // Panel is down; each site reports that below.
    }
    for (const site of only ? [only] : SITES) {
      if (!(await siteOn(site))) continue;
      try {
        const added = await syncSite(site, all);
        await setStatus(site, { at: Date.now(), added, error: null, importing: false });
      } catch (e) {
        await setStatus(site, { at: Date.now(), error: e.message, importing: false });
        if (e instanceof PanelDown) break;
        if (e instanceof Offline) chrome.alarms.create("sync-retry", { delayInMinutes: 1 });
      }
    }
  })().finally(() => (running = null));
  return running;
}

async function state() {
  const panel = await fetch(`${PANEL}/api/health`).then((r) => r.ok, () => false);
  return {
    panel,
    auto: await get("auto", true),
    syncing: !!running,
    status: await get("status", {}),
    pending: (await get("pending", [])).length,
    sites: { x: await siteOn("x"), instagram: await siteOn("instagram"), pinterest: await siteOn("pinterest") },
    igFolder: await get("igFolder", null),
    igFolders: await get("igFolders", []),
    pinBoard: await get("pinBoard", null),
    pinBoards: await get("pinBoards", []),
  };
}

// ---------- Wiring ----------

async function schedule() {
  if (await get("auto", true)) chrome.alarms.create("sync", { periodInMinutes: SYNC_MINUTES, delayInMinutes: 1 });
  else await chrome.alarms.clear("sync");
}

// Requests the extension makes on its own should look like they come from the
// sites themselves, which is what their servers expect.
function sameSiteHeaders() {
  const rule = (id, urlFilter, origin) => ({
    id,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        { header: "origin", operation: "set", value: origin },
        { header: "referer", operation: "set", value: `${origin}/` },
      ],
    },
    condition: { urlFilter, tabIds: [-1], resourceTypes: ["xmlhttprequest"] },
  });
  return chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [1, 2, 3],
    addRules: [
      rule(1, "||x.com/i/api/", "https://x.com"),
      rule(2, "||www.instagram.com/api/", "https://www.instagram.com"),
      rule(3, "||www.pinterest.com/resource/", "https://www.pinterest.com"),
    ],
  });
}

sameSiteHeaders();
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "panel-page", title: "Save this site to Panel", contexts: ["page"] });
    chrome.contextMenus.create({ id: "panel-link", title: "Save link to Panel", contexts: ["link"] });
  });
  schedule().then(() => sync());
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.menuItemId === "panel-link" ? info.linkUrl : info.pageUrl ?? tab?.url;
  flashBadge(await savePage(url));
});
chrome.runtime.onStartup.addListener(schedule);
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "sync" || a.name === "sync-retry") sync();
  else if (a.name.startsWith("instagram-")) sync("instagram");
});

/** Folder names come from your Saved page; "Design" is picked until you choose another. */
async function rememberFolders(list) {
  const folders = (Array.isArray(list) ? list : [])
    .filter((f) => /^\d+$/.test(f?.id) && typeof f.name === "string")
    .map((f) => ({ id: f.id, name: f.name.slice(0, 80) }));
  if (!folders.length) return;
  await set("igFolders", folders);
  const chosen = (await chrome.storage.local.get("igFolder")).igFolder;
  const design = folders.find((f) => f.name.trim().toLowerCase() === "design");
  if (chosen === undefined && design) await set("igFolder", design);
}

const VALID_TEMPLATE = (t) =>
  t && /^[\w-]+$/.test(t.queryId) && t.features && typeof t.features === "object" && /^AAAA[\w%]+$/.test(t.bearer);

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const handlers = {
    save: () => saveFromClick(msg.url, msg.site),
    "save-page": () => savePage(msg.url),
    skip: () => skipBookmark(msg.url),
    "is-on": async () => ({ on: await siteOn(msg.site) }),
    "ig-folders": () => rememberFolders(msg.folders),
    "ig-folder": async () => {
      await set("igFolder", msg.folder ?? null);
      return state();
    },
    "pin-saved": () => savePin(msg.id, msg.boardId),
    "pin-board": async () => {
      await set("pinBoard", msg.board ?? null);
      return state();
    },
    "site-on": async () => {
      await set("sites", { ...(await get("sites", {})), [msg.site]: !!msg.on });
      return state();
    },
    "x-template": async () => VALID_TEMPLATE(msg.template) && set("xTemplate", msg.template),
    state,
    sync: async () => {
      await sync();
      return state();
    },
    import: async () => {
      sync(msg.site, true); // runs on; the popup follows its progress
      return state();
    },
    auto: async () => {
      await set("auto", !!msg.on);
      await schedule();
      return state();
    },
  };
  const handler = handlers[msg?.type];
  if (!handler) return false;
  handler().then(reply, (e) => reply({ ok: false, error: e.message }));
  return true;
});
