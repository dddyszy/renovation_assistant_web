import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
const root = new URL(process.env.SMOKE_URL || "http://127.0.0.1:8080");
if (
  process.env.SMOKE_ALLOW_WRITE !== "yes" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(root.hostname)
)
  throw new Error(
    "该脚本会创建临时验收数据，仅在本机测试端口设置 SMOKE_ALLOW_WRITE=yes 后运行",
  );
const origin = process.env.SMOKE_ORIGIN || "https://renovation.example.test";
const metadata = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
let cookie = "",
  family;
const password = randomBytes(24).toString("hex");
async function api(path, method = "GET", body) {
  const response = await fetch(new URL("/api/v1" + path, root), {
    method,
    headers: {
      origin,
      "x-requested-with": "zhu-jia-web",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await response.json();
  assert.equal(response.status, 200, `${path}: ${JSON.stringify(json)}`);
  const set = response.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return json.data;
}
try {
  const health = await api("/health");
  assert.equal(
    health.version,
    process.env.SMOKE_EXPECTED_VERSION || metadata.version,
  );
  const email = `docker-${randomUUID()}@example.test`;
  await api("/auth/register", "POST", {
    email,
    password,
    nickname: "Docker 验收",
  });
  await api("/auth/login", "POST", { email, password });
  family = await api("/families", "POST", { name: "Docker 临时验收家庭" });
  const project = await api(`/families/${family.id}/projects`, "POST", {
    name: "Docker 验收项目",
    packageType: "half",
    templateId: "half-standard",
    budgetCents: 100000,
  });
  const base = `/families/${family.id}/projects/${project.id}`;
  assert.equal((await api(base + "/stages")).length, 9);
  const entry = {
    title: "容器记账验收",
    category: "材料",
    amountCents: 2990,
    paymentStatus: "paid",
    incurredAt: "2026-10-29",
    requestId: randomUUID(),
  };
  const a = await api(base + "/costs", "POST", entry),
    b = await api(base + "/costs", "POST", entry);
  assert.equal(a.id, b.id);
  const stats = await api(base + "/statistics");
  assert.equal(stats.totalCents, 2990);
  assert.equal(stats.paidCents, 2990);
  assert.equal(stats.balanceCents, 97010);
  console.log(`Docker HTTP smoke passed · v${health.version}`);
} finally {
  if (family)
    await api(`/families/${family.id}`, "DELETE", {
      confirmName: family.name,
      password,
    });
  if (cookie) await api("/auth/logout", "POST");
}
