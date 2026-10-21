#!/usr/bin/env node
/**
 * Компиляция «кодовых» builtin-расширений (`extensions/<x>/main.ts`) в один CJS-файл
 * `<dir>/out/extension.cjs`. В бандле не должно остаться ни одного относительного
 * `require`: файл грузится через `Module._compile` без реального пути (dev и SEA).
 * `vscode` — external, его в subprocess'е подменяет `installVscodeStub`.
 *
 * Раннер: `node scripts/build-extensions.mjs`; `build-sea.mjs` зовёт его ДО упаковки
 * `diode.bundle`.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { build } from "esbuild";

import { generateSettingsSchema } from "./generate-settings-schema.mjs";

const RELATIVE_REQUIRE = /\brequire\d*\(\s*["'`]\.{1,2}\//;

/** Совпадает с `main` в манифесте. */
export const COMPILED_BUILTIN_ENTRY = "out/extension.cjs";

const SOURCE_ENTRY = "main.ts";

/**
 * Уцелевший относительный `require` роняет расширение тихо: `LanguagesNamespace`
 * глотает ошибки провайдера, и автодополнение молча пустеет.
 */
function assertSelfContained(outfile, id) {
    const code = readFileSync(outfile, "utf8");
    const match = RELATIVE_REQUIRE.exec(code);
    if (match === null) return;
    throw new Error(
        `[build-extensions] ${id}: в бандле остался относительный require (${match[0]}…).\n` +
            `Обычно это UMD-зависимость, чьи подмодули тянутся рантайм-require'ом.\n` +
            `Проверь, что у неё есть ESM-сборка (mainFields: ["module", "main"] уже включён).`,
    );
}

export async function buildExtensions({ repoRoot }) {
    const builtinDir = resolve(repoRoot, "extensions");
    // ДО esbuild: `diode-settings/main.ts` импортирует `settings-schema.generated.ts`.
    await generateSettingsSchema({ repoRoot });
    const built = [];
    for (const entry of readdirSync(builtinDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = join(builtinDir, entry.name);
        const entryPoint = join(dir, SOURCE_ENTRY);
        if (!statSync(entryPoint, { throwIfNoEntry: false })?.isFile()) continue; // языковой пак
        const outfile = join(dir, COMPILED_BUILTIN_ENTRY);
        await build({
            entryPoints: [entryPoint],
            outfile,
            platform: "node",
            format: "cjs",
            bundle: true,
            target: "es2024",
            external: ["vscode"],
            // ESM раньше UMD: у UMD подмодули тянутся рантайм-`require` внутри фабрики,
            // которого esbuild не видит (`jsonc-parser` → "./impl/format").
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
