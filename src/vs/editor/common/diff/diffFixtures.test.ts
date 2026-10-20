import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { setUnexpectedErrorHandler } from "../../../base/common/errors.ts";
import { TextEdit, TextReplacement } from "../core/edits/textEdit.ts";
import type { Range } from "../core/range.ts";
import type { AbstractText } from "../core/text/abstractText.ts";
import { ArrayText } from "../core/text/abstractText.ts";

import { DefaultLinesDiffComputer } from "./defaultLinesDiffComputer/defaultLinesDiffComputer.ts";
import type { LinesDiff } from "./linesDiffComputer.ts";
import type { DetailedLineRangeMapping, RangeMapping } from "./rangeMapping.ts";
import { RangeMapping as RangeMappingClass } from "./rangeMapping.ts";

/**
 * Фикстурный корпус upstream — главный гейт качества вендоринга
 * `vs/editor/common/diff` (см. AGENTS.md и docs/ARCHITECTURE.md).
 *
 * Каждый кейс — папка в `__fixtures__/` с парой файлов `1.*`/`2.*` и эталоном
 * `advanced.expected.diff.json`, где лежит и содержимое обоих файлов, и
 * ожидаемый результат `DefaultLinesDiffComputer`. Портировано с
 * `src/vs/editor/test/node/diffing/fixtures.test.ts` (mocha → vitest).
 *
 * ОТЛИЧИЕ ОТ UPSTREAM: у них раннер при расхождении ПЕРЕЗАПИСЫВАЕТ эталон
 * (удобно, когда ты же и меняешь алгоритм). Нам это ровно противопоказано:
 * перенос не имеет права «починиться» молчаливой правкой ожиданий. Поэтому
 * читаем только, а обновление — осознанное, через `UPDATE_DIFF_FIXTURES=1`.
 */

const FIXTURES_DIR = join(import.meta.dirname, "__fixtures__");
const UPDATE = process.env.UPDATE_DIFF_FIXTURES === "1";

interface IDiff {
    originalRange: string;
    modifiedRange: string;
}

interface IDetailedDiff {
    originalRange: string;
    modifiedRange: string;
    innerChanges: IDiff[] | null;
}

interface IMoveInfo {
    originalRange: string;
    modifiedRange: string;
    changes: IDetailedDiff[];
}

interface IDiffingResult {
    original: { content: string; fileName: string };
    modified: { content: string; fileName: string };
    diffs: IDetailedDiff[];
    moves?: IMoveInfo[];
}

/** Нормализация переводов строк — эталоны сняты на LF. */
function readNormalized(path: string): string {
    return readFileSync(path, "utf8").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function formatRange(range: Range, lines: string[]): string {
    const toLastChar = range.endColumn === lines[range.endLineNumber - 1].length + 1;
    return `[${range.startLineNumber},${range.startColumn} -> ${range.endLineNumber},${range.endColumn}${toLastChar ? " EOL" : ""}]`;
}

function toTextEdit(rangeMappings: readonly RangeMapping[], modified: AbstractText): TextEdit {
    return new TextEdit(
        rangeMappings.map((m) => new TextReplacement(m.originalRange, modified.getValueOfRange(m.modifiedRange))),
    );
}

/**
 * Property-проверка: применение всех `innerChanges` к оригиналу обязано дать
 * ровно модифицированный текст. Ловит внутренне противоречивый результат даже
 * там, где эталон совпал бы.
 */
function assertDiffCorrectness(diff: LinesDiff, original: string[], modified: string[]): void {
    const allInnerChanges = diff.changes.flatMap((c) => c.innerChanges ?? []);
    const edit = toTextEdit(allInnerChanges, new ArrayText(modified));
    expect(edit.normalize().apply(new ArrayText(original))).toBe(modified.join("\n"));
}

function computeResult(folder: string): IDiffingResult {
    const folderPath = join(FIXTURES_DIR, folder);
    const files = readdirSync(folderPath);

    const firstFileName = files.find((f) => f.startsWith("1."));
    const secondFileName = files.find((f) => f.startsWith("2."));
    if (firstFileName === undefined || secondFileName === undefined) {
        throw new Error(`фикстура ${folder}: не найдена пара файлов 1.*/2.*`);
    }

    const firstContent = readNormalized(join(folderPath, firstFileName));
    const secondContent = readNormalized(join(folderPath, secondFileName));
    const originalLines = firstContent.split("\n");
    const modifiedLines = secondContent.split("\n");

    // Соглашение upstream: режим ignoreTrimWhitespace включает само имя папки.
    const ignoreTrimWhitespace = folder.includes("trimws");
    const diff = new DefaultLinesDiffComputer().computeDiff(originalLines, modifiedLines, {
        ignoreTrimWhitespace,
        maxComputationTimeMs: Number.MAX_SAFE_INTEGER,
        computeMoves: true,
    });

    if (!ignoreTrimWhitespace) {
        assertDiffCorrectness(diff, originalLines, modifiedLines);
    }

    const getDiffs = (changes: readonly DetailedLineRangeMapping[]): IDetailedDiff[] => {
        for (const c of changes) {
            RangeMappingClass.assertSorted(c.innerChanges ?? []);
        }
        return changes.map((c) => ({
            originalRange: c.original.toString(),
            modifiedRange: c.modified.toString(),
            innerChanges:
                c.innerChanges?.map((inner) => ({
                    originalRange: formatRange(inner.originalRange, originalLines),
                    modifiedRange: formatRange(inner.modifiedRange, modifiedLines),
                })) ?? null,
        }));
    };

    const result: IDiffingResult = {
        original: { content: firstContent, fileName: `./${firstFileName}` },
        modified: { content: secondContent, fileName: `./${secondFileName}` },
        diffs: getDiffs(diff.changes),
        moves: diff.moves.map((v) => ({
            originalRange: v.lineRangeMapping.original.toString(),
            modifiedRange: v.lineRangeMapping.modified.toString(),
            changes: getDiffs(v.changes),
        })),
    };
    if (result.moves?.length === 0) delete result.moves;
    return result;
}

describe("diffing fixtures (upstream corpus)", () => {
    beforeEach(() => {
        // Как в фикстурном раннере upstream: во время тестов нарушение инварианта
        // в assertFn обязано валить кейс, а не тихо уходить в лог.
        setUnexpectedErrorHandler((e) => {
            throw e instanceof Error ? e : new Error(String(e));
        });
        return () => {
            setUnexpectedErrorHandler((e) => {
                console.error(e);
            });
        };
    });

    const folders = readdirSync(FIXTURES_DIR).sort();

    it("корпус на месте", () => {
        // Гейт на случай, если фикстуры не доехали: пустой readdir дал бы ноль
        // кейсов и зелёный прогон, который ничего не проверил.
        expect(folders.length).toBeGreaterThanOrEqual(58);
    });

    for (const folder of folders) {
        it(folder, () => {
            const actual = computeResult(folder);
            const expectedPath = join(FIXTURES_DIR, folder, "advanced.expected.diff.json");

            if (UPDATE) {
                writeFileSync(expectedPath, JSON.stringify(actual, null, "\t"));
                return;
            }

            expect(actual).toEqual(JSON.parse(readFileSync(expectedPath, "utf8")) as IDiffingResult);
        });
    }
});
