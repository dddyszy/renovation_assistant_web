import type { FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import type { Db, Row } from "../db.ts";
import { fail } from "./errors.ts";
export const id = () => randomUUID();
export const actorFields = (uid: string) => ({ created_by: uid, updated_by: uid });
const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
export const sqlData = (data: Row): Row =>
  Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      snake(key),
      key === "details" ? JSON.stringify(value) : value,
    ]),
  );
export async function insert(db: Db, table: string, data: Row) {
  const fields = Object.keys(data);
  const [row] = await db.query(
    `INSERT INTO ${table} (${fields.join(",")}) VALUES (${fields.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`,
    Object.values(data),
  );
  return row!;
}
export async function audit(
  db: Db,
  r: FastifyRequest,
  action: string,
  entityType: string,
  entityId: string,
  label: string,
) {
  await insert(db, "audit_logs", {
    id: id(),
    family_id: r.familyId,
    actor_user_id: r.user.id,
    action,
    entity_type: entityType,
    entity_id: entityId,
    label,
  });
}
export async function update(
  db: Db,
  table: string,
  rid: string,
  familyId: string,
  v: number,
  data: Row,
) {
  const fields = Object.keys(data);
  const [row] = await db.query(
    `UPDATE ${table} SET ${fields.map((f, i) => `${f}=$${i + 1}`).join(",")}, version=version+1,updated_at=now() WHERE id=$${fields.length + 1} AND family_id=$${fields.length + 2} AND version=$${fields.length + 3} RETURNING *`,
    [...Object.values(data), rid, familyId, v],
  );
  return (
    row ||
    fail(409, "VERSION_CONFLICT", "内容已被家人修改，请刷新后再试。你的输入仍会保留。")
  );
}
