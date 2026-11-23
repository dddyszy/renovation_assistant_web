import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import type { HTTPMethods, InjectOptions } from "fastify";
import { createApp } from "../server/app.ts";
import { createDb, type Db } from "../server/db.ts";

let db: Db, app: Awaited<ReturnType<typeof createApp>>;
const headers = { origin: "http://localhost:5173", "x-requested-with": "zhu-jia-web" };
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
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
  const isJson = String(response.headers["content-type"] || "").includes("json");
  return {
    status: response.statusCode,
    json: isJson ? response.json() : {},
    headers: response.headers,
    raw: response.rawPayload,
    cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join(";"),
  };
}
async function account(label: string) {
  const credentials = {
    email: `${randomUUID()}@column.test`,
    password: "ColumnTest!123",
  };
  await api("/auth/register", "POST", { ...credentials, nickname: label });
  return (await api("/auth/login", "POST", credentials)).cookie;
}
async function workspace() {
  const cookie = await account("专栏主人");
  const fid = (await api("/families", "POST", { name: "专栏家庭" }, cookie)).json.data.id;
  const project = await api(
    `/families/${fid}/projects`,
    "POST",
    { name: "专栏项目", packageType: "half", budgetCents: 0, templateId: "blank" },
    cookie,
  );
  const base = `/families/${fid}/projects/${project.json.data.id}`;
  const column = await api(`${base}/note-columns`, "POST", { name: "厨房确认" }, cookie);
  const columnId = column.json.data.id as string;
  const notes = [];
  for (const [title, starred] of [
    ["插座高度", true],
    ["台面颜色", false],
  ]) {
    notes.push(
      (
        await api(
          `${base}/notes`,
          "POST",
          {
            title,
            columnId,
            details: [`${title}的细节`],
            starred,
            status: "pending",
          },
          cookie,
        )
      ).json.data.id as string,
    );
  }
  const upload = await api(
    `${base}/notes/${notes[0]}/images`,
    "POST",
    {
      data: png,
      mime: "image/png",
      width: 1,
      height: 1,
    },
    cookie,
  );
  return { cookie, fid, base, columnId, notes, imageId: upload.json.data.id as string };
}
before(async () => {
  db = await createDb(process.env.TEST_DATABASE_URL || "memory://");
  app = await createApp(db, { testing: true });
});
after(async () => {
  await app?.close();
  await db?.close();
});

test("专栏分享免登录查看全部备忘和图片，撤销后失效", async () => {
  const { cookie, base, columnId, notes, imageId } = await workspace();
  const share = await api(`${base}/note-columns/${columnId}/share`, "POST", {}, cookie);
  assert.equal(share.status, 200, JSON.stringify(share.json));
  const token = share.json.data.token as string;
  assert.equal(share.json.data.path, `/share/column/${token}`);

  const shared = await api(`/share/columns/${token}`);
  assert.equal(shared.status, 200);
  assert.equal(shared.json.data.name, "厨房确认");
  assert.equal(shared.json.data.total, 2);
  assert.deepEqual(
    shared.json.data.notes.map((n: { id: string }) => n.id),
    [notes[0], notes[1]],
  );
  assert.equal(shared.json.data.notes[0].images.length, 1);

  const image = await api(`/share/columns/${token}/images/${imageId}`);
  assert.equal(image.status, 200);
  assert.equal(image.headers["content-type"], "image/png");

  await api(`${base}/note-columns/${columnId}/share`, "DELETE", {}, cookie);
  assert.equal((await api(`/share/columns/${token}`)).status, 404);
  assert.equal((await api(`/share/columns/${token}/images/${imageId}`)).status, 404);
});

test("重新分享作废旧链接，删除的备忘和专栏不再出现", async () => {
  const { cookie, base, columnId, notes } = await workspace();
  const first = await api(`${base}/note-columns/${columnId}/share`, "POST", {}, cookie);
  const oldToken = first.json.data.token as string;
  const second = await api(`${base}/note-columns/${columnId}/share`, "POST", {}, cookie);
  const token = second.json.data.token as string;
  assert.notEqual(oldToken, token);
  assert.equal((await api(`/share/columns/${oldToken}`)).status, 404);

  const deleted = await api(
    `${base}/notes/${notes[0]}`,
    "DELETE",
    { version: 1 },
    cookie,
  );
  assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
  const shared = await api(`/share/columns/${token}`);
  assert.equal(shared.json.data.notes.length, 1);
  assert.equal(shared.json.data.total, 1);

  await api(
    `${base}/note-columns/${columnId}`,
    "DELETE",
    { version: 1, confirm: true },
    cookie,
  );
  assert.equal((await api(`/share/columns/${token}`)).status, 404);
});

test("只读成员不能创建专栏分享，过期链接返回 404", async () => {
  const { cookie, fid, base, columnId } = await workspace();
  const share = await api(`${base}/note-columns/${columnId}/share`, "POST", {}, cookie);
  const token = share.json.data.token as string;
  await db.query(
    "UPDATE note_column_shares SET expires_at=now()-interval '1 day' WHERE column_id=$1",
    [columnId],
  );
  assert.equal((await api(`/share/columns/${token}`)).status, 404);

  const viewer = await account("专栏访客");
  const invite = await api(
    `/families/${fid}/invitations`,
    "POST",
    { role: "viewer" },
    cookie,
  );
  const inviteToken = invite.json.data.path.split("/").pop();
  await api(`/invitations/${inviteToken}/accept`, "POST", {}, viewer);
  assert.equal(
    (await api(`${base}/note-columns/${columnId}/share`, "POST", {}, viewer)).status,
    403,
  );
});
