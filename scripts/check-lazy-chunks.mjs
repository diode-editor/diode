#!/usr/bin/env node
/**
 * Gate on the first-frame graph (`npm run lazy-chunks-check`, CI job `static`):
 * lazy chunks have not leaked into `dist/main.cjs`. `build-dist.mjs` fails on the same
 * check, but it runs only in e2e; here the answer takes seconds.
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
        console.error("Lazy chunks leaked into the first-frame graph:");
        for (const error of errors) console.error(`  ${error}`);
        console.error("Recipe: docs/arch/Common.md, the lazy chunks section.");
        process.exit(1);
    }
    console.log(`Lazy chunks outside main.cjs: ${LAZY_CHUNKS.map((c) => c.id).join(", ")}`);
} finally {
    rmSync(outDir, { recursive: true, force: true });
}
