import type { FastifyRequest } from "fastify";
import type { Db, Row } from "../db.ts";
import { fail } from "./errors.ts";
export const resource = async (
  tx: Db,
  r: FastifyRequest,
  table: string,
  rid: string,
  deleted = false,
) => {
  const [row] = await tx.query(
    `SELECT * FROM ${table} WHERE id=$1 AND family_id=$2 AND project_id=$3 AND deleted_at IS ${deleted ? "NOT " : ""}NULL`,
    [rid, r.familyId, r.project.id],
  );
  return row || fail(404, "NOT_FOUND", "记录不存在");
};
export const checkLinks = async (tx: Db, r: FastifyRequest, b: Row) => {
  if (b.stageId) await resource(tx, r, "stages", b.stageId);
  if (b.materialId) {
    const m = await resource(tx, r, "materials", b.materialId);
    if (m.stageId !== b.stageId) fail(422, "INVALID_LINK", "材料与支出必须属于同一阶段");
  }
  if (b.columnId) await resource(tx, r, "note_columns", b.columnId);
};
