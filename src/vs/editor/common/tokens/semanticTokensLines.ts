import { spliceInChunks } from "../../../base/common/arrays.ts";
import type { IRange } from "../core/iRange.ts";
import type { ISemanticTokensLegend } from "../languages/iSemanticTokensSource.ts";

/**
 * Quadruples `[startChar, endChar, typeIdx, modifierSet]` in ascending `startChar`, non-overlapping;
 * indices refer to the legend of the provider that answered.
 */
export interface ISemanticLineTokens {
    readonly legend: ISemanticTokensLegend;
    readonly tokens: readonly number[];
}

interface IMutableLine {
    readonly legend: ISemanticTokensLegend;
    tokens: number[];
}

const CHAR_0 = 48;
const CHAR_9 = 57;
const CHAR_UPPER_A = 65;
const CHAR_UPPER_Z = 90;
const CHAR_LOWER_A = 97;
const CHAR_LOWER_Z = 122;

/** Only `\n`, unlike upstream `countEOL`: `TextDocument.applyEdits` splits inserted text on `\n`. */
export function countEOL(text: string): [eolCount: number, firstLineLength: number, lastLineLength: number] {
    const firstEol = text.indexOf("\n");
    if (firstEol === -1) return [0, text.length, text.length];
    return [text.split("\n").length - 1, firstEol, text.length - text.lastIndexOf("\n") - 1];
}

/**
 * Upstream `toMultilineTokens2`. Styles are not computed here: a token without a style
 * simply does not repaint TextMate at render time (upstream drops it right away).
 */
export function decodeSemanticTokens(data: Uint32Array, legend: ISemanticTokensLegend): SemanticTokensLines {
    const result = new SemanticTokensLines();
    let line = 0;
    let char = 0;
    let current: IMutableLine | undefined;
    let currentLine = -1;
    for (let i = 0; i + 4 < data.length; i += 5) {
        const deltaLine = data[i];
        line += deltaLine;
        char = deltaLine === 0 ? char + data[i + 1] : data[i + 1];
        const end = char + data[i + 2];
        if (end <= char) continue; // invalid length
        // By line number, not deltaLine: a dropped token may have opened the line.
        if (current === undefined || currentLine !== line) {
            current = result.ensureLine(line, legend);
            currentLine = line;
        }
        const tokens = current.tokens;
        if (tokens.length > 0 && tokens[tokens.length - 3] > char) continue; // overlapping token
        tokens.push(char, end, data[i + 3], data[i + 4]);
    }
    return result;
}

/** Moves tokens across edits per the cases of upstream `SparseMultilineTokensStorage.acceptDeleteRange`/`acceptInsertText`. */
export class SemanticTokensLines {
    private lines: (IMutableLine | undefined)[] = [];

    public getLine(line: number): ISemanticLineTokens | undefined {
        const entry = this.lines[line];
        return entry !== undefined && entry.tokens.length > 0 ? entry : undefined;
    }

    public get lineNumbers(): number[] {
        const result: number[] = [];
        this.lines.forEach((entry, index) => {
            if (entry !== undefined && entry.tokens.length > 0) result.push(index);
        });
        return result;
    }

    public ensureLine(line: number, legend: ISemanticTokensLegend): IMutableLine {
        let entry = this.lines[line];
        if (entry === undefined) {
            entry = { legend, tokens: [] };
            this.lines[line] = entry;
        }
        return entry;
    }

    public replaceLines(startLine: number, endLine: number, source: SemanticTokensLines): void {
        for (let line = startLine; line <= endLine; line++) {
            const entry = source.lines[line];
            if (entry === undefined) {
                // Stryker disable next-line ArrayDeclaration: a hole and an empty line are indistinguishable to getLine
                // Stryker disable next-line ConditionalExpression,EqualityOperator: past the array end the assignment only adds holes, indistinguishable
                if (line < this.lines.length) this.lines[line] = undefined;
            } else {
                this.lines[line] = { legend: entry.legend, tokens: [...entry.tokens] };
            }
        }
    }

    /** `range` is in original (pre-edit) coordinates. */
    public applyEdit(range: IRange, text: string): void {
        const [eolCount, firstLineLength, lastLineLength] = countEOL(text);
        this.acceptDeleteRange(range);
        this.acceptInsertText(
            range.start.line,
            range.start.character,
            eolCount,
            firstLineLength,
            lastLineLength,
            // NaN for empty text: it matches no word-character range.
            text.charCodeAt(0),
        );
    }

    private acceptDeleteRange(range: IRange): void {
        const { line: startLine, character: startChar } = range.start;
        const { line: endLine, character: endChar } = range.end;
        const kept: number[] = [];
        const first = this.lines[startLine];
        // Stryker disable next-line AssignmentOperator,ConditionalExpression: a backward step or an always-true condition loops forever, the mutant hangs rather than survives
        for (let i = 0; first !== undefined && i < first.tokens.length; i += 4) {
            const start = first.tokens[i];
            let end = first.tokens[i + 1];
            // The boundary comparisons below (here and in the branches) are equivalent: a token
            // touching the deletion edge gets the same coordinates in the neighbouring branch.
            // Stryker disable next-line EqualityOperator: see above
            if (end <= startChar) {
                // 1a. The token is completely before the deletion range
            } else if (start < startChar) {
                // 1b, 1c, 1d — the token survives, but it needs to shrink
                // Stryker disable next-line EqualityOperator: see above
                end = startLine === endLine && end > endChar ? end - (endChar - startChar) : startChar;
            } else if (startLine === endLine) {
                // Stryker disable next-line EqualityOperator: see above
                if (start < endChar) {
                    // 2c / 3c — ends after the deletion: shrinks / moves right after it; otherwise deleted
                    if (end <= endChar) continue;
                    end = startChar + (end - endChar);
                    kept.push(startChar, end, first.tokens[i + 2], first.tokens[i + 3]);
                    continue;
                }
                // 4. The token starts after the deletion range, on the same line
                kept.push(
                    start - (endChar - startChar),
                    end - (endChar - startChar),
                    first.tokens[i + 2],
                    first.tokens[i + 3],
                );
                continue;
            } else {
                // 2a, 2b, 3a, 3b on the first line of a multi-line deletion — deleted
                continue;
            }
            kept.push(start, end, first.tokens[i + 2], first.tokens[i + 3]);
        }

        let legend = first?.legend;
        if (startLine !== endLine) {
            const last = this.lines[endLine];
            // Stryker disable next-line AssignmentOperator: a backward step loops forever, the mutant hangs rather than survives
            for (let i = 0; last !== undefined && i < last.tokens.length; i += 4) {
                const start = last.tokens[i];
                const end = last.tokens[i + 1];
                // Stryker disable next-line EqualityOperator: see above
                if (start < endChar) {
                    // 3c — the token moves to continue right after the deletion; 3a/3b — deleted
                    if (end <= endChar) continue;
                    if (legend !== undefined && legend !== last.legend) continue;
                    legend = last.legend;
                    kept.push(startChar, startChar + (end - endChar), last.tokens[i + 2], last.tokens[i + 3]);
                } else {
                    // 4. The token starts after the deletion range, on its last line
                    if (legend !== undefined && legend !== last.legend) continue;
                    legend = last.legend;
                    kept.push(
                        start - endChar + startChar,
                        end - endChar + startChar,
                        last.tokens[i + 2],
                        last.tokens[i + 3],
                    );
                }
            }
            this.lines.splice(startLine + 1, endLine - startLine);
        }
        if (legend !== undefined) this.lines[startLine] = { legend, tokens: kept };
    }

    private acceptInsertText(
        line: number,
        character: number,
        eolCount: number,
        firstLineLength: number,
        lastLineLength: number,
        firstCharCode: number,
    ): void {
        const isInsertingPreciselyOneWordCharacter =
            eolCount === 0 &&
            firstLineLength === 1 &&
            ((firstCharCode >= CHAR_0 && firstCharCode <= CHAR_9) ||
                (firstCharCode >= CHAR_UPPER_A && firstCharCode <= CHAR_UPPER_Z) ||
                (firstCharCode >= CHAR_LOWER_A && firstCharCode <= CHAR_LOWER_Z));

        const entry = this.lines[line];
        const stays: number[] = [];
        const moves: number[] = [];
        for (let i = 0; entry !== undefined && i < entry.tokens.length; i += 4) {
            let start = entry.tokens[i];
            let end = entry.tokens[i + 1];
            const type = entry.tokens[i + 2];
            const modifiers = entry.tokens[i + 3];
            if (end < character) {
                // 1. The token is completely before the insertion point
                stays.push(start, end, type, modifiers);
                continue;
            }
            if (end === character) {
                // 2. The token ends precisely at the insertion point
                // => expand the end character only if inserting precisely one word character
                stays.push(start, isInsertingPreciselyOneWordCharacter ? end + 1 : end, type, modifiers);
                continue;
            }
            if (start < character) {
                // 3. The token contains the insertion point: expand, or cut off on a line break
                stays.push(start, eolCount === 0 ? end + firstLineLength : character, type, modifiers);
                continue;
            }
            if (start === character && isInsertingPreciselyOneWordCharacter) {
                // 4. The token starts precisely at the insertion point: keep it in place
                stays.push(start, end, type, modifiers);
                continue;
            }
            // 4. or 5. — the token must move and keep its size constant
            if (eolCount === 0) {
                stays.push(start + firstLineLength, end + firstLineLength, type, modifiers);
            } else {
                const length = end - start;
                start = lastLineLength + (start - character);
                end = start + length;
                moves.push(start, end, type, modifiers);
            }
        }

        // Past the known lines splice only appends empty lines.
        if (eolCount > 0) {
            const inserted = new Array<IMutableLine | undefined>(eolCount - 1).fill(undefined);
            inserted.push(entry === undefined ? undefined : { legend: entry.legend, tokens: moves });
            spliceInChunks(this.lines, line + 1, 0, inserted);
        }
        if (entry !== undefined) entry.tokens = stays;
    }
}
