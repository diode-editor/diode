#!/usr/bin/env node
/**
 * Проверка двух осей раскладки `src/vs/*` (аналог upstream `code-layering`,
 * `code-import-patterns` и `layersChecker`):
 *
 *  1. Слои (импорт — только своего и нижних):
 *     base/common → base/node → platform → editor → workbench → diode.
 *  2. Окружения: common → [common], browser → [common, browser],
 *     node → [common, node]; окружение — первый сегмент common/browser/node в пути.
 *  3. `@tuidom/*` размечен той же осью по подпути (TUIDOM_ENVS); `base/common`
 *     значений из движка не берёт; `@tuidom/core/common/disposable` запрещён во
 *     всём `src/`, `import type` тоже — примитив наш, `vs/base/common/lifecycle.ts`.
 *  4. common/browser не импортируют модули ОС (кроме `node:path`) и
 *     NODE_ONLY_PACKAGES; `import type` считается — тип `fs.Dirent` в сигнатуре
 *     тоже привязывает к Node. Долг — храповик NODE_IMPORT_DEBT.
 *
 * Для осей 1–3 jsdoc-ссылки и `import type` — не зависимости (как в upstream
 * layersChecker). Файлы вне `src/vs` не проверяются.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import * as path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const vsRoot = path.join(repoRoot, "src", "vs");

// Порядок = высота слоя.
const ZONES = [
    "src/vs/base/common",
    "src/vs/base/node",
    "src/vs/platform",
    "src/vs/editor",
    "src/vs/workbench",
    "src/vs/diode",
];

/**
 * [префикс файла, префикс импорта]; новые — только с записью в
 * docs/TODO/VscodeStructureFollowUps.md.
 */
const EXCEPTIONS = [
    // Single-process TUI: «browser»-сторона зовёт node-сервисы напрямую, без RPC-моста vscode.
    ["src/vs/workbench/browser/", "src/vs/workbench/services/terminalEnvironment/node/"],
    ["src/vs/workbench/services/keybinding/browser/", "src/vs/workbench/services/terminalEnvironment/node/"],
    // Мост тема→стили держит unthemed-дефолты у виджета редактора; разнос —
    // follow-up (unthemed-дефолты в platform или getEditorStyles в editor).
    ["src/vs/platform/theme/browser/defaultStyles.ts", "src/vs/editor/browser/editorElement.ts"],
    // Цвета иконок файлов упакованы движковым packRgb — значение из @tuidom в
    // base/common. Перенос цветовой части иконок выше — follow-up.
    ["src/vs/base/common/fileIcons.ts", "@tuidom/core/common/colorUtils"],
];

/** Ядро workbench'а не знает фич (как `code-layering` у upstream): импорт отсюда в contrib запрещён. */
const WORKBENCH_CORE_DIRS = [
    "src/vs/workbench/browser/",
    "src/vs/workbench/common/",
    "src/vs/workbench/services/",
    "src/vs/workbench/api/",
];
const WORKBENCH_CONTRIB_DIR = "src/vs/workbench/contrib/";

/** Храповик: новые сюда не добавляются, ненужная запись — тоже нарушение. План — E4. */
const DIRECTION_EXCEPTIONS = [
    // Корень: ссылки на фичи в setWorkspaceFolder/activate/restore (E4 PR5).
    "src/vs/workbench/browser/workbenchComponent.ts",
    // Мелкие action-файлы ядра зовут сервисы фич (explorer, markers) — зона E4.
    "src/vs/workbench/browser/actions/editorGroupActions.ts",
    "src/vs/workbench/browser/actions/inputActions.ts",
    "src/vs/workbench/browser/actions/layoutActions.ts",
];

/** Первое совпадение побеждает; неразмеченный подпуть — нарушение. */
const TUIDOM_ENVS = [
    [/^@tuidom\/core\/(common|input)\//, "common"],
    [/^@tuidom\/(core\/(dom|rendering|backend)|elements|inspector)\//, "browser"],
    [/^@tuidom\/(terminal|headless)-backend\//, "node"],
    // Ни в одно окружение не входит: доступен только тестам и тестовому профилю `vs/diode`.
    [/^@tuidom\/testing\//, "test"],
];

const NODE_ONLY_PACKAGES = new Set(["chokidar", "node-pty", "yauzl"]);

const ALLOWED_NODE_BUILTINS = new Set(["node:path"]);

/** Храповик: гейт падает и на устаревшую запись. Остаток — PR 5 в docs/TODO/FileService.md. */
const NODE_IMPORT_DEBT = [
    ["src/vs/platform/workspace/common/workspaceId.ts", "node:crypto"],
    ["src/vs/workbench/api/common/vscodeNamespace.ts", "node:crypto"],
    // Синхронная проверка существования: рестор синхронен по устройству (пути
    // нужны до первого кадра) и асинхронным станет с загрузкой модели (PR 5);
    // история — открытый вопрос в docs/TODO/FileService.md.
    ["src/vs/workbench/services/editor/browser/editorPaneFactory.ts", "node:fs"],
    ["src/vs/workbench/services/history/browser/historyService.ts", "node:fs"],
    // Синхронная загрузка с диска переезжает вместе с асинхронным открытием (PR 5).
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
            `${rel} → ${m[2]}  (окружение ${env} не берёт модулей ОС — заведи шов в common или перенеси в node)`,
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

/** Тесты, stories и бенчи пересекают оси легально: поднимают полное приложение (у vscode они в test/-деревьях). */
function isCheckedSource(rel) {
    if (/\.(test|stories|bench)\.(ts|tsx)$/.test(rel)) return false;
    if (/(^|\.)testUtils\.ts$/i.test(rel)) return false;
    if (rel.includes("/learning/") || rel.includes("/__fixtures__/")) return false;
    return true;
}

/** Чистые контракты в node/browser-каталогах. */
const ENV_OVERRIDES = new Map([]);

function envOf(rel) {
    const override = ENV_OVERRIDES.get(rel);
    if (override !== undefined) return override;
    // Сборка приложения по определению склеивает browser и node.
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

/** «Токен рядом со своим типом» (docs/DI.md): `T` из `token<T>()` — не из слоя выше. */
function checkTokenDeclarations(rel, raw, zoneIdx, violations) {
    for (const m of raw.matchAll(/\btoken\s*<\s*([A-Za-z0-9_]+)\b/g)) {
        const typeName = m[1];
        if (new RegExp(`\\b(class|interface|type)\\s+${typeName}\\b`).test(raw)) continue;
        const importMatch = raw.match(
            new RegExp(`import[^;]*\\{[^}]*\\b${typeName}\\b[^}]*\\}\\s*from\\s*["']([^"']+)["']`),
        );
        if (!importMatch) continue; // re-export и т.п. — не наша ось
        const target = path
            .normalize(path.join(path.dirname(rel), importMatch[1]))
            .split(path.sep)
            .join("/");
        const targetZone = zoneOf(target);
        if (targetZone !== null && ZONES.indexOf(targetZone) > zoneIdx) {
            violations.push(`${rel} → token<${typeName}> (тип из слоя ${targetZone} выше слоя токена)`);
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
            violations.push(`${rel} → ${specifier}  (подпуть движка не размечен окружением — TUIDOM_ENVS)`);
            continue;
        }
        if (zone === "src/vs/base/common") {
            violations.push(`${rel} → ${specifier}  (base/common не берёт значений из движка)`);
            continue;
        }
        if (env !== null && !ENV_ALLOWED[env].has(targetEnv)) {
            violations.push(`${rel} → ${specifier}  (окружение: ${env} не может импортировать ${targetEnv})`);
        }
    }
}

/** Во всём `src/`, тесты и `import type` включительно. */
function checkDisposableImports(violations) {
    for (const abs of listFiles(path.join(repoRoot, "src"))) {
        const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
        const content = stripComments(readFileSync(abs, "utf8"));
        if (content.includes(`"${TUIDOM_DISPOSABLE}"`) || content.includes(`'${TUIDOM_DISPOSABLE}'`)) {
            violations.push(`${rel} → ${TUIDOM_DISPOSABLE}  (примитив жизненного цикла — vs/base/common/lifecycle.ts)`);
        }
    }
}

function main() {
    if (!existsSync(vsRoot)) {
        console.log("[check-layers] src/vs не существует (до миграции) — нечего проверять");
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
        // Форма спецификатора перечислена явно: ленивое `type\s[\s\S]*?from`
        // цеплялось за `export type X = …` и глотало код до ближайшего `from`.
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
                else violations.push(`${rel} → ${target}  (направление: ядро workbench не импортирует contrib)`);
                continue;
            }
            if (EXCEPTIONS.some(([f, t]) => rel.startsWith(f) && target.startsWith(t))) continue;

            const targetZone = zoneOf(target);
            if (targetZone !== null && ZONES.indexOf(targetZone) > zoneIdx) {
                violations.push(`${rel} → ${target}  (слой: ${zone} не может импортировать ${targetZone})`);
                continue;
            }
            const targetEnv = envOf(target);
            if (env !== null && targetEnv !== null && !ENV_ALLOWED[env].has(targetEnv)) {
                violations.push(`${rel} → ${target}  (окружение: ${env} не может импортировать ${targetEnv})`);
            }
        }
    }

    for (const rel of DIRECTION_EXCEPTIONS) {
        if (!usedDirectionExceptions.has(rel)) {
            violations.push(`${rel}  (DIRECTION_EXCEPTIONS: contrib он больше не импортирует — удали запись)`);
        }
    }
    for (const [file, module] of NODE_IMPORT_DEBT) {
        if (!seenDebt.has(`${file}|${module}`)) {
            violations.push(`${file} → ${module}  (импорта больше нет — убери запись из NODE_IMPORT_DEBT)`);
        }
    }

    if (violations.length > 0) {
        console.error(`[check-layers] нарушений: ${violations.length}`);
        for (const v of violations) console.error(`  ${v}`);
        process.exit(1);
    }
    console.log("[check-layers] OK");
}

main();
