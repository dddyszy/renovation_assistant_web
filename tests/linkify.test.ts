import assert from "node:assert/strict";
import { test } from "node:test";
import { linkify } from "../shared/linkify.ts";

test("识别网址并保留前后文字", () => {
  const parts = linkify("参考 https://example.com/a?b=1 的做法");
  assert.deepEqual(parts, [
    { type: "text", value: "参考 " },
    {
      type: "link",
      value: "https://example.com/a?b=1",
      href: "https://example.com/a?b=1",
    },
    { type: "text", value: " 的做法" },
  ]);
});

test("中文标点和句号不进入链接", () => {
  const parts = linkify("见https://example.com/x。另外http://a.cn/y，");
  assert.deepEqual(
    parts.filter((p) => p.type === "link").map((p) => p.value),
    ["https://example.com/x", "http://a.cn/y"],
  );
  assert.deepEqual(
    parts.filter((p) => p.type === "text").map((p) => p.value),
    ["见", "。另外", "，"],
  );
});

test("没有网址时原样返回，支持多行文本", () => {
  assert.deepEqual(linkify("第一行\n第二行"), [
    { type: "text", value: "第一行\n第二行" },
  ]);
});

test("同一段文字里的多个网址都能识别", () => {
  const parts = linkify("https://a.com/1 和 https://b.com/2");
  assert.deepEqual(
    parts.filter((p) => p.type === "link").map((p) => p.href),
    ["https://a.com/1", "https://b.com/2"],
  );
});
