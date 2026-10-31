import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import type { HTTPMethods, InjectOptions } from "fastify";
import { createApp } from "../server/app.ts";
import { createDb, type Db } from "../server/db.ts";
import type { Row } from "../server/db.ts";
import { importProjectNotes } from "../server/services/notes-transfer.ts";
import {
  createNotesArchive,
  parseNotesArchive,
  type TransferColumn,
} from "../shared/notes-transfer.ts";

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
async function account() {
  const credentials = {
    email: `${randomUUID()}@transfer.test`,
    password: "TransferTest!123",
  };
  assert.equal(
    (await api("/auth/register", "POST", { ...credentials, nickname: "文件验收" }))
      .status,
    200,
  );
  return (await api("/auth/login", "POST", credentials)).cookie;
}
async function project(cookie: string) {
  const family = await api("/families", "POST", { name: "文件互通家庭" }, cookie);
  const fid = family.json.data.id;
  const project = await api(
    `/families/${fid}/projects`,
    "POST",
    { name: "互通项目", packageType: "half", budgetCents: 0, templateId: "blank" },
    cookie,
  );
  assert.equal(project.status, 200);
  return { fid, base: `/families/${fid}/projects/${project.json.data.id}` };
}
before(async () => {
  db = await createDb(process.env.TEST_DATABASE_URL || "memory://");
  app = await createApp(db, { testing: true });
});
after(async () => {
  await app?.close();
  await db?.close();
});

test("小程序文件导入 Web，全部导出超过一页，重复导入跳过且导出隔离私有字段", async () => {
  const cookie = await account();
  const { base } = await project(cookie);
  const columns: TransferColumn[] = [
    {
      name: "跨端专栏",
      items: Array.from({ length: 125 }, (_, i) => ({
        title: `备忘${i}`,
        details: ["中文描述\n换行"],
        starred: i % 3 === 0,
        status: i % 2 ? "confirmed" : "pending",
      })),
    },
    { name: "空专栏", items: [] },
  ];
  const archive = createNotesArchive("miniprogram", "小程序项目", columns, "0.9.6");
  const concurrent = await Promise.all([
    api(`${base}/notes/import-file`, "POST", archive, cookie),
    api(`${base}/notes/import-file`, "POST", archive, cookie),
  ]);
  assert(concurrent.every((result) => result.status === 200));
  assert.deepEqual(
    concurrent.map((result) => result.json.data.added).sort((a, b) => a - b),
    [0, 125],
  );
  const repeated = await api(`${base}/notes/import-file`, "POST", archive, cookie);
  assert.equal(repeated.json.data.added, 0);
  assert.equal(repeated.json.data.skipped, 125);
  const exported = await api(`${base}/notes/export`, "GET", undefined, cookie);
  assert.equal(exported.status, 200);
  const portable = parseNotesArchive(exported.json.data);
  assert.equal(portable.source, "web");
  const column = portable.columns.find((c) => c.name === "跨端专栏")!;
  assert.equal(column.items.length, 125);
  assert.deepEqual(
    new Set(column.items.map((n) => JSON.stringify(n))),
    new Set(columns[0]!.items.map((n) => JSON.stringify(n))),
  );
  assert(portable.columns.some((c) => c.name === "空专栏" && !c.items.length));
  assert(!JSON.stringify(exported.json.data).includes("familyId"));
  assert(!JSON.stringify(exported.json.data).includes("createdBy"));
  const dest = await project(cookie);
  assert.equal(
    (await api(`${dest.base}/notes/import-file`, "POST", portable, cookie)).json.data
      .added,
    125,
  );
  const list = await api(`${base}/note-columns`, "GET", undefined, cookie);
  const cid = list.json.data.find((c: { name: string }) => c.name === "跨端专栏").id;
  assert.equal(
    parseNotesArchive(
      (await api(`${base}/notes/export?columnId=${cid}`, "GET", undefined, cookie)).json
        .data,
    ).columns.length,
    1,
  );
  const notes = await api(`${base}/notes?columnId=${cid}`, "GET", undefined, cookie);
  const note = notes.json.data[0];
  assert.equal(
    (await api(`${base}/notes/${note.id}`, "DELETE", { version: note.version }, cookie))
      .status,
    200,
  );
  const remaining = parseNotesArchive(
    (await api(`${base}/notes/export`, "GET", undefined, cookie)).json.data,
  );
  assert.equal(remaining.columns.find((c) => c.name === "跨端专栏")!.items.length, 124);
});

test("导入中途数据库写入失败时，新增专栏和已写备忘一起回滚", async () => {
  const cookie = await account();
  const { fid, base } = await project(cookie);
  const user = (await api("/me", "GET", undefined, cookie)).json.data;
  const pid = base.split("/").pop()!;
  const archive = createNotesArchive(
    "miniprogram",
    "失败验收",
    [
      {
        name: "不得残留",
        items: [
          { title: "第一条", details: [], starred: false, status: "pending" },
          { title: "第二条", details: [], starred: true, status: "confirmed" },
        ],
      },
    ],
    "0.9.6",
  );
  let writes = 0;
  await assert.rejects(
    db.transaction(async (tx) => {
      const failing: Db = {
        ...tx,
        query: async <T extends object = Row>(sql: string, args?: unknown[]) => {
          if (sql.startsWith("INSERT INTO notes ") && ++writes === 2)
            throw new Error("模拟中途写入失败");
          return tx.query<T>(sql, args);
        },
      };
      return importProjectNotes(failing, archive, fid, pid, user.id);
    }),
    /模拟中途写入失败/,
  );
  const result = parseNotesArchive(
    (await api(`${base}/notes/export`, "GET", undefined, cookie)).json.data,
  );
  assert(!result.columns.some((column) => column.name === "不得残留"));
  assert(result.columns.every((column) => column.items.length === 0));
});

test("文件导入保持权限边界和容量原子性，损坏文件不创建任何内容", async () => {
  const owner = await account(),
    viewer = await account(),
    outsider = await account();
  const { fid, base } = await project(owner);
  const archive = createNotesArchive(
    "web",
    "任意来源",
    [
      {
        name: "新专栏",
        items: [{ title: "测试", details: [], starred: true, status: "pending" }],
      },
    ],
    "0.9.6",
  );
  assert.equal(
    (await api(`${base}/notes/import-file`, "POST", archive, outsider)).status,
    404,
  );
  const invite = await api(
    `/families/${fid}/invitations`,
    "POST",
    { role: "viewer" },
    owner,
  );
  const token = invite.json.data.path.split("/").pop();
  assert.equal(
    (await api(`/invitations/${token}/accept`, "POST", {}, viewer)).status,
    200,
  );
  assert.equal((await api(`${base}/notes/export`, "GET", undefined, viewer)).status, 200);
  assert.equal(
    (await api(`${base}/notes/import-file`, "POST", archive, viewer)).status,
    403,
  );
  const before = await api(`${base}/note-columns`, "GET", undefined, owner);
  assert.equal(
    (
      await api(
        `${base}/notes/import-file`,
        "POST",
        { ...archive, schemaVersion: 999 },
        owner,
      )
    ).status,
    422,
  );
  assert.deepEqual(
    (await api(`${base}/note-columns`, "GET", undefined, owner)).json.data,
    before.json.data,
  );
  for (let i = before.json.data.length; i < 20; i++)
    assert.equal(
      (await api(`${base}/note-columns`, "POST", { name: `占位${i}` }, owner)).status,
      200,
    );
  assert.equal(
    (await api(`${base}/notes/import-file`, "POST", archive, owner)).status,
    422,
  );
  const exported = parseNotesArchive(
    (await api(`${base}/notes/export`, "GET", undefined, owner)).json.data,
  );
  assert.equal(exported.columns.length, 20);
  assert(!exported.columns.some((c) => c.name === "新专栏"));
  assert.equal(
    (await api(`${base}/notes/export?columnId=foreign`, "GET", undefined, owner)).status,
    404,
  );
  const current = (await api(base, "GET", undefined, owner)).json.data;
  assert.equal(
    (
      await api(
        `${base}/archive`,
        "POST",
        { archived: true, version: current.version },
        owner,
      )
    ).status,
    200,
  );
  assert.equal(
    (await api(`${base}/notes/import-file`, "POST", archive, owner)).status,
    409,
  );
  assert.equal((await api(`${base}/notes/export`, "GET", undefined, owner)).status, 200);
});
