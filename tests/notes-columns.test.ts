import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import type { HTTPMethods, InjectOptions } from "fastify";
import { createApp } from "../server/app.ts";
import { createDb, type Db } from "../server/db.ts";

let db: Db, app: Awaited<ReturnType<typeof createApp>>;
const headers = { origin: "http://localhost:5173", "x-requested-with": "zhu-jia-web" };
async function api(
  path: string,
  method: HTTPMethods = "GET",
  payload?: InjectOptions["payload"],
  cookie = "",
) {
  const response = await app.inject({
    method,
    url: `/api/v1${path}`,
    headers: { ...headers, cookie },
    payload,
  });
  return {
    status: response.statusCode,
    json: response.json(),
    cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join(";"),
  };
}
async function workspace() {
  const credentials = {
    email: `${randomUUID()}@columns.test`,
    password: "ColumnTest!123",
  };
  assert.equal(
    (await api("/auth/register", "POST", { ...credentials, nickname: "专栏验收" }))
      .status,
    200,
  );
  const cookie = (await api("/auth/login", "POST", credentials)).cookie;
  const family = await api("/families", "POST", { name: "专栏家庭" }, cookie);
  const fid = family.json.data.id;
  const project = await api(
    `/families/${fid}/projects`,
    "POST",
    { name: "专栏项目", packageType: "half", budgetCents: 0, templateId: "blank" },
    cookie,
  );
  assert.equal(project.status, 200);
  return { cookie, base: `/families/${fid}/projects/${project.json.data.id}` };
}
async function column(base: string, cookie: string, name: string) {
  const created = await api(`${base}/note-columns`, "POST", { name }, cookie);
  assert.equal(created.status, 200, JSON.stringify(created.json));
  return created.json.data as { id: string; version: number; name: string };
}
async function note(base: string, cookie: string, columnId: string, title: string) {
  const created = await api(
    `${base}/notes`,
    "POST",
    { title, columnId, details: [], starred: false, status: "pending" },
    cookie,
  );
  assert.equal(created.status, 200, JSON.stringify(created.json));
  return created.json.data as { id: string; version: number };
}
async function names(base: string, cookie: string) {
  const list = await api(`${base}/note-columns`, "GET", undefined, cookie);
  return (list.json.data as { name: string }[]).map((c) => c.name);
}
before(async () => {
  db = await createDb(process.env.TEST_DATABASE_URL || "memory://");
  app = await createApp(db, { testing: true });
});
after(async () => {
  await app?.close();
  await db?.close();
});

test("专栏删除走 note-columns 接口并可以撤销", async () => {
  const { cookie, base } = await workspace();
  const target = await column(base, cookie, "待删除专栏");

  const removed = await api(
    `${base}/note-columns/${target.id}`,
    "DELETE",
    { version: target.version },
    cookie,
  );
  assert.equal(removed.status, 200, JSON.stringify(removed.json));
  assert.equal(removed.json.data.deletedAt != null, true);
  assert.equal((await names(base, cookie)).includes("待删除专栏"), false);

  const restored = await api(
    `${base}/note-columns/${target.id}/restore`,
    "POST",
    { version: removed.json.data.version },
    cookie,
  );
  assert.equal(restored.status, 200, JSON.stringify(restored.json));
  assert.equal((await names(base, cookie)).includes("待删除专栏"), true);
});

test("非空专栏需确认删除，撤销时只恢复随专栏删除的备忘", async () => {
  const { cookie, base } = await workspace();
  const target = await column(base, cookie, "有备忘的专栏");
  const kept = await note(base, cookie, target.id, "随专栏删除");
  const earlier = await note(base, cookie, target.id, "更早单独删除");

  const single = await api(
    `${base}/notes/${earlier.id}`,
    "DELETE",
    { version: earlier.version },
    cookie,
  );
  assert.equal(single.status, 200, JSON.stringify(single.json));

  const blocked = await api(
    `${base}/note-columns/${target.id}`,
    "DELETE",
    { version: target.version },
    cookie,
  );
  assert.equal(blocked.status, 409, JSON.stringify(blocked.json));
  assert.equal(blocked.json.error.code, "COLUMN_NOT_EMPTY");

  const removed = await api(
    `${base}/note-columns/${target.id}`,
    "DELETE",
    { version: target.version, confirm: true },
    cookie,
  );
  assert.equal(removed.status, 200, JSON.stringify(removed.json));

  const deletedNotes = await api(
    `${base}/notes?columnId=${target.id}&deleted=true`,
    "GET",
    undefined,
    cookie,
  );
  assert.deepEqual(
    (deletedNotes.json.data as { id: string }[]).map((n) => n.id).sort(),
    [kept.id, earlier.id].sort(),
  );

  const restored = await api(
    `${base}/note-columns/${target.id}/restore`,
    "POST",
    { version: removed.json.data.version },
    cookie,
  );
  assert.equal(restored.status, 200, JSON.stringify(restored.json));

  const active = await api(
    `${base}/notes?columnId=${target.id}`,
    "GET",
    undefined,
    cookie,
  );
  assert.deepEqual(
    (active.json.data as { id: string }[]).map((n) => n.id),
    [kept.id],
  );
  const stillDeleted = await api(
    `${base}/notes?columnId=${target.id}&deleted=true`,
    "GET",
    undefined,
    cookie,
  );
  assert.deepEqual(
    (stillDeleted.json.data as { id: string }[]).map((n) => n.id),
    [earlier.id],
  );
});
