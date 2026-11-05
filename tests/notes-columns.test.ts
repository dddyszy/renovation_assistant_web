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

  const multiline = await api(
    `${base}/notes`,
    "POST",
    {
      title: "多行描述",
      columnId: target.id,
      details: ["第一段\n第二段", "另一个要点"],
      starred: false,
      status: "pending",
    },
    cookie,
  );
  assert.equal(multiline.status, 200, JSON.stringify(multiline.json));
  assert.deepEqual(multiline.json.data.details, ["第一段\n第二段", "另一个要点"]);

  const longDetail = "长".repeat(900);
  const longNote = await api(
    `${base}/notes`,
    "POST",
    {
      title: "长要点",
      columnId: target.id,
      details: [longDetail],
      starred: false,
      status: "pending",
    },
    cookie,
  );
  assert.equal(longNote.status, 200, JSON.stringify(longNote.json));
  assert.equal((longNote.json.data.details as string[])[0]!.length, 900);

  const tooLong = await api(
    `${base}/notes`,
    "POST",
    {
      title: "超长要点",
      columnId: target.id,
      details: ["长".repeat(1001)],
      starred: false,
      status: "pending",
    },
    cookie,
  );
  assert.equal(tooLong.status, 422);
});

async function account(nickname: string) {
  const credentials = {
    email: `${randomUUID()}@columns.test`,
    password: "ColumnTest!123",
  };
  await api("/auth/register", "POST", { ...credentials, nickname });
  return (await api("/auth/login", "POST", credentials)).cookie;
}

test("只读成员不能删除专栏，删除不存在的专栏返回 404", async () => {
  const { cookie, base } = await workspace();
  const target = await column(base, cookie, "只读不可删");
  const viewer = await account("只读成员");
  const familyPath = base.split("/projects/")[0]!;
  const invite = await api(
    `${familyPath}/invitations`,
    "POST",
    { role: "viewer" },
    cookie,
  );
  const token = invite.json.data.path.split("/").pop();
  assert.equal(
    (await api(`/invitations/${token}/accept`, "POST", {}, viewer)).status,
    200,
  );
  assert.equal(
    (
      await api(
        `${base}/note-columns/${target.id}`,
        "DELETE",
        { version: target.version },
        viewer,
      )
    ).status,
    403,
  );
  assert.equal(
    (await api(`${base}/note-columns/${randomUUID()}`, "DELETE", { version: 1 }, cookie))
      .status,
    404,
  );
});

test("过期版本删除返回 409，重复删除返回 404", async () => {
  const { cookie, base } = await workspace();
  const target = await column(base, cookie, "版本专栏");
  await api(
    `${base}/note-columns/${target.id}`,
    "PATCH",
    { name: "版本专栏改名", version: target.version },
    cookie,
  );
  const stale = await api(
    `${base}/note-columns/${target.id}`,
    "DELETE",
    { version: target.version },
    cookie,
  );
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error.code, "VERSION_CONFLICT");

  const fresh = await api(`${base}/note-columns`, "GET", undefined, cookie);
  const current = (fresh.json.data as { id: string; version: number }[]).find(
    (c) => c.id === target.id,
  )!;
  const removed = await api(
    `${base}/note-columns/${target.id}`,
    "DELETE",
    { version: current.version },
    cookie,
  );
  assert.equal(removed.status, 200);
  const again = await api(
    `${base}/note-columns/${target.id}`,
    "DELETE",
    { version: removed.json.data.version },
    cookie,
  );
  assert.equal(again.status, 404);
});

test("删除后可用同名新建，撤销旧专栏时不能破坏名称唯一性", async () => {
  const { cookie, base } = await workspace();
  const target = await column(base, cookie, "重名专栏");
  const removed = await api(
    `${base}/note-columns/${target.id}`,
    "DELETE",
    { version: target.version },
    cookie,
  );
  assert.equal(removed.status, 200);
  const reused = await api(`${base}/note-columns`, "POST", { name: "重名专栏" }, cookie);
  assert.equal(reused.status, 200, JSON.stringify(reused.json));

  const restore = await api(
    `${base}/note-columns/${target.id}/restore`,
    "POST",
    { version: removed.json.data.version },
    cookie,
  );
  assert.equal(restore.status, 409, JSON.stringify(restore.json));
  assert.equal(restore.json.error.code, "COLUMN_NAME_TAKEN");
});

test("专栏删除后不能单独恢复其中的备忘", async () => {
  const { cookie, base } = await workspace();
  const target = await column(base, cookie, "整栏删除");
  const item = await note(base, cookie, target.id, "随栏删除");
  const removed = await api(
    `${base}/note-columns/${target.id}`,
    "DELETE",
    { version: target.version, confirm: true },
    cookie,
  );
  assert.equal(removed.status, 200);
  const list = await api(
    `${base}/notes?columnId=${target.id}&deleted=true`,
    "GET",
    undefined,
    cookie,
  );
  const deleted = (list.json.data as { id: string; version: number }[]).find(
    (n) => n.id === item.id,
  )!;
  const restore = await api(
    `${base}/notes/${item.id}/restore`,
    "POST",
    { version: deleted.version },
    cookie,
  );
  assert.equal(restore.status, 404, JSON.stringify(restore.json));
});

test("专栏创建拒绝重名并限制 20 个", async () => {
  const { cookie, base } = await workspace();
  const duplicate = await api(
    `${base}/note-columns`,
    "POST",
    { name: "事前确认" },
    cookie,
  );
  assert.equal(duplicate.status, 422);
  assert.equal(duplicate.json.error.code, "INVALID_COLUMN");

  const current = (await api(`${base}/note-columns`, "GET", undefined, cookie)).json
    .data as unknown[];
  for (let i = current.length; i < 20; i++)
    assert.equal(
      (await api(`${base}/note-columns`, "POST", { name: `专栏${i}` }, cookie)).status,
      200,
    );
  const overflow = await api(
    `${base}/note-columns`,
    "POST",
    { name: "第二十一个" },
    cookie,
  );
  assert.equal(overflow.status, 422);
  assert.equal(overflow.json.error.code, "INVALID_COLUMN");
});

test("专栏改名与排序校验版本", async () => {
  const { cookie, base } = await workspace();
  const target = await column(base, cookie, "待改名");
  const renamed = await api(
    `${base}/note-columns/${target.id}`,
    "PATCH",
    { name: "已改名", version: target.version },
    cookie,
  );
  assert.equal(renamed.status, 200, JSON.stringify(renamed.json));
  assert.equal(renamed.json.data.name, "已改名");

  const stale = await api(
    `${base}/note-columns/${target.id}`,
    "PATCH",
    { name: "再次改名", version: target.version },
    cookie,
  );
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error.code, "VERSION_CONFLICT");

  const listed = (await api(`${base}/note-columns`, "GET", undefined, cookie)).json
    .data as { id: string; version: number }[];
  const items = [...listed].reverse().map((c) => ({ id: c.id, version: c.version }));
  const sorted = await api(`${base}/note-columns/reorder`, "POST", { items }, cookie);
  assert.equal(sorted.status, 200, JSON.stringify(sorted.json));
  const after = (await api(`${base}/note-columns`, "GET", undefined, cookie)).json
    .data as { id: string }[];
  assert.equal(after[0]!.id, listed.at(-1)!.id);

  const partial = await api(
    `${base}/note-columns/reorder`,
    "POST",
    { items: [items[0]] },
    cookie,
  );
  assert.equal(partial.status, 409);
});

test("专栏改名为已存在的名称时返回冲突", async () => {
  const { cookie, base } = await workspace();
  const target = await column(base, cookie, "普通专栏");
  const conflict = await api(
    `${base}/note-columns/${target.id}`,
    "PATCH",
    { name: "事前确认", version: target.version },
    cookie,
  );
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.error.code, "CONFLICT");
});
