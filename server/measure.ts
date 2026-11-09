// Sites saved before Panel measured them (sitefacts.ts): visited one at a time, quietly, at
// desktop size and without taking pictures, until every site has its fonts and values.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, now, reindex } from "./db.ts";
import { Cdp, chromePath, devtoolsUrl, evaluate, measureFacts, trackNetwork, VIEWPORTS } from "./site.ts";
import { saveMeasured, type Measured } from "./sitefacts.ts";

/** Open the page at desktop size and measure it, without taking pictures. */
async function visit(url: string): Promise<Omit<Measured, "at"> | null> {
  const exe = chromePath();
  if (!exe) return null;
  const vp = VIEWPORTS[0]!;
  const profile = mkdtempSync(join(tmpdir(), "panel-measure-"));
  const proc = Bun.spawn(
    [exe, "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--hide-scrollbars", "--mute-audio", "--disable-background-networking", "--disable-sync", "about:blank"],
    { stdout: "ignore", stderr: "pipe" },
  );
  const cdp = new Cdp();
  // Whatever the page does, this Chrome doesn't outlive the visit.
  const guard = setTimeout(() => proc.kill(), 85_000);
  try {
    await cdp.connect(await devtoolsUrl(proc.stderr));
    const { targetId } = await cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    const s = <T = unknown>(method: string, params: object = {}) => cdp.send<T>(method, params, sessionId);
    await s("Page.enable");
    await s("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: false });
    await s("Network.enable");
    const net = trackNetwork(cdp, sessionId);
    try {
      const loaded = cdp.waitFor("Page.loadEventFired", sessionId, 30_000);
      const nav = await Promise.race([s<{ errorText?: string }>("Page.navigate", { url }), Bun.sleep(40_000).then(() => ({ errorText: "too slow" }))]);
      if (nav.errorText) return null;
      await loaded.catch(() => {});
      await net.idle(1, 700, 12_000);
      await evaluate(s, "document.fonts.ready.then(() => true)", 8000).catch(() => {});
    } finally {
      net.stop();
    }
    return await measureFacts(s).catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(guard);
    cdp.close();
    proc.kill();
    await Promise.race([proc.exited, Bun.sleep(3000)]);
    rmSync(profile, { recursive: true, force: true });
  }
}

let busy = false;
async function measureNext() {
  if (busy || !chromePath()) return;
  const r = db
    .query<{ id: string; source_url: string }, []>("SELECT id, source_url FROM refs WHERE site = 1 AND measured IS NULL AND source_url IS NOT NULL AND status != 'pending' ORDER BY created_at DESC LIMIT 1")
    .get();
  if (!r) return;
  busy = true;
  try {
    // The same address saved twice is measured once.
    const twin = db.query<{ measured: string }, [string, string]>("SELECT measured FROM refs WHERE source_url = ? AND id != ? AND measured IS NOT NULL AND measured != '{}' LIMIT 1").get(r.source_url, r.id);
    if (twin) {
      db.run("UPDATE refs SET measured = ?, updated_at = ? WHERE id = ?", [twin.measured, now(), r.id]);
      reindex(r.id);
    } else {
      // A page that never settles mustn't hold up the rest: give each site a minute and a half.
      saveMeasured(r.id, await Promise.race([visit(r.source_url), Bun.sleep(90_000).then(() => null)]));
    }
  } catch {
    db.run("UPDATE refs SET measured = '{}' WHERE id = ?", [r.id]);
  } finally {
    busy = false;
  }
}

/** One older site every little while, so it never gets in the way of saving or sketching. */
export function startMeasuring() {
  setInterval(() => void measureNext(), 25_000);
}
