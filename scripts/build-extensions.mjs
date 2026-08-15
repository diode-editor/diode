#!/usr/bin/env node
/**
 * Компиляция «кодовых» builtin-расширений в один CJS-файл `<dir>/out/extension.cjs`.
 *
 * Кодовый builtin — подкаталог `extensions/*` с исходником `main.ts`
 * (языковые паки его не имеют — только грамматики/конфиги). esbuild бандлит
 * `main.ts` + `./lib/*` в один файл; `vscode` остаётся external (его в subprocess'е
 * подменяет `installVscodeStub`), node:builtins — тоже external (`platform:"node"`).
 * Поэтому в бандле не остаётся ни одного относительного `require` — файл грузится
 * в память через `Module._compile` без реального пути (dev и SEA единообразно).
 *
 * Раннер: `node scripts/build-extensions.mjs`. Также вызывается из `build-sea.mjs`
 * ДО упаковки бандла, чтобы `out/extension.cjs` попал в `diode.bundle`.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { build } from "esbuild";

import { generateSettingsSchema } from "./generate-settings-schema.mjs";

/**
 * Ловит относительные `require("./…")`/`require("../…")`, уцелевшие в бандле.
 * Строковые литералы в коде (напр. `"./impl/format"` сам по себе) не считаются —
 * важен именно вызов require.
 */
const RELATIVE_REQUIRE = /\brequire\d*\(\s*["'`]\.{1,2}\//;

/** Имя скомпилированного entry внутри каталога расширения (совпадает с `main` в манифесте). */
export const COMPILED_BUILTIN_ENTRY = "out/extension.cjs";

/** Исходный entry кодового builtin по конвенции. */
const SOURCE_ENTRY = "main.ts";

/**
 * Бандл грузится через `Module._compile` без реального пути, поэтому уцелевший
 * относительный `require` не резолвится и роняет расширение. Хуже того, падение
 * тихое: `LanguagesNamespace` глотает ошибки провайдера, и автодополнение просто
 * молча пустеет. Проверяем инвариант на месте, а не ждём отладки в UI.
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

/**
 * Скомпилировать все кодовые builtin-расширения. Возвращает список
 * `{ id, entryPoint, outfile }` собранных.
 */
export async function buildExtensions({ repoRoot }) {
    const builtinDir = resolve(repoRoot, "extensions");
    // Генерируем каталог ключей настроек ДО esbuild — `diode-settings/main.ts`
    // импортирует `settings-schema.generated.ts`, который бандлится в out/extension.cjs.
    await generateSettingsSchema({ repoRoot });
    const built = [];
    for (const entry of readdirSync(builtinDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = join(builtinDir, entry.name);
        const entryPoint = join(dir, SOURCE_ENTRY);
        if (!statSync(entryPoint, { throwIfNoEntry: false })?.isFile()) continue; // не кодовый builtin
        const outfile = join(dir, COMPILED_BUILTIN_ENTRY);
        await build({
            entryPoints: [entryPoint],
            outfile,
            platform: "node",
            format: "cjs",
            bundle: true,
            target: "es2024",
            external: ["vscode"],
            // Предпочитаем ESM-сборку зависимости её UMD-варианту (`main`). У UMD
            // подмодули тянутся рантайм-вызовом `require` внутри фабрики — esbuild
            // его статически не видит и оставляет как есть, из-за чего в бандле
            // всплывает относительный require (напр. `jsonc-parser` → "./impl/format")
            // и падает при загрузке через `Module._compile`. У ESM импорты статические.
            mainFields: ["module", "main"],
            sourcemap: false,
            logLevel: "warning",
        });
        assertSelfContained(outfile, entry.name);
        built.push({ id: entry.name, entryPoint, outfile });
    }
    return built;
}

// Прямой запуск: `node scripts/build-extensions.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
    const repoRoot = resolve(import.meta.dirname, "..");
    const built = await buildExtensions({ repoRoot });
    console.error(`[build-extensions] compiled ${built.length}: ${built.map((b) => b.id).join(", ") || "—"}`);
}
