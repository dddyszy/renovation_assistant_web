import type { Db } from "../db.ts";
export const eraseProject = async (tx: Db, pid: string, fid: string) => {
  for (const table of ["costs", "materials", "notes", "note_columns", "stages"])
    await tx.query(`DELETE FROM ${table} WHERE project_id=$1 AND family_id=$2`, [
      pid,
      fid,
    ]);
  await tx.query("DELETE FROM projects WHERE id=$1 AND family_id=$2", [pid, fid]);
  await tx.query("UPDATE user_preferences SET project_id=NULL WHERE project_id=$1", [
    pid,
  ]);
};
