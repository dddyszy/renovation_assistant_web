import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RequestContext } from "../context.ts";
import { fail } from "../lib/errors.ts";
import { data, param, scope } from "../lib/http.ts";
import { actorFields, audit, id, insert, sqlData, update } from "../lib/persistence.ts";
import { checkLinks, resource } from "../lib/resources.ts";
import { noteSchema, required, version } from "../schemas.ts";

export function registerNotesRoutes(app: FastifyInstance, context: RequestContext) {
  const { db, project, allow, writeTransaction } = context;
  app.get(`${scope}/note-columns`, { preHandler: project }, async (r) =>
    data(
      await db.query(
        "SELECT * FROM note_columns WHERE family_id=$1 AND project_id=$2 AND deleted_at IS NULL ORDER BY sort_order,created_at",
        [r.familyId, r.project.id],
      ),
    ),
  );
  app.post(`${scope}/note-columns`, { preHandler: project }, async (r) => {
    allow(r);
    const b = z.object({ name: required(30) }).parse(r.body);
    return data(
      await writeTransaction(r, async (tx) => {
        await tx.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [r.project.id]);
        const columns = await tx.query(
          "SELECT name FROM note_columns WHERE project_id=$1 AND deleted_at IS NULL",
          [r.project.id],
        );
        if (columns.length >= 20 || columns.some((c) => c.name === b.name))
          fail(422, "INVALID_COLUMN", "专栏已存在或已达 20 个上限");
        const [last] = await tx.query(
          "SELECT COALESCE(max(sort_order),-1)+1 AS next FROM note_columns WHERE project_id=$1",
          [r.project.id],
        );
        return insert(tx, "note_columns", {
          id: id(),
          family_id: r.familyId,
          project_id: r.project.id,
          name: b.name,
          sort_order: Number(last!.next),
          ...actorFields(r.user.id),
        });
      }),
    );
  });
  app.patch(`${scope}/note-columns/:rid`, { preHandler: project }, async (r) => {
    allow(r);
    const b = z.object({ version, name: required(30) }).parse(r.body);
    return data(
      await writeTransaction(r, async (tx) => {
        await resource(tx, r, "note_columns", param(r, "rid"));
        const column = await update(
          tx,
          "note_columns",
          param(r, "rid"),
          r.familyId,
          b.version,
          { name: b.name, updated_by: r.user.id },
        );
        await audit(tx, r, "修改专栏", "note_columns", column.id, column.name);
        return column;
      }),
    );
  });
  app.post(`${scope}/note-columns/reorder`, { preHandler: project }, async (r) => {
    allow(r);
    const b = z
      .object({
        items: z.array(z.object({ id: required(), version })).max(20),
      })
      .parse(r.body);
    await writeTransaction(r, async (tx) => {
      const cols = await tx.query(
        "SELECT id FROM note_columns WHERE project_id=$1 AND deleted_at IS NULL FOR UPDATE",
        [r.project.id],
      );
      if (
        cols.length !== b.items.length ||
        new Set(b.items.map((i) => i.id)).size !== cols.length ||
        cols.some((c) => !b.items.some((i) => i.id === c.id))
      )
        fail(409, "VERSION_CONFLICT", "专栏列表已变化");
      for (const [i, c] of b.items.entries())
        await update(tx, "note_columns", c.id, r.familyId, c.version, {
          sort_order: i,
          updated_by: r.user.id,
        });
    });
    return data({ sorted: true });
  });
  app.post(`${scope}/notes/import`, { preHandler: project }, async (r) => {
    allow(r);
    const b = z.object({ items: z.array(noteSchema).min(1).max(100) }).parse(r.body);
    return data(
      await writeTransaction(r, async (tx) => {
        const [count] = await tx.query(
          "SELECT count(*)::int AS count FROM notes WHERE project_id=$1 AND deleted_at IS NULL",
          [r.project.id],
        );
        if (count!.count + b.items.length > 1000)
          fail(422, "LIMIT", "导入后将超过 1000 条备忘上限");
        const result = [];
        for (const item of b.items) {
          await checkLinks(tx, r, item);
          result.push(
            await insert(tx, "notes", {
              id: id(),
              family_id: r.familyId,
              project_id: r.project.id,
              ...sqlData(item),
              ...actorFields(r.user.id),
            }),
          );
        }
        await audit(tx, r, "批量导入", "notes", r.project.id, `${result.length} 条备忘`);
        return result;
      }),
    );
  });
}
