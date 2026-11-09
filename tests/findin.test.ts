import { expect, test } from "bun:test";
import { findIn } from "../server/materials.ts";

const spec = `${"Вступление. ".repeat(400)}
5.2 Экран подписания
Пользователь подписывает Акт выполненных работ через IMZO. ${"Детали. ".repeat(300)}
7.1 Ошибки
Если подпись не прошла, экран подписания показывает ошибку. ${"Хвост. ".repeat(300)}`;

test("a phrase is found in a long document, with its offset, case and spacing aside", () => {
  const hits = findIn(spec, "экран   ПОДПИСАНИЯ");
  expect(hits.length).toBe(2);
  expect(hits[0]!.text).toContain("5.2 Экран подписания");
  expect(spec.slice(hits[0]!.at, hits[0]!.at + 20)).toBe(hits[0]!.text.slice(0, 20));
  expect(hits[1]!.text).toContain("подпись не прошла");
});

test("several words close together are found in any order; nothing found says so by being empty", () => {
  expect(findIn(spec, "IMZO акт").length).toBe(1);
  expect(findIn(spec, "логотип")).toEqual([]);
});
