import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "../server/db.ts";

test("内置数据库关闭并重新打开后保留已写入的数据", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zhu-jia-persistence-"));
  const location = join(directory, "postgres");
  let db: Db | undefined;
  try {
    db = await createDb(location);
    await db.query(
      "CREATE TABLE durability_probe (id text PRIMARY KEY, amount_cents bigint NOT NULL)",
    );
    await db.query("INSERT INTO durability_probe VALUES ($1,$2)", [
      "saved-record",
      123456,
    ]);
    await db.close();
    db = undefined;
    db = await createDb(location);
    const [row] = await db.query("SELECT * FROM durability_probe WHERE id=$1", [
      "saved-record",
    ]);
    assert.equal(row?.amountCents, 123456);
  } finally {
    await db?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
