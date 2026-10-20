#!/usr/bin/env node
/**
 * Управляет дословными копиями кода редактора из upstream `microsoft/vscode`:
 *   - алгоритм построчного диффа — `src/vs/editor/common/diff/` вместе с
 *     примитивами ядра (`src/vs/editor/common/core/`), enum'ом `CharCode` и
 *     фикстурным корпусом;
 *   - токенизация модели — `src/vs/editor/common/model/textModelTokens.ts`
 *     (хранилище end-state'ов, очередь невалидных строк, фоновый токенизатор,
 *     эвристика вьюпорта) и её мелкие зависимости, бинарный формат токенов
 *     (`encodedTokenAttributes.ts`, `tokens/lineTokens.ts`,
 *     `tokens/contiguousMultilineTokens*.ts`) — docs/TODO/VscodeModel.md, B1/B2.
 *
 * Один скрипт на все переносы, а не по скрипту на подсистему: трансформация,
 * сторож `--check` и пин у них общие, и расходиться им незачем.
 *
 * Философия та же, что у `import-vscode-dts.mjs`: перенесённый код — стадийная
 * копия upstream, а не наш исходник. Он **не правится руками**; единственный
 * способ его изменить — поменять пин или объявленную трансформацию здесь и
 * перегенерировать. Сторож — режим `--check`.
 *
 * ТРАНСФОРМАЦИЯ (детерминированная, применяется в этом порядке):
 *   1. ИССЕЧЕНИЯ (EXCISIONS) — объявленные вырезки кода, тянущего лишние
 *      зависимости. Анкеры — точные строки; не нашёлся анкер → падаем.
 *   2. РАСШИРЕНИЯ ИМПОРТОВ `'./x.js'` → `'./x.ts'` (конвенция diode, AGENTS.md).
 *   3. `import` → `import type` для символов из TYPE_ONLY: у нас
 *      `verbatimModuleSyntax: true`, при котором значение-импорт типа — ошибка
 *      TS1484. Список объявлен ниже, а не выведен эвристикой.
 *   4. БАННЕР провенанса сразу после MIT-шапки upstream, за ним — объявленная
 *      прелюдия (PRELUDES: импорт mocha-глобалов в upstream-тесты).
 *
 * Шаги 1–4 обратимы в том смысле, что `--check` заново выводит ожидаемое
 * содержимое из upstream и сравнивает побайтно. Если upstream уедет так, что
 * анкер иссечения не найдётся, — скрипт упадёт громко, а не испортит перенос.
 *
 * Зависимости, которые upstream тянет из `base/common` (arrays, assert, errors,
 * map, strings, …), НЕ переносятся: их полные версии тащат
 * `cancellation → event → lifecycle → observableInternal` (~30 файлов, диффу не
 * нужных). Вместо них — узкие рукописные шимы по тем же путям; парность
 * раскладки делает подмену прозрачной, ни один import править не надо. Так же
 * закрыты и зависимости токенизации из `editor/common` (`languages.ts`,
 * `model.ts`): их upstream-версии — тысячи строк провайдеров языковых фич и
 * `TextModel` эталона, из которых перенесённому коду нужны десятки.
 *
 * Режимы:
 *   (без флагов)  — перенести файлы из upstream запинненного тега.
 *   --check       — сверить дерево с re-derived upstream. Exit 1 при дрейфе.
 *
 * Пин согласован с `extensions/VSCODE_VERSION` — держите теги в лок-степе.
 *
 * Usage: node scripts/import-vscode-editor.mjs [--check] [--keep-clone]
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

    // Токенизация модели: состояние строк, очередь, фон, эвристика вьюпорта.
    "src/vs/editor/common/model/textModelTokens.ts",
    "src/vs/editor/common/model/fixedArray.ts",
    "src/vs/editor/common/core/misc/eolCounter.ts",
    "src/vs/base/common/stopwatch.ts",
    // Бинарный формат токенов (B2): раскладка метаданных, токены строки,
    // токены подряд идущих строк (их и отдаёт фон) с правкой и (де)сериализацией
    // (последняя — для воркера, B3), результат «токенизатор упал».
    "src/vs/editor/common/encodedTokenAttributes.ts",
    "src/vs/editor/common/tokens/lineTokens.ts",
    "src/vs/editor/common/tokens/contiguousMultilineTokens.ts",
    "src/vs/editor/common/tokens/contiguousMultilineTokensBuilder.ts",
    "src/vs/editor/common/tokens/contiguousTokensEditing.ts",
    "src/vs/editor/common/languages/nullTokenize.ts",

    // Хранение текста: PieceTree (красно-чёрное дерево кусков с кэшем стартов
    // строк) и его зависимости. Пока никем не используется — подключение к
    // TextDocument это шаг A3 (docs/TODO/VscodeModel.md).
    "src/vs/editor/common/model/pieceTreeTextBuffer/pieceTreeBase.ts",
    "src/vs/editor/common/model/pieceTreeTextBuffer/rbTreeBase.ts",
    "src/vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBuffer.ts",
    "src/vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder.ts",
    "src/vs/editor/common/core/textChange.ts",
    // Поиск по буферу (`findMatchesLineByLine`): `Searcher` и разбор границ слов.
    "src/vs/editor/common/model/textModelSearch.ts",
    "src/vs/editor/common/core/wordCharacterClassifier.ts",
    "src/vs/editor/common/core/characterClassifier.ts",
    "src/vs/base/common/uint.ts",

    // Upstream-тесты PieceTree (фаззинг со случайными правками) — главный гейт
    // переноса дерева. Путь — upstream'овский (`editor/test/...`), а не
    // колокация: парность раскладки оставляет относительные импорты дословными.
    "src/vs/editor/test/common/model/pieceTreeTextBuffer/pieceTreeTextBuffer.test.ts",
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
    "/src/vs/base/common/stopwatch.ts",
    "/src/vs/editor/common/model/textModelTokens.ts",
    "/src/vs/editor/common/model/fixedArray.ts",
    "/src/vs/editor/common/encodedTokenAttributes.ts",
    "/src/vs/editor/common/tokens/lineTokens.ts",
    "/src/vs/editor/common/tokens/contiguousMultilineTokens.ts",
    "/src/vs/editor/common/tokens/contiguousMultilineTokensBuilder.ts",
    "/src/vs/editor/common/tokens/contiguousTokensEditing.ts",
    "/src/vs/editor/common/languages/nullTokenize.ts",
    "src/vs/editor/common/model/pieceTreeTextBuffer",
    "/src/vs/editor/common/model/textModelSearch.ts",
    "/src/vs/base/common/uint.ts",
    "/src/vs/editor/test/common/model/pieceTreeTextBuffer/pieceTreeTextBuffer.test.ts",
    FIXTURES_FROM,
];

// ---- объявленная трансформация ---------------------------------------------

/**
 * Иссечения: вырезаем строки от `from` до `to` включительно (`to: "EOF"` — до
 * конца файла, `"SELF"` — одна строка `from`; `nth` — до `nth`-й строки `to`).
 * Каждое — с обоснованием; цель списка — оставаться коротким.
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
    "src/vs/editor/common/tokens/lineTokens.ts": [
        {
            // Вид токена в позиции модели — читает `model.tokenization`
            // (`TokenizationTextModelPart` эталона), а модель у нас своя
            // (`ITextDocument` + `DocumentTokenStore`); то же у нас делает
            // `languages/standardTokenType.ts` поверх `LineTokens`.
            from: "export function getStandardTokenTypeAtPosition(model: ITextModel, position: IPosition): StandardTokenType | undefined {",
            to: "}",
        },
        { from: "import { IPosition } from '../core/position.js';", to: "SELF" },
        { from: "import { ITextModel } from '../model.js';", to: "SELF" },
    ],
    "src/vs/editor/common/core/textChange.ts": [
        {
            // Бинарная сериализация TextChange (`writeSize`/`write`/`read` и
            // их помощники — шесть методов подряд) — для сохранения undo-стека
            // эталона в Uint8Array. Тянет base/common/buffer.ts (lazy, stream)
            // и core/stringBuilder.ts (platform, TextDecoder). Нам нужен только
            // сам TextChange как запись обратной правки PieceTree.
            from: "\tprivate static _writeStringSize(str: string): number {",
            to: "\t}",
            nth: 6,
        },
        { from: "import * as buffer from '../../../base/common/buffer.js';", to: "SELF" },
        { from: "import { decodeUTF16LE } from './stringBuilder.js';", to: "SELF" },
    ],
    "src/vs/editor/common/model/textModelSearch.ts": [
        {
            // Разбор запроса виджета поиска (строка/регэксп/регистр) — тянет
            // strings.createRegExp и экранирование. PieceTree получает уже
            // готовый SearchData; виджет поиска у нас пока свой.
            from: "export class SearchParams {",
            to: "}",
        },
        {
            // Поиск по TextModel (многострочный, next/previous) — тянет
            // textModel.ts целиком (весь TextModel эталона мы не переносим,
            // docs/TODO/VscodeModel.md, ветка C). PieceTree зовёт только
            // Searcher / createFindMatch / isValidMatch, они остаются.
            from: "export class TextModelSearch {",
            to: "}",
        },
        { from: "import { TextModel } from './textModel.js';", to: "SELF" },
    ],
};

/**
 * Строки, вставляемые сразу после баннера. Сейчас — только импорт
 * mocha-глобалов (`suite`/`test`) в upstream-тесты: у эталона они глобальны
 * (mocha), у нас vitest без глобалов. Адаптер — src/TestUtils/mochaCompat.ts
 * (он же отдаёт тесту `this.timeout()`, который зовут фаззинг-кейсы).
 */
const PRELUDES = {
    "src/vs/editor/test/common/model/pieceTreeTextBuffer/pieceTreeTextBuffer.test.ts": [
        "import { suite, test } from '../../../../../../TestUtils/mochaCompat.ts';",
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
    "ITokenPresentation",
    "IViewLineTokens",
    // из наших шимов в base/common
    "Comparator",
    "IEquatable",
    "IdleDeadline",
    // из наших шимов токенизации в editor/common
    "IBackgroundTokenizationStore",
    "IBackgroundTokenizer",
    "ILanguageIdCodec",
    "IModelContentChange",
    "IState",
    "ITextModel",
    "ITokenizationSupport",
    // PieceTree: из шима model.ts и lifecycle.ts
    "IDisposable",
    "IInternalModelContentChange",
    "ISingleEditOperationIdentifier",
    "ITextBuffer",
    "ITextBufferBuilder",
    "ITextBufferFactory",
    "ITextSnapshot",
    "IValidEditOperation",
]);

/** Последняя строка MIT-шапки upstream — баннер вставляем сразу после неё. */
const MIT_HEADER_LAST = " *--------------------------------------------------------------------------------------------*/";

function banner(upstreamPath) {
    return [
        `//@diode:vendored microsoft/vscode@${VSCODE_TAG} ${upstreamPath}`,
        "// НЕ ПРАВИТЬ РУКАМИ — перегенерируется scripts/import-vscode-editor.mjs (см. AGENTS.md).",
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
            throw new Error(`[vendor] иссечение не приложилось в ${upstreamPath}: анкер не найден\n  ${spec.from}`);
        }
        const end = spec.to === "EOF" ? out.length - 1 : spec.to === "SELF" ? start : nthIndex(out, start, spec.to, spec.nth ?? 1);
        if (end === -1) {
            throw new Error(`[vendor] иссечение не приложилось в ${upstreamPath}: конечный анкер не найден\n  ${spec.to}`);
        }
        out = [...out.slice(0, start), ...out.slice(end + 1)];
    }
    return out;
}

/** Индекс `nth`-й (с 1) строки, равной `line`, начиная с `from`; -1 — нет. */
function nthIndex(lines, from, line, nth) {
    let seen = 0;
    for (let i = from; i < lines.length; i++) {
        if (lines[i] === line && ++seen === nth) return i;
    }
    return -1;
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
    if (idx === -1) throw new Error(`[vendor] MIT-шапка не найдена в ${upstreamPath}`);
    return [...lines.slice(0, idx + 1), ...banner(upstreamPath), ...(PRELUDES[upstreamPath] ?? []), ...lines.slice(idx + 1)];
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
    const scratch = mkdtempSync(join(tmpdir(), "vscode-editor-"));
    const cloneDir = join(scratch, "vscode");
    const keepClone = process.argv.includes("--keep-clone");
    try {
        console.error(`[vendor] cloning microsoft/vscode@${VSCODE_TAG} (sparse, blobless)`);
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
        console.error(`[vendor] перенесено файлов: ${FILES.length}`);

        const fixtureTarget = join(repoRoot, FIXTURES_TO);
        rmSync(fixtureTarget, { recursive: true, force: true });
        const fixtures = fixtureFiles(cloneDir);
        for (const rel of fixtures) {
            const to = join(fixtureTarget, rel);
            mkdirSync(dirname(to), { recursive: true });
            cpSync(join(cloneDir, FIXTURES_FROM, rel), to);
        }
        console.error(`[vendor] перенесено фикстур: ${fixtures.length} файл(ов) → ${FIXTURES_TO}`);
        console.error(`[vendor] upstream ${VSCODE_TAG} ${sha}`);
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
            console.error(`[vendor] --check OK: ${FILES.length} файл(ов) + ${fixtures.length} фикстур совпадают с upstream @ ${VSCODE_TAG} ${sha}`);
            return;
        }
        console.error(`[vendor] --check FAIL (${problems.length}):`);
        for (const p of problems.slice(0, 20)) console.error(`  ${p}`);
        process.exit(1);
    });
}

// ---- main ------------------------------------------------------------------

if (process.argv.includes("--check")) check();
else regen();
