#!/usr/bin/env node
/**
 * Проверка двух осей vscode-раскладки `src/vs/*` (аналог upstream-правил
 * `local/code-layering` + `code-import-patterns` и `layersChecker`):
 *
 *  1. Вертикальные слои (зоны, импортировать можно только свою и нижние):
 *     base/common → base/node → platform → editor → workbench → vexx.
 *     «Браузер» целиком (DOM-ядро, виджеты, rendering/input/backend,
 *     Inspector) — внешние npm-пакеты `@tuidom/*` (github.com/tuidom/tuidom);
 *     импорты в него, как и в прочие пакеты, осями не проверяются, а сам
 *     пакет физически не может импортировать src/vs.
 *  2. Окружения: common → [common], browser → [common, browser],
 *     node → [common, node]. Окружение файла — первый сегмент
 *     common/browser/node в его пути; `vs/tui/{rendering,input}` считаются
 *     common (чистые структуры/парсинг), `vs/tui/backend` и `vs/vexx` — node.
 *
 * Не считаются зависимостями: jsdoc-ссылки в комментариях и `import type`
 * (типы стираются при компиляции — как в upstream layersChecker).
 *
 * Файлы вне `src/vs` (dev-тулинг: Inspector, TestUtils, StoryRunner, demos) и
 * импорты в них не проверяются. Точечные признанные нарушения — EXCEPTIONS
 * (каждое с комментарием-обоснованием); цель — пустой список.
 *
 * До миграции (PR 2.1) `src/vs` не существует — скрипт сообщает и выходит
 * зелёным, чтобы npm-скрипт можно было завести заранее.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const vsRoot = path.join(repoRoot, "src", "vs");

// ── Зоны (порядок = высота слоя) ────────────────────────────────────────────

const ZONES = [
    "src/vs/base/common",
    "src/vs/base/node",
    "src/vs/platform",
    "src/vs/editor",
    "src/vs/workbench",
    "src/vs/vexx",
];

/**
 * Признанные нарушения: [префикс файла, префикс импорта]. Каждая запись —
 * осознанный долг с обоснованием; новые не добавлять без записи в
 * docs/TODO/VscodeStructureFollowUps.md.
 */
const EXCEPTIONS = [
    // Single-process TUI: «browser»-сторона зовёт node-сервисы напрямую, без
    // RPC-моста vscode (IFileService и т.п.). Признанный долг — см.
    // docs/TODO/VscodeStructureFollowUps.md.
    ["src/vs/workbench/browser/", "src/vs/workbench/services/search/node/"],
    ["src/vs/workbench/browser/", "src/vs/workbench/services/terminalEnvironment/node/"],
    ["src/vs/workbench/contrib/quickaccess/browser/", "src/vs/workbench/services/search/node/"],
    ["src/vs/workbench/contrib/diff/browser/", "src/vs/workbench/services/search/node/"],
    ["src/vs/workbench/contrib/files/browser/", "src/vs/workbench/contrib/bulkEdit/node/"],
    ["src/vs/workbench/services/keybinding/browser/", "src/vs/workbench/services/terminalEnvironment/node/"],
    // Мост тема→стили держит unthemed-дефолты у виджета редактора; разнос —
    // follow-up (unthemed-дефолты в platform или getEditorStyles в editor).
    ["src/vs/platform/theme/browser/defaultStyles.ts", "src/vs/editor/browser/editorElement.ts"],
    // WorkbenchComponent тянет DI-токен из модуля профиля; вынос токенов из
    // vexx/modules в слои-владельцы — follow-up.
    ["src/vs/workbench/browser/workbenchComponent.ts", "src/vs/vexx/modules/"],
];

function zoneOf(rel) {
    let best = null;
    for (const z of ZONES) {
        if (rel.startsWith(`${z}/`) && (best === null || z.length > best.length)) best = z;
    }
    return best;
}

/**
 * Файлы-источники, не участвующие в проверке: колокационные тесты, stories и
 * бенчи (пересекают оси легально — поднимают полное приложение; у vscode они
 * живут в test/-деревьях), учебная песочница textMate/learning и тест-утилиты.
 */
function isCheckedSource(rel) {
    if (/\.(test|stories|bench)\.(ts|tsx)$/.test(rel)) return false;
    if (/(^|\.)testUtils\.ts$/i.test(rel)) return false;
    if (rel.includes("/learning/") || rel.includes("/__fixtures__/")) return false;
    return true;
}

/** Точечные env-оверрайды: чистые контракты в node/browser-каталогах. */
const ENV_OVERRIDES = new Map([]);

function envOf(rel) {
    const override = ENV_OVERRIDES.get(rel);
    if (override !== undefined) return override;
    // vexx — сборка приложения (DI-профили, entry): единственный слой, которому
    // env-ось не применяется — он по определению склеивает browser и node.
    if (rel.startsWith("src/vs/vexx/")) return null;
    for (const seg of rel.split("/")) {
        if (seg === "common" || seg === "browser" || seg === "node") return seg;
    }
    return null; // окружение не размечено — ось окружений не проверяем
}

const ENV_ALLOWED = {
    common: new Set(["common"]),
    browser: new Set(["common", "browser"]),
    node: new Set(["common", "node"]),
};

// ── Обход ───────────────────────────────────────────────────────────────────

function listFiles(dirAbs, out = []) {
    for (const entry of readdirSync(dirAbs, { withFileTypes: true })) {
        const abs = path.join(dirAbs, entry.name);
        if (entry.isDirectory()) listFiles(abs, out);
        else if (/\.(ts|tsx)$/.test(entry.name)) out.push(abs);
    }
    return out;
}

/**
 * DI-правило «токен рядом со своим типом»: файл, зовущий `token<T>()`, обязан
 * объявлять `T` сам или импортировать его из своего слоя/ниже — иначе токен
 * семантически ведёт в слой выше себя (см. docs/DI.md «Где объявлять токены»).
 */
function checkTokenDeclarations(rel, raw, zoneIdx, violations) {
    for (const m of raw.matchAll(/\btoken\s*<\s*([A-Za-z0-9_]+)\b/g)) {
        const typeName = m[1];
        if (new RegExp(`\\b(class|interface|type)\\s+${typeName}\\b`).test(raw)) continue;
        const importMatch = raw.match(
            new RegExp(`import[^;]*\\{[^}]*\\b${typeName}\\b[^}]*\\}\\s*from\\s*["']([^"']+)["']`),
        );
        if (!importMatch) continue; // тип не найден — не наша ось (re-export и т.п.)
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

function main() {
    if (!existsSync(vsRoot)) {
        console.log("[check-layers] src/vs не существует (до миграции) — нечего проверять");
        return;
    }

    const violations = [];
    for (const abs of listFiles(vsRoot)) {
        const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
        if (!isCheckedSource(rel)) continue;
        const zone = zoneOf(rel);
        const env = envOf(rel);
        if (zone === null) continue;
        const zoneIdx = ZONES.indexOf(zone);
        const raw = readFileSync(abs, "utf8");
        checkTokenDeclarations(rel, raw, zoneIdx, violations);
        // Комментарии (jsdoc {@link import(...)}) и type-only импорты — не
        // зависимости времени исполнения.
        const content = raw
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/^\s*\/\/.*$/gm, "")
            .replace(/(?:import|export)\s+type\s[\s\S]*?from\s*["'][^"']+["'];/g, "");

        for (const m of content.matchAll(/(["'])(\.\.?\/[^"']+?\.(?:ts|tsx))\1/g)) {
            const target = path
                .normalize(path.join(path.dirname(rel), m[2]))
                .split(path.sep)
                .join("/");
            if (!target.startsWith("src/vs/")) continue; // dev-тулинг вне осей
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

    if (violations.length > 0) {
        console.error(`[check-layers] нарушений: ${violations.length}`);
        for (const v of violations) console.error(`  ${v}`);
        process.exit(1);
    }
    console.log("[check-layers] OK");
}

main();
