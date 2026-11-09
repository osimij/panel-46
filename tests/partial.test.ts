import { expect, test } from "bun:test";
import { partialHtml } from "../server/partial.ts";

const page = `<!doctype html><html><head><title>Тест "кавычки"</title><style>body{font-family:"Inter";color:#111}\n.a::before{content:"\\201C"}</style></head><body><h1>Ҳуҷҷат — “подпись”</h1>${"<p>строка текста</p>".repeat(30)}</body></html>`;
const whole = JSON.stringify({ project: "X", title: "T", html: page, tries: "after" });

test("a finished input gives back the page exactly", () => {
  expect(partialHtml(whole)).toBe(page);
});

test("every cut-off point gives a prefix of the page, never a broken one", () => {
  const start = whole.indexOf('"html"');
  for (let cut = start; cut <= whole.length; cut += 7) {
    const got = partialHtml(whole.slice(0, cut));
    if (got !== null) expect(page.startsWith(got)).toBe(true);
  }
});

test("too little to show yet is nothing", () => {
  expect(partialHtml('{"project":"X","html":"<!doctype html><html>')).toBeNull();
  expect(partialHtml('{"project":"X","title":"no page"}')).toBeNull();
});
