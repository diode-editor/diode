#!/usr/bin/env node
/**
 * Pack assets into `dist/diode.bundle` for SEA-сборки.
 *
 * Формат синхронен с декодером `src/vs/base/common/assets/assetBundleFormat.ts`;
 * дублируется намеренно, чтобы build-pipeline не зависел от tsx/jiti.
 *
 * Layout:
 *   [magic 8B "DIODEBND"]
 *   [headerLength uint32 LE]
 *   [header JSON UTF-8]
 *   [data ...]
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, posix, relative, resolve, sep } from "node:path";

const MAGIC = Buffer.from([0x44, 0x49, 0x4f, 0x44, 0x45, 0x42, 0x4e, 0x44]); // "DIODEBND"

/**
 * @typedef {{ virtualPath: string, data: Buffer }} PackInput
 */

/** @param {readonly PackInput[]} inputs */
export function packBundle(inputs) {
    const files = {};
    let dataSize = 0;
    for (const input of inputs) {
        validateVirtualPath(input.virtualPath);
        if (Object.prototype.hasOwnProperty.call(files, input.virtualPath)) {
            throw new Error(`Duplicate bundle entry: ${input.virtualPath}`);
        }
        files[input.virtualPath] = { offset: dataSize, size: input.data.length };
        dataSize += input.data.length;
    }
    const header = { version: 1, files };
    const headerJson = Buffer.from(JSON.stringify(header), "utf-8");

    const total = MAGIC.length + 4 + headerJson.length + dataSize;
    const out = Buffer.allocUnsafe(total);
    MAGIC.copy(out, 0);
    out.writeUInt32LE(headerJson.length, MAGIC.length);
    headerJson.copy(out, MAGIC.length + 4);

    let cursor = MAGIC.length + 4 + headerJson.length;
    for (const input of inputs) {
        input.data.copy(out, cursor);
        cursor += input.data.length;
    }
    return out;
}

/** @param {string} virtualPath */
function validateVirtualPath(virtualPath) {
    if (virtualPath.length === 0) throw new Error("Virtual path must not be empty");
    if (virtualPath.startsWith("/")) throw new Error(`Virtual path must not start with "/": ${virtualPath}`);
    if (virtualPath.endsWith("/")) throw new Error(`Virtual path must not end with "/": ${virtualPath}`);
    for (const segment of virtualPath.split("/")) {
        if (segment === "" || segment === "." || segment === "..") {
            throw new Error(`Invalid segment in virtual path: ${virtualPath}`);
        }
    }
}

function walkFiles(rootDir) {
    /** @type {string[]} */
    const out = [];
    /** @param {string} dir */
    function walk(dir) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile()) out.push(full);
        }
    }
    walk(rootDir);
    return out;
}

function toVirtualPath(prefix, root, absPath) {
    const rel = relative(root, absPath).split(sep).join(posix.sep);
    return `${prefix}${rel}`;
}

export function buildDiodeBundle({ repoRoot }) {
    const builtinSrc = resolve(repoRoot, "extensions");
    const require = createRequire(import.meta.url);
    const onigWasmPath = require.resolve("vscode-oniguruma/release/onig.wasm");

    /** @type {PackInput[]} */
    const inputs = [];
    inputs.push({ virtualPath: "onig.wasm", data: readFileSync(onigWasmPath) });

    // TS-исходники скомпилированных builtin'ов выкидываем — под SEA они нерекуайрабельны.
    const codeBuiltins = new Set(
        readdirSync(builtinSrc, { withFileTypes: true })
            .filter((e) => e.isDirectory() && existsSync(join(builtinSrc, e.name, "out")))
            .map((e) => e.name),
    );

    const builtinFiles = walkFiles(builtinSrc).sort();
    for (const filePath of builtinFiles) {
        const relParts = relative(builtinSrc, filePath).split(sep);
        const base = relParts[relParts.length - 1];
        if (base.endsWith(".test.ts") || base.endsWith(".test.tsx")) continue;
        if (codeBuiltins.has(relParts[0]) && relParts[1] !== "out" && (base.endsWith(".ts") || base.endsWith(".tsx"))) {
            continue;
        }
        const virtualPath = toVirtualPath("Extensions/builtin/", builtinSrc, filePath);
        inputs.push({ virtualPath, data: readFileSync(filePath) });
    }

    const bundle = packBundle(inputs);
    return { bundle, inputs, onigWasmPath };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const repoRoot = resolve(import.meta.dirname, "..");
    const dist = resolve(repoRoot, "dist");
    const { bundle, inputs, onigWasmPath } = buildDiodeBundle({ repoRoot });
    const outPath = join(dist, "diode.bundle");
    writeFileSync(outPath, bundle);
    const wasmStat = statSync(onigWasmPath);
    console.error(
        `[pack-assets] ${outPath} (${(bundle.length / 1024).toFixed(1)} KB, ${inputs.length} entries; onig.wasm=${(
            wasmStat.size / 1024
        ).toFixed(1)} KB)`,
    );
}
