import type { Note, NoteColumn } from "../../shared/api.ts";
import type { NotesArchive, TransferColumn } from "../../shared/notes-transfer.ts";
import { planNotesImport } from "../../shared/notes-transfer.ts";
import type { Db } from "../db.ts";
import { actorFields, id, insert, sqlData } from "../lib/persistence.ts";

export async function readProjectNotes(db: Db, familyId: string, projectId: string) {
  const args = [familyId, projectId];
  const columns = await db.query<NoteColumn>(
    "SELECT * FROM note_columns WHERE family_id=$1 AND project_id=$2 AND deleted_at IS NULL ORDER BY sort_order,created_at,id",
    args,
  );
  const notes = await db.query<Note>(
    "SELECT * FROM notes WHERE family_id=$1 AND project_id=$2 AND deleted_at IS NULL ORDER BY created_at,id",
    args,
  );
  const portable: TransferColumn[] = columns.map((column) => ({
    name: column.name,
    items: notes
      .filter((note) => note.columnId === column.id)
      .map((note) => ({
        title: note.title,
        details: note.details,
        starred: note.starred,
        status: note.status,
      })),
  }));
  return { columns, portable };
}

/** The caller holds the project's write lock, so capacity and duplicate checks stay valid. */
export async function importProjectNotes(
  tx: Db,
  archive: NotesArchive,
  familyId: string,
  projectId: string,
  userId: string,
) {
  const current = await readProjectNotes(tx, familyId, projectId);
  const plan = planNotesImport(archive, current.portable);
  const columns = new Map(current.columns.map((column) => [column.name, column.id]));
  let order =
    current.columns.reduce((max, column) => Math.max(max, column.sortOrder), -1) + 1;
  let itemIndex = 0;
  const baseTime = Date.now();
  for (const column of plan.columns) {
    let columnId = columns.get(column.name);
    if (!columnId) {
      columnId = id();
      await insert(tx, "note_columns", {
        id: columnId,
        family_id: familyId,
        project_id: projectId,
        name: column.name,
        sort_order: order++,
        ...actorFields(userId),
      });
      columns.set(column.name, columnId);
    }
    for (const note of column.items) {
      await insert(tx, "notes", {
        id: id(),
        family_id: familyId,
        project_id: projectId,
        column_id: columnId,
        created_at: new Date(baseTime + itemIndex++),
        ...sqlData(note),
        ...actorFields(userId),
      });
    }
  }
  return {
    added: plan.added,
    skipped: plan.skipped,
    createdColumns: plan.createdColumns,
  };
}
