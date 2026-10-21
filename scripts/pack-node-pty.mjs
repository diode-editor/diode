#!/usr/bin/env node
/**
 * Рантайм-раскладка `node-pty` → ассет `node-pty.bundle`: `process.dlopen` требует
 * файл на диске, поэтому `loadNodePty.ts` на первом запуске распаковывает ассет в
 * tmpdir и делает `require` из `<targetDir>/node-pty` — отсюда префикс `node-pty/`
 * у каждой записи.
 *
 * Проверено end-to-end только на linux-x64/arm64; macOS/Windows пакуются, но не
 * проверены (docs/TODO/IntegratedTerminal.md).
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, posix, relative, resolve, sep } from "node:path";

import { packBundle } from "./pack-assets.mjs";

function walkFiles(rootDir, filter) {
    /** @type {string[]} */
    const out = [];
    /** @param {string} dir */
    function walk(dir) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile() && filter(full)) out.push(full);
        }
    }
    walk(rootDir);
    return out;
}

/**
 * @param {{ repoRoot: string }} params
 * @returns {{ bundle: Buffer, inputs: { virtualPath: string, data: Buffer }[], nodePtyRoot: string }}
 */
export function buildNodePtyBundle({ repoRoot }) {
    // От repoRoot, а не от скрипта: бандл берётся из node_modules сборки.
    const requireFromRoot = createRequire(join(repoRoot, "package.json"));
    const nodePtyRoot = requireFromRoot.resolve("node-pty/package.json").replace(/package\.json$/, "");

    /** @type {{ virtualPath: string, data: Buffer }[]} */
    const inputs = [];
    const addFile = (absPath) => {
        const rel = relative(nodePtyRoot, absPath).split(sep).join(posix.sep);
        inputs.push({ virtualPath: `node-pty/${rel}`, data: readFileSync(absPath) });
    };

    addFile(join(nodePtyRoot, "package.json"));

    const libFiles = walkFiles(
        join(nodePtyRoot, "lib"),
        (p) => p.endsWith(".js") && !p.endsWith(".test.js") && !p.endsWith(".js.map"),
    ).sort();
    for (const filePath of libFiles) addFile(filePath);

    // Те же каталоги, где нативы ищет сам node-pty (lib/utils.js): Linux компилирует
    // `build/Release` на install, macOS/Windows получают `prebuilds/`. Раскладка
    // сохраняется — после распаковки резолв тот же. .pdb — виндовые debug-символы (десятки МБ).
    const nativeDirs = [
        join(nodePtyRoot, "build", "Release"),
        join(nodePtyRoot, "prebuilds", `${process.platform}-${process.arch}`),
    ];
    let nativeCount = 0;
    for (const dir of nativeDirs) {
        if (!existsSync(dir)) continue;
        for (const filePath of walkFiles(dir, (p) => !p.endsWith(".pdb")).sort()) {
            addFile(filePath);
            nativeCount++;
        }
    }
    if (nativeCount === 0) {
        throw new Error(
            `[pack-node-pty] нативы node-pty не найдены (искали ${nativeDirs.join(", ")}) — ` +
                `соберите node-pty под текущую платформу`,
        );
    }

    const bundle = packBundle(inputs);
    return { bundle, inputs, nodePtyRoot };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const repoRoot = resolve(import.meta.dirname, "..");
    const dist = resolve(repoRoot, "dist");
    const { bundle, inputs, nodePtyRoot } = buildNodePtyBundle({ repoRoot });
    const outPath = join(dist, "node-pty.bundle");
    writeFileSync(outPath, bundle);
    console.error(
        `[pack-node-pty] ${outPath} (${(bundle.length / 1024).toFixed(1)} KB, ${inputs.length} entries; from ${nodePtyRoot})`,
    );
}
