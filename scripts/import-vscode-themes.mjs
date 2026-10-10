#!/usr/bin/env node
/**
 * Import built-in color themes from microsoft/vscode into `src/vs/workbench/services/themes/common/themes/`.
 *
 * VS Code ships its default themes as JSON files that reference a base theme via
 * `"include"` (e.g. Dark Modern → Dark+ → Dark (Visual Studio)). This script
 * fetches each theme at the pinned tag, resolves the `include` chain, strips the
 * JSONC comments, and flattens everything into a single `IThemeFile` object that
 * our loader understands (`name` / `type` / `colors` / `tokenColors` /
 * `semanticHighlighting` / `semanticTokenRules`).
 *
 * Repeatable: bumping `VSCODE_TAG` and re-running refreshes all generated theme
 * files to the new tag. The pinned tag matches `extensions/VSCODE_VERSION`.
 *
 * Usage: node scripts/import-vscode-themes.mjs
 */

import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseJsonc } from "jsonc-parser";

const VSCODE_TAG = "1.127.0";
const RAW_BASE = `https://raw.githubusercontent.com/microsoft/vscode/${VSCODE_TAG}/extensions`;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(SCRIPT_DIR, "..", "src", "vs", "workbench", "services", "themes", "common", "themes");

/**
 * Themes to import. `entry` is the top-of-chain JSON (relative to `RAW_BASE`);
 * `type` and `name` are forced onto the flattened output so we don't depend on
 * the source files carrying them. `export` is the generated const name and the
 * output file basename.
 */
const THEMES = [
    {
        export: "dark2026Theme",
        name: "Dark 2026",
        type: "dark",
        entry: "theme-defaults/themes/2026-dark.json",
    },
    {
        export: "darkModernTheme",
        name: "Dark Modern",
        type: "dark",
        entry: "theme-defaults/themes/dark_modern.json",
    },
    {
        export: "darkPlusTheme",
        name: "Dark+",
        type: "dark",
        entry: "theme-defaults/themes/dark_plus.json",
    },
    {
        export: "lightModernTheme",
        name: "Light Modern",
        type: "light",
        entry: "theme-defaults/themes/light_modern.json",
    },
    {
        export: "lightPlusTheme",
        name: "Light+",
        type: "light",
        entry: "theme-defaults/themes/light_plus.json",
    },
    {
        export: "monokaiTheme",
        name: "Monokai",
        type: "dark",
        entry: "theme-monokai/themes/monokai-color-theme.json",
    },
];

async function fetchJsonc(relPath) {
    const url = `${RAW_BASE}/${relPath}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
    const text = await res.text();
    const errors = [];
    const value = parseJsonc(text, errors, { allowTrailingComma: true });
    if (errors.length > 0) throw new Error(`JSONC parse errors in ${relPath}: ${JSON.stringify(errors)}`);
    return value;
}

/**
 * Resolve the `include` chain into a single flat theme. VS Code merges the
 * included (base) theme first, then overlays the including theme: `colors` are
 * object-merged (child overrides), `tokenColors` are concatenated base-first so
 * later (more specific) rules win on ties — matching our TokenThemeResolver.
 * `semanticTokenColors` become `semanticTokenRules`, also base-first, and
 * `semanticHighlighting` is OR'ed along the chain — as `mergeThemeFiles`.
 */
async function resolveTheme(relPath) {
    const raw = await fetchJsonc(relPath);
    const colors = {};
    const tokenColors = [];
    const semanticTokenRules = [];
    let semanticHighlighting = false;

    if (typeof raw.include === "string") {
        const includePath = join(dirname(relPath), raw.include);
        const base = await resolveTheme(includePath);
        Object.assign(colors, base.colors);
        tokenColors.push(...base.tokenColors);
        semanticTokenRules.push(...base.semanticTokenRules);
        semanticHighlighting = base.semanticHighlighting;
    }

    Object.assign(colors, raw.colors ?? {});
    tokenColors.push(...(raw.tokenColors ?? []));
    for (const [selector, value] of Object.entries(raw.semanticTokenColors ?? {})) {
        semanticTokenRules.push({ selector, settings: typeof value === "string" ? { foreground: value } : value });
    }
    semanticHighlighting = semanticHighlighting || raw.semanticHighlighting === true;

    return { colors, tokenColors, semanticTokenRules, semanticHighlighting };
}

/** Keep only the fields our `IThemeFile` models. */
function pruneTokenColor(rule) {
    const settings = {};
    if (rule.settings?.foreground !== undefined) settings.foreground = rule.settings.foreground;
    if (rule.settings?.background !== undefined) settings.background = rule.settings.background;
    if (rule.settings?.fontStyle !== undefined) settings.fontStyle = rule.settings.fontStyle;
    const pruned = { settings };
    if (rule.name !== undefined) pruned.name = rule.name;
    if (rule.scope !== undefined) pruned.scope = rule.scope;
    return pruned;
}

function emit(themeDef, flat) {
    const theme = {
        name: themeDef.name,
        type: themeDef.type,
        colors: flat.colors,
        tokenColors: flat.tokenColors.map(pruneTokenColor),
    };
    if (flat.semanticHighlighting) theme.semanticHighlighting = true;
    if (flat.semanticTokenRules.length > 0) theme.semanticTokenRules = flat.semanticTokenRules;
    const body = JSON.stringify(theme, null, 4);
    const contents =
        `// GENERATED by scripts/import-vscode-themes.mjs from microsoft/vscode ${VSCODE_TAG}.\n` +
        `// Do not edit by hand — re-run the script to refresh.\n` +
        `import type { IThemeFile } from "../../../../../platform/theme/common/iThemeFile.ts";\n\n` +
        `export const ${themeDef.export}: IThemeFile = ${body};\n`;
    const outPath = join(OUT_DIR, `${basenameFor(themeDef.export)}.ts`);
    writeFileSync(outPath, contents);
    return outPath;
}

/** `darkModernTheme` → `darkModern`. */
function basenameFor(exportName) {
    return exportName.replace(/Theme$/, "");
}

async function main() {
    for (const themeDef of THEMES) {
        const flat = await resolveTheme(themeDef.entry);
        const outPath = emit(themeDef, flat);
        const rules = flat.tokenColors.length;
        const colors = Object.keys(flat.colors).length;
        console.log(`✓ ${themeDef.name}: ${colors} colors, ${rules} token rules → ${outPath}`);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
