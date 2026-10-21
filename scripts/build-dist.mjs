#!/usr/bin/env node
/**
 * Общая часть упаковок SEA (`build-sea.mjs`, вшивает бандлы ассетами) и self-extract
 * (`build-selfextract.mjs`, кладёт файлами рядом с `main.cjs`).
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildExtensions } from "./build-extensions.mjs";
import { buildLazyChunks, verifyLazyChunks } from "./build-lazy-chunks.mjs";
import { buildNodePtyBundle } from "./pack-node-pty.mjs";
import { buildDiodeBundle } from "./pack-assets.mjs";
import { buildRipgrepBundle } from "./pack-ripgrep.mjs";
import { buildTsServerBundle } from "./pack-ts-server.mjs";

/**
 * Другой `distDir` нужен e2e: неизменяемая сборка в кэше по хешу (`scripts/e2e-artifacts.mjs`).
 *
 * @param {{ repoRoot: string, distDir?: string }} params
 * @returns {Promise<{ distDir: string, mainJsPath: string, bundlePath: string, nodePtyBundlePath: string, ripgrepBundlePath: string, tsServerBundlePath: string, lazyChunks: Array<{ id: string, asset: string, path: string }> }>}
 */
export async function buildDistArtifacts({ repoRoot, distDir = join(repoRoot, "dist") }) {
    mkdirSync(distDir, { recursive: true });

    // CLI tsup напрямую, массивом аргументов: на Windows `npx` требует шелл, а
    // кавычки и обратные слэши пути там ломаются.
    const tsupCli = join(repoRoot, "node_modules", "tsup", "dist", "cli-default.js");
    console.log(`> tsup --out-dir ${distDir}`);
    execFileSync(process.execPath, [tsupCli, "--out-dir", distDir], { stdio: "inherit", cwd: repoRoot });

    const lazyChunks = await buildLazyChunks({ repoRoot, distDir });
    const mainMetafile = JSON.parse(readFileSync(join(distDir, "metafile-cjs.json"), "utf8"));
    const lazyErrors = verifyLazyChunks({ mainMetafile, chunks: lazyChunks });
    if (lazyErrors.length > 0) {
        throw new Error(`[build-dist] Ленивые куски протекли в main.cjs:\n  ${lazyErrors.join("\n  ")}`);
    }
    console.log(`[build-dist] Lazy chunks: ${lazyChunks.map((c) => c.asset).join(", ")}`);

    // ДО упаковки, иначе скомпилированный entry не попадёт в diode.bundle.
    const builtExtensions = await buildExtensions({ repoRoot });
    console.log(
        `[build-dist] Compiled ${builtExtensions.length} code-builtin(s): ${builtExtensions.map((b) => b.id).join(", ") || "—"}`,
    );

    const { bundle, inputs } = buildDiodeBundle({ repoRoot });
    const bundlePath = join(distDir, "diode.bundle");
    writeFileSync(bundlePath, bundle);
    console.log(`[build-dist] Packed ${inputs.length} assets → ${bundlePath} (${(bundle.length / 1024).toFixed(1)} KB)`);

    const { bundle: ptyBundle, inputs: ptyInputs } = buildNodePtyBundle({ repoRoot });
    const nodePtyBundlePath = join(distDir, "node-pty.bundle");
    writeFileSync(nodePtyBundlePath, ptyBundle);
    console.log(
        `[build-dist] Packed ${ptyInputs.length} node-pty files → ${nodePtyBundlePath} (${(ptyBundle.length / 1024).toFixed(1)} KB)`,
    );

    const { bundle: rgBundle, binaryName: rgBinaryName } = buildRipgrepBundle({ repoRoot });
    const ripgrepBundlePath = join(distDir, "rg.bundle");
    writeFileSync(ripgrepBundlePath, rgBundle);
    console.log(
        `[build-dist] Packed ripgrep (${rgBinaryName}) → ${ripgrepBundlePath} (${(rgBundle.length / 1024 / 1024).toFixed(1)} MB)`,
    );

    const { bundle: tsBundle, fileCount: tsFileCount } = buildTsServerBundle({ repoRoot });
    const tsServerBundlePath = join(distDir, "ts-server.bundle");
    writeFileSync(tsServerBundlePath, tsBundle);
    // Сайдкар: по нему рантайм строит каталог распаковки без хэша 13 МБ на старте
    // (`packagedAssetCacheDirByName` в packagedAsset.ts).
    writeFileSync(`${tsServerBundlePath}.sha256`, createHash("sha256").update(tsBundle).digest("hex"));
    console.log(
        `[build-dist] Packed ts-server (${tsFileCount} files) → ${tsServerBundlePath} (${(tsBundle.length / 1024 / 1024).toFixed(1)} MB)`,
    );

    return {
        distDir,
        mainJsPath: join(distDir, "main.cjs"),
        bundlePath,
        nodePtyBundlePath,
        ripgrepBundlePath,
        tsServerBundlePath,
        lazyChunks: lazyChunks.map(({ id, asset, path }) => ({ id, asset, path })),
    };
}
