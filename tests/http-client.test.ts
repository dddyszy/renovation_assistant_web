import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { errorMessage, HttpError, request } from "../src/services/api.ts";

function mockBrowser(t: TestContext) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const events = new EventTarget();
  Object.defineProperty(globalThis, "window", { configurable: true, value: events });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  });
  return events;
}

test("HTTP 客户端按同源发送凭据和写请求头，保留分页信息", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      data: [{ id: "cost-1" }],
      meta: { total: 1, page: 1, pageSize: 30 },
    }),
  );
  const body = { amountCents: 1250 };
  const result = await request<{ id: string }[]>("/costs", "POST", body);
  assert.equal(result.data[0]?.id, "cost-1");
  assert.equal(result.meta?.total, 1);
  const [url, options] = fetch.mock.calls[0]!.arguments;
  assert.equal(url, "/api/v1/costs");
  assert.equal(options?.credentials, "same-origin");
  assert.equal(options?.body, JSON.stringify(body));
  assert.equal(new Headers(options?.headers).get("X-Requested-With"), "zhu-jia-web");
  assert.equal(new Headers(options?.headers).get("Content-Type"), "application/json");
});

test("HTTP 客户端保留业务错误，并按状态更新会话和工作区", async (t) => {
  const events = mockBrowser(t);
  let expired = 0;
  let unavailable = 0;
  events.addEventListener("session-expired", () => expired++);
  events.addEventListener("workspace-unavailable", () => unavailable++);
  const responses = [
    Response.json(
      { error: { code: "UNAUTHENTICATED", message: "请先登录" } },
      { status: 401 },
    ),
    Response.json(
      { error: { code: "INVALID_CREDENTIALS", message: "密码不正确" } },
      { status: 401 },
    ),
    Response.json(
      { error: { code: "NOT_FOUND", message: "家庭不存在" } },
      { status: 404 },
    ),
  ];
  t.mock.method(globalThis, "fetch", async () => responses.shift()!);
  await assert.rejects(request("/me"), (error: unknown) => {
    assert(error instanceof HttpError);
    assert.equal(error.status, 401);
    assert.equal(error.code, "UNAUTHENTICATED");
    assert.equal(error.message, "请先登录");
    return true;
  });
  await assert.rejects(request("/auth/login", "POST"), HttpError);
  assert.equal(expired, 1);
  await assert.rejects(request("/families/missing/projects"), HttpError);
  assert.equal(unavailable, 1);
});

test("HTTP 客户端为损坏的响应和未知异常提供可读提示", async (t) => {
  const responses = [
    new Response("<html>error</html>"),
    Response.json(null),
    Response.json({}),
  ];
  t.mock.method(globalThis, "fetch", async () => responses.shift()!);
  await assert.rejects(request("/health"), /服务暂时不可用/);
  await assert.rejects(request("/health"), /服务返回格式不正确/);
  await assert.rejects(request("/health"), /服务返回格式不正确/);
  assert.equal(errorMessage(new Error("输入有误")), "输入有误");
  assert.equal(errorMessage(null), "操作失败，请稍后重试");
});
