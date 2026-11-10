// Pictures and files attached to a message for FRIDAY (chatfiles.ts). Nothing here sends a
// message that reaches Claude: only the attaching, and the refusals that come before Claude.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { startPanel, type TestPanel } from "./helpers.ts";

// One pixel, as a PNG.
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

let p: TestPanel;
beforeAll(async () => {
  p = await startPanel();
});
afterAll(async () => {
  await p?.stop();
});

const attach = async (...files: File[]) => {
  const form = new FormData();
  for (const f of files) form.append("file", f);
  return (await (await fetch(`${p.url}/api/chat-files`, { method: "POST", body: form })).json()) as any;
};

test("a picture and a text file are attached, shown, and can be taken back out", async () => {
  const up = await attach(new File([PIXEL], "shot.png", { type: "image/png" }), new File(["# Brief\nA calm hero."], "brief.md", { type: "text/markdown" }), new File([], "empty.txt"));
  expect(up.added).toHaveLength(2);
  expect(up.failed[0]).toContain("empty");
  const [pic, doc] = up.added;
  expect(pic.picture).toBe(true);
  expect(doc.picture).toBe(false);
  expect(doc.thumb_url).toBeNull();

  // The picture made for Claude, and the file itself.
  const view = await fetch(p.url + pic.thumb_url);
  expect(view.ok).toBe(true);
  expect(view.headers.get("content-type")).toBe("image/jpeg");
  const file = await fetch(p.url + doc.url);
  expect(await file.text()).toContain("A calm hero.");
  expect(p.db.query("SELECT text FROM chat_files WHERE id = ?").get(doc.id)).toEqual({ text: "# Brief\nA calm hero." });

  // Not sent yet: it can go.
  expect(((await (await p.send("DELETE", `/api/chat-files/${doc.id}`)).json()) as any).ok).toBe(true);
  expect((await fetch(p.url + doc.url)).status).toBe(404);
});

test("a page attached opens as plain text, so it can't act as Panel", async () => {
  const up = await attach(new File(["<script>alert(1)</script>"], "page.html", { type: "text/html" }));
  const res = await fetch(p.url + up.added[0].url);
  expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
});

test("only Panel's own page may attach", async () => {
  const form = new FormData();
  form.append("file", new File([PIXEL], "shot.png", { type: "image/png" }));
  const res = await fetch(`${p.url}/api/chat-files`, { method: "POST", body: form, headers: { origin: "https://example.com" } });
  expect(res.status).toBe(403);
});

test("a message needs words or files, and files that are gone are said to be", async () => {
  const chat = ((await (await p.send("POST", "/api/chats", {})).json()) as any).id;
  const empty = await p.send("POST", `/api/chats/${chat}/messages`, { text: "  ", context: {} });
  expect(((await empty.json()) as any).error).toBe("Write something first.");
  const gone = await p.send("POST", `/api/chats/${chat}/messages`, { text: "", context: { files: ["00000000000000ff"] } });
  expect(((await gone.json()) as any).error).toContain("Attach them again");
});
