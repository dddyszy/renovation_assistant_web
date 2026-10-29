import type { User, Project } from "../shared/api.ts";
import { verify } from "@node-rs/argon2";
import type { FastifyRequest } from "fastify";
import type { Db } from "./db.ts";
import { fail } from "./lib/errors.ts";
import { digest, param } from "./lib/http.ts";
declare module "fastify" {
  interface FastifyRequest {
    user: User;
    role: string;
    familyId: string;
    project: Project;
  }
}

export function createRequestContext(db: Db) {
  const auth = async (r: FastifyRequest) => {
    const token = r.cookies.session;
    if (!token) fail(401, "UNAUTHENTICATED", "请先登录");
    const [user] = await db.query<User>(
      "SELECT u.id,u.email,u.nickname FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now()",
      [digest(token!)],
    );
    r.user = user || fail(401, "UNAUTHENTICATED", "登录已过期，请重新登录");
  };
  const family = async (r: FastifyRequest) => {
    await auth(r);
    const fid = param(r, "fid");
    const [member] = await db.query(
      "SELECT role FROM family_members WHERE family_id=$1 AND user_id=$2",
      [fid, r.user.id],
    );
    r.role = member?.role || fail(404, "NOT_FOUND", "家庭不存在或你已不在这个家庭");
    r.familyId = fid;
  };
  const project = async (r: FastifyRequest) => {
    await family(r);
    const [row] = await db.query<Project>(
      "SELECT * FROM projects WHERE id=$1 AND family_id=$2 AND deleted_at IS NULL",
      [param(r, "pid"), r.familyId],
    );
    r.project = row || fail(404, "NOT_FOUND", "项目不存在");
  };
  const allow = (r: FastifyRequest, list = ["owner", "admin", "member"]) => {
    if (!list.includes(r.role)) fail(403, "FORBIDDEN", "你没有此操作权限");
    if (r.project?.status === "archived") fail(409, "ARCHIVED", "请先恢复已归档项目");
  };
  async function writeTransaction<T>(
    r: FastifyRequest,
    fn: (tx: Db) => Promise<T>,
  ): Promise<T> {
    return db.transaction(async (tx) => {
      if (r.familyId) {
        await tx.query("SELECT id FROM families WHERE id=$1 FOR UPDATE", [r.familyId]);
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
  const reauthenticate = async (r: FastifyRequest, pw: string) => {
    const [u] = await db.query("SELECT password_hash FROM users WHERE id=$1", [
      r.user.id,
    ]);
    if (!u || !(await verify(u.passwordHash, pw).catch(() => false)))
      fail(422, "INVALID_PASSWORD", "密码不正确，无法执行此操作");
  };
  return { db, auth, family, project, allow, writeTransaction, reauthenticate };
}
export type RequestContext = ReturnType<typeof createRequestContext>;
