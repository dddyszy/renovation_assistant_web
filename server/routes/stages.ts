import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RequestContext } from "../context.ts";
import { fail } from "../lib/errors.ts";
import { data, param, scope } from "../lib/http.ts";
import { actorFields, audit, id, insert, sqlData, update } from "../lib/persistence.ts";
import { resource } from "../lib/resources.ts";
import { cents, required, version } from "../schemas.ts";

export function registerStagesRoutes(app: FastifyInstance, context: RequestContext) {
  const { db, project, allow, writeTransaction } = context;
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
    const b = z.object({ name: required(60), budgetCents: cents }).parse(r.body);
    return data(
      await writeTransaction(r, async (tx) => {
        await tx.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [r.project.id]);
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
        const s = await resource(tx, r, "stages", param(r, "rid"));
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
}
