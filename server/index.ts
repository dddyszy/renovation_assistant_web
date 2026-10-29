import "dotenv/config";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import fastifyStatic from "@fastify/static";
import { createDb } from "./db.ts";
import { createApp } from "./app.ts";
const db = await createDb();
const app = await createApp(db);
if (existsSync(resolve("dist/index.html"))) {
  await app.register(fastifyStatic, {
    root: resolve("dist"),
    preCompressed: true,
    setHeaders(response, path) {
      response.header(
        "Cache-Control",
        path.includes("/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      );
    },
  });
  app.setNotFoundHandler((r, reply) =>
    r.url.startsWith("/api/")
      ? reply
          .code(404)
          .send({ error: { code: "NOT_FOUND", message: "接口不存在" } })
      : reply.sendFile("index.html"),
  );
}
await app.listen({
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || "127.0.0.1",
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    await app.close();
    await db.close();
    process.exit(0);
  });
