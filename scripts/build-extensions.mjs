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

export async function buildExtensions({ repoRoot }) {
    const builtinDir = resolve(repoRoot, "extensions");
    // BEFORE esbuild: `diode-settings/main.ts` imports `settings-schema.generated.ts`.
    await generateSettingsSchema({ repoRoot });
    const built = [];
    for (const entry of readdirSync(builtinDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = join(builtinDir, entry.name);
        const entryPoint = join(dir, SOURCE_ENTRY);
        if (!statSync(entryPoint, { throwIfNoEntry: false })?.isFile()) continue; // a language pack
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
    }
    return built;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const repoRoot = resolve(import.meta.dirname, "..");
    const built = await buildExtensions({ repoRoot });
    console.error(`[build-extensions] compiled ${built.length}: ${built.map((b) => b.id).join(", ") || "—"}`);
}
