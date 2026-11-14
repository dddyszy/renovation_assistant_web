import assert from "node:assert/strict";
import { test } from "node:test";
import { isAuthPath, isPublicPath } from "../src/router/public-paths.ts";

test("分享链接与登录页属于公开路径", () => {
  for (const path of [
    "/login",
    "/register",
    "/reset-password",
    "/share/note/abc123",
    "/share/note/abc123/",
  ])
    assert.equal(isPublicPath(path), true, path);
});

test("业务页面仍然是受保护路径", () => {
  for (const path of ["/", "/notes", "/ledger", "/statistics", "/share", "/share/note"])
    assert.equal(isPublicPath(path), false, path);
});

test("只有登录相关页面算认证页", () => {
  assert.equal(isAuthPath("/login"), true);
  assert.equal(isAuthPath("/share/note/abc"), false);
});
