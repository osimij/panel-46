const $ = (s) => document.querySelector(s);
const ask = (msg) => chrome.runtime.sendMessage(msg);

function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}

function render(st) {
  const conn = $("#conn");
  conn.className = `conn ${st.panel ? "on" : "off"}`;
  $("#conn-text").textContent = st.panel ? "Running" : "Not running";

  const select = $("#folder");
  const options = [{ id: "", name: "All saved posts" }, ...st.igFolders];
  if (st.igFolder && !st.igFolders.some((f) => f.id === st.igFolder.id)) options.push(st.igFolder);
  const key = JSON.stringify(options);
  if (select.dataset.key !== key) {
    select.replaceChildren(...options.map((f) => new Option(f.name, f.id)));
    select.dataset.key = key;
  }
  if (document.activeElement !== select) select.value = st.igFolder?.id ?? "";
  $("#folder-hint").hidden = st.igFolders.length > 0;

  for (const site of ["x", "instagram"]) {
    $(`[data-site="${site}"]`).classList.toggle("off", !st.sites[site]);
    $(`[data-on="${site}"]`).checked = st.sites[site];
    const s = st.status[site] ?? {};
    const el = $(`[data-site="${site}"] .site-status`);
    let text = "Not synced yet";
    let tone = "";
    if (s.importing) {
      text = `Importing… ${s.added ?? 0} new so far`;
      tone = "busy";
    } else if (st.syncing) {
      text = "Checking…";
      tone = "busy";
    } else if (s.error) {
      text = s.error;
      tone = "bad";
    } else if (s.at) {
      text = `Checked ${ago(s.at)} · ${s.added ? `${s.added} new` : "nothing new"}`;
    }
    el.textContent = text;
    el.className = `site-status ${tone}`;
    $(`[data-import="${site}"]`).disabled = st.syncing || !st.panel;
  }

  const pending = $("#pending");
  pending.hidden = !st.pending;
  pending.textContent = `${st.pending} waiting for Panel to open`;
  $("#auto").checked = st.auto;
  $("#sync").disabled = st.syncing;
}

const refresh = async () => render(await ask({ type: "state" }));

$("#sync").addEventListener("click", async () => {
  $("#sync").disabled = true;
  ask({ type: "sync" }).then(render);
  setTimeout(refresh, 150);
});
for (const b of document.querySelectorAll("[data-import]"))
  b.addEventListener("click", async () => render(await ask({ type: "import", site: b.dataset.import })));
$("#auto").addEventListener("change", async (e) => render(await ask({ type: "auto", on: e.target.checked })));
for (const t of document.querySelectorAll("[data-on]"))
  t.addEventListener("change", async () => render(await ask({ type: "site-on", site: t.dataset.on, on: t.checked })));
$("#folder").addEventListener("change", async (e) => {
  const options = [...e.target.options];
  const picked = options.find((o) => o.value === e.target.value);
  const folder = picked?.value ? { id: picked.value, name: picked.text } : null;
  render(await ask({ type: "ig-folder", folder }));
});

// ---------- This page ----------

const POST = /^https:\/\/(x\.com|twitter\.com)\/[^/]+\/status\/|^https:\/\/www\.instagram\.com\/(p|reel)\//;

async function showPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:\/\//.test(tab.url) || tab.url.startsWith("http://127.0.0.1:4646")) return;
  const url = new URL(tab.url);
  $("#page").hidden = false;
  $("#page-title").textContent = tab.title || url.hostname;
  $("#page-host").textContent = url.hostname.replace(/^www\./, "");
  const icon = $("#page-icon");
  if (tab.favIconUrl && /^https?:/.test(tab.favIconUrl)) icon.src = tab.favIconUrl;
  else icon.classList.add("blank");
  icon.onerror = () => icon.classList.add("blank");
  const btn = $("#save-page");
  btn.textContent = POST.test(tab.url) ? "Save this post" : "Save this site";
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Saving…";
    const r = await ask({ type: "save-page", url: tab.url });
    const out = $("#page-result");
    out.hidden = false;
    out.className = `page-result ${r.ok || r.queued ? "" : "bad"}`;
    if (r.ok) {
      btn.textContent = r.existing ? "In Panel" : "Saved";
      out.replaceChildren(
        r.existing ? "Already in Panel. " : POST.test(tab.url) ? "Saving a copy now. " : "Panel is taking full-page screenshots now. ",
        Object.assign(document.createElement("a"), {
          href: `http://127.0.0.1:4646/?open=${r.id}`, target: "_blank", textContent: "View in Panel",
        }),
      );
    } else if (r.queued) {
      btn.textContent = "Waiting";
      out.textContent = "Panel isn't running. It'll be saved when Panel opens.";
    } else {
      btn.disabled = false;
      btn.textContent = "Try again";
      out.textContent = r.error || "Couldn't save this page.";
    }
  });
}

showPage();
refresh();
setInterval(refresh, 1000);
