#!/usr/bin/env node
/**
 * Checks the layout axes of `src/vs/*` (like upstream `code-layering`,
 * `code-import-patterns` and `layersChecker`):
 *
 *  1. Layers (import only from your own and lower ones):
 *     base/common → base/node → platform → editor → workbench → diode.
 *  2. Environments: common → [common], browser → [common, browser],
 *     node → [common, node]; the environment is the first common/browser/node path segment.
 *  3. `@tuidom/*` is mapped onto the same axis by subpath (TUIDOM_ENVS); `base/common`
 *     takes no values from the engine; `@tuidom/core/common/disposable` is banned in all
 *     of `src/`, `import type` too: the primitive is ours, `vs/base/common/lifecycle.ts`.
 *  4. common/browser don't import OS modules (except `node:path`) or
 *     NODE_ONLY_PACKAGES; `import type` counts, since an `fs.Dirent` type in a signature
 *     ties code to Node too. The debt is the NODE_IMPORT_DEBT ratchet.
 *
 * For axes 1–3 jsdoc links and `import type` are not dependencies (as in upstream
 * layersChecker). Files outside `src/vs` are not checked.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import * as path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const vsRoot = path.join(repoRoot, "src", "vs");

// Order = layer height.
const ZONES = [
    "src/vs/base/common",
    "src/vs/base/node",
    "src/vs/platform",
    "src/vs/editor",
    "src/vs/workbench",
    "src/vs/diode",
];

/**
 * [file prefix, import prefix]; add new ones only with an entry in
 * docs/TODO/VscodeStructureFollowUps.md.
 */
const EXCEPTIONS = [
    // Single-process TUI: the "browser" side calls node services directly, without the vscode RPC bridge.
    ["src/vs/workbench/browser/", "src/vs/workbench/services/terminalEnvironment/node/"],
    ["src/vs/workbench/services/keybinding/browser/", "src/vs/workbench/services/terminalEnvironment/node/"],
    // The theme→styles bridge keeps unthemed defaults next to the editor widget; splitting them
    // is a follow-up (unthemed defaults in platform or getEditorStyles in editor).
    ["src/vs/platform/theme/browser/defaultStyles.ts", "src/vs/editor/browser/editorElement.ts"],
    // File icon colors are packed with the engine's packRgb, a value from @tuidom in
    // base/common. Moving the color part of icons higher is a follow-up.
    ["src/vs/base/common/fileIcons.ts", "@tuidom/core/common/colorUtils"],
];

/** The workbench core doesn't know features (like upstream `code-layering`): importing contrib from here is banned. */
const WORKBENCH_CORE_DIRS = [
    "src/vs/workbench/browser/",
    "src/vs/workbench/common/",
    "src/vs/workbench/services/",
    "src/vs/workbench/api/",
];
const WORKBENCH_CONTRIB_DIR = "src/vs/workbench/contrib/";

/** Ratchet: no new entries; a stale entry is a violation too. The plan is E4. */
const DIRECTION_EXCEPTIONS = [
    // Root: feature references in setWorkspaceFolder/activate/restore (E4 PR5).
    "src/vs/workbench/browser/workbenchComponent.ts",
    // Small core action files call feature services (explorer, markers), E4 territory.
    "src/vs/workbench/browser/actions/editorGroupActions.ts",
    "src/vs/workbench/browser/actions/inputActions.ts",
    "src/vs/workbench/browser/actions/layoutActions.ts",
];

/** The first match wins; an unmapped subpath is a violation. */
const TUIDOM_ENVS = [
    [/^@tuidom\/core\/(common|input)\//, "common"],
    [/^@tuidom\/(core\/(dom|rendering|backend)|elements|inspector)\//, "browser"],
    [/^@tuidom\/(terminal|headless)-backend\//, "node"],
    // Belongs to no environment: only tests and the `vs/diode` test profile may use it.
    [/^@tuidom\/testing\//, "test"],
];

const NODE_ONLY_PACKAGES = new Set(["chokidar", "node-pty", "yauzl"]);

const ALLOWED_NODE_BUILTINS = new Set(["node:path"]);

/** Ratchet: the gate also fails on a stale entry. The rest is PR 5 in docs/TODO/FileService.md. */
const NODE_IMPORT_DEBT = [
    ["src/vs/platform/workspace/common/workspaceId.ts", "node:crypto"],
    ["src/vs/workbench/api/common/vscodeNamespace.ts", "node:crypto"],
    // A synchronous existence check: restore is synchronous by design (paths are needed
    // before the first frame) and becomes async with model loading (PR 5);
    // history is an open question in docs/TODO/FileService.md.
    ["src/vs/workbench/services/editor/browser/editorPaneFactory.ts", "node:fs"],
    ["src/vs/workbench/services/history/browser/historyService.ts", "node:fs"],
    // Small files are read synchronously by decision (OpenPerformance 4.5), large ones through IRandomAccessFile;
    // moving reads onto the file service is optional debt (docs/TODO/FileService.md).
    ["src/vs/workbench/services/textfile/common/textFileModel.ts", "node:fs"],
];

function osModuleOf(specifier) {
    if (specifier.startsWith(".")) return null;
    const name = specifier.startsWith("node:") ? specifier : `node:${specifier}`;
    const root = name.slice("node:".length).split("/")[0];
    if (specifier.startsWith("node:") || builtinModules.includes(root)) {
        return ALLOWED_NODE_BUILTINS.has(name) ? null : name;
    }
    const pkg = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
    return NODE_ONLY_PACKAGES.has(pkg) ? pkg : null;
}

function checkNodeImports(rel, env, content, seenDebt, violations) {
    if (env !== "common" && env !== "browser") return;
    for (const m of content.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*(["'])([^"']+)\1/g)) {
        const module = osModuleOf(m[2]);
        if (module === null) continue;
        const key = `${rel}|${module}`;
        if (NODE_IMPORT_DEBT.some(([f, mod]) => `${f}|${mod}` === key)) {
            seenDebt.add(key);
            continue;
        }
        violations.push(
            `${rel} → ${m[2]}  (environment ${env} takes no OS modules: add a seam in common or move it to node)`,
        );
    }
}

const TUIDOM_DISPOSABLE = "@tuidom/core/common/disposable";

function tuidomEnvOf(specifier) {
    for (const [re, env] of TUIDOM_ENVS) if (re.test(specifier)) return env;
    return null;
}

function zoneOf(rel) {
    let best = null;
    for (const z of ZONES) {
        if (rel.startsWith(`${z}/`) && (best === null || z.length > best.length)) best = z;
    }
    return best;
}

/** Tests, stories and benches legally cross the axes: they boot the full app (vscode keeps them in test/ trees). */
function isCheckedSource(rel) {
    if (/\.(test|stories|bench)\.(ts|tsx)$/.test(rel)) return false;
    if (/(^|\.)testUtils\.ts$/i.test(rel)) return false;
    if (rel.includes("/learning/") || rel.includes("/__fixtures__/")) return false;
    return true;
}

/** Pure contracts in node/browser directories. */
const ENV_OVERRIDES = new Map([]);

function envOf(rel) {
    const override = ENV_OVERRIDES.get(rel);
    if (override !== undefined) return override;
    // The app assembly glues browser and node together by definition.
    if (rel.startsWith("src/vs/diode/")) return null;
    for (const seg of rel.split("/")) {
        if (seg === "common" || seg === "browser" || seg === "node") return seg;
    }
    return null;
}

const ENV_ALLOWED = {
    common: new Set(["common"]),
    browser: new Set(["common", "browser"]),
    node: new Set(["common", "node"]),
};

function listFiles(dirAbs, out = []) {
    for (const entry of readdirSync(dirAbs, { withFileTypes: true })) {
        const abs = path.join(dirAbs, entry.name);
        if (entry.isDirectory()) listFiles(abs, out);
        else if (/\.(ts|tsx)$/.test(entry.name)) out.push(abs);
    }
    return out;
}

/** "A token next to its type" (docs/DI.md): `T` of `token<T>()` is not from a higher layer. */
function checkTokenDeclarations(rel, raw, zoneIdx, violations) {
    for (const m of raw.matchAll(/\btoken\s*<\s*([A-Za-z0-9_]+)\b/g)) {
        const typeName = m[1];
        if (new RegExp(`\\b(class|interface|type)\\s+${typeName}\\b`).test(raw)) continue;
        const importMatch = raw.match(
            new RegExp(`import[^;]*\\{[^}]*\\b${typeName}\\b[^}]*\\}\\s*from\\s*["']([^"']+)["']`),
        );
        if (!importMatch) continue; // re-exports etc. are not our axis
        const target = path
            .normalize(path.join(path.dirname(rel), importMatch[1]))
            .split(path.sep)
            .join("/");
        const targetZone = zoneOf(target);
        if (targetZone !== null && ZONES.indexOf(targetZone) > zoneIdx) {
            violations.push(`${rel} → token<${typeName}> (the type is from layer ${targetZone}, above the token's layer)`);
        }
    }
}

function stripComments(raw) {
    return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function checkTuidomImports(rel, zone, env, content, violations) {
    for (const m of content.matchAll(/(["'])(@tuidom\/[^"']+)\1/g)) {
        const specifier = m[2];
        if (EXCEPTIONS.some(([f, t]) => rel.startsWith(f) && specifier.startsWith(t))) continue;
        const targetEnv = tuidomEnvOf(specifier);
        if (targetEnv === null) {
            violations.push(`${rel} → ${specifier}  (the engine subpath has no environment, see TUIDOM_ENVS)`);
            continue;
        }
        if (zone === "src/vs/base/common") {
            violations.push(`${rel} → ${specifier}  (base/common takes no values from the engine)`);
            continue;
        }
        if (env !== null && !ENV_ALLOWED[env].has(targetEnv)) {
            violations.push(`${rel} → ${specifier}  (environment: ${env} cannot import ${targetEnv})`);
        }
    }
}

/** All of `src/`, including tests and `import type`. */
function checkDisposableImports(violations) {
    for (const abs of listFiles(path.join(repoRoot, "src"))) {
        const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
        const content = stripComments(readFileSync(abs, "utf8"));
        if (content.includes(`"${TUIDOM_DISPOSABLE}"`) || content.includes(`'${TUIDOM_DISPOSABLE}'`)) {
            violations.push(`${rel} → ${TUIDOM_DISPOSABLE}  (the lifecycle primitive is vs/base/common/lifecycle.ts)`);
        }
    }
}

function main() {
    if (!existsSync(vsRoot)) {
        console.log("[check-layers] src/vs does not exist (before the migration), nothing to check");
        return;
    }

    const violations = [];
    const usedDirectionExceptions = new Set();
    const seenDebt = new Set();
    checkDisposableImports(violations);
    for (const abs of listFiles(vsRoot)) {
        const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
        if (!isCheckedSource(rel)) continue;
        const zone = zoneOf(rel);
        const env = envOf(rel);
        if (zone === null) continue;
        const zoneIdx = ZONES.indexOf(zone);
        const raw = readFileSync(abs, "utf8");
        checkTokenDeclarations(rel, raw, zoneIdx, violations);
        checkNodeImports(rel, env, stripComments(raw), seenDebt, violations);
        // The specifier forms are listed explicitly: a lazy `type\s[\s\S]*?from`
        // caught `export type X = …` and swallowed code up to the nearest `from`.
        const content = stripComments(raw).replace(
            /(?:import|export)\s+type\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s*["'][^"']+["'];/g,
            "",
        );
        checkTuidomImports(rel, zone, env, content, violations);

        for (const m of content.matchAll(/(["'])(\.\.?\/[^"']+?\.(?:ts|tsx))\1/g)) {
            const target = path
                .normalize(path.join(path.dirname(rel), m[2]))
                .split(path.sep)
                .join("/");
            if (!target.startsWith("src/vs/")) continue;
            if (target.startsWith(WORKBENCH_CONTRIB_DIR) && WORKBENCH_CORE_DIRS.some((d) => rel.startsWith(d))) {
                if (DIRECTION_EXCEPTIONS.includes(rel)) usedDirectionExceptions.add(rel);
                else violations.push(`${rel} → ${target}  (direction: the workbench core does not import contrib)`);
                continue;
            }
            if (EXCEPTIONS.some(([f, t]) => rel.startsWith(f) && target.startsWith(t))) continue;

            const targetZone = zoneOf(target);
            if (targetZone !== null && ZONES.indexOf(targetZone) > zoneIdx) {
                violations.push(`${rel} → ${target}  (layer: ${zone} cannot import ${targetZone})`);
                continue;
            }
            const targetEnv = envOf(target);
            if (env !== null && targetEnv !== null && !ENV_ALLOWED[env].has(targetEnv)) {
                violations.push(`${rel} → ${target}  (environment: ${env} cannot import ${targetEnv})`);
            }
        }
    }

    for (const rel of DIRECTION_EXCEPTIONS) {
        if (!usedDirectionExceptions.has(rel)) {
            violations.push(`${rel}  (DIRECTION_EXCEPTIONS: it no longer imports contrib, remove the entry)`);
        }
    }
    for (const [file, module] of NODE_IMPORT_DEBT) {
        if (!seenDebt.has(`${file}|${module}`)) {
            violations.push(`${file} → ${module}  (the import is gone, remove the entry from NODE_IMPORT_DEBT)`);
        }
    }

    if (violations.length > 0) {
        console.error(`[check-layers] violations: ${violations.length}`);
        for (const v of violations) console.error(`  ${v}`);
        process.exit(1);
    }
    console.log("[check-layers] OK");
}

main();
