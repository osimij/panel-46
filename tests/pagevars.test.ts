import { expect, test } from "bun:test";
import { withVars } from "../server/pagevars.ts";

const page = `<!doctype html><html><head><style>
:root { --bg: #f4f1ea; --bg-2: #fff; --ink:#1a1a1a; --radius: 16px; --font-display: "Inter", sans-serif; }
@media (prefers-color-scheme: dark) { :root { --bg: #111; } }
.card { background: var(--bg-2); border-radius: var(--radius); }
</style></head><body><div class="card">--bg: not this</div></body></html>`;

test("a value is changed where the page declares it, and nothing else moves", () => {
  const out = withVars(page, { "--bg": "#000000", "--radius": "8px" });
  expect(out).toContain("--bg: #000000;");
  expect(out).toContain("--radius: 8px;");
  expect(out).toContain("--bg-2: #fff;");
  expect(out).toContain("{ :root { --bg: #111; } }");
  expect(out).toContain("--bg: not this");
  expect(out.length).toBe(page.length + "#000000".length - "#f4f1ea".length + "8px".length - "16px".length);
});

test("a tightly written declaration and a font stack both work", () => {
  const out = withVars(page, { "--ink": "#222", "--font-display": '"Golos Text", sans-serif' });
  expect(out).toContain("--ink: #222;");
  expect(out).toContain('--font-display: "Golos Text", sans-serif;');
});

test("a variable the page doesn't have yet is added", () => {
  expect(withVars(page, { "--accent": "#c8472b" })).toContain(":root { --accent: #c8472b; --bg: #f4f1ea;");
});

test("anything that could break out of the declaration is refused", () => {
  expect(() => withVars(page, { "--bg": "red; } body { display: none" })).toThrow();
  expect(() => withVars(page, { "bg": "red" })).toThrow();
  expect(() => withVars("<html><body>no styles</body></html>", { "--bg": "red" })).toThrow();
});
