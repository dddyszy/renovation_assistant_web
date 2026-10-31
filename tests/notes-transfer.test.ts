import type * as NotesProtocol from "../shared/notes-transfer.ts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import {
  createNotesArchive,
  parseNotesArchive,
  planNotesImport,
  splitNotesArchive,
  stringifyNotesArchive,
  utf8ByteLength,
  type TransferColumn,
} from "../shared/notes-transfer.ts";

const columns: TransferColumn[] = [
  {
    name: "事前确认",
    items: [
      {
        title: "厨房插座 🌟",
        details: ["洗碗机、咖啡机", '引号"与换行\n保留'],
        starred: true,
        status: "confirmed",
      },
    ],
  },
  { name: "空专栏", items: [] },
];
test("Web 文件与小程序 CommonJS 协议双向往返，保留中文、状态、描述和空专栏", async () => {
  const source = await readFile(
    new URL("../shared/notes-transfer.ts", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const sandbox = { exports: {} as typeof NotesProtocol };
  vm.runInNewContext(compiled, sandbox);
  const mini = sandbox.exports;
  const webExport = createNotesArchive("web", "新家", columns, "0.9.6");
  const miniImport = mini.parseNotesArchive(stringifyNotesArchive(webExport));
  assert.deepEqual(JSON.parse(JSON.stringify(miniImport.columns)), columns);
  const miniExport = mini.createNotesArchive(
    "miniprogram",
    "新家",
    miniImport.columns,
    "0.9.6",
  );
  assert.deepEqual(
    parseNotesArchive(mini.stringifyNotesArchive(miniExport)).columns,
    columns,
  );
});
test("导入追加合并并去重，保留不同状态的同标题备忘，容量检查不截断", () => {
  const archive = createNotesArchive("web", "新家", columns, "0.9.6");
  const first = planNotesImport(archive, []);
  assert.equal(first.added, 1);
  assert.equal(first.createdColumns, 2);
  const second = planNotesImport(archive, columns);
  assert.equal(second.added, 0);
  assert.equal(second.skipped, 1);
  const changed = structuredClone(archive);
  changed.columns[0]!.items[0]!.status = "pending";
  assert.equal(planNotesImport(changed, columns).added, 1);
  assert.throws(
    () =>
      planNotesImport(
        archive,
        Array.from({ length: 20 }, (_, index) => ({ name: `专栏${index}`, items: [] })),
      ),
    /20 个专栏/,
  );
});
test("拒绝损坏、未知版本、错误字段与超限文件，不接受原始数据库对象", () => {
  const good = createNotesArchive("web", "新家", columns, "0.9.6");
  for (const input of [
    "{broken",
    [],
    {},
    { ...good, schemaVersion: 2 },
    {
      ...good,
      columns: [
        {
          name: "x",
          items: [{ title: "x", details: [], starred: "true", status: "pending" }],
        },
      ],
    },
  ]) {
    assert.throws(() => parseNotesArchive(input));
  }
  assert.throws(
    () => parseNotesArchive({ ...good, columns: [columns[0], columns[0]] }),
    /重名/,
  );
  assert.throws(() => parseNotesArchive(" ".repeat(2 * 1024 * 1024 + 1)), /2 MiB/);
  assert.throws(
    () =>
      createNotesArchive(
        "web",
        "新家",
        [{ name: "x", items: Array(1001).fill(columns[0]!.items[0]) }],
        "0.9.6",
      ),
    /1000/,
  );
  const withIds = {
    ...good,
    account: "secret",
    projectId: "source-project",
    columns: good.columns.map((c) => ({
      ...c,
      _id: "source-column",
      items: c.items.map((n) => ({ ...n, ownerOpenid: "private", _id: "source-note" })),
    })),
  };
  assert.equal(
    JSON.stringify(parseNotesArchive(withIds)).includes("source-project"),
    false,
  );
  assert.equal(JSON.stringify(parseNotesArchive(withIds)).includes("ownerOpenid"), false);
  assert.deepEqual(parseNotesArchive("\uFEFF" + JSON.stringify(good)), good);
  assert.equal(utf8ByteLength("中文🌟\ud800"), Buffer.byteLength("中文🌟\ud800"));
});
test("1000 条文件拆分后不丢项，每批最多 50 条并保留专栏顺序", () => {
  const items = Array.from({ length: 1000 }, (_, i) => ({
    title: `备忘${i}`,
    details: [],
    starred: false,
    status: "pending" as const,
  }));
  const archive = createNotesArchive(
    "web",
    "新家",
    [
      { name: "空", items: [] },
      { name: "整批", items },
    ],
    "0.9.6",
  );
  const batches = splitNotesArchive(archive);
  assert.equal(batches.length, 20);
  assert.equal(batches[0]!.columns[0]!.name, "空");
  assert.deepEqual(
    batches.flatMap((batch) => batch.columns.flatMap((c) => c.items)),
    items,
  );
  assert(
    batches.every(
      (batch) => batch.columns.reduce((sum, c) => sum + c.items.length, 0) <= 50,
    ),
  );
});
