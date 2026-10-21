#!/usr/bin/env node
/**
 * typescript-language-server + a minimal TypeScript -> the `ts-server.bundle` asset:
 * LSP out of the box without node_modules in the project or node in PATH (docs/arch/Extensions.md).
 *
 * The lists are fixed: dropped are locales (~4.4 MB), tsc (~6 MB), tsserverlibrary,
 * *.map and typingsInstaller (ATA is off for the bundled path, resolveServer.ts).
 *
 * The `node_modules/typescript/...` layout is deliberate: cli.mjs finds TypeScript with
 * `require.resolve` from itself, without initializationOptions. Virtual paths must match
 * the `loadTsServer.ts` constants.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

import { packBundle } from "./pack-assets.mjs";

/** watchGuard.js is for Windows. */
const TYPESCRIPT_LIB_FILES = ["tsserver.js", "_tsserver.js", "typescript.js", "typesMap.json", "watchGuard.js"];

/**
 * `import()` from the embedded SEA main hits the embedder hook (builtins only), and
 * `require(esm)` cannot load cli.mjs because of top-level await; `import()` from an EXTERNAL
 * CJS file goes through the real ESM loader (verified on the binary).
 */
const RUN_CLI_CJS = `"use strict";
// diode: CJS shim for SEA mode, see scripts/pack-ts-server.mjs.
const { pathToFileURL } = require("node:url");
const { join } = require("node:path");
import(pathToFileURL(join(__dirname, "cli.mjs")).href).catch((err) => {
    console.error(err);
    process.exit(1);
});
`;

const TYPESCRIPT_STDLIB_RE = /^lib(\..+)?\.d\.ts$/;

/**
 * @param {{ repoRoot: string }} params
 * @returns {{ bundle: Buffer, fileCount: number }}
 */
export function buildTsServerBundle({ repoRoot }) {
    const requireFromRoot = createRequire(join(repoRoot, "package.json"));

    const mustResolve = (spec) => {
        try {
            return requireFromRoot.resolve(spec);
        } catch {
            throw new Error(`[pack-ts-server] "${spec}" not found; install devDependencies (npm install)`);
        }
    };

    const cliPath = mustResolve("typescript-language-server/lib/cli.mjs");
    const tlsPackageJson = join(dirname(dirname(cliPath)), "package.json");
    const tsserverPath = mustResolve("typescript/lib/tsserver.js");
    const typescriptLibDir = dirname(tsserverPath);
    const typescriptPackageJson = join(dirname(typescriptLibDir), "package.json");

    /** @type {{ virtualPath: string, data: Buffer }[]} */
    const inputs = [
        { virtualPath: "typescript-language-server/lib/cli.mjs", data: readFileSync(cliPath) },
        { virtualPath: "typescript-language-server/lib/run-cli.cjs", data: Buffer.from(RUN_CLI_CJS, "utf8") },
        { virtualPath: "typescript-language-server/package.json", data: readFileSync(tlsPackageJson) },
        { virtualPath: "node_modules/typescript/package.json", data: readFileSync(typescriptPackageJson) },
    ];
    for (const file of TYPESCRIPT_LIB_FILES) {
        inputs.push({
            virtualPath: `node_modules/typescript/lib/${file}`,
            data: readFileSync(join(typescriptLibDir, file)),
        });
    }
    const stdlibs = readdirSync(typescriptLibDir).filter((name) => TYPESCRIPT_STDLIB_RE.test(name));
    if (stdlibs.length === 0) {
        throw new Error(`[pack-ts-server] no lib.*.d.ts found in ${typescriptLibDir}`);
    }
    for (const file of stdlibs.sort()) {
        inputs.push({
            virtualPath: `node_modules/typescript/lib/${file}`,
            data: readFileSync(join(typescriptLibDir, file)),
        });
    }

    return { bundle: packBundle(inputs), fileCount: inputs.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const repoRoot = resolve(import.meta.dirname, "..");
    const { bundle, fileCount } = buildTsServerBundle({ repoRoot });
    const distDir = resolve(repoRoot, "dist");
    mkdirSync(distDir, { recursive: true });
    const outPath = join(distDir, "ts-server.bundle");
    writeFileSync(outPath, bundle);
    console.error(
        `[pack-ts-server] ${outPath} (${(bundle.length / 1024 / 1024).toFixed(1)} MB, ${String(fileCount)} files)`,
    );
}
