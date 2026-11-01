/**
 * Lazy chunks: dependencies not needed before the first frame are built not into
 * `dist/main.cjs` but as separate `lazy/<id>.cjs` files (SEA assets, otherwise a file
 * next to `main.cjs`); `loadLazyModule` loads them on first use of the feature.
 * `main.cjs` keeps an external `import("<id>")` of the chunk (`tsup.config.ts`) as
 * the dev-build fallback.
 *
 * A chunk is either a package (`id`) or our own code (`entry`, a process role); a role
 * shares common modules with the core and carries a copy of them within `sharedBudgetKb`.
 *
 * A new chunk is an entry in {@link LAZY_CHUNKS} plus `loadLazyModule`/`importLazyModule`
 * at the seam; the rest is picked up from the list. Recipe: docs/arch/Common.md, the lazy chunks section.
 */

import { execFileSync } from "node:child_process";
import { builtinModules, createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { resolveDiodeVersion } from "./resolve-version.mjs";

/**
 * V8 snapshot build flags: without `--predictable` the second-pass binary rejects the
 * chunk cache taken by the first-pass binary ({@link buildLazyChunkCodeCaches}).
 */
export const SNAPSHOT_BUILD_FLAGS = ["--predictable"];

export const SNAPSHOT_ENTRY = join(import.meta.dirname, "snapshot-entry.cjs");

/**
 * @param {string} mainPath
 * @returns {Record<string, string>}
 */
export function snapshotEntryEnv(mainPath) {
    return { DIODE_SNAPSHOT_MAIN: mainPath };
}

/**
 * `warmup` runs while the code cache is taken: V8 caches only already compiled
 * functions and compiles lazily, so without a warmup the cache holds only the module
 * top level. The function goes to the child node as source (`String(fn)`), so no closures.
 *
 * `entry` is the entry module path from the repo root; it requires `sharedBudgetKb`.
 *
 * @type {ReadonlyArray<{ id: string, reason: string, warmup?: (module: any) => unknown, entry?: string, sharedBudgetKb?: number }>}
 */
export const LAZY_CHUNKS = [
    { id: "yauzl", reason: ".vsix install" },
    // Called from common code, hence importLazyModule.
    { id: "semver", reason: "extension gallery: registry versions and engines" },
    {
        id: "@xterm/headless",
        reason: "integrated terminal: VT emulator",
        // Like the first XtermSurface output: a color and a newline.
        warmup: async (xterm) => {
            const term = new xterm.Terminal({ cols: 80, rows: 24, allowProposedApi: true, scrollback: 1000 });
            await new Promise((resolve) => term.write("diode \u001b[32mwarmup\u001b[0m\r\n$ ", resolve));
            term.dispose();
        },
    },
    {
        id: "iconv-lite",
        reason: "encodings other than utf-8 and UTF-16",
        // A single-byte encoding round trip, like encoding.ts on reopen and save; Cyrillic text ("Privet, mir!").
        warmup: (iconv) => {
            const bytes = iconv.encode("\u041f\u0440\u0438\u0432\u0435\u0442, \u043c\u0438\u0440!\n", "windows1251", { addBOM: false });
            iconv.decode(bytes, "windows1251", { stripBOM: false });
        },
    },
    // Budget is the measurement plus ~5%; shared with the core: vscodeTypes, the RPC protocol,
    // vscode-uri, jsonc-parser, base/common. Raises: 155 for the environmentVariableCollection
    // parsers, 156 (a human decision) for `sideEditors` in the strip snapshot (#683, 155.06 KB),
    // 157 for `vscode.DocumentHighlight` in vscodeTypes (#948, 156.3 KB).
    {
        id: "roles/extension-host",
        reason: "extension host role: vscode API implementation",
        entry: "src/vs/diode/roles/extensionHostRole.ts",
        sharedBudgetKb: 160,
    },
    // Shared with the core (63 KB of 75): chokidar, which the core keeps for settings file subscriptions.
    {
        id: "roles/file-watcher",
        reason: "file watcher role: tree walk",
        entry: "src/vs/diode/roles/fileWatcherRole.ts",
        sharedBudgetKb: 66,
    },
];

/**
 * `module` before `main`: for CJS esbuild picks `main`, where jsonc-parser has a UMD build
 * with `require` inside the factory; esbuild does not inline it, and the bundle fails at runtime.
 */
export const MAIN_FIELDS = ["module", "main"];

/**
 * The path is relative to `repoRoot`: tsup bundles its config together with this module,
 * so `import.meta.dirname` here would point at the root.
 *
 * @param {string} repoRoot
 * @returns {{ define: Record<string, string>, inject: string[] }}
 */
export function importMetaUrlShim(repoRoot) {
    return {
        define: { "import.meta.url": "__diode_import_meta.url" },
        inject: [join(repoRoot, "scripts", "import-meta-url-shim.mjs")],
    };
}

const LAZY_CHUNK_IDS = new Set(LAZY_CHUNKS.map(({ id }) => id));

/**
 * Rewrites `import()` of a chunk entry to an external `import("<id>")`: without code splitting
 * esbuild would inline the entry into `main.cjs`. A static import of the entry is rewritten
 * the same way, and the gate catches it.
 *
 * @param {string} repoRoot
 * @returns {import("esbuild").Plugin}
 */
export function lazyEntryChunksPlugin(repoRoot) {
    const byPath = new Map(LAZY_CHUNKS.filter((c) => c.entry !== undefined).map((c) => [resolve(repoRoot, c.entry), c.id]));
    const names = [...byPath.keys()].map((p) => basename(p).replace(/[.]/g, "\\."));
    return {
        name: "diode-lazy-entry-chunks",
        setup(build) {
            if (names.length === 0) return;
            build.onResolve({ filter: new RegExp(`(^|/)(${names.join("|")})$`) }, (args) => {
                const id = byPath.get(resolve(args.resolveDir, args.path));
                return id === undefined ? undefined : { path: id, external: true };
            });
        },
    };
}

/**
 * SEA asset key and path relative to `main.cjs`; `src/vs/base/node/lazyModule.ts` uses the same formula.
 *
 * @param {string} id
 */
export function lazyChunkAssetName(id) {
    return `lazy/${id}.cjs`;
}

/**
 * `src/vs/base/node/lazyModule.ts` uses the same formula.
 *
 * @param {string} id
 */
export function lazyChunkCacheAssetName(id) {
    return `lazy/${id}.v8cache`;
}

/**
 * SEA only. V8 accepts a cache only if the version, flags and process snapshot match
 * (on node 26, a snapshot of the same entry with `--predictable`), so the first-pass binary
 * takes the cache in run-as-node, and the second pass embeds it into a binary built from the
 * same `main.cjs`. No `NODE_OPTIONS`: V8 flags must match the binary's runtime.
 *
 * @param {{ chunks: ReadonlyArray<{ id: string, asset: string, path: string }>, outDir: string, command: readonly string[] }} params
 *   `command` runs `lazy-chunk-code-cache.cjs`: `[binary]` (with
 *   `DIODE_RUN_AS_NODE=1`) or any command with the same argv semantics.
 * @returns {Array<{ asset: string, path: string }>}
 */
export function buildLazyChunkCodeCaches({ chunks, outDir, command }) {
    const warmups = new Map(LAZY_CHUNKS.map(({ id, warmup }) => [id, warmup]));
    const env = { ...process.env, DIODE_RUN_AS_NODE: "1" };
    delete env.NODE_OPTIONS;
    // Not a module constant: tsup inlines this file into its config, where `import.meta.dirname` is the root.
    const script = join(import.meta.dirname, "lazy-chunk-code-cache.cjs");
    const [file, ...prefix] = command;
    return chunks.map(({ id, asset, path }) => {
        const cacheAsset = lazyChunkCacheAssetName(id);
        const out = join(outDir, cacheAsset);
        mkdirSync(dirname(out), { recursive: true });
        const warmup = warmups.get(id);
        const args = [...prefix, script, path, asset, out, ...(warmup ? [String(warmup)] : [])];
        execFileSync(file, args, { env, stdio: "inherit" });
        return { asset: cacheAsset, path: out };
    });
}

/**
 * @param {{ repoRoot: string, distDir: string, write?: boolean }} params
 *   `write: false` only builds (the gate without a binary build).
 * @returns {Promise<Array<{ id: string, asset: string, path: string, metafile: import("esbuild").Metafile }>>}
 */
export async function buildLazyChunks({ repoRoot, distDir, write = true }) {
    const esbuild = await import("esbuild");
    const chunks = [];
    for (const { id, entry, sharedBudgetKb } of LAZY_CHUNKS) {
        const asset = lazyChunkAssetName(id);
        const outfile = join(distDir, asset);
        const target = entry === undefined ? id : `./${entry}`;
        const result = await esbuild.build({
            stdin: { contents: `module.exports = require(${JSON.stringify(target)});`, resolveDir: repoRoot, loader: "js" },
            bundle: true,
            platform: "node",
            format: "cjs",
            target: "es2024",
            outfile,
            metafile: true,
            write: false,
            absWorkingDir: repoRoot,
            logLevel: "warning",
            ...(entry === undefined
                ? {}
                : {
                      // Other chunks are reached by import() through the loader.
                      external: [...LAZY_CHUNK_IDS].filter((other) => other !== id),
                      // Same package builds as main.cjs, otherwise a shared module is a different file and the gate misses the copy.
                      mainFields: MAIN_FIELDS,
                      // Same shim as the core: the chunk's entryDir() must be the main.cjs directory.
                      define: {
                          __DIODE_VERSION__: JSON.stringify(resolveDiodeVersion()),
                          ...importMetaUrlShim(repoRoot).define,
                      },
                      inject: importMetaUrlShim(repoRoot).inject,
                  }),
        });
        if (write) {
            for (const file of result.outputFiles) {
                mkdirSync(dirname(file.path), { recursive: true });
                writeFileSync(file.path, file.contents);
            }
        }
        chunks.push({ id, asset, path: outfile, metafile: result.metafile, entry, sharedBudgetKb });
    }
    return chunks;
}

const BUILTINS = new Set(builtinModules);

/** @param {string} path */
function isBuiltin(path) {
    return path.startsWith("node:") || BUILTINS.has(path);
}

/**
 * Ratchet on the first-frame graph. A chunk of our own code shares common modules with the core,
 * so its rule is softer than a package's: the entry stays out of `main.cjs`, and the copy of shared
 * modules (an extra parse and module state in two instances) stays within budget.
 *
 * @param {{ mainMetafile: import("esbuild").Metafile, chunks: ReadonlyArray<{ id: string, metafile: import("esbuild").Metafile, entry?: string, sharedBudgetKb?: number }> }} params
 * @returns {string[]} violations, one line each
 */
export function verifyLazyChunks({ mainMetafile, chunks }) {
    const errors = [];
    const mainOutputs = codeOutputs(mainMetafile);
    const mainInputs = new Set(mainOutputs.flatMap(([, output]) => Object.keys(output.inputs)));

    for (const { id, metafile, entry, sharedBudgetKb } of chunks) {
        // 1. Chunk modules are not duplicated in the core.
        if (entry === undefined) {
            for (const input of Object.keys(metafile.inputs)) {
                if (input !== "<stdin>" && mainInputs.has(input)) {
                    errors.push(`${id}: module ${input} is in both the chunk and main.cjs; a static import in the core pulls it in`);
                }
            }
        } else {
            errors.push(...verifyEntryChunk({ id, metafile, entry, sharedBudgetKb, mainInputs }));
        }
        // 2. The core reaches the chunk only dynamically (the loadLazyModule fallback).
        for (const [file, output] of mainOutputs) {
            for (const imp of output.imports) {
                if (imp.path === id && imp.kind !== "dynamic-import") {
                    errors.push(`${id}: ${basename(file)} imports the chunk statically (${imp.kind}); use loadLazyModule / importLazyModule`);
                }
            }
        }
        // 3. The chunk is self-contained: only builtin modules and other chunks via import().
        for (const output of Object.values(metafile.outputs)) {
            for (const imp of output.imports) {
                if (!imp.external || isBuiltin(imp.path)) continue;
                if (LAZY_CHUNK_IDS.has(imp.path) && imp.kind === "dynamic-import") continue;
                errors.push(`${id}: the chunk requires external module ${imp.path}, which SEA does not have`);
            }
        }
    }
    return errors;
}

/**
 * @param {import("esbuild").Metafile} metafile
 */
function codeOutputs(metafile) {
    return Object.entries(metafile.outputs).filter(([file]) => /[.]c?js$/.test(file));
}

/**
 * @param {import("esbuild").Metafile} metafile
 * @param {Set<string>} mainInputs
 */
function sharedWithMain(metafile, mainInputs) {
    const shared = Object.values(metafile.outputs)
        .flatMap((output) => Object.entries(output.inputs))
        .filter(([input]) => mainInputs.has(input))
        .sort(([, a], [, b]) => b.bytesInOutput - a.bytesInOutput);
    const sharedBytes = shared.reduce((sum, [, { bytesInOutput }]) => sum + bytesInOutput, 0);
    return { shared, sharedBytes };
}

/**
 * The summary to set and raise budgets by.
 *
 * @param {{ mainMetafile: import("esbuild").Metafile, chunks: ReadonlyArray<{ id: string, metafile: import("esbuild").Metafile, entry?: string, sharedBudgetKb?: number }> }} params
 * @returns {string[]}
 */
export function describeEntryChunks({ mainMetafile, chunks }) {
    const mainInputs = new Set(codeOutputs(mainMetafile).flatMap(([, output]) => Object.keys(output.inputs)));
    return chunks
        .filter((c) => c.entry !== undefined)
        .map(({ id, metafile, sharedBudgetKb }) => {
            const total = Object.values(metafile.outputs).reduce((sum, output) => sum + output.bytes, 0);
            const { sharedBytes } = sharedWithMain(metafile, mainInputs);
            const kb = (/** @type {number} */ n) => (n / 1024).toFixed(1);
            return `${id}: chunk ${kb(total)} KB, shared with main.cjs ${kb(sharedBytes)} KB (budget ${sharedBudgetKb} KB)`;
        });
}

/**
 * @param {{ id: string, metafile: import("esbuild").Metafile, entry: string, sharedBudgetKb: number | undefined, mainInputs: Set<string> }} params
 * @returns {string[]}
 */
function verifyEntryChunk({ id, metafile, entry, sharedBudgetKb, mainInputs }) {
    if (sharedBudgetKb === undefined) {
        return [`${id}: a chunk of our own code has no sharedBudgetKb, how much of shared core modules it may carry as a copy`];
    }
    if (mainInputs.has(entry)) {
        return [`${id}: entry ${entry} is in main.cjs; the core imports the role statically, so the chunk is useless`];
    }
    const { shared, sharedBytes } = sharedWithMain(metafile, mainInputs);
    if (sharedBytes <= sharedBudgetKb * 1024) return [];
    const top = shared
        .slice(0, 5)
        .map(([input, { bytesInOutput }]) => `${input} ${(bytesInOutput / 1024).toFixed(1)} KB`)
        .join(", ");
    return [
        `${id}: modules shared with main.cjs take ${(sharedBytes / 1024).toFixed(1)} KB, over the ${sharedBudgetKb} KB budget ` +
            `(largest: ${top}). Role code leaked into the core via a static import, or the role pulls in too much of the core`,
    ];
}
