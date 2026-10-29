import { test } from "node:test";
import assert from "node:assert/strict";
import { toCents, parseNotes } from "../shared/domain.ts";
test("金额按十进制精确转换，并拒绝负数、科学计数和三位小数", () => {
  assert.equal(toCents("0.29"), 29);
  assert.equal(toCents("1000000.01"), 100000001);
  assert.equal(toCents("1.1"), 110);
  for (const s of ["-1", "1.001", "1e3", "Infinity", "abc", ""])
    assert.throws(() => toCents(s));
});
test("多行备忘保留重点和括号描述", () => {
  assert.deepEqual(parseNotes("* 厨房插座（洗碗机、咖啡机）\n2. 阳台布局")[0], {
    title: "厨房插座",
    details: ["洗碗机", "咖啡机"],
    starred: true,
    status: "pending",
  });
  assert.equal(parseNotes("\n\n").length, 0);
  assert.equal(parseNotes(Array(150).fill("需求").join("\n")).length, 100);
});
