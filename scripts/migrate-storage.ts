import "dotenv/config";
import { resolve } from "node:path";
import { createDb, type Db } from "../server/db.ts";

// Tables are in foreign-key order. Active sessions and reset tokens intentionally expire at cutover.
const tables = [
  "users",
  "families",
  "family_members",
  "projects",
  "stages",
  "materials",
  "costs",
  "note_columns",
  "notes",
  "note_shares",
  "note_images",
  "note_column_shares",
  "invitations",
  "user_preferences",
  "audit_logs",
];
const sourceLocation = process.env.SOURCE_DATABASE;
const targetLocation = process.env.TARGET_DATABASE;
if (!sourceLocation || !targetLocation)
  throw new Error("请同时设置 SOURCE_DATABASE 和 TARGET_DATABASE");
const identity = (location: string) =>
  location.startsWith("postgres") ? location : resolve(location);
if (identity(sourceLocation) === identity(targetLocation))
  throw new Error("源与目标不能是同一数据库");
if (sourceLocation === "memory://" || targetLocation === "memory://")
  throw new Error("迁移必须使用持久化数据库");
const apply = process.argv.includes("--apply");
let source: Db | undefined, target: Db | undefined;
try {
  source = await createDb(sourceLocation);
  target = await createDb(targetLocation);
  await source.transaction(async (origin) => {
    await origin.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const [row] = await origin.query(`SELECT count(*)::int AS count FROM ${table}`);
      counts[table] = row!.count;
    }
    if (!counts.users) throw new Error("源数据库没有账号，请检查源地址；未执行迁移");
    await target!.transaction(async (destination) => {
      for (const table of [...tables, "sessions", "verification_tokens"]) {
        const [row] = await destination.query(
          `SELECT count(*)::int AS count FROM ${table}`,
        );
        if (row!.count)
          throw new Error(`目标表 ${table} 非空；仅支持迁移到全新数据库，不合并或覆盖`);
      }
      console.table(counts);
      if (!apply) {
        console.log("预检通过，未复制记录。停止源/目标应用写入后，加 --apply 执行迁移。");
        return;
      }
      for (const table of tables) {
        for (let offset = 0; offset < counts[table]!; offset += 500) {
          const rows = await origin.query(
            `SELECT * FROM ${table} ORDER BY ${table === "family_members" ? "family_id,user_id" : table === "user_preferences" ? "user_id" : "id"} LIMIT 500 OFFSET $1`,
            [offset],
          );
          for (const row of rows) {
            const entries = Object.entries(row).map(
              ([key, value]) =>
                [
                  key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`),
                  key === "details" ? JSON.stringify(value) : value,
                ] as const,
            );
            await destination.query(
              `INSERT INTO ${table} (${entries.map(([key]) => key).join(",")}) VALUES (${entries.map((_, i) => `$${i + 1}`).join(",")})`,
              entries.map(([, value]) => value),
            );
          }
        }
        const [copied] = await destination.query(
          `SELECT count(*)::int AS count FROM ${table}`,
        );
        if (copied!.count !== counts[table])
          throw new Error(`表 ${table} 的记录数量不一致`);
      }
      // Compare money in SQL, as text, without losing bigint precision.
      for (const [table, field] of [
        ["projects", "budget_cents"],
        ["stages", "budget_cents"],
        ["materials", "total_price_cents"],
        ["costs", "amount_cents"],
      ] as const) {
        const sql = `SELECT COALESCE(sum(${field}),0)::text AS total FROM ${table}`;
        const [before] = await origin.query(sql),
          [after] = await destination.query(sql);
        if (before!.total !== after!.total) throw new Error(`${table} 金额校验不一致`);
      }
    });
  });
  if (apply)
    console.log(
      "迁移完成；记录数量与金额一致。请在目标环境重新登录，核对已付/待付与软删除记录后再开放写入。",
    );
} finally {
  await source?.close();
  await target?.close();
}
