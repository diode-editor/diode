#!/usr/bin/env node
/**
 * Гейт на граф первого кадра (`npm run lazy-chunks-check`, CI job `static`):
 * ленивые куски бандла (scripts/build-lazy-chunks.mjs) не протекли в
 * `dist/main.cjs`. Собирает main.cjs во временный каталог (tsup, секунды) и куски
 * в память, сверяет по metafile esbuild. Та же проверка роняет и настоящую
 * сборку (`build-dist.mjs`), но та идёт только в e2e — здесь ответ за секунды.
 *
 * Падает, если: модуль куска попал в main.cjs (его тянет статический импорт
 * ядра), main.cjs импортирует кусок не через `import()`, кусок тянет что-то,
 * кроме встроенных модулей node.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { buildLazyChunks, describeEntryChunks, LAZY_CHUNKS, verifyLazyChunks } from "./build-lazy-chunks.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const outDir = mkdtempSync(join(tmpdir(), "diode-lazy-check-"));
try {
    const tsupCli = join(repoRoot, "node_modules", "tsup", "dist", "cli-default.js");
    execFileSync(process.execPath, [tsupCli, "--out-dir", outDir, "--silent"], { stdio: "inherit", cwd: repoRoot });
    const mainMetafile = JSON.parse(readFileSync(join(outDir, "metafile-cjs.json"), "utf8"));
    const chunks = await buildLazyChunks({ repoRoot, distDir: outDir, write: false });
    const errors = verifyLazyChunks({ mainMetafile, chunks });
    for (const line of describeEntryChunks({ mainMetafile, chunks })) console.log(line);
    if (errors.length > 0) {
        console.error("Ленивые куски протекли в граф первого кадра:");
        for (const error of errors) console.error(`  ${error}`);
        console.error("Рецепт — docs/arch/Common.md («Ленивые куски»).");
        process.exit(1);
    }
    console.log(`Ленивые куски вне main.cjs: ${LAZY_CHUNKS.map((c) => c.id).join(", ")}`);
} finally {
    rmSync(outDir, { recursive: true, force: true });
}
