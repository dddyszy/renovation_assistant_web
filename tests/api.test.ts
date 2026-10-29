import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.ts";
import { createDb, type Db } from "../server/db.ts";
import { APP_VERSION } from "../shared/version.ts";
let db: Db, app: Awaited<ReturnType<typeof createApp>>;
const origin = {
  origin: "http://localhost:5173",
  "x-requested-with": "zhu-jia-web",
};
async function api(path: string, method = "GET", payload?: any, cookie = "") {
  const r = await app.inject({
    url: "/api/v1" + path,
    method: method as any,
    headers: { ...origin, ...(cookie ? { cookie } : {}) },
    payload,
  });
  return {
    status: r.statusCode,
    body: r.json(),
    cookie: r.cookies.map((c) => `${c.name}=${c.value}`).join(";"),
  };
}
async function account(name: string) {
  const email = `${name}@example.test`,
    password = "TestOnly!12345";
  const reg = await api("/auth/register", "POST", {
    email,
    password,
    nickname: name,
  });
  assert.equal(reg.status, 200);
  const login = await api("/auth/login", "POST", { email, password });
  assert.equal(login.status, 200);
  return { cookie: login.cookie, user: login.body.data, email, password };
}
before(async () => {
  // A supplied URL must point to a disposable test database.
  db = await createDb(process.env.TEST_DATABASE_URL || "memory://");
  app = await createApp(db, { testing: true });
  await app.ready();
});
after(async () => {
  await app?.close();
  await db?.close();
});
test("健康检查包含当前发布版本并确认数据库可查询", async () => {
  const response = await api("/health");
  assert.equal(response.status, 200);
  assert.equal(response.body.data.status, "ok");
  assert.equal(response.body.data.version, APP_VERSION);
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
  if (process.env.TEST_POSTGRES_MAJOR) {
    const [server] = await db.query(
      "SELECT current_setting('server_version_num')::int AS server_version_num",
    );
    assert.equal(
      Math.floor(Number(server!.serverVersionNum) / 10000),
      Number(process.env.TEST_POSTGRES_MAJOR),
      "测试数据库主版本与 CI 声明不符",
    );
  }
});
test("家庭隔离、邀请、只读权限、金额口径、版本冲突和幂等全链路", async () => {
  const owner = await account("owner"),
    member = await account("member"),
    outsider = await account("outsider");
  const family = await api(
    "/families",
    "POST",
    { name: "测试家庭" },
    owner.cookie,
  );
  const fid = family.body.data.id;
  const root = `/families/${fid}`;
  const p = await api(
    root + "/projects",
    "POST",
    {
      name: "测试装修",
      packageType: "half",
      budgetCents: 20000000,
      templateId: "half-standard",
    },
    owner.cookie,
  );
  assert.equal(p.status, 200);
  const base = `${root}/projects/${p.body.data.id}`;
  const stages = (await api(base + "/stages", "GET", undefined, owner.cookie))
    .body.data;
  assert.equal(stages.length, 9);
  assert.equal(
    (await api(base + "/statistics", "GET", undefined, outsider.cookie)).status,
    404,
  );
  const invite = await api(
    root + "/invitations",
    "POST",
    { role: "viewer" },
    owner.cookie,
  );
  const token = invite.body.data.path.split("/").pop();
  assert.equal(
    (await api(`/invitations/${token}/accept`, "POST", {}, member.cookie))
      .status,
    200,
  );
  assert.equal(
    (await api(`/invitations/${token}/accept`, "POST", {}, outsider.cookie))
      .status,
    404,
  );
  assert.equal(
    (await api(base + "/costs", "POST", { title: "越权" }, member.cookie))
      .status,
    403,
  );
  assert.equal(
    (await api(base + "/statistics", "GET", undefined, member.cookie)).status,
    200,
  );
  await api(
    root + `/members/${member.user.id}`,
    "PATCH",
    { role: "member" },
    owner.cookie,
  );
  assert.equal(
    (await api(root + "/projects", "POST", {}, member.cookie)).status,
    403,
  );
  const material = await api(
    base + "/materials",
    "POST",
    {
      name: "地砖",
      category: "材料",
      stageId: stages[0].id,
      totalPriceCents: 600000,
    },
    member.cookie,
  );
  assert.equal(material.status, 200);
  const common = {
    title: "地砖定金",
    category: "材料",
    amountCents: 100000,
    stageId: stages[0].id,
    materialId: material.body.data.id,
    paymentStatus: "paid",
    incurredAt: "2026-10-29",
    requestId: randomUUID(),
  };
  const first = await api(base + "/costs", "POST", common, member.cookie);
  assert.equal(first.status, 200);
  const again = await api(base + "/costs", "POST", common, member.cookie);
  assert.equal(again.body.data.id, first.body.data.id);
  assert.equal(
    (
      await api(
        base + "/costs",
        "POST",
        { ...common, title: "换了内容" },
        member.cookie,
      )
    ).status,
    409,
  );
  const pending = await api(
    base + "/costs",
    "POST",
    {
      ...common,
      title: "尾款",
      amountCents: 200000,
      paymentStatus: "pending",
      requestId: randomUUID(),
    },
    owner.cookie,
  );
  let stats = (await api(base + "/statistics", "GET", undefined, owner.cookie))
    .body.data;
  assert.equal(stats.totalCents, 300000);
  assert.equal(stats.paidCents, 100000);
  assert.equal(stats.pendingCents, 200000);
  assert.equal(stats.plannedCents, 600000);
  assert.equal(stats.balanceCents, 19700000);
  const edited = await api(
    base + `/costs/${first.body.data.id}`,
    "PATCH",
    { ...common, version: 1, title: "更名" },
    owner.cookie,
  );
  assert.equal(edited.status, 200);
  assert.equal(
    (
      await api(
        base + `/costs/${first.body.data.id}`,
        "PATCH",
        { ...common, version: 1, title: "覆盖" },
        member.cookie,
      )
    ).status,
    409,
  );
  const moved = await api(
    base + `/materials/${material.body.data.id}`,
    "PATCH",
    {
      name: "地砖",
      category: "材料",
      stageId: stages[1].id,
      totalPriceCents: 600000,
      version: 1,
    },
    owner.cookie,
  );
  assert.equal(moved.status, 200);
  const costs = (await api(base + "/costs", "GET", undefined, owner.cookie))
    .body.data;
  assert(costs.every((c: any) => c.stageId === stages[1].id));
  const row = costs.find((c: any) => c.id === pending.body.data.id);
  const removed = await api(
    base + `/costs/${row.id}`,
    "DELETE",
    { version: row.version },
    member.cookie,
  );
  assert.equal(removed.status, 200);
  stats = (await api(base + "/statistics", "GET", undefined, owner.cookie)).body
    .data;
  assert.equal(stats.totalCents, 100000);
  assert.equal(
    (
      await api(
        base + `/costs/${row.id}/restore`,
        "POST",
        { version: removed.body.data.version },
        owner.cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await api(
        base + `/stages/${stages[1].id}`,
        "DELETE",
        { version: 1 },
        owner.cookie,
      )
    ).status,
    409,
  );
  // A material in a different project cannot be linked, even when both projects share a family.
  const p2 = await api(
    root + "/projects",
    "POST",
    {
      name: "第二个项目",
      packageType: "half",
      budgetCents: 0,
      templateId: "blank",
    },
    owner.cookie,
  );
  assert.equal(
    (
      await api(
        `${root}/projects/${p2.body.data.id}/costs`,
        "POST",
        { ...common, requestId: randomUUID() },
        owner.cookie,
      )
    ).status,
    404,
  );
  await api(
    root + `/members/${member.user.id}`,
    "DELETE",
    undefined,
    owner.cookie,
  );
  assert.equal(
    (await api(base + "/statistics", "GET", undefined, member.cookie)).status,
    404,
  );
  const counts = (
    await api(base + "/costs?pageSize=1", "GET", undefined, owner.cookie)
  ).body.meta;
  assert.equal(counts.total, 2);
  assert.equal(counts.totalCents, 300000);
  const logs = (await api(root + "/audit-logs", "GET", undefined, owner.cookie))
    .body.data;
  assert(logs.length > 5);
  // Archive is read-only; restore preserves records and totals.
  const archive = await api(
    base + "/archive",
    "POST",
    { version: 1, archived: true },
    owner.cookie,
  );
  assert.equal(archive.status, 200);
  assert.equal(
    (
      await api(
        base + "/costs",
        "POST",
        { ...common, requestId: randomUUID() },
        owner.cookie,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await api(
        base + "/archive",
        "POST",
        { version: archive.body.data.version, archived: false },
        owner.cookie,
      )
    ).status,
    200,
  );
});
test("邀请撤销、CSRF、会话撤销与密码重置", async () => {
  const a = await account("security");
  const res = await app.inject({
    url: "/api/v1/families",
    method: "POST",
    headers: { cookie: a.cookie, origin: "https://evil.example" },
    payload: { name: "不该创建" },
  });
  assert.equal(res.statusCode, 403);
  const family = await api("/families", "POST", { name: "安全测试" }, a.cookie);
  const fid = family.body.data.id;
  assert.equal(
    (await api(`/families/${fid}/leave`, "POST", {}, a.cookie)).status,
    409,
  );
  const inv = await api(
    `/families/${fid}/invitations`,
    "POST",
    { role: "member" },
    a.cookie,
  );
  const token = inv.body.data.path.split("/").pop();
  await api(
    `/families/${fid}/invitations/${inv.body.data.id}`,
    "DELETE",
    undefined,
    a.cookie,
  );
  assert.equal(
    (await api(`/invitations/${token}/preview`, "GET", undefined, a.cookie))
      .status,
    404,
  );
  const reset = await api("/auth/reset/request", "POST", { email: a.email });
  assert(reset.body.data.devToken);
  assert.equal(
    (
      await api("/auth/reset/complete", "POST", {
        token: reset.body.data.devToken,
        password: "ChangedPass!12345",
      })
    ).status,
    200,
  );
  assert.equal((await api("/me", "GET", undefined, a.cookie)).status, 401);
  assert.equal(
    (
      await api("/auth/reset/complete", "POST", {
        token: reset.body.data.devToken,
        password: "ChangedAgain!12345",
      })
    ).status,
    422,
  );
});
test("超过一页的账本仍按全集聚合，重复并发提交只生成一条", async () => {
  const login = await api("/auth/login", "POST", {
    email: "owner@example.test",
    password: "TestOnly!12345",
  });
  const cookie = login.cookie;
  const f = await api("/families", "POST", { name: "分页验收" }, cookie);
  const fid = f.body.data.id;
  const p = await api(
    `/families/${fid}/projects`,
    "POST",
    {
      name: "分页项目",
      packageType: "half",
      budgetCents: 100000,
      templateId: "blank",
    },
    cookie,
  );
  const base = `/families/${fid}/projects/${p.body.data.id}`;
  for (let i = 0; i < 35; i++)
    assert.equal(
      (
        await api(
          base + "/costs",
          "POST",
          {
            title: `记录 ${i}`,
            category: i % 2 ? "人工" : "材料",
            amountCents: 101,
            incurredAt: "2026-10-29",
            paymentStatus: i % 2 ? "pending" : "paid",
            requestId: randomUUID(),
          },
          cookie,
        )
      ).status,
      200,
    );
  const first = await api(base + "/costs?page=1", "GET", undefined, cookie),
    second = await api(base + "/costs?page=2", "GET", undefined, cookie);
  assert.equal(first.body.data.length, 30);
  assert.equal(second.body.data.length, 5);
  assert.equal(first.body.meta.totalCents, 3535);
  assert.equal(
    new Set([...first.body.data, ...second.body.data].map((c) => c.id)).size,
    35,
  );
  const stats = (await api(base + "/statistics", "GET", undefined, cookie)).body
    .data;
  assert.equal(stats.totalCents, 3535);
  assert.equal(stats.paidCents, 1818);
  assert.equal(stats.pendingCents, 1717);
  const one = {
    title: "并发请求",
    category: "材料",
    amountCents: 29,
    incurredAt: "2026-10-29",
    requestId: randomUUID(),
  };
  const responses = await Promise.all(
    Array.from({ length: 3 }, () => api(base + "/costs", "POST", one, cookie)),
  );
  assert(responses.every((r) => r.status === 200));
  assert.equal(new Set(responses.map((r) => r.body.data.id)).size, 1);
  const filtered = await api(
    base + "/costs?category=人工",
    "GET",
    undefined,
    cookie,
  );
  assert.equal(filtered.body.meta.total, 17);
  assert.equal(filtered.body.meta.totalCents, 1717);
  await api(
    "/me/preferences",
    "POST",
    { familyId: fid, projectId: p.body.data.id },
    cookie,
  );
  assert.equal(
    (await api("/me", "GET", undefined, cookie)).body.data.currentProjectId,
    p.body.data.id,
  );
});
test("所有权转让、管理员边界、邀请过期与受保护的数据清理", async () => {
  const owner = await api("/auth/login", "POST", {
      email: "owner@example.test",
      password: "TestOnly!12345",
    }),
    member = await api("/auth/login", "POST", {
      email: "member@example.test",
      password: "TestOnly!12345",
    });
  const f = await api(
    "/families",
    "POST",
    { name: "生命周期验收" },
    owner.cookie,
  );
  const root = `/families/${f.body.data.id}`;
  const i = await api(
      root + "/invitations",
      "POST",
      { role: "admin" },
      owner.cookie,
    ),
    token = i.body.data.path.split("/").pop();
  assert.equal(
    (await api(`/invitations/${token}/accept`, "POST", {}, member.cookie))
      .status,
    200,
  );
  assert.equal(
    (await api(root + "/invitations", "POST", { role: "admin" }, member.cookie))
      .status,
    403,
  );
  const expired = await api(
    root + "/invitations",
    "POST",
    { role: "member" },
    owner.cookie,
  );
  await db.query(
    "UPDATE invitations SET expires_at=now()-interval '1 hour' WHERE id=$1",
    [expired.body.data.id],
  );
  assert.equal(
    (
      await api(
        `/invitations/${expired.body.data.path.split("/").pop()}/accept`,
        "POST",
        {},
        member.cookie,
      )
    ).status,
    404,
  );
  const p = await api(
    root + "/projects",
    "POST",
    {
      name: "即将归档",
      packageType: "half",
      budgetCents: 0,
      templateId: "blank",
    },
    owner.cookie,
  );
  const base = root + "/projects/" + p.body.data.id;
  assert.equal(
    (
      await api(
        base,
        "DELETE",
        { confirmName: "即将归档", password: "TestOnly!12345", version: 1 },
        owner.cookie,
      )
    ).status,
    422,
  );
  await api(
    base + "/archive",
    "POST",
    { version: 1, archived: true },
    owner.cookie,
  );
  assert.equal(
    (
      await api(
        base,
        "DELETE",
        { confirmName: "即将归档", password: "wrong", version: 2 },
        owner.cookie,
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await api(
        base,
        "DELETE",
        { confirmName: "即将归档", password: "TestOnly!12345", version: 2 },
        owner.cookie,
      )
    ).status,
    200,
  );
  const members = (await api(root + "/members", "GET", undefined, owner.cookie))
    .body.data;
  const target = members.find((m: any) => m.id !== owner.body.data.id);
  assert.equal(
    (
      await api(
        root + "/transfer-ownership",
        "POST",
        { userId: target.id },
        owner.cookie,
      )
    ).status,
    200,
  );
  const after = (await api(root + "/members", "GET", undefined, member.cookie))
    .body.data;
  assert.equal(after.filter((m: any) => m.role === "owner").length, 1);
  assert.equal(
    (
      await api(
        root,
        "DELETE",
        { confirmName: "生命周期验收", password: "TestOnly!12345" },
        owner.cookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await api(
        root,
        "DELETE",
        { confirmName: "生命周期验收", password: "TestOnly!12345" },
        member.cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (await api(root + "/members", "GET", undefined, owner.cookie)).status,
    404,
  );
});

test("注册无需验证码，邮箱规范化去重并保留密码强度校验", async () => {
  const body = {
    email: "direct@example.test",
    password: "DirectSignup!123",
    nickname: "直接注册",
  };
  assert.equal((await api("/auth/register", "POST", body)).status, 200);
  const login = await api("/auth/login", "POST", {
    email: body.email,
    password: body.password,
  });
  assert.equal(login.status, 200);
  assert.equal(
    (await api("/me", "GET", undefined, login.cookie)).body.data.nickname,
    body.nickname,
  );
  assert.equal(
    (await api("/auth/logout", "POST", undefined, login.cookie)).status,
    200,
  );
  assert.equal((await api("/me", "GET", undefined, login.cookie)).status, 401);
  const duplicate = await api("/auth/register", "POST", {
    ...body,
    email: "DIRECT@EXAMPLE.TEST",
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, "EMAIL_EXISTS");
  assert.equal(
    (
      await api("/auth/register", "POST", {
        ...body,
        email: "weak@example.test",
        password: "123",
      })
    ).status,
    422,
  );
  assert.equal(
    (await api("/auth/register", "POST", { ...body, email: "invalid" })).status,
    422,
  );
  assert.equal(
    (await api("/auth/register/request-code", "POST", { email: body.email }))
      .status,
    404,
  );
});
test("生产环境无需 SMTP 即可注册登录，未配置邮件时找回密码明确报错", async () => {
  const keys = ["NODE_ENV", "APP_ORIGIN", "SMTP_HOST", "SMTP_FROM"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  let productionApp: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    process.env.NODE_ENV = "production";
    process.env.APP_ORIGIN = "https://zhu-jia.example.test";
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_FROM;
    productionApp = await createApp(db, { testing: true });
    const headers = {
      origin: "https://zhu-jia.example.test",
      "x-requested-with": "zhu-jia-web",
    };
    const credentials = {
      email: "production@example.test",
      password: "ProductionTest!123",
    };
    const registered = await productionApp.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers,
      payload: { ...credentials, nickname: "生产注册验收" },
    });
    assert.equal(registered.statusCode, 200);
    const loggedIn = await productionApp.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers,
      payload: credentials,
    });
    assert.equal(loggedIn.statusCode, 200);
    assert(loggedIn.cookies[0]?.secure);
    const reset = await productionApp.inject({
      method: "POST",
      url: "/api/v1/auth/reset/request",
      headers,
      payload: { email: credentials.email },
    });
    assert.equal(reset.statusCode, 503);
    assert.equal(reset.json().error.code, "MAIL_NOT_CONFIGURED");
  } finally {
    await productionApp?.close();
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});
