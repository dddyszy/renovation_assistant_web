import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { templates } from "../../shared/domain.ts";
import type { RequestContext } from "../context.ts";
import { fail } from "../lib/errors.ts";
import { authLimit, data, scope } from "../lib/http.ts";
import { actorFields, audit, id, insert, sqlData, update } from "../lib/persistence.ts";
import {
  cents,
  optionalDate,
  projectSchema,
  required,
  text,
  version,
} from "../schemas.ts";
import { eraseProject } from "../services/projects.ts";

export function registerProjectsRoutes(app: FastifyInstance, context: RequestContext) {
  const { db, family, project, allow, writeTransaction, reauthenticate } = context;
  app.get("/api/v1/families/:fid/projects", { preHandler: family }, async (r) =>
    data(
      await db.query(
        "SELECT * FROM projects WHERE family_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC",
        [r.familyId],
      ),
    ),
  );
  app.post("/api/v1/families/:fid/projects", { preHandler: family }, async (r) => {
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
      for (const [i, name] of ["事前确认", "设计需求点", "灵感与想法"].entries())
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
  });
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
    if (!["owner", "admin"].includes(r.role)) fail(403, "FORBIDDEN", "你没有此操作权限");
    const b = z.object({ version, archived: z.boolean() }).parse(r.body);
    return data(
      await writeTransaction(r, async (tx) => {
        const p = await update(tx, "projects", r.project.id, r.familyId, b.version, {
          status: b.archived ? "archived" : "active",
          updated_by: r.user.id,
        });
        await audit(tx, r, b.archived ? "归档项目" : "恢复项目", "project", p.id, p.name);
        return p;
      }),
    );
  });
  app.delete(
    scope,
    { preHandler: project, config: { rateLimit: authLimit } },
    async (r) => {
      if (r.role !== "owner") fail(403, "FORBIDDEN", "仅家庭所有者可以永久删除项目");
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
        const [p] = await tx.query("SELECT * FROM projects WHERE id=$1 FOR UPDATE", [
          r.project.id,
        ]);
        if (p?.version !== b.version || p.status !== "archived")
          fail(409, "VERSION_CONFLICT", "项目状态已变化，请刷新");
        await eraseProject(tx, r.project.id, r.familyId);
        await audit(tx, r, "永久删除项目", "project", r.project.id, r.project.name);
      });
      return data({ deleted: true });
    },
  );
}
