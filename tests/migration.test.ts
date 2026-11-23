import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createDb, type Db } from "../server/db.ts";

test("存储迁移默认预检，保留金额/JSON/软删除并拒绝覆盖非空目标", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zhu-jia-migration-"));
  const source = join(directory, "source"),
    target = process.env.TEST_MIGRATION_TARGET_DATABASE || join(directory, "target");
  let db: Db | undefined;
  async function migrate(apply = false) {
    return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "scripts/migrate-storage.ts", ...(apply ? ["--apply"] : [])],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            SOURCE_DATABASE: source,
            TARGET_DATABASE: target,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "";
      child.stdout.on("data", (d) => (output += d));
      child.stderr.on("data", (d) => (output += d));
      child.on("error", reject);
      child.on("exit", (code) => resolve({ code, output }));
    });
  }
  try {
    db = await createDb(source);
    await db.query(
      "INSERT INTO users(id,email,password_hash,nickname) VALUES('u','migration@example.test','fixture-only-hash','迁移验收')",
    );
    await db.query(
      "INSERT INTO families(id,name,owner_user_id) VALUES('f','迁移家庭','u')",
    );
    await db.query(
      "INSERT INTO family_members(family_id,user_id,role) VALUES('f','u','owner')",
    );
    await db.query(
      "INSERT INTO projects(id,family_id,name,package_type,budget_cents,created_by,updated_by) VALUES('p','f','迁移项目','half',50000,'u','u')",
    );
    await db.query(
      "INSERT INTO stages(id,family_id,project_id,name,budget_cents,created_by,updated_by) VALUES('s','f','p','阶段',20000,'u','u')",
    );
    await db.query(
      "INSERT INTO materials(id,family_id,project_id,stage_id,name,total_price_cents,created_by,updated_by) VALUES('m','f','p','s','材料',15000,'u','u')",
    );
    for (const [i, amount, status, deleted] of [
      [1, 12345, "paid", false],
      [2, 6789, "pending", false],
      [3, 500, "paid", true],
    ])
      await db.query(
        `INSERT INTO costs(id,family_id,project_id,stage_id,material_id,title,amount_cents,payment_status,incurred_at,request_id,request_fingerprint,created_by,updated_by,deleted_at) VALUES($1,'f','p','s','m','支出',$2,$3,'2026-10-29',$1,$1,'u','u',${deleted ? "now()" : "NULL"})`,
        [`c${i}`, amount, status],
      );
    await db.query(
      "INSERT INTO note_columns(id,family_id,project_id,name,created_by,updated_by) VALUES('nc','f','p','专栏','u','u')",
    );
    await db.query(
      "INSERT INTO notes(id,family_id,project_id,column_id,title,details,created_by,updated_by) VALUES('n','f','p','nc','需求',$1,'u','u')",
      [JSON.stringify(["插座位置", "保留管线照片"])],
    );
    await db.query(
      "INSERT INTO note_shares(id,note_id,family_id,project_id,token_hash,created_by,expires_at) VALUES('ns','n','f','p','share-hash','u',now()+interval '7 days')",
    );
    await db.query(
      "INSERT INTO note_column_shares(id,column_id,family_id,project_id,token_hash,created_by,expires_at) VALUES('ncs','nc','f','p','column-share-hash','u',now()+interval '7 days')",
    );
    await db.query(
      "INSERT INTO note_images(id,note_id,family_id,project_id,mime,width,height,bytes,created_by) VALUES('ni','n','f','p','image/png',1,1,$1,'u')",
      [Buffer.from("89504e470d0a1a0a", "hex")],
    );
    await db.query(
      "INSERT INTO user_preferences(user_id,family_id,project_id) VALUES('u','f','p')",
    );
    await db.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES('old-session','u',now()+interval '1 day')",
    );
    await db.close();
    db = undefined;
    const dryRun = await migrate();
    assert.equal(dryRun.code, 0, dryRun.output);
    db = await createDb(target);
    assert.equal(
      (await db.query("SELECT count(*)::int AS count FROM users"))[0]?.count,
      0,
    );
    await db.close();
    db = undefined;
    const applied = await migrate(true);
    assert.equal(applied.code, 0, applied.output);
    db = await createDb(target);
    assert.deepEqual((await db.query("SELECT details FROM notes"))[0]?.details, [
      "插座位置",
      "保留管线照片",
    ]);
    assert.equal(
      (
        await db.query(
          "SELECT sum(amount_cents) AS total_cents FROM costs WHERE deleted_at IS NULL",
        )
      )[0]?.totalCents,
      19134,
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM costs WHERE deleted_at IS NOT NULL",
        )
      )[0]?.count,
      1,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int AS count FROM sessions"))[0]?.count,
      0,
    );
    assert.equal((await db.query("SELECT * FROM user_preferences"))[0]?.projectId, "p");
    assert.equal(
      (await db.query("SELECT count(*)::int AS count FROM note_shares"))[0]?.count,
      1,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int AS count FROM note_column_shares"))[0]?.count,
      1,
    );
    assert.equal(
      (await db.query("SELECT mime FROM note_images WHERE id='ni'"))[0]?.mime,
      "image/png",
    );
    assert.equal(
      (await db.query("SELECT password_hash FROM users"))[0]?.passwordHash,
      "fixture-only-hash",
    );
    await db.close();
    db = undefined;
    const refused = await migrate(true);
    assert.notEqual(refused.code, 0);
    assert.match(refused.output, /非空/);
  } finally {
    await db?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
