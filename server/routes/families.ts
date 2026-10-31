import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { RequestContext } from "../context.ts";
import type { Db } from "../db.ts";
import { fail } from "../lib/errors.ts";
import { authLimit, data, digest, param } from "../lib/http.ts";
import { audit, id, insert } from "../lib/persistence.ts";
import { required } from "../schemas.ts";
import { eraseProject } from "../services/projects.ts";

export function registerFamiliesRoutes(app: FastifyInstance, context: RequestContext) {
  const { db, auth, family, allow, writeTransaction, reauthenticate } = context;
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
    const [f] = await db.query("UPDATE families SET name=$1 WHERE id=$2 RETURNING *", [
      b.name,
      r.familyId,
    ]);
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
  app.patch("/api/v1/families/:fid/members/:uid", { preHandler: family }, async (r) => {
    allow(r, ["owner", "admin"]);
    const b = z.object({ role: z.enum(["admin", "member", "viewer"]) }).parse(r.body);
    const uid = param(r, "uid");
    await writeTransaction(r, async (tx) => {
      await tx.query("SELECT id FROM families WHERE id=$1 FOR UPDATE", [r.familyId]);
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
        (current?.role === "admin" && (target!.role === "admin" || b.role === "admin"))
      )
        fail(403, "FORBIDDEN", "不能调整该成员权限");
      await tx.query(
        "UPDATE family_members SET role=$1 WHERE family_id=$2 AND user_id=$3",
        [b.role, r.familyId, uid],
      );
      await audit(tx, r, "调整权限", "member", uid, b.role);
    });
    return data({ updated: true });
  });
  app.delete("/api/v1/families/:fid/members/:uid", { preHandler: family }, async (r) => {
    allow(r, ["owner", "admin"]);
    const uid = param(r, "uid");
    await writeTransaction(r, async (tx) => {
      await tx.query("SELECT id FROM families WHERE id=$1 FOR UPDATE", [r.familyId]);
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
      await tx.query("DELETE FROM family_members WHERE family_id=$1 AND user_id=$2", [
        r.familyId,
        uid,
      ]);
      await audit(tx, r, "移除成员", "member", uid, "家庭成员");
    });
    return data({ removed: true });
  });
  app.post("/api/v1/families/:fid/leave", { preHandler: family }, async (r) => {
    await writeTransaction(r, async (tx) => {
      await tx.query("SELECT id FROM families WHERE id=$1 FOR UPDATE", [r.familyId]);
      const [m] = await tx.query(
        "SELECT role FROM family_members WHERE family_id=$1 AND user_id=$2",
        [r.familyId, r.user.id],
      );
      if (m?.role === "owner") fail(409, "OWNER_REQUIRED", "请先转让家庭所有权");
      await tx.query("DELETE FROM family_members WHERE family_id=$1 AND user_id=$2", [
        r.familyId,
        r.user.id,
      ]);
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
        const [f] = await tx.query("SELECT * FROM families WHERE id=$1 FOR UPDATE", [
          r.familyId,
        ]);
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
  app.get("/api/v1/families/:fid/invitations", { preHandler: family }, async (r) => {
    allow(r, ["owner", "admin"]);
    return data(
      await db.query(
        "SELECT id,role,expires_at,used_by,revoked_at FROM invitations WHERE family_id=$1 ORDER BY created_at DESC LIMIT 30",
        [r.familyId],
      ),
    );
  });
  app.post("/api/v1/families/:fid/invitations", { preHandler: family }, async (r) => {
    allow(r, ["owner", "admin"]);
    const b = z.object({ role: z.enum(["admin", "member", "viewer"]) }).parse(r.body);
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
  });
  app.delete(
    "/api/v1/families/:fid/invitations/:iid",
    { preHandler: family },
    async (r) => {
      allow(r, ["owner", "admin"]);
      const [i] = await db.query(
        "SELECT role FROM invitations WHERE id=$1 AND family_id=$2",
        [param(r, "iid"), r.familyId],
      );
      if (!i) fail(404, "NOT_FOUND", "邀请不存在");
      if (i!.role === "admin" && r.role !== "owner")
        fail(403, "FORBIDDEN", "仅所有者可撤销此邀请");
      await db.query(
        "UPDATE invitations SET revoked_at=now() WHERE id=$1 AND family_id=$2",
        [param(r, "iid"), r.familyId],
      );
      return data({ revoked: true });
    },
  );
  const checkInvite = async (tx: Db, token: string, lock = false) => {
    const [i] = await tx.query(
      `SELECT i.*,f.name AS family_name FROM invitations i JOIN families f ON f.id=i.family_id WHERE i.token_hash=$1 ${lock ? "FOR UPDATE OF i" : ""}`,
      [digest(token)],
    );
    if (!i || i.revokedAt || i.usedBy || new Date(i.expiresAt).getTime() < Date.now())
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
  app.get("/api/v1/invitations/:token/preview", { preHandler: auth }, async (r) => {
    const i = await checkInvite(db, param(r, "token"));
    return data({
      familyName: i.familyName,
      role: i.role,
      expiresAt: i.expiresAt,
    });
  });
  app.post("/api/v1/invitations/:token/accept", { preHandler: auth }, async (r) =>
    data(
      await writeTransaction(r, async (tx) => {
        const i = await checkInvite(tx, param(r, "token"), true);
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
  app.get("/api/v1/families/:fid/audit-logs", { preHandler: family }, async (r) =>
    data(
      await db.query(
        "SELECT a.*,u.nickname AS actor_name FROM audit_logs a JOIN users u ON a.actor_user_id=u.id WHERE a.family_id=$1 ORDER BY a.created_at DESC LIMIT 60",
        [r.familyId],
      ),
    ),
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
        const [f] = await tx.query("SELECT name FROM families WHERE id=$1 FOR UPDATE", [
          r.familyId,
        ]);
        if (f?.name !== b.confirmName)
          fail(422, "CONFIRMATION_REQUIRED", "请输入完整家庭名称");
        const ps = await tx.query("SELECT id FROM projects WHERE family_id=$1", [
          r.familyId,
        ]);
        for (const p of ps) await eraseProject(tx, p.id, r.familyId);
        for (const table of [
          "invitations",
          "audit_logs",
          "family_members",
          "user_preferences",
        ])
          await tx.query(`DELETE FROM ${table} WHERE family_id=$1`, [r.familyId]);
        await tx.query("DELETE FROM families WHERE id=$1", [r.familyId]);
      });
      return data({ deleted: true });
    },
  );
}
