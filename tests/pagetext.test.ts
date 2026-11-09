import { expect, test } from "bun:test";
import { withText } from "../server/pagetext.ts";

const page = `<!doctype html><html><head><title>T</title></head><body>
<nav><a href="#">Главная</a><a href="#">О нас</a></nav>
<main>
  <h1 class="hero">Документы
    без <em>очередей</em></h1>
  <p>Один</p><p>Два &amp; три</p>
  <p>Один</p>
</main>
<script>document.querySelector("nav").insertAdjacentHTML("beforeend", "<span>Войти</span>");</script>
</body></html>`;

test("words are changed where the part sits, inline tags and all", () => {
  const out = withText(page, {
    path: "body > main:nth-child(2) > h1:nth-child(1)",
    before: "Документы\n    без <em>очередей</em>",
    after: "Справки без <em>очередей</em>",
    beforeText: "Документы без очередей",
    afterText: "Справки без очередей",
  });
  expect(out).toContain('<h1 class="hero">Справки без <em>очередей</em></h1>');
  expect(out).toContain("<p>Два &amp; три</p>");
});

test("when the place doesn't hold those words, the words themselves are found", () => {
  const out = withText(page, { path: "body > main:nth-child(9) > p:nth-child(1)", before: "Два &amp; три", after: "Два и три", beforeText: "Два & три", afterText: "Два и три" });
  expect(out).toContain("<p>Два и три</p>");
});

test("words a script writes are changed in the script, if they're plain", () => {
  const out = withText(page, { path: "body > nav:nth-child(1) > span:nth-child(3)", before: "Войти", after: "Вход", beforeText: "Войти", afterText: "Вход" });
  expect(out).toContain('"<span>Вход</span>"');
  expect(() => withText(page, { path: "", before: "Войти", after: 'Вход "сюда"', beforeText: "Войти", afterText: 'Вход "сюда"' })).toThrow(/script/);
});

test("words that appear twice, or not at all, are refused", () => {
  expect(() => withText(page, { path: "", before: "Один", after: "Раз", beforeText: "Один", afterText: "Раз" })).toThrow(/more than once/);
  expect(() => withText(page, { path: "", before: "Нет такого", after: "x", beforeText: "Нет такого", afterText: "x" })).toThrow(/Couldn't find/);
  expect(() => withText(page, { path: "", before: "Один", after: "<script>x</script>", beforeText: "Один", afterText: "x" })).toThrow(/Only words/);
});
