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
  const credentials = { email: `${randomUUID()}@image.test`, password: "ImageTest!123" };
  await api("/auth/register", "POST", { ...credentials, nickname: label });
  return (await api("/auth/login", "POST", credentials)).cookie;
}
async function workspace() {
  const cookie = await account("图片主人");
  const fid = (await api("/families", "POST", { name: "图片家庭" }, cookie)).json.data.id;
  const project = await api(
    `/families/${fid}/projects`,
    "POST",
    { name: "图片项目", packageType: "half", budgetCents: 0, templateId: "blank" },
    cookie,
  );
  const base = `/families/${fid}/projects/${project.json.data.id}`;
  const column = await api(`${base}/note-columns`, "POST", { name: "图片专栏" }, cookie);
  const note = await api(
    `${base}/notes`,
    "POST",
    {
      title: "带图片的备忘",
      columnId: column.json.data.id,
      details: ["看这张图"],
      starred: false,
      status: "pending",
    },
    cookie,
  );
  return { cookie, fid, base, noteId: note.json.data.id as string };
}
async function upload(cookie: string, base: string, noteId: string, data = png) {
  return api(
    `${base}/notes/${noteId}/images`,
    "POST",
    {
      data,
      mime: "image/png",
      width: 1,
      height: 1,
    },
    cookie,
  );
}
before(async () => {
  db = await createDb(process.env.TEST_DATABASE_URL || "memory://");
  app = await createApp(db, { testing: true });
});
after(async () => {
  await app?.close();
  await db?.close();
});

test("上传图片后列表、原图和分享页都能读取", async () => {
  const { cookie, base, noteId } = await workspace();
  const created = await upload(cookie, base, noteId);
  assert.equal(created.status, 200, JSON.stringify(created.json));
  const imageId = created.json.data.id as string;
  assert.equal(created.json.data.mime, "image/png");

  const list = await api(`${base}/notes?columnId=&page=1`, "GET", undefined, cookie);
  const note = list.json.data.find((n: { id: string }) => n.id === noteId);
  assert.equal(note.images.length, 1);
  assert.equal(note.images[0].id, imageId);

  const image = await api(
    `${base}/notes/${noteId}/images/${imageId}`,
    "GET",
    undefined,
    cookie,
  );
  assert.equal(image.status, 200);
  assert.equal(image.headers["content-type"], "image/png");
  assert.equal(image.raw.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");

  const share = await api(`${base}/notes/${noteId}/share`, "POST", {}, cookie);
  const token = share.json.data.token as string;
  const shared = await api(`/share/notes/${token}`);
  assert.equal(shared.status, 200);
  assert.equal(shared.json.data.images.length, 1);

  const publicImage = await api(`/share/notes/${token}/images/${imageId}`);
  assert.equal(publicImage.status, 200);
  assert.equal(publicImage.headers["content-type"], "image/png");

  await api(`${base}/notes/${noteId}/share`, "DELETE", {}, cookie);
  assert.equal((await api(`/share/notes/${token}/images/${imageId}`)).status, 404);
});

test("图片类型与大小受限，删除后不再返回", async () => {
  const { cookie, base, noteId } = await workspace();
  const wrong = await api(
    `${base}/notes/${noteId}/images`,
    "POST",
    {
      data: png,
      mime: "image/jpeg",
      width: 1,
      height: 1,
    },
    cookie,
  );
  assert.equal(wrong.status, 422);

  const invalid = await upload(
    cookie,
    base,
    noteId,
    Buffer.from("not an image").toString("base64"),
  );
  assert.equal(invalid.status, 422);

  const uploaded = await upload(cookie, base, noteId);
  const imageId = uploaded.json.data.id as string;
  assert.equal(
    (await api(`${base}/notes/${noteId}/images/${imageId}`, "DELETE", undefined, cookie))
      .status,
    200,
  );
  assert.equal(
    (await api(`${base}/notes/${noteId}/images/${imageId}`, "GET", undefined, cookie))
      .status,
    404,
  );
});

test("并发上传也不会超过六张", async () => {
  const { cookie, base, noteId } = await workspace();
  const results = await Promise.all(
    Array.from({ length: 7 }, () => upload(cookie, base, noteId)),
  );
  assert.equal(results.filter((r) => r.status === 200).length, 6);
  assert.equal(results.filter((r) => r.status === 422).length, 1);
  const list = await api(`${base}/notes?columnId=&page=1`, "GET", undefined, cookie);
  const note = list.json.data.find((n: { id: string }) => n.id === noteId);
  assert.equal(note.images.length, 6);
});

test("只读成员不能上传，单条备忘最多六张", async () => {
  const { cookie, fid, base, noteId } = await workspace();
  for (let i = 0; i < 6; i++)
    assert.equal((await upload(cookie, base, noteId)).status, 200);
  assert.equal((await upload(cookie, base, noteId)).status, 422);

  const viewer = await account("图片访客");
  const invite = await api(
    `/families/${fid}/invitations`,
    "POST",
    { role: "viewer" },
    cookie,
  );
  const token = invite.json.data.path.split("/").pop();
  await api(`/invitations/${token}/accept`, "POST", {}, viewer);
  assert.equal((await upload(viewer, base, noteId)).status, 403);
});
