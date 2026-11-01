import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.ts";
import { createDb } from "../server/db.ts";

const headers = { origin: "http://localhost:5173", "x-requested-with": "zhu-jia-web" };

test("生产环境不提供邮件找回，开发环境返回本地重置链接", async () => {
  const saved = { nodeEnv: process.env.NODE_ENV, origin: process.env.APP_ORIGIN };
  const db = await createDb("memory://");
  try {
    process.env.NODE_ENV = "production";
    process.env.APP_ORIGIN = "http://localhost:5173";
    const production = await createApp(db, { testing: true });
    const blocked = await production.inject({
      method: "POST",
      url: "/api/v1/auth/reset/request",
      headers,
      payload: { email: "nobody@example.test" },
    });
    assert.equal(blocked.statusCode, 503);
    assert.equal(blocked.json().error.code, "MAIL_NOT_CONFIGURED");
    await production.close();

    process.env.NODE_ENV = "test";
    const development = await createApp(db, { testing: true });
    const credentials = {
      email: `${randomUUID()}@reset.test`,
      password: "ResetTest!123",
    };
    await development.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers,
      payload: { ...credentials, nickname: "找回测试" },
    });
    const reset = await development.inject({
      method: "POST",
      url: "/api/v1/auth/reset/request",
      headers,
      payload: { email: credentials.email },
    });
    assert.equal(reset.statusCode, 200, reset.body);
    assert.equal(typeof reset.json().data.devToken, "string");
    await development.close();
  } finally {
    if (saved.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved.nodeEnv;
    if (saved.origin === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = saved.origin;
    await db.close();
  }
});
