// Runs inside Pinterest's own page. When you save a pin (to any board, or with the
// quick save), Pinterest answers with your new copy of it; pass its id on so Panel
// saves the same pin a sync would find.
(() => {
  const SAVE = /\/resource\/(RepinResource|PinResource)\/create\/?/;

  const tell = (body) => {
    try {
      const pin = (typeof body === "string" ? JSON.parse(body) : body)?.resource_response?.data;
      if (pin?.id && /^\d+$/.test(String(pin.id)))
        window.postMessage({ panel: "pin-saved", id: String(pin.id), boardId: pin.board?.id ? String(pin.board.id) : null }, location.origin);
    } catch {
      // Not worth breaking Pinterest over.
    }
  };

  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (String(method).toUpperCase() === "POST" && SAVE.test(String(url)))
      this.addEventListener("load", () => this.status < 300 && tell(this.responseType === "json" ? this.response : this.responseText));
    return open.apply(this, arguments);
  };

  const fetch0 = window.fetch;
  window.fetch = function (input, init) {
    const p = fetch0.apply(this, arguments);
    try {
      const url = typeof input === "string" ? input : input?.url ?? String(input);
      const method = (init?.method ?? (typeof input === "object" ? input.method : null) ?? "GET").toUpperCase();
      if (method === "POST" && SAVE.test(url))
        p.then((res) => res.ok && res.clone().json().then(tell, () => {})).catch(() => {});
    } catch {
      // ignore
    }
    return p;
  };
})();
