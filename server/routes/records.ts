import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RequestContext } from "../context.ts";
import { fail } from "../lib/errors.ts";
import { data, digest, param, scope } from "../lib/http.ts";
import { actorFields, audit, id, insert, sqlData, update } from "../lib/persistence.ts";
import { checkLinks, resource } from "../lib/resources.ts";
import {
  businessDate,
  costSchema,
  materialSchema,
  noteSchema,
  required,
  text,
  version,
} from "../schemas.ts";

export function registerRecordsRoutes(app: FastifyInstance, context: RequestContext) {
  const { db, project, allow, writeTransaction } = context;
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
          purchaseStatus: z.enum(["planned", "ordered", "purchased"]).optional(),
          columnId: z.string().optional(),
          status: z.enum(["pending", "confirmed"]).optional(),
          starred: z.enum(["true"]).optional(),
          from: businessDate.optional(),
          to: businessDate.optional(),
          deleted: z.enum(["true"]).optional(),
        })
        .parse(r.query);
      const args: unknown[] = [r.familyId, r.project.id];
      let where = `t.family_id=$1 AND t.project_id=$2 AND t.deleted_at IS ${q.deleted ? "NOT " : ""}NULL`;
      const add = (expression: string, value: unknown) => {
        args.push(value);
        where += ` AND ${expression.replace("?", `$${args.length}`)}`;
      };
      if (q.keyword)
        add(`t.${table === "materials" ? "name" : "title"} ILIKE ?`, `%${q.keyword}%`);
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
            if (count!.count >= 1000) fail(422, "LIMIT", "每个项目最多 1000 条有效备忘");
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
          const row = await resource(tx, r, table, param(r, "rid"));
          await checkLinks(tx, r, b);
          const next = await update(tx, table, row.id, r.familyId, v, {
            ...sqlData(b),
            updated_by: r.user.id,
          });
          if (table === "materials" && "stageId" in b && b.stageId !== row.stageId)
            await tx.query(
              "UPDATE costs SET stage_id=$1,version=version+1,updated_by=$2,updated_at=now() WHERE family_id=$3 AND project_id=$4 AND material_id=$5",
              [b.stageId, r.user.id, r.familyId, r.project.id, row.id],
            );
          await audit(tx, r, "修改记录", table, row.id, next.name || next.title);
          return next;
        }),
      );
    });
  }
  for (const table of ["costs", "materials", "stages", "notes", "note_columns"]) {
    app.delete(`${scope}/${table}/:rid`, { preHandler: project }, async (r) => {
      allow(r, table === "stages" ? ["owner", "admin"] : undefined);
      const b = z.object({ version, confirm: z.boolean().optional() }).parse(r.body);
      return data(
        await writeTransaction(r, async (tx) => {
          const row = await resource(tx, r, table, param(r, "rid"));
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
              fail(409, "COLUMN_NOT_EMPTY", "专栏仍有备忘，请先移走或删除其中的备忘");
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
    app.post(`${scope}/${table}/:rid/restore`, { preHandler: project }, async (r) => {
      allow(r, table === "stages" ? ["owner", "admin"] : undefined);
      const b = z.object({ version }).parse(r.body);
      return data(
        await writeTransaction(r, async (tx) => {
          const row = await resource(tx, r, table, param(r, "rid"), true);
          if (table === "notes") await resource(tx, r, "note_columns", row.columnId);
          if (table === "costs" && row.materialId) {
            const [m] = await tx.query("SELECT stage_id FROM materials WHERE id=$1", [
              row.materialId,
            ]);
            row.stageId = m?.stageId ?? null;
          }
          const next = await update(tx, table, row.id, r.familyId, b.version, {
            deleted_at: null,
            updated_by: r.user.id,
            ...(table === "costs" ? { stage_id: row.stageId } : {}),
          });
          await audit(tx, r, "恢复记录", table, row.id, row.name || row.title);
          return next;
        }),
      );
    });
  }
}
