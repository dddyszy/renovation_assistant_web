import { hash, verify } from "@node-rs/argon2";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { APP_VERSION } from "../../shared/version.ts";
import type { RequestContext } from "../context.ts";
import { fail, hasErrorCode } from "../lib/errors.ts";
import { authLimit, data, digest } from "../lib/http.ts";
import { id, insert } from "../lib/persistence.ts";
import { email, password, required } from "../schemas.ts";
import { sendMail } from "../services/mail.ts";

export function registerAuthRoutes(
  app: FastifyInstance,
  context: RequestContext,
  production: boolean,
  origin: string,
) {
  const { db, auth, writeTransaction } = context;
  app.get("/api/v1/health", async () => {
    await db.query("SELECT 1");
    return data({
      status: "ok",
      version: APP_VERSION,
      localMail: !production && !process.env.SMTP_HOST,
    });
  });
  app.post("/api/v1/auth/register", { config: { rateLimit: authLimit } }, async (r) => {
    const b = z.object({ email, password, nickname: required(30) }).parse(r.body);
    const passwordHash = await hash(b.password);
    try {
      await insert(db, "users", {
        id: id(),
        email: b.email,
        password_hash: passwordHash,
        nickname: b.nickname,
      });
    } catch (error) {
      if (hasErrorCode(error, "23505"))
        fail(409, "EMAIL_EXISTS", "该邮箱已注册，请直接登录");
      throw error;
    }
    return data({ registered: true });
  });
  app.post(
    "/api/v1/auth/login",
    { config: { rateLimit: authLimit } },
    async (r, reply) => {
      const b = z.object({ email, password: z.string().max(128) }).parse(r.body);
      const [u] = await db.query("SELECT * FROM users WHERE email=$1", [b.email]);
      const dummy =
        "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$VRq7lrVEBwDe7tb2yWnzATIVWAnY2qCs/qBoJQ+QZds";
      const valid = await verify(u?.passwordHash || dummy, b.password).catch(() => false);
      if (!u || !valid) fail(401, "INVALID_CREDENTIALS", "邮箱或密码不正确");
      const token = randomBytes(32).toString("hex");
      await insert(db, "sessions", {
        token_hash: digest(token),
        user_id: u.id,
        expires_at: new Date(Date.now() + 14 * 24 * 3600e3),
      });
      reply.setCookie("session", token, {
        httpOnly: true,
        secure: origin.startsWith("https://"),
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
      const [u] = await db.query("SELECT id FROM users WHERE email=$1", [b.email]);
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
        ...(!production && !process.env.SMTP_HOST && u ? { devToken: token } : {}),
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
}
