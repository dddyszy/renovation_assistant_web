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
async function account(label: string) {
  const credentials = { email: `${randomUUID()}@share.test`, password: "ShareTest!123" };
  await api("/auth/register", "POST", { ...credentials, nickname: label });
  return (await api("/auth/login", "POST", credentials)).cookie;
}
async function workspace() {
  const cookie = await account("分享者");
  const fid = (await api("/families", "POST", { name: "分享家庭" }, cookie)).json.data.id;
  const project = await api(
    `/families/${fid}/projects`,
    "POST",
    { name: "分享项目", packageType: "half", budgetCents: 0, templateId: "blank" },
    cookie,
  );
  const base = `/families/${fid}/projects/${project.json.data.id}`;
  const column = await api(`${base}/note-columns`, "POST", { name: "分享专栏" }, cookie);
  const note = await api(
    `${base}/notes`,
    "POST",
    {
      title: "要分享的备忘",
      columnId: column.json.data.id,
      details: ["参考 https://example.com/x", "第二段\n换行内容"],
      starred: true,
      status: "pending",
    },
    cookie,
  );
  return {
    cookie,
    fid,
    base,
    noteId: note.json.data.id as string,
    noteVersion: note.json.data.version as number,
  };
}
before(async () => {
  db = await createDb(process.env.TEST_DATABASE_URL || "memory://");
  app = await createApp(db, { testing: true });
});
after(async () => {
  await app?.close();
  await db?.close();
});

test("分享链接无需登录即可只读查看，撤销后失效", async () => {
  const { cookie, base, noteId } = await workspace();
  const share = await api(`${base}/notes/${noteId}/share`, "POST", { days: 7 }, cookie);
  assert.equal(share.status, 200, JSON.stringify(share.json));
  const lifetime = Date.parse(share.json.data.expiresAt) - Date.now();
  assert.ok(lifetime > 6.9 * 24 * 3600e3 && lifetime < 7 * 24 * 3600e3 + 5000);
  assert.equal(
    (await api(`${base}/notes/${noteId}/share`, "POST", { days: 1 }, cookie)).status,
    422,
  );
  const token = share.json.data.token as string;
  assert.equal(share.json.data.path, `/share/note/${token}`);

  const shared = await api(`/share/notes/${token}`);
  assert.equal(shared.status, 200, JSON.stringify(shared.json));
  assert.equal(shared.json.data.title, "要分享的备忘");
  assert.equal(shared.json.data.columnName, "分享专栏");
  assert.equal(shared.json.data.starred, true);
  assert.deepEqual(shared.json.data.details, [
    "参考 https://example.com/x",
    "第二段\n换行内容",
  ]);

  const revoked = await api(`${base}/notes/${noteId}/share`, "DELETE", {}, cookie);
  assert.equal(revoked.status, 200);
  assert.equal((await api(`/share/notes/${token}`)).status, 404);

  const permanent = await api(
    `${base}/notes/${noteId}/share`,
    "POST",
    { days: 0 },
    cookie,
  );
  assert.equal(permanent.status, 200);
  assert.equal(permanent.json.data.expiresAt, null);
  assert.equal((await api(`/share/notes/${permanent.json.data.token}`)).status, 200);
});

test("重新分享会作废旧链接，过期或删除的备忘不可访问", async () => {
  const { cookie, base, noteId, noteVersion } = await workspace();
  const first = await api(`${base}/notes/${noteId}/share`, "POST", {}, cookie);
  const oldToken = first.json.data.token as string;
  const second = await api(`${base}/notes/${noteId}/share`, "POST", {}, cookie);
  const newToken = second.json.data.token as string;
  assert.notEqual(oldToken, newToken);
  assert.equal((await api(`/share/notes/${oldToken}`)).status, 404);
  assert.equal((await api(`/share/notes/${newToken}`)).status, 200);

  await db.query(
    "UPDATE note_shares SET expires_at=now()-interval '1 day' WHERE note_id=$1",
    [noteId],
  );
  assert.equal((await api(`/share/notes/${newToken}`)).status, 404);

  const again = await api(`${base}/notes/${noteId}/share`, "POST", {}, cookie);
  const liveToken = again.json.data.token as string;
  const deleted = await api(
    `${base}/notes/${noteId}`,
    "DELETE",
    { version: noteVersion },
    cookie,
  );
  assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
  assert.equal((await api(`/share/notes/${liveToken}`)).status, 404);
});

test("只读成员不能创建分享链接", async () => {
  const { cookie, fid, base, noteId } = await workspace();
  const viewer = await account("只读访客");
  const invite = await api(
    `/families/${fid}/invitations`,
    "POST",
    { role: "viewer" },
    cookie,
  );
  const token = invite.json.data.path.split("/").pop();
  assert.equal(
    (await api(`/invitations/${token}/accept`, "POST", {}, viewer)).status,
    200,
  );
  const denied = await api(`${base}/notes/${noteId}/share`, "POST", {}, viewer);
  assert.equal(denied.status, 403);
});
