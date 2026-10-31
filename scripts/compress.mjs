import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync, brotliCompressSync } from "node:zlib";
const metadata = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const worker = await readFile("dist/sw.js", "utf8");
await writeFile("dist/sw.js", worker.replaceAll("__APP_VERSION__", metadata.version));
async function compress(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await compress(path);
    else if (/\.(js|css|html|svg|webmanifest)$/.test(entry.name)) {
      const bytes = await readFile(path);
      if (bytes.length < 512) continue;
      await Promise.all([
        writeFile(path + ".gz", gzipSync(bytes)),
        writeFile(path + ".br", brotliCompressSync(bytes)),
      ]);
    }
  }
}
await compress("dist");
