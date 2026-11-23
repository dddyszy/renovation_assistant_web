import type { Db, Row } from "../db.ts";

export interface NoteImageRow {
  id: string;
  noteId: string;
  mime: string;
  width: number;
  height: number;
}

export async function attachNoteImages<T extends Row>(db: Db, rows: T[]): Promise<T[]> {
  if (!rows.length) return rows;
  const ids = rows.map((row) => String(row.id));
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(",");
  const images = await db.query<NoteImageRow>(
    `SELECT id,note_id,mime,width,height FROM note_images
      WHERE note_id IN (${placeholders}) AND deleted_at IS NULL
      ORDER BY sort_order,created_at`,
    ids,
  );
  const grouped = new Map<string, NoteImageRow[]>();
  for (const image of images) {
    const list = grouped.get(image.noteId) || [];
    list.push(image);
    grouped.set(image.noteId, list);
  }
  return rows.map((row) => ({
    ...row,
    images: (grouped.get(String(row.id)) || []).map((image) => ({
      id: image.id,
      mime: image.mime,
      width: image.width,
      height: image.height,
    })),
  }));
}
