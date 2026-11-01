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
async function account(nickname: string) {
  const credentials = {
    email: `${randomUUID()}@project.test`,
    password: "ProjectTest!123",
  };
  assert.equal(
    (await api("/auth/register", "POST", { ...credentials, nickname })).status,
    200,
  );
  return (await api("/auth/login", "POST", credentials)).cookie;
}
async function workspace(templateId = "half-standard", packageType = "half") {
  const cookie = await account("项目负责人");
  const fid = (await api("/families", "POST", { name: "项目家庭" }, cookie)).json.data.id;
  const project = await api(
    `/families/${fid}/projects`,
    "POST",
    { name: "装修项目", packageType, budgetCents: 500000, templateId },
    cookie,
  );
  assert.equal(project.status, 200, JSON.stringify(project.json));
  return {
    cookie,
    fid,
    pid: project.json.data.id as string,
    base: `/families/${fid}/projects/${project.json.data.id}`,
  };
}
async function join(fid: string, cookie: string, role: "member" | "viewer") {
  const invite = await api(`/families/${fid}/invitations`, "POST", { role }, cookie);
  const token = invite.json.data.path.split("/").pop();
  const memberCookie = await account(`${role}成员`);
  assert.equal(
    (await api(`/invitations/${token}/accept`, "POST", {}, memberCookie)).status,
    200,
  );
  return memberCookie;
}
before(async () => {
  db = await createDb(process.env.TEST_DATABASE_URL || "memory://");
  app = await createApp(db, { testing: true });
});
after(async () => {
  await app?.close();
  await db?.close();
});

test("阶段可创建、改状态与改名，权限和校验生效", async () => {
  const { cookie, fid, base } = await workspace();
  assert.equal(
    (await api(`${base}/stages`, "GET", undefined, cookie)).json.data.length,
    9,
  );

  const created = await api(
    `${base}/stages`,
    "POST",
    { name: "追加阶段", budgetCents: 12300 },
    cookie,
  );
  assert.equal(created.status, 200, JSON.stringify(created.json));
  assert.equal(created.json.data.sortOrder, 9);

  const member = await join(fid, cookie, "member");
  const statusOnly = await api(
    `${base}/stages/${created.json.data.id}`,
    "PATCH",
    { version: created.json.data.version, status: "in_progress" },
    member,
  );
  assert.equal(statusOnly.status, 200, JSON.stringify(statusOnly.json));
  assert.equal(statusOnly.json.data.status, "in_progress");

  const renameByMember = await api(
    `${base}/stages/${created.json.data.id}`,
    "PATCH",
    { version: statusOnly.json.data.version, name: "成员改名" },
    member,
  );
  assert.equal(renameByMember.status, 403);

  const badStatus = await api(
    `${base}/stages/${created.json.data.id}`,
    "PATCH",
    { version: statusOnly.json.data.version, status: "done" },
    cookie,
  );
  assert.equal(badStatus.status, 422);

  const renamed = await api(
    `${base}/stages/${created.json.data.id}`,
    "PATCH",
    { version: statusOnly.json.data.version, name: "水电阶段", budgetCents: 45600 },
    cookie,
  );
  assert.equal(renamed.status, 200, JSON.stringify(renamed.json));
  assert.equal(renamed.json.data.name, "水电阶段");
  assert.equal(renamed.json.data.budgetCents, 45600);
});

test("阶段排序必须提交完整列表", async () => {
  const { cookie, base } = await workspace();
  const stages = (await api(`${base}/stages`, "GET", undefined, cookie)).json.data as {
    id: string;
    version: number;
  }[];
  const partial = await api(
    `${base}/stages/reorder`,
    "POST",
    { items: [stages[0]] },
    cookie,
  );
  assert.equal(partial.status, 409);
  assert.equal(partial.json.error.code, "VERSION_CONFLICT");

  const items = [...stages].reverse().map((s) => ({ id: s.id, version: s.version }));
  const sorted = await api(`${base}/stages/reorder`, "POST", { items }, cookie);
  assert.equal(sorted.status, 200, JSON.stringify(sorted.json));
  const after = (await api(`${base}/stages`, "GET", undefined, cookie)).json.data as {
    id: string;
  }[];
  assert.equal(after[0]!.id, stages.at(-1)!.id);
});

test("有材料的阶段不能删除，空阶段可删除并撤销", async () => {
  const { cookie, base } = await workspace("blank");
  const stage = await api(
    `${base}/stages`,
    "POST",
    { name: "有材料阶段", budgetCents: 0 },
    cookie,
  );
  const material = await api(
    `${base}/materials`,
    "POST",
    { name: "瓷砖", category: "主材", stageId: stage.json.data.id, totalPriceCents: 100 },
    cookie,
  );
  assert.equal(material.status, 200, JSON.stringify(material.json));

  const blocked = await api(
    `${base}/stages/${stage.json.data.id}`,
    "DELETE",
    { version: stage.json.data.version },
    cookie,
  );
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.error.code, "STAGE_NOT_EMPTY");

  const empty = await api(
    `${base}/stages`,
    "POST",
    { name: "空阶段", budgetCents: 0 },
    cookie,
  );
  const removed = await api(
    `${base}/stages/${empty.json.data.id}`,
    "DELETE",
    { version: empty.json.data.version },
    cookie,
  );
  assert.equal(removed.status, 200, JSON.stringify(removed.json));
  const restored = await api(
    `${base}/stages/${empty.json.data.id}/restore`,
    "POST",
    { version: removed.json.data.version },
    cookie,
  );
  assert.equal(restored.status, 200, JSON.stringify(restored.json));
});

test("项目编辑、归档与永久删除的校验和权限", async () => {
  const { cookie, fid, base } = await workspace();
  const project = (await api(base, "GET", undefined, cookie)).json.data;
  const editable = {
    name: "装修项目改名",
    address: "新地址",
    description: "说明",
    budgetCents: 600000,
    startDate: "",
    endDate: "",
    templateId: "half-standard",
    packageType: "half",
  };
  const updated = await api(
    base,
    "PATCH",
    { ...editable, version: project.version },
    cookie,
  );
  assert.equal(updated.status, 200, JSON.stringify(updated.json));
  assert.equal(updated.json.data.name, "装修项目改名");

  const badRange = await api(
    base,
    "PATCH",
    {
      ...editable,
      startDate: "2026-05-01",
      endDate: "2026-04-01",
      version: updated.json.data.version,
    },
    cookie,
  );
  assert.equal(badRange.status, 422);

  const viewer = await join(fid, cookie, "viewer");
  const denied = await api(
    base,
    "PATCH",
    { ...editable, version: updated.json.data.version },
    viewer,
  );
  assert.equal(denied.status, 403);

  const earlyDelete = await api(
    base,
    "DELETE",
    {
      confirmName: "装修项目改名",
      password: "ProjectTest!123",
      version: updated.json.data.version,
    },
    cookie,
  );
  assert.equal(earlyDelete.status, 422);
  assert.equal(earlyDelete.json.error.code, "CONFIRMATION_REQUIRED");

  const archived = await api(
    `${base}/archive`,
    "POST",
    { version: updated.json.data.version, archived: true },
    cookie,
  );
  assert.equal(archived.status, 200, JSON.stringify(archived.json));
  assert.equal(archived.json.data.status, "archived");

  const wrongName = await api(
    base,
    "DELETE",
    {
      confirmName: "错误名称",
      password: "ProjectTest!123",
      version: archived.json.data.version,
    },
    cookie,
  );
  assert.equal(wrongName.status, 422);

  const wrongPassword = await api(
    base,
    "DELETE",
    {
      confirmName: "装修项目改名",
      password: "wrong-password",
      version: archived.json.data.version,
    },
    cookie,
  );
  assert.equal(wrongPassword.status, 422);
  assert.equal(wrongPassword.json.error.code, "INVALID_PASSWORD");

  const removed = await api(
    base,
    "DELETE",
    {
      confirmName: "装修项目改名",
      password: "ProjectTest!123",
      version: archived.json.data.version,
    },
    cookie,
  );
  assert.equal(removed.status, 200, JSON.stringify(removed.json));
  const list = await api(`/families/${fid}/projects`, "GET", undefined, cookie);
  assert.equal(
    (list.json.data as { id: string }[]).some((p) => p.id === project.id),
    false,
  );
});

test("模板与承包方式不匹配时拒绝创建项目", async () => {
  const cookie = await account("模板校验");
  const fid = (await api("/families", "POST", { name: "模板家庭" }, cookie)).json.data.id;
  const bad = await api(
    `/families/${fid}/projects`,
    "POST",
    {
      name: "错误模板",
      packageType: "full",
      budgetCents: 0,
      templateId: "half-standard",
    },
    cookie,
  );
  assert.equal(bad.status, 422);
  assert.equal(bad.json.error.code, "INVALID_TEMPLATE");
});
