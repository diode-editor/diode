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
 * Upstream fixture corpus (`editor/test/node/diffing/fixtures.test.ts`): the main quality
 * gate for the vendored copy of `vs/editor/common/diff`.
 *
 * DIFFERENCE FROM UPSTREAM: there the runner OVERWRITES the expected file on mismatch, but
 * the vendored copy must not "fix itself" by silently editing expectations. Updates are deliberate
 * only, via `UPDATE_DIFF_FIXTURES=1`.
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

/** Expected files were captured with LF. */
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

/** Catches an internally inconsistent result even where the expected file would match. */
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
        throw new Error(`fixture ${folder}: no 1.*/2.* file pair found`);
    }

    const firstContent = readNormalized(join(folderPath, firstFileName));
    const secondContent = readNormalized(join(folderPath, secondFileName));
    const originalLines = firstContent.split("\n");
    const modifiedLines = secondContent.split("\n");

    // Upstream convention: the folder name itself turns on ignoreTrimWhitespace.
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
        // As in the upstream runner: an invariant violation in assertFn fails the case instead of being logged.
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

    it("corpus is present", () => {
        // An empty readdir would give a green run that checked nothing.
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
