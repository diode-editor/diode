#!/usr/bin/env node
/**
 * Compiles builtin extensions with code (`extensions/<x>/main.ts`) into a single CJS file
 * `<dir>/out/extension.cjs`. The bundle must keep no relative `require`: the file is loaded
 * via `Module._compile` without a real path (dev and SEA).
 * `vscode` is external; `installVscodeStub` substitutes it in the subprocess.
 *
 * Runner: `node scripts/build-extensions.mjs`; `build-sea.mjs` calls it BEFORE packing
 * `diode.bundle`.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { build } from "esbuild";

import { generateSettingsSchema } from "./generate-settings-schema.mjs";

const RELATIVE_REQUIRE = /\brequire\d*\(\s*["'`]\.{1,2}\//;

/** Matches `main` in the manifest. */
export const COMPILED_BUILTIN_ENTRY = "out/extension.cjs";

const SOURCE_ENTRY = "main.ts";

/**
 * Language servers a builtin starts as a separate node process (vendored upstream sources). Each one is a single ESM
 * file; `typescript` stays external: the server resolves it from where it lies, the repo's `node_modules` in dev and
 * the unpacked `ts-server.bundle` in the binary (`pack-ts-server.mjs` packs the server next to TypeScript).
 * `@vscode/l10n` is bundled as CommonJS and still calls `require("fs")`: the banner gives the ESM output a `require`,
 * as upstream's `esbuild.mts` does.
 */
export const LANGUAGE_SERVER_BUNDLES = [
    {
        id: "html-language-features",
        entry: "server/src/node/htmlServerNodeMain.ts",
        outfile: "server/out/node/htmlServerMain.mjs",
    },
];

async function buildLanguageServer(dir, server) {
    const outfile = join(dir, server.outfile);
    await build({
        entryPoints: [join(dir, server.entry)],
        outfile,
        platform: "node",
        format: "esm",
        bundle: true,
        target: "es2024",
        external: ["typescript"],
        mainFields: ["module", "main"],
        // Aliased: a bundled module may import `createRequire` itself (the vendored `javascriptLibs.ts` does).
        banner: {
            js: 'import { createRequire as bannerCreateRequire } from "module"; const require = bannerCreateRequire(import.meta.url);',
        },
        sourcemap: false,
        logLevel: "warning",
    });
    return outfile;
}

/**
 * A leftover relative `require` breaks the extension silently: `LanguagesNamespace`
 * swallows provider errors, and completion quietly goes empty.
 */
function assertSelfContained(outfile, id) {
    const code = readFileSync(outfile, "utf8");
    const match = RELATIVE_REQUIRE.exec(code);
    if (match === null) return;
    throw new Error(
        `[build-extensions] ${id}: the bundle still has a relative require (${match[0]}…).\n` +
            `Usually a UMD dependency whose submodules load via a runtime require.\n` +
            `Check that it has an ESM build (mainFields: ["module", "main"] is already on).`,
    );
}

/**
 * A builtin manifest with `main` but no `main.ts` beside it promises code nobody ships: the host reads
 * the entry point of every builtin with `main`, and a missing one is `<id>: failed to register (builtin)`
 * in the Extensions channel on every start (upstream `git-base` did that until the import script
 * started stripping its runtime fields).
 */
export function assertEntryPointHasSource(id, manifest, hasSource) {
    if (hasSource || typeof manifest.main !== "string") return;
    throw new Error(
        `[build-extensions] ${id}: the manifest declares main "${manifest.main}" but there is no ${SOURCE_ENTRY} to compile.\n` +
            `A language pack must not promise code: re-run scripts/import-vscode-extensions.mjs (it strips main,\n` +
            `browser, activationEvents and the command contributions) or add the source.`,
    );
}

export async function buildExtensions({ repoRoot }) {
    const builtinDir = resolve(repoRoot, "extensions");
    // BEFORE esbuild: `diode-settings/main.ts` imports `settings-schema.generated.ts`.
    await generateSettingsSchema({ repoRoot });
    const built = [];
    for (const entry of readdirSync(builtinDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = join(builtinDir, entry.name);
        const entryPoint = join(dir, SOURCE_ENTRY);
        const hasSource = statSync(entryPoint, { throwIfNoEntry: false })?.isFile() === true;
        assertEntryPointHasSource(entry.name, JSON.parse(readFileSync(join(dir, "package.json"), "utf8")), hasSource);
        if (!hasSource) continue; // a language pack
        const outfile = join(dir, COMPILED_BUILTIN_ENTRY);
        await build({
            entryPoints: [entryPoint],
            outfile,
            platform: "node",
            format: "cjs",
            bundle: true,
            target: "es2024",
            external: ["vscode"],
            // ESM before UMD: UMD submodules load via a runtime `require` inside the factory,
            // which esbuild does not see (`jsonc-parser` -> "./impl/format").
            mainFields: ["module", "main"],
            sourcemap: false,
            logLevel: "warning",
        });
        assertSelfContained(outfile, entry.name);
        built.push({ id: entry.name, entryPoint, outfile });
        for (const server of LANGUAGE_SERVER_BUNDLES.filter((s) => s.id === entry.name)) {
            await buildLanguageServer(dir, server);
        }
    }
    return built;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const repoRoot = resolve(import.meta.dirname, "..");
    const built = await buildExtensions({ repoRoot });
    console.error(`[build-extensions] compiled ${built.length}: ${built.map((b) => b.id).join(", ") || "—"}`);
}
