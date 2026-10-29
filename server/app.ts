import Fastify, { type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { hash, verify } from "@node-rs/argon2";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { z } from "zod";
import { type Db, type Row } from "./db.ts";
import { templates } from "../shared/domain.ts";
import { APP_VERSION } from "../shared/version.ts";

declare module "fastify" {
  interface FastifyRequest {
    user: Row;
    role: string;
    familyId: string;
    project: Row;
  }
}
class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, code: string, message: string): never => {
  throw new ApiError(status, code, message);
};
const id = () => randomUUID();
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const text = (max = 200) => z.string().trim().max(max);
const required = (max = 100) => text(max).min(1, "请填写必填内容");
const cents = z.number().int().min(0).max(999_999_999_999);
const version = z.number().int().positive();
const email = z
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());
const password = z.string().min(10, "密码至少 10 位").max(128);
const businessDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式不正确")
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
    "日期不存在",
  );
const optionalDate = z.union([businessDate, z.literal("")]).default("");
const actorFields = (uid: string) => ({ created_by: uid, updated_by: uid });
const projectSchema = z
  .object({
    name: required(60),
    address: text(200).default(""),
    description: text(500).default(""),
    packageType: z.enum(["half", "full"]),
    budgetCents: cents,
    startDate: optionalDate,
    endDate: optionalDate,
    templateId: z
      .enum(["half-standard", "half-partial", "full-standard", "blank"])
      .default("half-standard"),
    contractCents: cents.optional(),
  })
  .refine(
    (p) => !p.startDate || !p.endDate || p.endDate >= p.startDate,
    "结束日期不能早于开始日期",
  );
const materialSchema = z.object({
  name: required(100),
  category: required(30),
  stageId: z.string().nullable().default(null),
  quantity: z.number().min(0).max(1e8).default(1),
  unit: text(20).default("件"),
  model: text(100).default(""),
  supplier: text(100).default(""),
  note: text(1000).default(""),
  totalPriceCents: cents,
  purchaseStatus: z
    .enum(["planned", "ordered", "purchased"])
    .default("planned"),
});
const costSchema = z.object({
  title: required(100),
  category: required(30),
  amountCents: cents.refine((n) => n > 0, "金额必须大于零"),
  stageId: z.string().nullable().default(null),
  materialId: z.string().nullable().default(null),
  paymentStatus: z.enum(["paid", "pending"]).default("pending"),
  merchant: text(100).default(""),
  paymentMethod: text(30).default(""),
  note: text(1000).default(""),
  incurredAt: businessDate,
});
const noteSchema = z.object({
  title: required(60),
  columnId: required(),
  details: z.array(text(200)).max(20).default([]),
  starred: z.boolean().default(false),
  status: z.enum(["pending", "confirmed"]).default("pending"),
});
const snake = (key: string) =>
  key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const sqlData = (data: Row): Row =>
  Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      snake(key),
      key === "details" ? JSON.stringify(value) : value,
    ]),
  );
async function insert(db: Db, table: string, data: Row) {
  const fields = Object.keys(data);
  const [row] = await db.query(
    `INSERT INTO ${table} (${fields.join(",")}) VALUES (${fields.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`,
    Object.values(data),
  );
  return row!;
}
async function audit(
  db: Db,
  r: FastifyRequest,
  action: string,
  entityType: string,
  entityId: string,
  label: string,
) {
  await insert(db, "audit_logs", {
    id: id(),
    family_id: r.familyId,
    actor_user_id: r.user.id,
    action,
    entity_type: entityType,
    entity_id: entityId,
    label,
  });
}
async function update(
  db: Db,
  table: string,
  rid: string,
  familyId: string,
  v: number,
  data: Row,
) {
  const fields = Object.keys(data);
  const [row] = await db.query(
    `UPDATE ${table} SET ${fields.map((f, i) => `${f}=$${i + 1}`).join(",")}, version=version+1,updated_at=now() WHERE id=$${fields.length + 1} AND family_id=$${fields.length + 2} AND version=$${fields.length + 3} RETURNING *`,
    [...Object.values(data), rid, familyId, v],
  );
  return (
    row ||
    fail(
      409,
      "VERSION_CONFLICT",
      "内容已被家人修改，请刷新后再试。你的输入仍会保留。",
    )
  );
}
export async function createApp(db: Db, options: { testing?: boolean } = {}) {
  const production = process.env.NODE_ENV === "production";
  const origin = process.env.APP_ORIGIN || "http://localhost:5173";
  if (production && !process.env.APP_ORIGIN?.startsWith("https://"))
    throw new Error("生产环境需要 HTTPS APP_ORIGIN");
  if (process.env.SMTP_HOST && !process.env.SMTP_FROM)
    throw new Error("配置 SMTP_HOST 后需要同时设置 SMTP_FROM");
  const app = Fastify({
    logger: options.testing
      ? false
      : {
          level: "info",
          redact: ["req.headers.cookie", "req.headers.authorization"],
        },
    bodyLimit: 256 * 1024,
    disableRequestLogging: true,
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 240, timeWindow: "1 minute" });
  app.decorateRequest("user");
  app.decorateRequest("project");
  app.decorateRequest("role", "");
  app.decorateRequest("familyId", "");
  app.setErrorHandler((error: any, _req, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(422).send({
        error: {
          code: "VALIDATION",
          message: error.issues[0]?.message || "请检查输入内容",
        },
      });
    if (error instanceof ApiError)
      return reply
        .code(error.status)
        .send({ error: { code: error.code, message: error.message } });
    if (error.statusCode === 429)
      return reply.code(429).send({
        error: { code: "RATE_LIMIT", message: "操作太频繁，请稍后再试" },
      });
    if (error.statusCode === 400 || error.statusCode === 413)
      return reply.code(error.statusCode).send({
        error: { code: "INVALID_REQUEST", message: "请求内容不正确或过大" },
      });
    if (error.code === "23505")
      return reply.code(409).send({
        error: { code: "CONFLICT", message: "记录已存在，请刷新后重试" },
      });
    app.log.error(error);
    return reply.code(500).send({
      error: { code: "INTERNAL", message: "服务暂时出现问题，请稍后重试" },
    });
  });
  app.addHook("onRequest", async (r) => {
    if (["POST", "PATCH", "PUT", "DELETE"].includes(r.method)) {
      const requestOrigin = r.headers.origin;
      const allowed = new Set([
        origin,
        ...(!production
          ? ["http://localhost:5173", "http://127.0.0.1:5173"]
          : []),
      ]);
      const lanDev =
        !production &&
        /^http:\/\/(?:10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+):5173$/.test(
          requestOrigin || "",
        );
      if (
        !requestOrigin ||
        (!allowed.has(requestOrigin) && !lanDev) ||
        r.headers["x-requested-with"] !== "zhu-jia-web"
      )
        fail(403, "ORIGIN", "请求来源无效，请从应用页面操作");
    }
  });
  app.addHook("onSend", async (r, reply, payload) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer");
    if (r.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    if (production)
      reply.header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      );
    return payload;
  });
  const auth = async (r: FastifyRequest) => {
    const token = r.cookies.session;
    if (!token) fail(401, "UNAUTHENTICATED", "请先登录");
    const [user] = await db.query(
      "SELECT u.id,u.email,u.nickname FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now()",
      [digest(token!)],
    );
    r.user = user || fail(401, "UNAUTHENTICATED", "登录已过期，请重新登录");
  };
  const family = async (r: FastifyRequest) => {
    await auth(r);
    const fid = (r.params as any).fid;
    const [member] = await db.query(
      "SELECT role FROM family_members WHERE family_id=$1 AND user_id=$2",
      [fid, r.user.id],
    );
    r.role =
      member?.role || fail(404, "NOT_FOUND", "家庭不存在或你已不在这个家庭");
    r.familyId = fid;
  };
  const project = async (r: FastifyRequest) => {
    await family(r);
    const [row] = await db.query(
      "SELECT * FROM projects WHERE id=$1 AND family_id=$2 AND deleted_at IS NULL",
      [(r.params as any).pid, r.familyId],
    );
    r.project = row || fail(404, "NOT_FOUND", "项目不存在");
  };
  const allow = (r: FastifyRequest, list = ["owner", "admin", "member"]) => {
    if (!list.includes(r.role)) fail(403, "FORBIDDEN", "你没有此操作权限");
    if (r.project?.status === "archived")
      fail(409, "ARCHIVED", "请先恢复已归档项目");
  };
  async function writeTransaction<T>(
    r: FastifyRequest,
    fn: (tx: Db) => Promise<T>,
  ): Promise<T> {
    return db.transaction(async (tx) => {
      if (r.familyId) {
        await tx.query("SELECT id FROM families WHERE id=$1 FOR UPDATE", [
          r.familyId,
        ]);
        const [member] = await tx.query(
          "SELECT role FROM family_members WHERE family_id=$1 AND user_id=$2",
          [r.familyId, r.user.id],
        );
        if (!member || member.role !== r.role)
          fail(403, "PERMISSION_CHANGED", "你的家庭权限已变化，请刷新后重试");
        if (r.project) {
          const [p] = await tx.query(
            "SELECT status FROM projects WHERE id=$1 AND family_id=$2 FOR UPDATE",
            [r.project.id, r.familyId],
          );
          if (!p) fail(404, "NOT_FOUND", "项目不存在");
          if (
            p!.status === "archived" &&
            !r.url.endsWith("/archive") &&
            !(
              r.method === "DELETE" &&
              /^\/api\/v1\/families\/[^/]+\/projects\/[^/?]+$/.test(r.url)
            )
          )
            fail(409, "ARCHIVED", "请先恢复已归档项目");
        }
      }
      return fn(tx);
    });
  }
  const scope = "/api/v1/families/:fid/projects/:pid";
  const data = (value: any, meta?: any) => ({
    data: value,
    ...(meta ? { meta } : {}),
  });
  const authLimit = { max: 10, timeWindow: "15 minutes" };
  const sendMail = async (
    address: string,
    subject: string,
    message: string,
  ) => {
    if (!process.env.SMTP_HOST) return;
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_PORT === "465",
      ...(process.env.SMTP_USER
        ? {
            auth: {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASSWORD,
            },
          }
        : {}),
    });
    await transport.sendMail({
      from: process.env.SMTP_FROM,
      to: address,
      subject,
      text: message,
    });
  };
  app.get("/api/v1/health", async () => {
    await db.query("SELECT 1");
    return data({
      status: "ok",
      version: APP_VERSION,
      localMail: !production && !process.env.SMTP_HOST,
    });
  });
  app.post(
    "/api/v1/auth/register",
    { config: { rateLimit: authLimit } },
    async (r) => {
      const b = z
        .object({ email, password, nickname: required(30) })
        .parse(r.body);
      const passwordHash = await hash(b.password);
      try {
        await insert(db, "users", {
          id: id(),
          email: b.email,
          password_hash: passwordHash,
          nickname: b.nickname,
        });
      } catch (error: any) {
        if (error.code === "23505")
          fail(409, "EMAIL_EXISTS", "该邮箱已注册，请直接登录");
        throw error;
      }
      return data({ registered: true });
    },
  );
  app.post(
    "/api/v1/auth/login",
    { config: { rateLimit: authLimit } },
    async (r, reply) => {
      const b = z
        .object({ email, password: z.string().max(128) })
        .parse(r.body);
      const [u] = await db.query("SELECT * FROM users WHERE email=$1", [
        b.email,
      ]);
      const dummy =
        "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$VRq7lrVEBwDe7tb2yWnzATIVWAnY2qCs/qBoJQ+QZds";
      const valid = await verify(u?.passwordHash || dummy, b.password).catch(
        () => false,
      );
      if (!u || !valid) fail(401, "INVALID_CREDENTIALS", "邮箱或密码不正确");
      const token = randomBytes(32).toString("hex");
      await insert(db, "sessions", {
        token_hash: digest(token),
        user_id: u.id,
        expires_at: new Date(Date.now() + 14 * 24 * 3600e3),
      });
      reply.setCookie("session", token, {
        httpOnly: true,
        secure: production,
        sameSite: "lax",
        path: "/",
        maxAge: 14 * 24 * 3600,
      });
      return data({ id: u.id, email: u.email, nickname: u.nickname });
    },
  );
  app.post("/api/v1/auth/logout", async (r, reply) => {
    if (r.cookies.session)
      await db.query("DELETE FROM sessions WHERE token_hash=$1", [
        digest(r.cookies.session),
      ]);
    reply.clearCookie("session", { path: "/" });
    return data({ loggedOut: true });
  });
  app.post(
    "/api/v1/auth/reset/request",
    { config: { rateLimit: authLimit } },
    async (r) => {
      const b = z.object({ email }).parse(r.body);
      if (production && !process.env.SMTP_HOST)
        fail(503, "MAIL_NOT_CONFIGURED", "暂未开通邮件找回，请联系应用管理员");
      const [u] = await db.query("SELECT id FROM users WHERE email=$1", [
        b.email,
      ]);
      const token = randomBytes(32).toString("hex");
      if (u) {
        await insert(db, "verification_tokens", {
          id: id(),
          email: b.email,
          purpose: "reset",
          token_hash: digest(token),
          expires_at: new Date(Date.now() + 15 * 60e3),
        });
        await sendMail(
          b.email,
          "筑家手记 · 重置密码",
          `请在 15 分钟内打开：${origin}/reset-password?token=${token}`,
        );
      }
      return data({
        message: "如果此邮箱已注册，你将收到重置邮件",
        ...(!production && !process.env.SMTP_HOST && u
          ? { devToken: token }
          : {}),
      });
    },
  );
  app.post(
    "/api/v1/auth/reset/complete",
    { config: { rateLimit: authLimit } },
    async (r) => {
      const b = z.object({ token: required(128), password }).parse(r.body);
      const ph = await hash(b.password);
      await writeTransaction(r, async (tx) => {
        const [token] = await tx.query(
          "SELECT * FROM verification_tokens WHERE token_hash=$1 AND purpose='reset' AND consumed_at IS NULL AND expires_at>now() FOR UPDATE",
          [digest(b.token)],
        );
        if (!token) fail(422, "INVALID_TOKEN", "重置链接已失效");
        const [u] = await tx.query(
          "UPDATE users SET password_hash=$1 WHERE email=$2 RETURNING id",
          [ph, token!.email],
        );
        await tx.query(
          "UPDATE verification_tokens SET consumed_at=now() WHERE email=$1 AND purpose=$2",
          [token!.email, "reset"],
        );
        await tx.query("DELETE FROM sessions WHERE user_id=$1", [u!.id]);
      });
      return data({ reset: true });
    },
  );
  app.get("/api/v1/me", { preHandler: auth }, async (r) => {
    const [pref] = await db.query(
      "SELECT family_id,project_id FROM user_preferences WHERE user_id=$1",
      [r.user.id],
    );
    return data({
      ...r.user,
      currentFamilyId: pref?.familyId,
      currentProjectId: pref?.projectId,
    });
  });
  app.post("/api/v1/me/preferences", { preHandler: auth }, async (r) => {
    const b = z
      .object({ familyId: required(), projectId: z.string().nullable() })
      .parse(r.body);
    const [m] = await db.query(
      "SELECT role FROM family_members WHERE family_id=$1 AND user_id=$2",
      [b.familyId, r.user.id],
    );
    if (!m) fail(404, "NOT_FOUND", "家庭不可访问");
    if (b.projectId) {
      const [p] = await db.query(
        "SELECT id FROM projects WHERE id=$1 AND family_id=$2 AND deleted_at IS NULL",
        [b.projectId, b.familyId],
      );
      if (!p) fail(404, "NOT_FOUND", "项目不可访问");
    }
    await db.query(
      "INSERT INTO user_preferences(user_id,family_id,project_id) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET family_id=$2,project_id=$3,updated_at=now()",
      [r.user.id, b.familyId, b.projectId],
    );
    return data({ saved: true });
  });
  app.patch("/api/v1/me", { preHandler: auth }, async (r) => {
    const b = z.object({ nickname: required(30) }).parse(r.body);
    const [u] = await db.query(
      "UPDATE users SET nickname=$1 WHERE id=$2 RETURNING id,email,nickname",
      [b.nickname, r.user.id],
    );
    return data(u);
  });
  app.get("/api/v1/families", { preHandler: auth }, async (r) =>
    data(
      await db.query(
        "SELECT f.*,m.role,(SELECT count(*)::int FROM family_members fm WHERE fm.family_id=f.id) AS member_count FROM families f JOIN family_members m ON m.family_id=f.id WHERE m.user_id=$1 ORDER BY f.created_at",
        [r.user.id],
      ),
    ),
  );
  app.post("/api/v1/families", { preHandler: auth }, async (r) => {
    const b = z.object({ name: required(40) }).parse(r.body);
    const f = await writeTransaction(r, async (tx) => {
      const f = await insert(tx, "families", {
        id: id(),
        name: b.name,
        owner_user_id: r.user.id,
      });
      await insert(tx, "family_members", {
        family_id: f.id,
        user_id: r.user.id,
        role: "owner",
      });
      return f;
    });
    return data({ ...f, role: "owner" });
  });
  app.patch("/api/v1/families/:fid", { preHandler: family }, async (r) => {
    allow(r, ["owner"]);
    const b = z.object({ name: required(40) }).parse(r.body);
    const [f] = await db.query(
      "UPDATE families SET name=$1 WHERE id=$2 RETURNING *",
      [b.name, r.familyId],
    );
    return data(f);
  });
  app.get("/api/v1/families/:fid/members", { preHandler: family }, async (r) =>
    data(
      await db.query(
        "SELECT u.id,u.nickname,m.role,m.joined_at FROM family_members m JOIN users u ON u.id=m.user_id WHERE m.family_id=$1 ORDER BY m.joined_at",
        [r.familyId],
      ),
    ),
  );
  app.patch(
    "/api/v1/families/:fid/members/:uid",
    { preHandler: family },
    async (r) => {
      allow(r, ["owner", "admin"]);
      const b = z
        .object({ role: z.enum(["admin", "member", "viewer"]) })
        .parse(r.body);
      const uid = (r.params as any).uid;
      await writeTransaction(r, async (tx) => {
        await tx.query("SELECT id FROM families WHERE id=$1 FOR UPDATE", [
          r.familyId,
        ]);
        const [current] = await tx.query(
          "SELECT role FROM family_members WHERE family_id=$1 AND user_id=$2",
          [r.familyId, r.user.id],
        );
        const [target] = await tx.query(
          "SELECT role FROM family_members WHERE family_id=$1 AND user_id=$2",
          [r.familyId, uid],
        );
        if (!target) fail(404, "NOT_FOUND", "成员不存在");
        if (
          target!.role === "owner" ||
          uid === r.user.id ||
          !["owner", "admin"].includes(current?.role) ||
          (current?.role === "admin" &&
            (target!.role === "admin" || b.role === "admin"))
        )
          fail(403, "FORBIDDEN", "不能调整该成员权限");
        await tx.query(
          "UPDATE family_members SET role=$1 WHERE family_id=$2 AND user_id=$3",
          [b.role, r.familyId, uid],
        );
        await audit(tx, r, "调整权限", "member", uid, b.role);
      });
      return data({ updated: true });
    },
  );
  app.delete(
    "/api/v1/families/:fid/members/:uid",
    { preHandler: family },
    async (r) => {
      allow(r, ["owner", "admin"]);
      const uid = (r.params as any).uid;
      await writeTransaction(r, async (tx) => {
        await tx.query("SELECT id FROM families WHERE id=$1 FOR UPDATE", [
          r.familyId,
        ]);
        const [current] = await tx.query(
          "SELECT role FROM family_members WHERE family_id=$1 AND user_id=$2",
          [r.familyId, r.user.id],
        );
        const [target] = await tx.query(
          "SELECT role FROM family_members WHERE family_id=$1 AND user_id=$2",
          [r.familyId, uid],
        );
        if (!target) fail(404, "NOT_FOUND", "成员不存在");
        if (
          target!.role === "owner" ||
          uid === r.user.id ||
          !["owner", "admin"].includes(current?.role) ||
          (current?.role === "admin" && target!.role === "admin")
        )
          fail(403, "FORBIDDEN", "不能移除此成员");
        await tx.query(
          "DELETE FROM family_members WHERE family_id=$1 AND user_id=$2",
          [r.familyId, uid],
        );
        await audit(tx, r, "移除成员", "member", uid, "家庭成员");
      });
      return data({ removed: true });
    },
  );
  app.post("/api/v1/families/:fid/leave", { preHandler: family }, async (r) => {
    await writeTransaction(r, async (tx) => {
      await tx.query("SELECT id FROM families WHERE id=$1 FOR UPDATE", [
        r.familyId,
      ]);
      const [m] = await tx.query(
        "SELECT role FROM family_members WHERE family_id=$1 AND user_id=$2",
        [r.familyId, r.user.id],
      );
      if (m?.role === "owner")
        fail(409, "OWNER_REQUIRED", "请先转让家庭所有权");
      await tx.query(
        "DELETE FROM family_members WHERE family_id=$1 AND user_id=$2",
        [r.familyId, r.user.id],
      );
      await audit(tx, r, "退出家庭", "member", r.user.id, r.user.nickname);
    });
    return data({ left: true });
  });
  app.post(
    "/api/v1/families/:fid/transfer-ownership",
    { preHandler: family },
    async (r) => {
      allow(r, ["owner"]);
      const b = z.object({ userId: required() }).parse(r.body);
      await writeTransaction(r, async (tx) => {
        const [f] = await tx.query(
          "SELECT * FROM families WHERE id=$1 FOR UPDATE",
          [r.familyId],
        );
        if (f?.ownerUserId !== r.user.id)
          fail(403, "FORBIDDEN", "家庭所有者已变化，请刷新");
        const [target] = await tx.query(
          "SELECT * FROM family_members WHERE family_id=$1 AND user_id=$2",
          [r.familyId, b.userId],
        );
        if (!target || b.userId === r.user.id)
          fail(422, "INVALID_MEMBER", "请选择其他有效成员");
        await tx.query(
          "UPDATE family_members SET role='admin' WHERE family_id=$1 AND user_id=$2",
          [r.familyId, r.user.id],
        );
        await tx.query(
          "UPDATE family_members SET role='owner' WHERE family_id=$1 AND user_id=$2",
          [r.familyId, b.userId],
        );
        await tx.query("UPDATE families SET owner_user_id=$1 WHERE id=$2", [
          b.userId,
          r.familyId,
        ]);
        await audit(tx, r, "转让所有权", "family", r.familyId, "家庭所有权");
      });
      return data({ transferred: true });
    },
  );
  app.get(
    "/api/v1/families/:fid/invitations",
    { preHandler: family },
    async (r) => {
      allow(r, ["owner", "admin"]);
      return data(
        await db.query(
          "SELECT id,role,expires_at,used_by,revoked_at FROM invitations WHERE family_id=$1 ORDER BY created_at DESC LIMIT 30",
          [r.familyId],
        ),
      );
    },
  );
  app.post(
    "/api/v1/families/:fid/invitations",
    { preHandler: family },
    async (r) => {
      allow(r, ["owner", "admin"]);
      const b = z
        .object({ role: z.enum(["admin", "member", "viewer"]) })
        .parse(r.body);
      if (b.role === "admin" && r.role !== "owner")
        fail(403, "FORBIDDEN", "仅所有者可以邀请管理员");
      const token = randomBytes(32).toString("hex");
      const inv = await insert(db, "invitations", {
        id: id(),
        family_id: r.familyId,
        token_hash: digest(token),
        role: b.role,
        invited_by: r.user.id,
        expires_at: new Date(Date.now() + 48 * 3600e3),
      });
      return data({
        id: inv.id,
        role: inv.role,
        expiresAt: inv.expiresAt,
        path: `/invite/${token}`,
      });
    },
  );
  app.delete(
    "/api/v1/families/:fid/invitations/:iid",
    { preHandler: family },
    async (r) => {
      allow(r, ["owner", "admin"]);
      const [i] = await db.query(
        "SELECT role FROM invitations WHERE id=$1 AND family_id=$2",
        [(r.params as any).iid, r.familyId],
      );
      if (!i) fail(404, "NOT_FOUND", "邀请不存在");
      if (i!.role === "admin" && r.role !== "owner")
        fail(403, "FORBIDDEN", "仅所有者可撤销此邀请");
      await db.query(
        "UPDATE invitations SET revoked_at=now() WHERE id=$1 AND family_id=$2",
        [(r.params as any).iid, r.familyId],
      );
      return data({ revoked: true });
    },
  );
  const checkInvite = async (tx: Db, token: string, lock = false) => {
    const [i] = await tx.query(
      `SELECT i.*,f.name AS family_name FROM invitations i JOIN families f ON f.id=i.family_id WHERE i.token_hash=$1 ${lock ? "FOR UPDATE OF i" : ""}`,
      [digest(token)],
    );
    if (
      !i ||
      i.revokedAt ||
      i.usedBy ||
      new Date(i.expiresAt).getTime() < Date.now()
    )
      fail(404, "INVALID_INVITE", "邀请已失效，请让家人重新发送");
    const [m] = await tx.query(
      "SELECT role FROM family_members WHERE family_id=$1 AND user_id=$2",
      [i!.familyId, i!.invitedBy],
    );
    if (
      !m ||
      !["owner", "admin"].includes(m.role) ||
      (i!.role === "admin" && m.role !== "owner")
    )
      fail(404, "INVALID_INVITE", "邀请人权限已变化，请重新邀请");
    return i!;
  };
  app.get(
    "/api/v1/invitations/:token/preview",
    { preHandler: auth },
    async (r) => {
      const i = await checkInvite(db, (r.params as any).token);
      return data({
        familyName: i.familyName,
        role: i.role,
        expiresAt: i.expiresAt,
      });
    },
  );
  app.post(
    "/api/v1/invitations/:token/accept",
    { preHandler: auth },
    async (r) =>
      data(
        await writeTransaction(r, async (tx) => {
          const i = await checkInvite(tx, (r.params as any).token, true);
          const [m] = await tx.query(
            "SELECT * FROM family_members WHERE family_id=$1 AND user_id=$2",
            [i.familyId, r.user.id],
          );
          if (m) return { familyId: i.familyId, alreadyMember: true };
          await insert(tx, "family_members", {
            family_id: i.familyId,
            user_id: r.user.id,
            role: i.role,
          });
          await tx.query("UPDATE invitations SET used_by=$1 WHERE id=$2", [
            r.user.id,
            i.id,
          ]);
          r.familyId = i.familyId;
          await audit(tx, r, "加入家庭", "member", r.user.id, r.user.nickname);
          return { familyId: i.familyId };
        }),
      ),
  );
  app.get(
    "/api/v1/families/:fid/audit-logs",
    { preHandler: family },
    async (r) =>
      data(
        await db.query(
          "SELECT a.*,u.nickname AS actor_name FROM audit_logs a JOIN users u ON a.actor_user_id=u.id WHERE a.family_id=$1 ORDER BY a.created_at DESC LIMIT 60",
          [r.familyId],
        ),
      ),
  );
  app.get("/api/v1/families/:fid/projects", { preHandler: family }, async (r) =>
    data(
      await db.query(
        "SELECT * FROM projects WHERE family_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC",
        [r.familyId],
      ),
    ),
  );
  app.post(
    "/api/v1/families/:fid/projects",
    { preHandler: family },
    async (r) => {
      allow(r, ["owner", "admin"]);
      const b = projectSchema.parse(r.body);
      const template = templates.find((t) => t.id === b.templateId)!;
      if (template.type !== "any" && template.type !== b.packageType)
        fail(422, "INVALID_TEMPLATE", "模板与承包方式不匹配");
      const result = await writeTransaction(r, async (tx) => {
        const { contractCents, ...rest } = b;
        const p = await insert(tx, "projects", {
          id: id(),
          family_id: r.familyId,
          ...sqlData(rest),
          ...actorFields(r.user.id),
        });
        for (const [i, name] of template.stages.entries())
          await insert(tx, "stages", {
            id: id(),
            family_id: r.familyId,
            project_id: p.id,
            name,
            sort_order: i,
            budget_cents: name === "装修公司施工" ? contractCents || 0 : 0,
            ...actorFields(r.user.id),
          });
        for (const [i, name] of [
          "事前确认",
          "设计需求点",
          "灵感与想法",
        ].entries())
          await insert(tx, "note_columns", {
            id: id(),
            family_id: r.familyId,
            project_id: p.id,
            name,
            sort_order: i,
            ...actorFields(r.user.id),
          });
        await audit(tx, r, "创建项目", "project", p.id, p.name);
        return p;
      });
      return data(result);
    },
  );
  app.get(scope, { preHandler: project }, async (r) => data(r.project));
  app.patch(scope, { preHandler: project }, async (r) => {
    allow(r, ["owner", "admin"]);
    const body = z
      .object({
        version,
        name: required(60),
        address: text(200),
        description: text(500),
        budgetCents: cents,
        startDate: optionalDate,
        endDate: optionalDate,
      })
      .refine(
        (p) => !p.startDate || !p.endDate || p.endDate >= p.startDate,
        "结束日期不能早于开始日期",
      )
      .parse(r.body);
    const { version: v, ...rest } = body;
    return data(
      await writeTransaction(r, async (tx) => {
        const p = await update(tx, "projects", r.project.id, r.familyId, v, {
          ...sqlData(rest),
          updated_by: r.user.id,
        });
        await audit(tx, r, "修改项目", "project", p.id, p.name);
        return p;
      }),
    );
  });
  app.post(`${scope}/archive`, { preHandler: project }, async (r) => {
    if (!["owner", "admin"].includes(r.role))
      fail(403, "FORBIDDEN", "你没有此操作权限");
    const b = z.object({ version, archived: z.boolean() }).parse(r.body);
    return data(
      await writeTransaction(r, async (tx) => {
        const p = await update(
          tx,
          "projects",
          r.project.id,
          r.familyId,
          b.version,
          { status: b.archived ? "archived" : "active", updated_by: r.user.id },
        );
        await audit(
          tx,
          r,
          b.archived ? "归档项目" : "恢复项目",
          "project",
          p.id,
          p.name,
        );
        return p;
      }),
    );
  });
  const reauthenticate = async (r: FastifyRequest, pw: string) => {
    const [u] = await db.query("SELECT password_hash FROM users WHERE id=$1", [
      r.user.id,
    ]);
    if (!u || !(await verify(u.passwordHash, pw).catch(() => false)))
      fail(422, "INVALID_PASSWORD", "密码不正确，无法执行此操作");
  };
  const eraseProject = async (tx: Db, pid: string, fid: string) => {
    for (const table of [
      "costs",
      "materials",
      "notes",
      "note_columns",
      "stages",
    ])
      await tx.query(
        `DELETE FROM ${table} WHERE project_id=$1 AND family_id=$2`,
        [pid, fid],
      );
    await tx.query("DELETE FROM projects WHERE id=$1 AND family_id=$2", [
      pid,
      fid,
    ]);
    await tx.query(
      "UPDATE user_preferences SET project_id=NULL WHERE project_id=$1",
      [pid],
    );
  };
  app.delete(
    scope,
    { preHandler: project, config: { rateLimit: authLimit } },
    async (r) => {
      if (r.role !== "owner")
        fail(403, "FORBIDDEN", "仅家庭所有者可以永久删除项目");
      const b = z
        .object({
          confirmName: required(60),
          password: z.string().max(128),
          version,
        })
        .parse(r.body);
      if (b.confirmName !== r.project.name || r.project.status !== "archived")
        fail(422, "CONFIRMATION_REQUIRED", "请先归档项目，并输入完整项目名称");
      await reauthenticate(r, b.password);
      await writeTransaction(r, async (tx) => {
        const [p] = await tx.query(
          "SELECT * FROM projects WHERE id=$1 FOR UPDATE",
          [r.project.id],
        );
        if (p?.version !== b.version || p.status !== "archived")
          fail(409, "VERSION_CONFLICT", "项目状态已变化，请刷新");
        await eraseProject(tx, r.project.id, r.familyId);
        await audit(
          tx,
          r,
          "永久删除项目",
          "project",
          r.project.id,
          r.project.name,
        );
      });
      return data({ deleted: true });
    },
  );
  app.delete(
    "/api/v1/families/:fid",
    { preHandler: family, config: { rateLimit: authLimit } },
    async (r) => {
      allow(r, ["owner"]);
      const b = z
        .object({ confirmName: required(40), password: z.string().max(128) })
        .parse(r.body);
      await reauthenticate(r, b.password);
      await writeTransaction(r, async (tx) => {
        const [f] = await tx.query(
          "SELECT name FROM families WHERE id=$1 FOR UPDATE",
          [r.familyId],
        );
        if (f?.name !== b.confirmName)
          fail(422, "CONFIRMATION_REQUIRED", "请输入完整家庭名称");
        const ps = await tx.query(
          "SELECT id FROM projects WHERE family_id=$1",
          [r.familyId],
        );
        for (const p of ps) await eraseProject(tx, p.id, r.familyId);
        for (const table of [
          "invitations",
          "audit_logs",
          "family_members",
          "user_preferences",
        ])
          await tx.query(`DELETE FROM ${table} WHERE family_id=$1`, [
            r.familyId,
          ]);
        await tx.query("DELETE FROM families WHERE id=$1", [r.familyId]);
      });
      return data({ deleted: true });
    },
  );
  const resource = async (
    tx: Db,
    r: FastifyRequest,
    table: string,
    rid: string,
    deleted = false,
  ) => {
    const [row] = await tx.query(
      `SELECT * FROM ${table} WHERE id=$1 AND family_id=$2 AND project_id=$3 AND deleted_at IS ${deleted ? "NOT " : ""}NULL`,
      [rid, r.familyId, r.project.id],
    );
    return row || fail(404, "NOT_FOUND", "记录不存在");
  };
  const checkLinks = async (tx: Db, r: FastifyRequest, b: Row) => {
    if (b.stageId) await resource(tx, r, "stages", b.stageId);
    if (b.materialId) {
      const m = await resource(tx, r, "materials", b.materialId);
      if (m.stageId !== b.stageId)
        fail(422, "INVALID_LINK", "材料与支出必须属于同一阶段");
    }
    if (b.columnId) await resource(tx, r, "note_columns", b.columnId);
  };
  app.get(`${scope}/stages`, { preHandler: project }, async (r) =>
    data(
      await db.query(
        "SELECT * FROM stages WHERE family_id=$1 AND project_id=$2 AND deleted_at IS NULL ORDER BY sort_order,created_at",
        [r.familyId, r.project.id],
      ),
    ),
  );
  app.post(`${scope}/stages`, { preHandler: project }, async (r) => {
    allow(r, ["owner", "admin"]);
    const b = z
      .object({ name: required(60), budgetCents: cents })
      .parse(r.body);
    return data(
      await writeTransaction(r, async (tx) => {
        await tx.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [
          r.project.id,
        ]);
        const [count] = await tx.query(
          "SELECT count(*)::int AS count FROM stages WHERE project_id=$1 AND deleted_at IS NULL",
          [r.project.id],
        );
        if (count!.count >= 30) fail(422, "LIMIT", "最多 30 个阶段");
        const [last] = await tx.query(
          "SELECT COALESCE(max(sort_order),-1)+1 AS next FROM stages WHERE project_id=$1",
          [r.project.id],
        );
        const s = await insert(tx, "stages", {
          id: id(),
          family_id: r.familyId,
          project_id: r.project.id,
          ...sqlData(b),
          sort_order: Number(last!.next),
          ...actorFields(r.user.id),
        });
        await audit(tx, r, "新增阶段", "stage", s.id, s.name);
        return s;
      }),
    );
  });
  app.patch(`${scope}/stages/:rid`, { preHandler: project }, async (r) => {
    allow(r);
    const b = z
      .object({
        version,
        name: required(60).optional(),
        budgetCents: cents.optional(),
        status: z.enum(["pending", "in_progress", "completed"]).optional(),
      })
      .parse(r.body);
    if (
      (b.name !== undefined || b.budgetCents !== undefined) &&
      !["owner", "admin"].includes(r.role)
    )
      fail(403, "FORBIDDEN", "仅管理员可修改阶段设置");
    const { version: v, ...rest } = b;
    return data(
      await writeTransaction(r, async (tx) => {
        const s = await resource(tx, r, "stages", (r.params as any).rid);
        const next = await update(tx, "stages", s.id, r.familyId, v, {
          ...sqlData(rest),
          updated_by: r.user.id,
        });
        await audit(tx, r, "更新阶段", "stage", s.id, s.name);
        return next;
      }),
    );
  });
  app.post(`${scope}/stages/reorder`, { preHandler: project }, async (r) => {
    allow(r, ["owner", "admin"]);
    const b = z
      .object({ items: z.array(z.object({ id: required(), version })).max(30) })
      .parse(r.body);
    await writeTransaction(r, async (tx) => {
      const stages = await tx.query(
        "SELECT id FROM stages WHERE family_id=$1 AND project_id=$2 AND deleted_at IS NULL FOR UPDATE",
        [r.familyId, r.project.id],
      );
      if (
        stages.length !== b.items.length ||
        new Set(b.items.map((i) => i.id)).size !== stages.length ||
        stages.some((s) => !b.items.some((i) => i.id === s.id))
      )
        fail(409, "VERSION_CONFLICT", "阶段列表已变化，请刷新");
      for (const [i, s] of b.items.entries())
        await update(tx, "stages", s.id, r.familyId, s.version, {
          sort_order: i,
          updated_by: r.user.id,
        });
    });
    return data({ sorted: true });
  });
  // Resource types are fixed server-side; table names never come from request input.
  for (const [table, schema] of [
    ["materials", materialSchema],
    ["costs", costSchema],
    ["notes", noteSchema],
  ] as const) {
    app.get(`${scope}/${table}`, { preHandler: project }, async (r) => {
      const q = z
        .object({
          page: z.coerce.number().int().min(1).max(100000).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(30),
          keyword: text(100).default(""),
          stageId: z.string().optional(),
          category: z.string().optional(),
          paymentStatus: z.enum(["paid", "pending"]).optional(),
          purchaseStatus: z
            .enum(["planned", "ordered", "purchased"])
            .optional(),
          columnId: z.string().optional(),
          status: z.enum(["pending", "confirmed"]).optional(),
          starred: z.enum(["true"]).optional(),
          from: businessDate.optional(),
          to: businessDate.optional(),
          deleted: z.enum(["true"]).optional(),
        })
        .parse(r.query);
      const args: any[] = [r.familyId, r.project.id];
      let where = `t.family_id=$1 AND t.project_id=$2 AND t.deleted_at IS ${q.deleted ? "NOT " : ""}NULL`;
      const add = (expression: string, value: any) => {
        args.push(value);
        where += ` AND ${expression.replace("?", `$${args.length}`)}`;
      };
      if (q.keyword)
        add(
          `t.${table === "materials" ? "name" : "title"} ILIKE ?`,
          `%${q.keyword}%`,
        );
      if (q.stageId && table !== "notes") add("t.stage_id=?", q.stageId);
      if (q.category && table !== "notes") add("t.category=?", q.category);
      if (table === "costs") {
        if (q.paymentStatus) add("t.payment_status=?", q.paymentStatus);
        if (q.from) add("t.incurred_at>=?", q.from);
        if (q.to) add("t.incurred_at<=?", q.to);
      }
      if (table === "materials" && q.purchaseStatus)
        add("t.purchase_status=?", q.purchaseStatus);
      if (table === "notes") {
        if (q.columnId) add("t.column_id=?", q.columnId);
        if (q.status) add("t.status=?", q.status);
        if (q.starred) add("t.starred=?", true);
      }
      const [total] = await db.query(
        `SELECT count(*)::int AS count${table === "costs" ? ",COALESCE(sum(amount_cents),0) AS total_cents" : ""} FROM ${table} t WHERE ${where}`,
        args,
      );
      const rows = await db.query(
        `SELECT t.*,u.nickname AS creator_name FROM ${table} t JOIN users u ON t.created_by=u.id WHERE ${where} ORDER BY ${table === "costs" ? "t.incurred_at DESC," : table === "notes" ? "t.starred DESC," : ""}t.created_at DESC,t.id DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
        [...args, q.pageSize, (q.page - 1) * q.pageSize],
      );
      return data(rows, {
        total: total!.count,
        totalCents: total!.totalCents,
        page: q.page,
        pageSize: q.pageSize,
      });
    });
    app.post(`${scope}/${table}`, { preHandler: project }, async (r) => {
      allow(r);
      const b = schema.parse(r.body);
      const requestId =
        table === "costs"
          ? z.object({ requestId: required(128) }).parse(r.body).requestId
          : "";
      const fingerprint = digest(JSON.stringify(b));
      return data(
        await writeTransaction(r, async (tx) => {
          await tx.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [
            r.project.id,
          ]);
          if (table === "costs") {
            const [existing] = await tx.query(
              "SELECT * FROM costs WHERE family_id=$1 AND project_id=$2 AND created_by=$3 AND request_id=$4",
              [r.familyId, r.project.id, r.user.id, requestId],
            );
            if (existing) {
              if (existing.requestFingerprint !== fingerprint)
                fail(409, "IDEMPOTENCY_CONFLICT", "此提交编号已用于另一条支出");
              return existing;
            }
          }
          await checkLinks(tx, r, b);
          if (table === "notes") {
            const [count] = await tx.query(
              "SELECT count(*)::int AS count FROM notes WHERE project_id=$1 AND deleted_at IS NULL",
              [r.project.id],
            );
            if (count!.count >= 1000)
              fail(422, "LIMIT", "每个项目最多 1000 条有效备忘");
          }
          const row = await insert(tx, table, {
            id: id(),
            family_id: r.familyId,
            project_id: r.project.id,
            ...sqlData(b),
            ...actorFields(r.user.id),
            ...(table === "costs"
              ? { request_id: requestId, request_fingerprint: fingerprint }
              : {}),
          });
          await audit(tx, r, "新增记录", table, row.id, row.name || row.title);
          return row;
        }),
      );
    });
    app.patch(`${scope}/${table}/:rid`, { preHandler: project }, async (r) => {
      allow(r);
      const b = schema.parse(r.body);
      const v = z.object({ version }).parse(r.body).version;
      return data(
        await writeTransaction(r, async (tx) => {
          const row = await resource(tx, r, table, (r.params as any).rid);
          await checkLinks(tx, r, b);
          const next = await update(tx, table, row.id, r.familyId, v, {
            ...sqlData(b),
            updated_by: r.user.id,
          });
          if (
            table === "materials" &&
            "stageId" in b &&
            b.stageId !== row.stageId
          )
            await tx.query(
              "UPDATE costs SET stage_id=$1,version=version+1,updated_by=$2,updated_at=now() WHERE family_id=$3 AND project_id=$4 AND material_id=$5",
              [b.stageId, r.user.id, r.familyId, r.project.id, row.id],
            );
          await audit(
            tx,
            r,
            "修改记录",
            table,
            row.id,
            next.name || next.title,
          );
          return next;
        }),
      );
    });
  }
  app.get(`${scope}/note-columns`, { preHandler: project }, async (r) =>
    data(
      await db.query(
        "SELECT * FROM note_columns WHERE family_id=$1 AND project_id=$2 AND deleted_at IS NULL ORDER BY sort_order,created_at",
        [r.familyId, r.project.id],
      ),
    ),
  );
  app.post(`${scope}/note-columns`, { preHandler: project }, async (r) => {
    allow(r);
    const b = z.object({ name: required(30) }).parse(r.body);
    return data(
      await writeTransaction(r, async (tx) => {
        await tx.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [
          r.project.id,
        ]);
        const columns = await tx.query(
          "SELECT name FROM note_columns WHERE project_id=$1 AND deleted_at IS NULL",
          [r.project.id],
        );
        if (columns.length >= 20 || columns.some((c) => c.name === b.name))
          fail(422, "INVALID_COLUMN", "专栏已存在或已达 20 个上限");
        const [last] = await tx.query(
          "SELECT COALESCE(max(sort_order),-1)+1 AS next FROM note_columns WHERE project_id=$1",
          [r.project.id],
        );
        return insert(tx, "note_columns", {
          id: id(),
          family_id: r.familyId,
          project_id: r.project.id,
          name: b.name,
          sort_order: Number(last!.next),
          ...actorFields(r.user.id),
        });
      }),
    );
  });
  app.patch(
    `${scope}/note-columns/:rid`,
    { preHandler: project },
    async (r) => {
      allow(r);
      const b = z.object({ version, name: required(30) }).parse(r.body);
      return data(
        await writeTransaction(r, async (tx) => {
          await resource(tx, r, "note_columns", (r.params as any).rid);
          const column = await update(
            tx,
            "note_columns",
            (r.params as any).rid,
            r.familyId,
            b.version,
            { name: b.name, updated_by: r.user.id },
          );
          await audit(
            tx,
            r,
            "修改专栏",
            "note_columns",
            column.id,
            column.name,
          );
          return column;
        }),
      );
    },
  );
  app.post(
    `${scope}/note-columns/reorder`,
    { preHandler: project },
    async (r) => {
      allow(r);
      const b = z
        .object({
          items: z.array(z.object({ id: required(), version })).max(20),
        })
        .parse(r.body);
      await writeTransaction(r, async (tx) => {
        const cols = await tx.query(
          "SELECT id FROM note_columns WHERE project_id=$1 AND deleted_at IS NULL FOR UPDATE",
          [r.project.id],
        );
        if (
          cols.length !== b.items.length ||
          new Set(b.items.map((i) => i.id)).size !== cols.length ||
          cols.some((c) => !b.items.some((i) => i.id === c.id))
        )
          fail(409, "VERSION_CONFLICT", "专栏列表已变化");
        for (const [i, c] of b.items.entries())
          await update(tx, "note_columns", c.id, r.familyId, c.version, {
            sort_order: i,
            updated_by: r.user.id,
          });
      });
      return data({ sorted: true });
    },
  );
  app.post(`${scope}/notes/import`, { preHandler: project }, async (r) => {
    allow(r);
    const b = z
      .object({ items: z.array(noteSchema).min(1).max(100) })
      .parse(r.body);
    return data(
      await writeTransaction(r, async (tx) => {
        const [count] = await tx.query(
          "SELECT count(*)::int AS count FROM notes WHERE project_id=$1 AND deleted_at IS NULL",
          [r.project.id],
        );
        if (count!.count + b.items.length > 1000)
          fail(422, "LIMIT", "导入后将超过 1000 条备忘上限");
        const result = [];
        for (const item of b.items) {
          await checkLinks(tx, r, item);
          result.push(
            await insert(tx, "notes", {
              id: id(),
              family_id: r.familyId,
              project_id: r.project.id,
              ...sqlData(item),
              ...actorFields(r.user.id),
            }),
          );
        }
        await audit(
          tx,
          r,
          "批量导入",
          "notes",
          r.project.id,
          `${result.length} 条备忘`,
        );
        return result;
      }),
    );
  });
  for (const table of [
    "costs",
    "materials",
    "stages",
    "notes",
    "note_columns",
  ]) {
    app.delete(`${scope}/${table}/:rid`, { preHandler: project }, async (r) => {
      allow(r, table === "stages" ? ["owner", "admin"] : undefined);
      const b = z
        .object({ version, confirm: z.boolean().optional() })
        .parse(r.body);
      return data(
        await writeTransaction(r, async (tx) => {
          const row = await resource(tx, r, table, (r.params as any).rid);
          if (table === "stages") {
            const [c] = await tx.query(
              "SELECT (SELECT count(*) FROM materials WHERE stage_id=$1)+(SELECT count(*) FROM costs WHERE stage_id=$1) AS count",
              [row.id],
            );
            if (Number(c!.count) > 0)
              fail(409, "STAGE_NOT_EMPTY", "阶段仍有材料或支出，不能删除");
          }
          if (table === "note_columns") {
            const [n] = await tx.query(
              "SELECT count(*)::int AS count FROM notes WHERE column_id=$1 AND deleted_at IS NULL",
              [row.id],
            );
            if (n!.count && !b.confirm)
              fail(
                409,
                "COLUMN_NOT_EMPTY",
                "专栏仍有备忘，请先移走或删除其中的备忘",
              );
          }
          const next = await update(tx, table, row.id, r.familyId, b.version, {
            deleted_at: new Date(),
            updated_by: r.user.id,
          });
          if (table === "note_columns")
            await tx.query(
              "UPDATE notes SET deleted_at=now(),version=version+1 WHERE column_id=$1 AND deleted_at IS NULL",
              [row.id],
            );
          await audit(tx, r, "删除记录", table, row.id, row.name || row.title);
          return next;
        }),
      );
    });
    app.post(
      `${scope}/${table}/:rid/restore`,
      { preHandler: project },
      async (r) => {
        allow(r, table === "stages" ? ["owner", "admin"] : undefined);
        const b = z.object({ version }).parse(r.body);
        return data(
          await writeTransaction(r, async (tx) => {
            const row = await resource(
              tx,
              r,
              table,
              (r.params as any).rid,
              true,
            );
            if (table === "notes")
              await resource(tx, r, "note_columns", row.columnId);
            if (table === "costs" && row.materialId) {
              const [m] = await tx.query(
                "SELECT stage_id FROM materials WHERE id=$1",
                [row.materialId],
              );
              row.stageId = m?.stageId ?? null;
            }
            const next = await update(
              tx,
              table,
              row.id,
              r.familyId,
              b.version,
              {
                deleted_at: null,
                updated_by: r.user.id,
                ...(table === "costs" ? { stage_id: row.stageId } : {}),
              },
            );
            await audit(
              tx,
              r,
              "恢复记录",
              table,
              row.id,
              row.name || row.title,
            );
            return next;
          }),
        );
      },
    );
  }
  app.get(`${scope}/statistics`, { preHandler: project }, async (r) =>
    db.transaction(async (tx) => {
      await tx.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const [currentProject] = await tx.query(
        "SELECT budget_cents FROM projects WHERE id=$1 AND family_id=$2",
        [r.project.id, r.familyId],
      );
      const args = [r.familyId, r.project.id];
      const [totals] = await tx.query(
        "SELECT COALESCE(sum(amount_cents),0) AS total_cents,COALESCE(sum(amount_cents) FILTER(WHERE payment_status='paid'),0) AS paid_cents,COALESCE(sum(amount_cents) FILTER(WHERE payment_status='pending'),0) AS pending_cents,count(*)::int AS cost_count FROM costs WHERE family_id=$1 AND project_id=$2 AND deleted_at IS NULL",
        args,
      );
      const [materials] = await tx.query(
        "SELECT COALESCE(sum(total_price_cents),0) AS planned_cents,count(*)::int AS material_count FROM materials WHERE family_id=$1 AND project_id=$2 AND deleted_at IS NULL",
        args,
      );
      const stages = await tx.query(
        "SELECT s.*,COALESCE((SELECT sum(c.amount_cents) FROM costs c WHERE c.stage_id=s.id AND c.deleted_at IS NULL),0) AS actual_cents,COALESCE((SELECT sum(m.total_price_cents) FROM materials m WHERE m.stage_id=s.id AND m.deleted_at IS NULL),0) AS planned_cents FROM stages s WHERE s.family_id=$1 AND s.project_id=$2 AND s.deleted_at IS NULL ORDER BY s.sort_order,s.created_at",
        args,
      );
      const byCategory = await tx.query(
        "SELECT category,sum(amount_cents) AS amount_cents FROM costs WHERE family_id=$1 AND project_id=$2 AND deleted_at IS NULL GROUP BY category ORDER BY amount_cents DESC",
        args,
      );
      const byMaterial = await tx.query(
        "SELECT material_id,COALESCE(sum(amount_cents),0) AS total_cents,COALESCE(sum(amount_cents) FILTER(WHERE payment_status='paid'),0) AS paid_cents,COALESCE(sum(amount_cents) FILTER(WHERE payment_status='pending'),0) AS pending_cents FROM costs WHERE family_id=$1 AND project_id=$2 AND deleted_at IS NULL AND material_id IS NOT NULL GROUP BY material_id",
        args,
      );
      const recent = await tx.query(
        "SELECT c.*,u.nickname AS creator_name FROM costs c JOIN users u ON c.created_by=u.id WHERE c.family_id=$1 AND c.project_id=$2 AND c.deleted_at IS NULL ORDER BY c.incurred_at DESC,c.created_at DESC LIMIT 5",
        args,
      );
      const [notes] = await tx.query(
        "SELECT count(*)::int AS pending_count FROM notes WHERE family_id=$1 AND project_id=$2 AND deleted_at IS NULL AND status='pending'",
        args,
      );
      return data({
        ...totals,
        ...materials,
        pendingNoteCount: notes!.pendingCount,
        budgetCents: currentProject!.budgetCents,
        balanceCents: currentProject!.budgetCents - totals!.totalCents,
        allocatedCents: stages.reduce((s, n) => s + n.budgetCents, 0),
        stages,
        byCategory,
        byMaterial,
        recent,
      });
    }),
  );
  return app;
}
