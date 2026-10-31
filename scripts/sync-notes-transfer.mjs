import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
export async function compileNotesTransfer() {
  const file = path.join(root, "shared/notes-transfer.ts");
  const source = await fs.readFile(file, "utf8");
  const banner =
    "// Generated from renovation_assistant_web/shared/notes-transfer.ts. Do not edit.\n";
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const program = ts.createProgram([file], {
    declaration: true,
    emitDeclarationOnly: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
  });
  let declaration = "";
  program.emit(undefined, (name, content) => {
    if (name.endsWith("notes-transfer.d.ts")) declaration = content;
  });
  if (!declaration) throw new Error("备忘格式声明生成失败");
  return { js: banner + js, declaration: banner + declaration };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf("--target");
  if (index < 0 || !process.argv[index + 1])
    throw new Error(
      "用法：node scripts/sync-notes-transfer.mjs --target <小程序仓库目录> [--check]",
    );
  const target = path.resolve(process.argv[index + 1]);
  const compiled = await compileNotesTransfer();
  for (const [file, content] of [
    [
      "protocol/notes-transfer.ts",
      await fs.readFile(path.join(root, "shared/notes-transfer.ts"), "utf8"),
    ],
    ["miniprogram/utils/notes-transfer.js", compiled.js],
    ["miniprogram/utils/notes-transfer.d.ts", compiled.declaration],
    ["cloudfunctions/notes/notes-transfer.js", compiled.js],
  ]) {
    const destination = path.join(target, file);
    if (process.argv.includes("--check")) {
      if ((await fs.readFile(destination, "utf8")) !== content)
        throw new Error(`协议文件不同步：${file}`);
    } else {
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, content);
    }
  }
  console.log(
    process.argv.includes("--check") ? "两端协议实现一致" : "小程序与云函数协议已同步",
  );
}
