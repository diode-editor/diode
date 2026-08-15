#!/usr/bin/env node
/**
 * Генератор каталога ключей настроек для builtin-расширения `diode-settings`.
 *
 * Собирает известные ключи настроек из двух реальных источников:
 *  - configuration-узлы приложения (`CONFIGURATION_CONTRIBUTIONS` из
 *    `src/vs/workbench/common/configuration/configurationContributions.ts`) — те же, из
 *    которых runtime собирает `ConfigurationRegistry` (defaults-слой + валидация);
 *  - `contributes.configuration.properties` всех builtin-расширений (rich: type,
 *    default, description, enum) — тот же набор, что валидирует SettingsDiagnostics.
 *
 * Пишет детерминированный (сортировка по ключу) `settings-schema.generated.ts`
 * в каталог `diode-settings/`. Файл коммитится (его импортирует `main.ts`,
 * видимый для tsc), а `build:extensions` держит его в актуальном состоянии.
 * Узлы извлекаются esbuild-bundle + import data-URL (как каталог тем).
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { build } from "esbuild";

/**
 * Configuration-узлы приложения. У файла узлов есть импорты (типы реестра,
 * DEFAULT_COLOR_THEME) — поэтому bundle, как у каталога тем.
 */
async function loadAppConfiguration(repoRoot) {
    const entry = resolve(repoRoot, "src", "vs", "workbench", "common", "configuration", "configurationContributions.ts");
    const result = await build({
        entryPoints: [entry],
        bundle: true,
        write: false,
        format: "esm",
        platform: "neutral",
        logLevel: "silent",
    });
    const code = result.outputFiles[0].text;
    const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
    const mod = await import(url);
    const out = [];
    for (const node of mod.CONFIGURATION_CONTRIBUTIONS) {
        for (const [key, schema] of Object.entries(node.properties)) {
            out.push({
                key,
                type: schema.type,
                default: schema.default,
                description: schema.description,
                enum: schema.enum,
            });
        }
    }
    return out;
}

/**
 * Лейблы встроенных тем — допустимые значения `workbench.colorTheme`. В отличие от
 * `defaults.ts`, у `themes/builtinThemes.ts` есть импорты, поэтому нужен bundle,
 * а не transform. Каталог статичен на этапе сборки: темы, приносимые расширениями
 * (`contributes.themes`), сюда не попадут.
 */
async function loadThemeNames(repoRoot) {
    const entry = resolve(repoRoot, "src", "vs", "workbench", "services", "themes", "common", "themes", "builtinThemes.ts");
    const result = await build({
        entryPoints: [entry],
        bundle: true,
        write: false,
        format: "esm",
        platform: "neutral",
        logLevel: "silent",
    });
    const code = result.outputFiles[0].text;
    const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
    const mod = await import(url);
    return mod.builtinThemes.map((theme) => theme.name);
}

function collectBuiltinContributions(repoRoot) {
    const builtinDir = resolve(repoRoot, "extensions");
    const entries = [];
    for (const dir of readdirSync(builtinDir, { withFileTypes: true })) {
        if (!dir.isDirectory()) continue;
        let pkg;
        try {
            pkg = JSON.parse(readFileSync(join(builtinDir, dir.name, "package.json"), "utf8"));
        } catch {
            continue; // не расширение / битый манифест — пропускаем
        }
        const cfg = pkg?.contributes?.configuration;
        const blocks = Array.isArray(cfg) ? cfg : cfg ? [cfg] : [];
        for (const block of blocks) {
            for (const [key, schema] of Object.entries(block?.properties ?? {})) {
                entries.push({
                    key,
                    type: Array.isArray(schema?.type) ? schema.type.join(" | ") : schema?.type,
                    default: schema?.default,
                    description: schema?.markdownDescription ?? schema?.description,
                    enum: Array.isArray(schema?.enum) ? schema.enum : undefined,
                });
            }
        }
    }
    return entries;
}

/** Убирает undefined-поля, чтобы JSON.stringify не оставлял дыр и вывод был чистым. */
function prune(entry) {
    const out = {};
    for (const [k, v] of Object.entries(entry)) if (v !== undefined) out[k] = v;
    return out;
}

export async function generateSettingsSchema({ repoRoot }) {
    const byKey = new Map();
    // app-узлы сначала; contributes перекрывают (у них richer description/enum).
    for (const e of await loadAppConfiguration(repoRoot)) byKey.set(e.key, prune(e));
    if (byKey.has("workbench.colorTheme")) {
        byKey.set("workbench.colorTheme", {
            ...byKey.get("workbench.colorTheme"),
            enum: await loadThemeNames(repoRoot),
        });
    }
    for (const e of collectBuiltinContributions(repoRoot)) byKey.set(e.key, { ...byKey.get(e.key), ...e });

    const entries = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key)).map(prune);

    const body = entries.map((e) => `    ${JSON.stringify(e)},`).join("\n");
    const file = `// GENERATED FILE — не редактировать вручную.
// Регенерируется \`npm run build:extensions\` (scripts/generate-settings-schema.mjs).
// Каталог известных ключей настроек: configuration-узлы приложения
// (Workbench/Configuration/) + contributes.configuration всех builtin-расширений.
// Вшивается в diode-settings
// на этапе сборки и служит источником автодополнения в settings.json.

export interface ISettingSchemaEntry {
    readonly key: string;
    readonly type?: string;
    readonly default?: unknown;
    readonly description?: string;
    readonly enum?: readonly unknown[];
}

export const SETTINGS_SCHEMA: readonly ISettingSchemaEntry[] = [
${body}
];
`;
    const outPath = resolve(repoRoot, "extensions", "diode-settings", "settings-schema.generated.ts");
    writeFileSync(outPath, file, "utf8");
    return { outPath, count: entries.length };
}

// Прямой запуск: `node scripts/generate-settings-schema.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
    const repoRoot = resolve(import.meta.dirname, "..");
    const { outPath, count } = await generateSettingsSchema({ repoRoot });
    console.error(`[generate-settings-schema] wrote ${count} keys → ${outPath}`);
}
