#!/usr/bin/env node
/**
 * Каталог ключей настроек для `diode-settings` (`settings-schema.generated.ts`): узлы
 * `CONFIGURATION_CONTRIBUTIONS` приложения плюс `contributes.configuration` всех
 * builtin-расширений. Файл коммитится — его импортирует `main.ts`, видимый для tsc;
 * в актуальном состоянии его держит `build:extensions`.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { build } from "esbuild";
import { format, resolveConfig } from "prettier";

/** У файла узлов есть импорты — поэтому bundle, а не transform. */
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
                type: Array.isArray(schema.type) ? schema.type.join(" | ") : schema.type,
                default: schema.default,
                description: schema.description,
                enum: schema.enum,
            });
        }
    }
    return out;
}

/** Каталог статичен на этапе сборки: темы из `contributes.themes` сюда не попадут. */
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
            continue;
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
    // Иначе регенерация и `npm run lint` наперегонки правят один файл.
    const prettierOptions = await resolveConfig(outPath);
    const formatted = await format(file, { ...prettierOptions, parser: "typescript" });
    writeFileSync(outPath, formatted, "utf8");
    return { outPath, count: entries.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const repoRoot = resolve(import.meta.dirname, "..");
    const { outPath, count } = await generateSettingsSchema({ repoRoot });
    console.error(`[generate-settings-schema] wrote ${count} keys → ${outPath}`);
}
