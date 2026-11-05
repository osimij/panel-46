// Runs inside X's own page. When X loads your bookmarks, note how it asked for
// them, so Panel's background sync keeps working after X updates its app.
(() => {
  const open = XMLHttpRequest.prototype.open;
  const setHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__panelBookmarks = /\/graphql\/[\w-]+\/Bookmarks\?/.test(String(url)) ? String(url) : null;
    return open.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this.__panelBookmarks && name.toLowerCase() === "authorization") {
      try {
        const u = new URL(this.__panelBookmarks, location.origin);
        const template = {
          queryId: u.pathname.split("/")[4],
          features: JSON.parse(u.searchParams.get("features") ?? "{}"),
          bearer: String(value).replace(/^Bearer\s+/i, ""),
        };
        window.postMessage({ panel: "x-bookmarks", template }, location.origin);
      } catch {
        // Not worth breaking X over.
      }
    }
    return setHeader.apply(this, arguments);
  };
})();
