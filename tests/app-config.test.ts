import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../server/app.ts";
import { createDb } from "../server/db.ts";

test("配置 SMTP_HOST 时必须同时提供 SMTP_FROM", async () => {
  const saved = { host: process.env.SMTP_HOST, from: process.env.SMTP_FROM };
  const db = await createDb("memory://");
  try {
    process.env.SMTP_HOST = "smtp.example.test";
    delete process.env.SMTP_FROM;
    await assert.rejects(() => createApp(db, { testing: true }), /SMTP_FROM/);

    process.env.SMTP_FROM = "筑家手记 <noreply@example.test>";
    const app = await createApp(db, { testing: true });
    const health = await app.inject({ method: "GET", url: "/api/v1/health" });
    assert.equal(health.statusCode, 200);
    await app.close();
  } finally {
    if (saved.host === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = saved.host;
    if (saved.from === undefined) delete process.env.SMTP_FROM;
    else process.env.SMTP_FROM = saved.from;
    await db.close();
  }
});
