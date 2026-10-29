import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError, fail, hasErrorCode } from "../lib/errors.ts";
export function registerSecurity(
  app: FastifyInstance,
  production: boolean,
  origin: string,
) {
  app.setErrorHandler((error, _req, reply) => {
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error
        ? error.statusCode
        : undefined;
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
    if (statusCode === 429)
      return reply.code(429).send({
        error: { code: "RATE_LIMIT", message: "操作太频繁，请稍后再试" },
      });
    if (statusCode === 400 || statusCode === 413)
      return reply.code(statusCode).send({
        error: { code: "INVALID_REQUEST", message: "请求内容不正确或过大" },
      });
    if (hasErrorCode(error, "23505"))
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
        ...(!production ? ["http://localhost:5173", "http://127.0.0.1:5173"] : []),
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
}
