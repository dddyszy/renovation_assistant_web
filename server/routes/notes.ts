import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  createNotesArchive,
  NOTES_FILE_LIMIT,
  NotesCapacityError,
  parseNotesArchive,
} from "../../shared/notes-transfer.ts";
import { APP_VERSION } from "../../shared/version.ts";
import type { RequestContext } from "../context.ts";
import { fail } from "../lib/errors.ts";
import { data, digest, param, scope } from "../lib/http.ts";
import { actorFields, audit, id, insert, sqlData, update } from "../lib/persistence.ts";
import { attachNoteImages } from "../lib/note-images.ts";
import { checkLinks, resource } from "../lib/resources.ts";
import { noteSchema, required, version } from "../schemas.ts";
import { importProjectNotes, readProjectNotes } from "../services/notes-transfer.ts";

const shareDuration = z.object({
  // 0 means permanent; it is stored as a far-future timestamp so existing queries stay simple.
  days: z.union([z.literal(0), z.literal(7), z.literal(30)]).default(7),
});
const PERMANENT_EXPIRY = new Date("9999-12-31T23:59:59.000Z");
const shareExpiry = (days: number) =>
  days === 0 ? PERMANENT_EXPIRY : new Date(Date.now() + days * 24 * 3600e3);

export function registerNotesRoutes(app: FastifyInstance, context: RequestContext) {
  const { db, project, allow, writeTransaction } = context;
  app.get(`${scope}/notes/export`, { preHandler: project }, async (r) => {
    const query = z.object({ columnId: z.string().optional() }).parse(r.query);
    return db.transaction(async (tx) => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const current = await readProjectNotes(tx, r.familyId, r.project.id);
      const index = query.columnId
        ? current.columns.findIndex((column) => column.id === query.columnId)
        : -1;
      if (query.columnId && index < 0) fail(404, "NOT_FOUND", "专栏不存在");
      try {
        return data(
          createNotesArchive(
            "web",
            r.project.name,
            query.columnId ? [current.portable[index]!] : current.portable,
            APP_VERSION,
          ),
        );
      } catch (error) {
        fail(
          422,
          "INVALID_NOTES_EXPORT",
          error instanceof Error ? error.message : "备忘无法导出",
        );
      }
    });
  });
  app.post(
    `${scope}/notes/import-file`,
    { preHandler: project, bodyLimit: NOTES_FILE_LIMIT },
    async (r) => {
      allow(r);
      let archive;
      try {
        archive = parseNotesArchive(r.body);
      } catch (error) {
        fail(
          422,
          "INVALID_NOTES_FILE",
          error instanceof Error ? error.message : "备忘文件格式不正确",
        );
      }
      return data(
        await writeTransaction(r, async (tx) => {
          let result;
          try {
            result = await importProjectNotes(
              tx,
              archive!,
              r.familyId,
              r.project.id,
              r.user.id,
            );
          } catch (error) {
            // Capacity errors are user input errors; preserve database failures for the common handler.
            if (error instanceof NotesCapacityError) fail(422, "LIMIT", error.message);
            throw error;
          }
          if (result.added || result.createdColumns)
            await audit(
              tx,
              r,
              "导入备忘文件",
              "notes",
              r.project.id,
              `新增 ${result.added} 条，跳过 ${result.skipped} 条`,
            );
          return result;
        }),
      );
    },
  );
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
  app.post(`${scope}/notes/:rid/share`, { preHandler: project }, async (r) => {
    allow(r);
    const b = shareDuration.parse(r.body ?? {});
    return data(
      await writeTransaction(r, async (tx) => {
        const note = await resource(tx, r, "notes", param(r, "rid"));
        await tx.query(
          "UPDATE note_shares SET revoked_at=now() WHERE note_id=$1 AND revoked_at IS NULL",
          [note.id],
        );
        const token = randomBytes(32).toString("hex");
        const expiresAt = shareExpiry(b.days);
        await insert(tx, "note_shares", {
          id: id(),
          note_id: note.id,
          family_id: r.familyId,
          project_id: r.project.id,
          token_hash: digest(token),
          created_by: r.user.id,
          expires_at: expiresAt,
        });
        await audit(tx, r, "分享备忘", "notes", note.id, note.title);
        return {
          token,
          path: `/share/note/${token}`,
          expiresAt: b.days === 0 ? null : expiresAt,
        };
      }),
    );
  });
  app.delete(`${scope}/notes/:rid/share`, { preHandler: project }, async (r) => {
    allow(r);
    return data(
      await writeTransaction(r, async (tx) => {
        const note = await resource(tx, r, "notes", param(r, "rid"));
        await tx.query(
          "UPDATE note_shares SET revoked_at=now() WHERE note_id=$1 AND revoked_at IS NULL",
          [note.id],
        );
        await audit(tx, r, "停止分享备忘", "notes", note.id, note.title);
        return { revoked: true };
      }),
    );
  });
  const imageBody = z.object({
    data: z.string().min(1).max(6_000_000),
    mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
    width: z.number().int().min(0).max(10000).default(0),
    height: z.number().int().min(0).max(10000).default(0),
  });
  app.post(
    `${scope}/notes/:rid/images`,
    { preHandler: project, bodyLimit: 8 * 1024 * 1024 },
    async (r) => {
      allow(r);
      const b = imageBody.parse(r.body);
      const bytes = Buffer.from(b.data, "base64");
      if (bytes.length < 16 || bytes.length > 3 * 1024 * 1024)
        fail(422, "INVALID_IMAGE", "图片需小于 3MB");
      const detected = imageMime(bytes);
      if (!detected || detected !== b.mime)
        fail(422, "INVALID_IMAGE", "仅支持 JPEG、PNG 或 WebP 图片");
      return data(
        await writeTransaction(r, async (tx) => {
          const note = await resource(tx, r, "notes", param(r, "rid"));
          const [count] = await tx.query(
            "SELECT count(*)::int AS count FROM note_images WHERE note_id=$1 AND deleted_at IS NULL",
            [note.id],
          );
          if (count!.count >= 6) fail(422, "LIMIT", "每条备忘最多 6 张图片");
          const image = await insert(tx, "note_images", {
            id: id(),
            note_id: note.id,
            family_id: r.familyId,
            project_id: r.project.id,
            mime: b.mime,
            width: b.width,
            height: b.height,
            bytes,
            sort_order: count!.count,
            created_by: r.user.id,
          });
          await audit(tx, r, "上传备忘图片", "notes", note.id, note.title);
          return {
            id: image.id,
            mime: image.mime,
            width: image.width,
            height: image.height,
          };
        }),
      );
    },
  );
  app.get(
    `${scope}/notes/:rid/images/:imageId`,
    { preHandler: project },
    async (r, reply) => {
      const [row] = await db.query(
        `SELECT i.mime,i.bytes FROM note_images i
           JOIN notes n ON n.id=i.note_id AND n.deleted_at IS NULL
          WHERE i.id=$1 AND i.note_id=$2 AND i.family_id=$3 AND i.project_id=$4
            AND n.family_id=$3 AND n.project_id=$4 AND i.deleted_at IS NULL`,
        [param(r, "imageId"), param(r, "rid"), r.familyId, r.project.id],
      );
      if (!row) fail(404, "NOT_FOUND", "图片不存在");
      return reply
        .type(row.mime)
        .header("Cache-Control", "private, max-age=300")
        .send(Buffer.from(row.bytes));
    },
  );
  app.delete(
    `${scope}/notes/:rid/images/:imageId`,
    { preHandler: project },
    async (r) => {
      allow(r);
      return data(
        await writeTransaction(r, async (tx) => {
          const note = await resource(tx, r, "notes", param(r, "rid"));
          const [image] = await tx.query(
            "SELECT id FROM note_images WHERE id=$1 AND note_id=$2 AND family_id=$3 AND project_id=$4 AND deleted_at IS NULL",
            [param(r, "imageId"), note.id, r.familyId, r.project.id],
          );
          if (!image) fail(404, "NOT_FOUND", "图片不存在");
          await tx.query("UPDATE note_images SET deleted_at=now() WHERE id=$1", [
            image.id,
          ]);
          await audit(tx, r, "删除备忘图片", "notes", note.id, note.title);
          return { deleted: true };
        }),
      );
    },
  );
  app.post(`${scope}/note-columns/:rid/share`, { preHandler: project }, async (r) => {
    allow(r);
    const b = shareDuration.parse(r.body ?? {});
    return data(
      await writeTransaction(r, async (tx) => {
        const column = await resource(tx, r, "note_columns", param(r, "rid"));
        await tx.query(
          "UPDATE note_column_shares SET revoked_at=now() WHERE column_id=$1 AND revoked_at IS NULL",
          [column.id],
        );
        const token = randomBytes(32).toString("hex");
        const expiresAt = shareExpiry(b.days);
        await insert(tx, "note_column_shares", {
          id: id(),
          column_id: column.id,
          family_id: r.familyId,
          project_id: r.project.id,
          token_hash: digest(token),
          created_by: r.user.id,
          expires_at: expiresAt,
        });
        await audit(tx, r, "分享备忘专栏", "note_columns", column.id, column.name);
        return {
          token,
          path: `/share/column/${token}`,
          expiresAt: b.days === 0 ? null : expiresAt,
        };
      }),
    );
  });
  app.delete(`${scope}/note-columns/:rid/share`, { preHandler: project }, async (r) => {
    allow(r);
    return data(
      await writeTransaction(r, async (tx) => {
        const column = await resource(tx, r, "note_columns", param(r, "rid"));
        await tx.query(
          "UPDATE note_column_shares SET revoked_at=now() WHERE column_id=$1 AND revoked_at IS NULL",
          [column.id],
        );
        await audit(tx, r, "停止分享备忘专栏", "note_columns", column.id, column.name);
        return { revoked: true };
      }),
    );
  });
  app.get("/api/v1/share/columns/:token", async (r) => {
    const token = z.object({ token: z.string().min(32).max(128) }).parse(r.params).token;
    const [column] = await db.query(
      `SELECT c.id,c.name,c.family_id,c.project_id,u.nickname AS creator_name
         FROM note_column_shares s
         JOIN note_columns c ON c.id=s.column_id AND c.deleted_at IS NULL
         JOIN users u ON u.id=c.created_by
        WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()`,
      [digest(token)],
    );
    if (!column) fail(404, "NOT_FOUND", "分享链接不存在或已过期");
    const [count] = await db.query(
      "SELECT count(*)::int AS count FROM notes WHERE column_id=$1 AND family_id=$2 AND project_id=$3 AND deleted_at IS NULL",
      [column.id, column.familyId, column.projectId],
    );
    const notes = await db.query(
      `SELECT n.id,n.title,n.details,n.starred,n.status,n.created_at,u.nickname AS creator_name
         FROM notes n JOIN users u ON u.id=n.created_by
        WHERE n.column_id=$1 AND n.family_id=$2 AND n.project_id=$3 AND n.deleted_at IS NULL
        ORDER BY n.starred DESC,n.created_at DESC,n.id DESC LIMIT 200`,
      [column.id, column.familyId, column.projectId],
    );
    return data({
      name: column.name,
      creatorName: column.creatorName,
      total: count!.count,
      notes: await attachNoteImages(db, notes),
    });
  });
  app.get("/api/v1/share/columns/:token/images/:imageId", async (r, reply) => {
    const p = z
      .object({
        token: z.string().min(32).max(128),
        imageId: z.string().min(1).max(64),
      })
      .parse(r.params);
    const [row] = await db.query(
      `SELECT i.mime,i.bytes FROM note_column_shares s
         JOIN note_columns c ON c.id=s.column_id AND c.deleted_at IS NULL
         JOIN notes n ON n.column_id=c.id AND n.deleted_at IS NULL
         JOIN note_images i ON i.note_id=n.id AND i.deleted_at IS NULL
        WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND i.id=$2`,
      [digest(p.token), p.imageId],
    );
    if (!row) fail(404, "NOT_FOUND", "图片不存在");
    return reply
      .type(row.mime)
      .header("Cache-Control", "no-store")
      .send(Buffer.from(row.bytes));
  });
  app.get("/api/v1/share/notes/:token/images/:imageId", async (r, reply) => {
    const p = z
      .object({
        token: z.string().min(32).max(128),
        imageId: z.string().min(1).max(64),
      })
      .parse(r.params);
    const [row] = await db.query(
      `SELECT i.mime,i.bytes FROM note_shares s
         JOIN notes n ON n.id=s.note_id AND n.deleted_at IS NULL
         JOIN note_images i ON i.note_id=n.id AND i.deleted_at IS NULL
        WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()
          AND i.id=$2`,
      [digest(p.token), p.imageId],
    );
    if (!row) fail(404, "NOT_FOUND", "图片不存在");
    return reply
      .type(row.mime)
      .header("Cache-Control", "no-store")
      .send(Buffer.from(row.bytes));
  });
  app.get("/api/v1/share/notes/:token", async (r) => {
    const token = z.object({ token: z.string().min(32).max(128) }).parse(r.params).token;
    const [row] = await db.query(
      `SELECT n.id,n.title,n.details,n.starred,n.status,n.created_at,n.updated_at,
              u.nickname AS creator_name,c.name AS column_name
         FROM note_shares s
         JOIN notes n ON n.id=s.note_id AND n.deleted_at IS NULL
         JOIN note_columns c ON c.id=n.column_id
         JOIN users u ON u.id=n.created_by
        WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()`,
      [digest(token)],
    );
    if (!row) fail(404, "NOT_FOUND", "分享链接不存在或已过期");
    const images = await db.query(
      `SELECT id,mime,width,height FROM note_images
        WHERE note_id=$1 AND deleted_at IS NULL ORDER BY sort_order,created_at`,
      [row.id],
    );
    return data({
      title: row.title,
      details: row.details,
      images,
      starred: row.starred,
      status: row.status,
      columnName: row.columnName,
      creatorName: row.creatorName,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
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

function imageMime(bytes: Buffer): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return "image/png";
  if (
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  return null;
}
