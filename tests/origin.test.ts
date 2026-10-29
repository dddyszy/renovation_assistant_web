import assert from "node:assert/strict";
import { test } from "node:test";
import { readAppOrigin } from "../server/lib/origin.ts";

test("浏览器入口支持 HTTP 与代理域名，规范化根路径及默认端口", () => {
  assert.equal(readAppOrigin(undefined, false), "http://localhost:5173");
  assert.equal(
    readAppOrigin("http://192.168.1.10:8080/", true),
    "http://192.168.1.10:8080",
  );
  assert.equal(
    readAppOrigin("http://home.example.com:80/", true),
    "http://home.example.com",
  );
  assert.equal(
    readAppOrigin("https://home.example.com/", true),
    "https://home.example.com",
  );
});

test("生产入口必须显式设置，拒绝无效协议、凭据、子路径及查询参数", () => {
  assert.throws(() => readAppOrigin(undefined, true), /需要设置 APP_ORIGIN/);
  for (const origin of [
    "home.example.com",
    "ftp://home.example.com",
    "http://user:secret@home.example.com",
    "http://home.example.com/app",
    "http://home.example.com?redirect=external",
    "http://home.example.com#fragment",
  ])
    assert.throws(() => readAppOrigin(origin, true), /APP_ORIGIN 必须/);
});
