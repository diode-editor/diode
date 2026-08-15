#!/usr/bin/env node
/**
 * Управляет дословной копией алгоритма построчного диффа из upstream
 * `microsoft/vscode` — `src/vs/editor/common/diff/` вместе с примитивами ядра
 * (`src/vs/editor/common/core/`), enum'ом `CharCode` и фикстурным корпусом.
 *
 * Философия та же, что у `import-vscode-dts.mjs`: перенесённый код — стадийная
 * копия upstream, а не наш исходник. Он **не правится руками**; единственный
 * способ его изменить — поменять пин или объявленную трансформацию здесь и
 * перегенерировать. Сторож — режим `--check`.
 *
 * ТРАНСФОРМАЦИЯ (детерминированная, применяется в этом порядке):
 *   1. ИССЕЧЕНИЯ (EXCISIONS) — объявленные вырезки кода, тянущего лишние
 *      зависимости. Анкеры — точные строки; не нашёлся анкер → падаем.
 *   2. РАСШИРЕНИЯ ИМПОРТОВ `'./x.js'` → `'./x.ts'` (конвенция vexx, AGENTS.md).
 *   3. `import` → `import type` для символов из TYPE_ONLY: у нас
 *      `verbatimModuleSyntax: true`, при котором значение-импорт типа — ошибка
 *      TS1484. Список объявлен ниже, а не выведен эвристикой.
 *   4. БАННЕР провенанса сразу после MIT-шапки upstream.
 *
 * Шаги 1–4 обратимы в том смысле, что `--check` заново выводит ожидаемое
 * содержимое из upstream и сравнивает побайтно. Если upstream уедет так, что
 * анкер иссечения не найдётся, — скрипт упадёт громко, а не испортит перенос.
 *
 * Зависимости, которые upstream тянет из `base/common` (arrays, assert, errors,
 * map, strings, …), НЕ переносятся: их полные версии тащат
 * `cancellation → event → lifecycle → observableInternal` (~30 файлов, диффу не
 * нужных). Вместо них — узкие рукописные шимы по тем же путям; парность
 * раскладки делает подмену прозрачной, ни один import править не надо.
 *
 * Режимы:
 *   (без флагов)  — перенести файлы из upstream запинненного тега.
 *   --check       — сверить дерево с re-derived upstream. Exit 1 при дрейфе.
 *
 * Пин согласован с `extensions/VSCODE_VERSION` — держите теги в лок-степе.
 *
 * Usage: node scripts/import-vscode-diff.mjs [--check] [--keep-clone]
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const VSCODE_TAG = "1.127.0";
const VSCODE_REPO = "https://github.com/microsoft/vscode.git";

const repoRoot = resolve(import.meta.dirname, "..");

// ---- что переносим ---------------------------------------------------------

/** Файлы, переносимые дословно. Путь в upstream == путь у нас (парность раскладки). */
const FILES = [
    // Алгоритм диффа. Не берём legacyLinesDiffComputer / externalLinesDiffComputer /
    // documentDiffProvider / linesDiffComputers (реестр legacy+advanced).
    "src/vs/editor/common/diff/linesDiffComputer.ts",
    "src/vs/editor/common/diff/rangeMapping.ts",
    "src/vs/editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.ts",
    "src/vs/editor/common/diff/defaultLinesDiffComputer/computeMovedLines.ts",
    "src/vs/editor/common/diff/defaultLinesDiffComputer/heuristicSequenceOptimizations.ts",
    "src/vs/editor/common/diff/defaultLinesDiffComputer/lineSequence.ts",
    "src/vs/editor/common/diff/defaultLinesDiffComputer/linesSliceCharSequence.ts",
    "src/vs/editor/common/diff/defaultLinesDiffComputer/utils.ts",
    "src/vs/editor/common/diff/defaultLinesDiffComputer/algorithms/diffAlgorithm.ts",
    "src/vs/editor/common/diff/defaultLinesDiffComputer/algorithms/dynamicProgrammingDiffing.ts",
    "src/vs/editor/common/diff/defaultLinesDiffComputer/algorithms/myersDiffAlgorithm.ts",

    // Примитивы ядра, на которых стоит алгоритм.
    "src/vs/editor/common/core/position.ts",
    "src/vs/editor/common/core/range.ts",
    "src/vs/editor/common/core/editOperation.ts",
    "src/vs/editor/common/core/ranges/lineRange.ts",
    "src/vs/editor/common/core/ranges/offsetRange.ts",
    "src/vs/editor/common/core/text/textLength.ts",
    "src/vs/editor/common/core/text/abstractText.ts",
    "src/vs/editor/common/core/text/positionToOffsetImpl.ts",
    "src/vs/editor/common/core/edits/edit.ts",
    "src/vs/editor/common/core/edits/stringEdit.ts",
    "src/vs/editor/common/core/edits/textEdit.ts",

    // Чистый enum без зависимостей — дешевле перенести целиком, чем шимить.
    "src/vs/base/common/charCode.ts",
];

/** Фикстурный корпус: upstream-путь → наш путь. Файлы копируются как есть. */
const FIXTURES_FROM = "src/vs/editor/test/node/diffing/fixtures";
const FIXTURES_TO = "src/vs/editor/common/diff/__fixtures__";
/** Ожидания legacy-компьютера не нужны — legacy мы не переносим. */
const FIXTURE_SKIP = new Set(["legacy.expected.diff.json"]);

/** Каталоги для sparse-checkout (перекрывают FILES + фикстуры). */
const SPARSE_PATHS = [
    "src/vs/editor/common/diff",
    "src/vs/editor/common/core",
    // Ведущий слэш обязателен для одиночного файла в non-cone режиме, иначе git
    // трактует путь как glob по имени и предупреждает (NON-CONE PROBLEMS).
    "/src/vs/base/common/charCode.ts",
    FIXTURES_FROM,
];

// ---- объявленная трансформация ---------------------------------------------

/**
 * Иссечения: вырезаем строки от `from` до `to` включительно (`to: "EOF"` — до
 * конца файла). Каждое — с обоснованием; цель списка — оставаться коротким.
 */
const EXCISIONS = {
    "src/vs/editor/common/diff/rangeMapping.ts": [
        {
            // Единственный потребитель типа IChange из legacyLinesDiffComputer.
            // Сама функция не имеет НИ ОДНОГО вызова во всём upstream (проверено
            // grep -rn по src/vs), а тянет legacyLinesDiffComputer.ts (691 LOC)
            // и base/common/diff/{diff,diffChange}.ts (1375 LOC) c LcsDiff.
            from: "export function lineRangeMappingFromChange(change: IChange): LineRangeMapping {",
            to: "EOF",
        },
        { from: "import { IChange } from './legacyLinesDiffComputer.js';", to: "SELF" },
    ],
};

/**
 * Символы, которые в перенесённом наборе экспортируются как `interface`/`type`.
 * При `verbatimModuleSyntax` их обязан импортировать `import type`, иначе TS1484.
 *
 * Список выведен из `grep '^export (interface|type)'` по переносимому набору
 * плюс два имени из наших шимов (`Comparator`, `IEquatable`). Если upstream
 * добавит новый тип и мы его пропустим — упадёт `npm run typecheck`, не тихо.
 */
const TYPE_ONLY = new Set([
    // из переносимого набора
    "AnyEdit",
    "AnyReplacement",
    "IDiffAlgorithm",
    "IEditData",
    "ILinesDiffComputer",
    "ILinesDiffComputerOptions",
    "IOffsetRange",
    "IPosition",
    "IRange",
    "ISequence",
    "ISerializedLineRange",
    "ISerializedStringEdit",
    "ISerializedStringReplacement",
    "ISingleEditOperation",
    "ITimeout",
    "SerializedLineEdit",
    "SerializedLineReplacement",
    // из наших шимов в base/common
    "Comparator",
    "IEquatable",
]);

/** Последняя строка MIT-шапки upstream — баннер вставляем сразу после неё. */
const MIT_HEADER_LAST = " *--------------------------------------------------------------------------------------------*/";

function banner(upstreamPath) {
    return [
        `//@diode:vendored microsoft/vscode@${VSCODE_TAG} ${upstreamPath}`,
        "// НЕ ПРАВИТЬ РУКАМИ — перегенерируется scripts/import-vscode-diff.mjs (см. AGENTS.md).",
    ];
}

// ---- шаги трансформации ----------------------------------------------------

function applyExcisions(lines, upstreamPath) {
    const specs = EXCISIONS[upstreamPath];
    if (specs === undefined) return lines;
    let out = lines;
    for (const spec of specs) {
        const start = out.findIndex((l) => l === spec.from);
        if (start === -1) {
            throw new Error(`[diff] иссечение не приложилось в ${upstreamPath}: анкер не найден\n  ${spec.from}`);
        }
        const end = spec.to === "EOF" ? out.length - 1 : spec.to === "SELF" ? start : out.findIndex((l, i) => i >= start && l === spec.to);
        if (end === -1) {
            throw new Error(`[diff] иссечение не приложилось в ${upstreamPath}: конечный анкер не найден\n  ${spec.to}`);
        }
        out = [...out.slice(0, start), ...out.slice(end + 1)];
    }
    return out;
}

/** `from './x.js'` → `from './x.ts'` — только в спецификаторах импорта/экспорта. */
function rewriteImportExtensions(lines) {
    return lines.map((l) => l.replace(/(\bfrom\s+')([^']+)\.js(')/g, "$1$2.ts$3"));
}

/**
 * Разбивает смешанный импорт на значение-часть и type-часть. Порядок имён
 * внутри каждой группы сохраняется, значение-импорт идёт первым.
 */
function splitTypeImports(lines) {
    const out = [];
    for (const line of lines) {
        const match = /^import\s+\{([^}]*)\}\s+from\s+('[^']+');$/.exec(line);
        if (match === null) {
            out.push(line);
            continue;
        }
        const names = match[1]
            .split(",")
            .map((n) => n.trim())
            .filter((n) => n !== "");
        const types = names.filter((n) => TYPE_ONLY.has(n));
        if (types.length === 0) {
            out.push(line);
            continue;
        }
        const values = names.filter((n) => !TYPE_ONLY.has(n));
        if (values.length > 0) out.push(`import { ${values.join(", ")} } from ${match[2]};`);
        out.push(`import type { ${types.join(", ")} } from ${match[2]};`);
    }
    return out;
}

function insertBanner(lines, upstreamPath) {
    const idx = lines.indexOf(MIT_HEADER_LAST);
    if (idx === -1) throw new Error(`[diff] MIT-шапка не найдена в ${upstreamPath}`);
    return [...lines.slice(0, idx + 1), ...banner(upstreamPath), ...lines.slice(idx + 1)];
}

/** Полная объявленная трансформация upstream-текста в наш файл. */
function transform(text, upstreamPath) {
    let lines = text.replace(/\r\n/g, "\n").split("\n");
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    lines = applyExcisions(lines, upstreamPath);
    lines = rewriteImportExtensions(lines);
    lines = splitTypeImports(lines);
    lines = insertBanner(lines, upstreamPath);
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines.join("\n") + "\n";
}

// ---- upstream fetch --------------------------------------------------------

function withUpstream(fn) {
    const scratch = mkdtempSync(join(tmpdir(), "vscode-diff-"));
    const cloneDir = join(scratch, "vscode");
    const keepClone = process.argv.includes("--keep-clone");
    try {
        console.error(`[diff] cloning microsoft/vscode@${VSCODE_TAG} (sparse, blobless)`);
        execFileSync("git", ["clone", "--depth", "1", "--filter=blob:none", "--sparse", "--branch", VSCODE_TAG, VSCODE_REPO, cloneDir], {
            stdio: ["ignore", "ignore", "inherit"],
        });
        execFileSync("git", ["-C", cloneDir, "sparse-checkout", "set", "--no-cone", ...SPARSE_PATHS], {
            stdio: ["ignore", "ignore", "inherit"],
        });
        const sha = execFileSync("git", ["-C", cloneDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
        return fn(cloneDir, sha);
    } finally {
        if (!keepClone) rmSync(scratch, { recursive: true, force: true });
    }
}

/** Все файлы фикстурного корпуса upstream — относительные пути, отсортированные. */
function fixtureFiles(cloneDir) {
    const root = join(cloneDir, FIXTURES_FROM);
    const out = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir).sort()) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) walk(full);
            else if (!FIXTURE_SKIP.has(entry)) out.push(relative(root, full));
        }
    };
    walk(root);
    return out;
}

// ---- режимы ----------------------------------------------------------------

function regen() {
    withUpstream((cloneDir, sha) => {
        for (const upstreamPath of FILES) {
            const source = readFileSync(join(cloneDir, upstreamPath), "utf8");
            const target = join(repoRoot, upstreamPath);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, transform(source, upstreamPath));
        }
        console.error(`[diff] перенесено файлов: ${FILES.length}`);

        const fixtureTarget = join(repoRoot, FIXTURES_TO);
        rmSync(fixtureTarget, { recursive: true, force: true });
        const fixtures = fixtureFiles(cloneDir);
        for (const rel of fixtures) {
            const to = join(fixtureTarget, rel);
            mkdirSync(dirname(to), { recursive: true });
            cpSync(join(cloneDir, FIXTURES_FROM, rel), to);
        }
        console.error(`[diff] перенесено фикстур: ${fixtures.length} файл(ов) → ${FIXTURES_TO}`);
        console.error(`[diff] upstream ${VSCODE_TAG} ${sha}`);
    });
}

function check() {
    withUpstream((cloneDir, sha) => {
        const problems = [];

        for (const upstreamPath of FILES) {
            const want = transform(readFileSync(join(cloneDir, upstreamPath), "utf8"), upstreamPath);
            const target = join(repoRoot, upstreamPath);
            if (!existsSync(target)) {
                problems.push(`отсутствует: ${upstreamPath}`);
                continue;
            }
            const got = readFileSync(target, "utf8");
            if (got === want) continue;
            const gotLines = got.split("\n");
            const wantLines = want.split("\n");
            const at = gotLines.findIndex((l, i) => l !== wantLines[i]);
            problems.push(
                `дрейф: ${upstreamPath}:${at + 1}\n    файл:     ${JSON.stringify(gotLines[at])}\n    upstream: ${JSON.stringify(wantLines[at])}`,
            );
        }

        const fixtures = fixtureFiles(cloneDir);
        for (const rel of fixtures) {
            const target = join(repoRoot, FIXTURES_TO, rel);
            if (!existsSync(target)) {
                problems.push(`отсутствует фикстура: ${FIXTURES_TO}/${rel}`);
                continue;
            }
            if (!readFileSync(target).equals(readFileSync(join(cloneDir, FIXTURES_FROM, rel)))) {
                problems.push(`дрейф фикстуры: ${FIXTURES_TO}/${rel}`);
            }
        }

        if (problems.length === 0) {
            console.error(`[diff] --check OK: ${FILES.length} файл(ов) + ${fixtures.length} фикстур совпадают с upstream @ ${VSCODE_TAG} ${sha}`);
            return;
        }
        console.error(`[diff] --check FAIL (${problems.length}):`);
        for (const p of problems.slice(0, 20)) console.error(`  ${p}`);
        process.exit(1);
    });
}

// ---- main ------------------------------------------------------------------

if (process.argv.includes("--check")) check();
else regen();
