import type { FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const scope = "/api/v1/families/:fid/projects/:pid";
export const authLimit = { max: 10, timeWindow: "15 minutes" };
export const data = <T>(value: T, meta?: Record<string, unknown>) => ({
  data: value,
  ...(meta ? { meta } : {}),
});
// All route parameters are strings; reject a missing parameter at the HTTP boundary.
export function param(request: FastifyRequest, name: string): string {
  return z.record(z.string(), z.string()).parse(request.params)[name]!;
}
