import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { createRequestContext } from "./context.ts";
import type { Db } from "./db.ts";
import { readAppOrigin } from "./lib/origin.ts";
import { registerSecurity } from "./plugins/security.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import { registerFamiliesRoutes } from "./routes/families.ts";
import { registerNotesRoutes } from "./routes/notes.ts";
import { registerProjectsRoutes } from "./routes/projects.ts";
import { registerRecordsRoutes } from "./routes/records.ts";
import { registerStagesRoutes } from "./routes/stages.ts";
import { registerStatisticsRoutes } from "./routes/statistics.ts";

export async function createApp(db: Db, options: { testing?: boolean } = {}) {
  const production = process.env.NODE_ENV === "production";
  const origin = readAppOrigin(process.env.APP_ORIGIN, production);
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
  registerSecurity(app, production, origin);
  const context = createRequestContext(db);
  registerAuthRoutes(app, context, production, origin);
  registerFamiliesRoutes(app, context);
  registerProjectsRoutes(app, context);
  registerStagesRoutes(app, context);
  registerRecordsRoutes(app, context);
  registerNotesRoutes(app, context);
  registerStatisticsRoutes(app, context);
  return app;
}
