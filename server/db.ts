import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { readFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
export type Row = Record<string, any>;
export interface Db {
  query(sql: string, args?: any[]): Promise<Row[]>;
  transaction<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
function normalize(row: Row): Row {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      if (value instanceof Date) value = value.toISOString();
      if (
        typeof value === "bigint" ||
        (typeof value === "string" && /(?:Cents|Count|Order)$/.test(camel))
      )
        value = Number(value);
      if (camel.endsWith("Cents") && !Number.isSafeInteger(value))
        throw new Error("金额合计超出安全整数范围");
      return [camel, value];
    }),
  );
}
export async function createDb(
  location = process.env.DATABASE_URL ||
    (process.env.PGHOST ? "postgres:env" : ".data/postgres"),
): Promise<Db> {
  let db: Db;
  if (location.startsWith("postgres")) {
    const pool = new pg.Pool({
      ...(location === "postgres:env" ? {} : { connectionString: location }),
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      max: 10,
    });
    const wrap = (client: pg.Pool | pg.PoolClient): Db => ({
      query: async (sql, args = []) =>
        (await client.query(sql, args)).rows.map(normalize),
      transaction: async (fn) => {
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          const result = await fn(wrap(c));
          await c.query("COMMIT");
          return result;
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        } finally {
          c.release();
        }
      },
      close: async () => {
        await pool.end();
      },
    });
    db = wrap(pool);
  } else {
    if (location !== "memory://")
      await mkdir(dirname(resolve(location)), { recursive: true });
    const client = new PGlite(location);
    await client.waitReady;
    const wrap = (c: Pick<PGlite, "query">): Db => ({
      query: async (sql, args = []) =>
        (await c.query<Row>(sql, args)).rows.map(normalize),
      transaction: (fn) => client.transaction((tx) => fn(wrap(tx))),
      close: () => client.close(),
    });
    db = wrap(client);
  }
  const schema = await readFile(
    new URL("./schema.sql", import.meta.url),
    "utf8",
  );
  for (const sql of schema
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean))
    await db.query(sql);
  return db;
}
