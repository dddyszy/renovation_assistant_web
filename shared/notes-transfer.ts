/** Portable notes format. Keep this module free of browser, Node and database APIs. */
export const NOTES_FORMAT = "zhujia.notes";
export const NOTES_SCHEMA_VERSION = 1;
export const NOTES_FILE_LIMIT = 2 * 1024 * 1024;
export const NOTES_COLUMN_LIMIT = 20;
export const NOTES_ITEM_LIMIT = 1000;
export const MINI_IMPORT_BATCH = 50;
export class NotesCapacityError extends Error {}

export interface TransferNote {
  title: string;
  details: string[];
  starred: boolean;
  status: "pending" | "confirmed";
}
export interface TransferColumn {
  name: string;
  items: TransferNote[];
}
export interface NotesArchive {
  format: typeof NOTES_FORMAT;
  schemaVersion: typeof NOTES_SCHEMA_VERSION;
  appVersion: string;
  source: "web" | "miniprogram";
  exportedAt: string;
  projectName: string;
  columns: TransferColumn[];
}
export interface NotesImportPlan {
  columns: TransferColumn[];
  added: number;
  skipped: number;
  createdColumns: number;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("文件内容必须是 JSON 对象");
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max: number, required = true): string {
  if (typeof value !== "string") throw new Error(`${label}必须是文字`);
  const result = value.trim();
  if ((required && !result) || result.length > max)
    throw new Error(`${label}不能为空且不能超过 ${max} 字`);
  return result;
}
export function utf8ByteLength(text: string): number {
  let size = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) size++;
    else if (code < 0x800) size += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < text.length &&
      text.charCodeAt(index + 1) >= 0xdc00 &&
      text.charCodeAt(index + 1) <= 0xdfff
    ) {
      size += 4;
      index++;
    } else size += 3;
  }
  return size;
}

export function parseNotesArchive(input: unknown): NotesArchive {
  if (typeof input === "string") {
    if (utf8ByteLength(input) > NOTES_FILE_LIMIT)
      throw new Error("备忘文件不能超过 2 MiB");
    try {
      input = JSON.parse(input.replace(/^\uFEFF/, ""));
    } catch {
      throw new Error("文件不是有效 JSON，请选择 Web 或小程序导出的备忘文件");
    }
  }
  const archive = object(input);
  if (archive.format !== NOTES_FORMAT) throw new Error("这不是筑家手记的备忘文件");
  if (archive.schemaVersion !== NOTES_SCHEMA_VERSION)
    throw new Error("不支持此备忘文件版本，请更新应用后再试");
  if (archive.source !== "web" && archive.source !== "miniprogram")
    throw new Error("备忘文件来源无效");
  const exportedAt = text(archive.exportedAt, "导出时间", 40);
  if (!Number.isFinite(Date.parse(exportedAt))) throw new Error("导出时间无效");
  if (!Array.isArray(archive.columns) || archive.columns.length > NOTES_COLUMN_LIMIT)
    throw new Error("备忘文件最多包含 20 个专栏");
  let count = 0;
  const names = new Set<string>();
  const columns = archive.columns.map((value) => {
    const column = object(value);
    const name = text(column.name, "专栏名称", 30);
    if (names.has(name)) throw new Error("文件中有重名专栏，请先合并后再导入");
    names.add(name);
    if (!Array.isArray(column.items)) throw new Error("专栏的 items 必须是数组");
    count += column.items.length;
    if (count > NOTES_ITEM_LIMIT) throw new Error("备忘文件最多包含 1000 条备忘");
    const items = column.items.map((value): TransferNote => {
      const note = object(value);
      if (!Array.isArray(note.details) || note.details.length > 20)
        throw new Error("每条备忘最多包含 20 条描述");
      if (typeof note.starred !== "boolean") throw new Error("重点标记必须为布尔值");
      if (note.status !== "pending" && note.status !== "confirmed")
        throw new Error("备忘状态必须为 pending 或 confirmed");
      return {
        title: text(note.title, "备忘标题", 60),
        details: note.details
          .map((value) => text(value, "具体描述", 1000, false))
          .filter(Boolean),
        starred: note.starred,
        status: note.status,
      };
    });
    return { name, items };
  });
  const result: NotesArchive = {
    format: NOTES_FORMAT,
    schemaVersion: NOTES_SCHEMA_VERSION,
    appVersion: text(archive.appVersion, "应用版本", 30),
    source: archive.source,
    exportedAt,
    projectName: text(archive.projectName, "项目名称", 60, false),
    columns,
  };
  if (utf8ByteLength(JSON.stringify(result)) > NOTES_FILE_LIMIT)
    throw new Error("备忘文件不能超过 2 MiB");
  return result;
}

export function createNotesArchive(
  source: NotesArchive["source"],
  projectName: string,
  columns: TransferColumn[],
  appVersion: string,
): NotesArchive {
  return parseNotesArchive({
    format: NOTES_FORMAT,
    schemaVersion: NOTES_SCHEMA_VERSION,
    source,
    appVersion,
    projectName,
    exportedAt: new Date().toISOString(),
    columns,
  });
}
export function stringifyNotesArchive(archive: NotesArchive): string {
  const result = JSON.stringify(parseNotesArchive(archive), null, 2) + "\n";
  if (utf8ByteLength(result) > NOTES_FILE_LIMIT)
    throw new Error("备忘文件不能超过 2 MiB，请选择较小的专栏导出");
  return result;
}
export function noteFingerprint(note: TransferNote): string {
  return JSON.stringify([note.title, note.details, note.starred, note.status]);
}
/** Append only: same-name columns merge, exact matches skip, existing data is never changed. */
export function planNotesImport(
  archive: NotesArchive,
  existing: TransferColumn[],
): NotesImportPlan {
  const known = new Map(
    existing.map((column) => [column.name, new Set(column.items.map(noteFingerprint))]),
  );
  let added = 0,
    skipped = 0,
    createdColumns = 0;
  const columns = archive.columns.map((column) => {
    let keys = known.get(column.name);
    if (!keys) {
      keys = new Set();
      known.set(column.name, keys);
      createdColumns++;
    }
    const items = column.items.filter((item) => {
      const key = noteFingerprint(item);
      if (keys.has(key)) {
        skipped++;
        return false;
      }
      keys.add(key);
      added++;
      return true;
    });
    return { name: column.name, items };
  });
  if (existing.length + createdColumns > NOTES_COLUMN_LIMIT)
    throw new NotesCapacityError("导入后将超过 20 个专栏上限");
  if (
    existing.reduce((sum, column) => sum + column.items.length, 0) + added >
    NOTES_ITEM_LIMIT
  )
    throw new NotesCapacityError("导入后将超过 1000 条备忘上限");
  return { columns, added, skipped, createdColumns };
}
/** Cloud transactions accept at most 100 operations: reserve room for columns and ownership checks. */
export function splitNotesArchive(archive: NotesArchive): NotesArchive[] {
  const batches: NotesArchive[] = [];
  let columns: TransferColumn[] = [];
  let count = 0;
  for (const column of archive.columns) {
    if (!column.items.length) columns.push({ name: column.name, items: [] });
    for (const item of column.items) {
      if (count === MINI_IMPORT_BATCH) {
        batches.push({ ...archive, columns });
        columns = [];
        count = 0;
      }
      let last = columns[columns.length - 1];
      if (!last || last.name !== column.name) {
        last = { name: column.name, items: [] };
        columns.push(last);
      }
      last.items.push(item);
      count++;
    }
  }
  if (columns.length) batches.push({ ...archive, columns });
  return batches;
}
