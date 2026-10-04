#!/usr/bin/env node
/**
 * Проверка двух осей vscode-раскладки `src/vs/*` (аналог upstream-правил
 * `local/code-layering` + `code-import-patterns` и `layersChecker`):
 *
 *  1. Вертикальные слои (зоны, импортировать можно только свою и нижние):
 *     base/common → base/node → platform → editor → workbench → diode.
 *     «Браузер» целиком (DOM-ядро, виджеты, rendering/input/backend,
 *     Inspector) — внешние npm-пакеты `@tuidom/*` (github.com/tuidom/tuidom);
 *     сам пакет физически не может импортировать src/vs.
 *  2. Окружения: common → [common], browser → [common, browser],
 *     node → [common, node]. Окружение файла — первый сегмент
 *     common/browser/node в его пути; `vs/tui/{rendering,input}` считаются
 *     common (чистые структуры/парсинг), `vs/tui/backend` и `vs/diode` — node.
 *  3. Импорты движка `@tuidom/*` размечены той же осью окружений по подпути
 *     (TUIDOM_ENVS): чистый срез `core/common`, `core/input` — common; DOM,
 *     rendering, виджеты, inspector — browser; бэкенды терминала — node;
 *     `@tuidom/testing` — только тесты. `base/common` значений из движка не
 *     берёт вовсе. `@tuidom/core/common/disposable` запрещён во всём `src/`
 *     (и `import type` тоже): примитив жизненного цикла — наш
 *     `vs/base/common/lifecycle.ts` (docs/TODO/Lifecycle.md).
 *  4. common/browser не импортируют модули ОС — `node:*` и голые имена
 *     встроенных модулей (кроме `node:path`: чистые строковые функции), а также
 *     node-only npm-пакеты (NODE_ONLY_PACKAGES); `import type` тоже считается —
 *     тип `fs.Dirent` в сигнатуре так же привязывает к Node. Сложившийся долг —
 *     храповик NODE_IMPORT_DEBT: новый импорт вне списка и запись списка, которой
 *     больше нет в коде, — оба нарушение (docs/TODO/FileService.md, §9).
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
import { builtinModules } from "node:module";
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
    "src/vs/diode",
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
    ["src/vs/workbench/browser/", "src/vs/workbench/services/terminalEnvironment/node/"],
    ["src/vs/workbench/services/keybinding/browser/", "src/vs/workbench/services/terminalEnvironment/node/"],
    // Мост тема→стили держит unthemed-дефолты у виджета редактора; разнос —
    // follow-up (unthemed-дефолты в platform или getEditorStyles в editor).
    ["src/vs/platform/theme/browser/defaultStyles.ts", "src/vs/editor/browser/editorElement.ts"],
    // Цвета иконок файлов упакованы движковым packRgb — значение из @tuidom в
    // base/common. Перенос цветовой части иконок выше — follow-up.
    ["src/vs/base/common/fileIcons.ts", "@tuidom/core/common/colorUtils"],
];

// ── Направление внутри workbench ─────────────────────────────────────────────

/**
 * Ядро workbench'а не знает фич (как `code-layering` у upstream): нетестовые
 * value-импорты из этих каталогов в `src/vs/workbench/contrib/` запрещены.
 * Фича регистрирует себя сама; знать её всю разрешено только агрегатору и
 * сборке приложения (`vs/diode`), к которым правило не применяется.
 */
const WORKBENCH_CORE_DIRS = [
    "src/vs/workbench/browser/",
    "src/vs/workbench/common/",
    "src/vs/workbench/services/",
    "src/vs/workbench/api/",
];
const WORKBENCH_CONTRIB_DIR = "src/vs/workbench/contrib/";

/**
 * Храповик: файлы ядра, которые ещё импортируют фичи. Новые сюда не
 * добавляются; запись, которая больше не нужна, — тоже нарушение (её надо
 * удалить), так что список только сокращается. Цель — пустой. План — E4 и
 * docs/TODO/VscodeStructureFollowUps.md.
 */
const DIRECTION_EXCEPTIONS = [
    // Корень: ссылки на фичи в setWorkspaceFolder/activate/restore (E4 PR5).
    "src/vs/workbench/browser/workbenchComponent.ts",
    // Контекст-ключи фич в ядре (F3).
    "src/vs/workbench/browser/workbenchContextKeyContributors.ts",
    // Экшены фич в общем списке и в мелких action-файлах (F2).
    "src/vs/workbench/browser/actions/builtinActions.ts",
    "src/vs/workbench/browser/actions/editorGroupActions.ts",
    "src/vs/workbench/browser/actions/inputActions.ts",
    "src/vs/workbench/browser/actions/layoutActions.ts",
    "src/vs/workbench/browser/actions/menuContributions.ts",
    "src/vs/workbench/browser/actions/searchActions.ts",
];

/**
 * Окружение подпути движка: та же ось, что у нашего кода. Первое совпадение
 * побеждает; неразмеченный подпуть — нарушение (разметь его здесь).
 */
const TUIDOM_ENVS = [
    [/^@tuidom\/core\/(common|input)\//, "common"],
    [/^@tuidom\/(core\/(dom|rendering|backend)|elements|inspector)\//, "browser"],
    [/^@tuidom\/(terminal|headless)-backend\//, "node"],
    // Ни в одно окружение не входит — значит, доступен только тестам (они
    // гейтом не проверяются) и сборке приложения `vs/diode` (тестовый профиль).
    [/^@tuidom\/testing\//, "test"],
];

/** npm-пакеты, которые работают только под Node (нативные модули, ФС/процессы). */
const NODE_ONLY_PACKAGES = new Set(["chokidar", "node-pty", "yauzl"]);

/** Встроенные модули Node, разрешённые в common/browser: чистые функции без ОС. */
const ALLOWED_NODE_BUILTINS = new Set(["node:path"]);

/**
 * Храповик: сложившиеся импорты ОС-модулей из common/browser — [файл, модуль,
 * кто снимает]. Цель — пустой список; записи убираются вместе с импортом
 * (гейт падает и на устаревшую запись). Номера PR — по плану
 * docs/TODO/FileService.md, §8.
 */
const NODE_IMPORT_DEBT = [
    // Чтение бандла ассетов; оба импортёра — из base/node/assets → переезд туда (PR 6).
    ["src/vs/base/common/assets/bundleFile.ts", "node:fs"],
    // Идентичность воркспейса — sha256 пути; вне файлового сервиса.
    ["src/vs/platform/workspace/common/workspaceId.ts", "node:crypto"],
    // Extension host: vscode.workspace.fs / findFiles / openTextDocument прямо на диск
    // из субпроцесса (как у эталона), раскладка → api/node (PR 6).
    ["src/vs/workbench/api/common/fileSystemNamespace.ts", "node:fs/promises"],
    ["src/vs/workbench/api/common/findFiles.ts", "node:fs/promises"],
    ["src/vs/workbench/api/common/workspaceNamespace.ts", "node:fs/promises"],
    // Extension host: env.machineId и т.п.; вне файлового сервиса.
    ["src/vs/workbench/api/common/vscodeNamespace.ts", "node:crypto"],
    // Рестор вкладок и история навигации проверяют существование файла синхронно:
    // рестор синхронен по устройству (бутстрапу нужны пути до первого кадра), и
    // асинхронным он станет вместе с загрузкой модели (PR 5, §7.2); история —
    // открытый вопрос §12.3, до решения поведение не меняем.
    ["src/vs/workbench/services/editor/browser/editorPaneFactory.ts", "node:fs"],
    ["src/vs/workbench/services/history/browser/historyService.ts", "node:fs"],
    // Модель пишет через IFileService (PR 4); загрузка с диска пока синхронная —
    // переезжает вместе с асинхронным открытием (PR 5, §7.2).
    ["src/vs/workbench/services/textfile/common/textFileModel.ts", "node:fs"],
];

/** ОС-модуль спецификатора (`fs` → `node:fs`) либо null, если он не ОС-модуль. */
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

/** Импорты ОС-модулей из common/browser (`import type` включительно), сверка с храповиком. */
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

/** Импорт, запрещённый во всём `src/`: примитив живёт в vs/base/common/lifecycle.ts. */
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
    // diode — сборка приложения (DI-профили, entry): единственный слой, которому
    // env-ось не применяется — он по определению склеивает browser и node.
    if (rel.startsWith("src/vs/diode/")) return null;
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

function stripComments(raw) {
    return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Значения из движка: окружение подпути и запрет на значения в base/common. */
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

/** `@tuidom/core/common/disposable` — во всём `src/`, тесты и `import type` включительно. */
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
        // Комментарии (jsdoc {@link import(...)}) и type-only импорты — не
        // зависимости времени исполнения. Форма спецификатора перечислена явно:
        // ленивое `type\s[\s\S]*?from` начиналось и на `export type X = …` и
        // глотало код до ближайшего `from "…";`, пряча импорты за ним.
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
            if (!target.startsWith("src/vs/")) continue; // dev-тулинг вне осей
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
