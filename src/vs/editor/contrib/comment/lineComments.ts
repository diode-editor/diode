import type { IPosition } from "../../common/core/iPosition.ts";
import { createRange } from "../../common/core/iRange.ts";
import type { ITextEdit } from "../../common/core/iTextEdit.ts";
import { createTextEdit } from "../../common/core/iTextEdit.ts";
import { getLeadingWhitespace } from "../../common/languages/autoIndent.ts";

// VS Code `LineCommentCommand`.

export type LineCommentMode = "toggle" | "add" | "remove";

/** Insertion (`delta > 0`) or deletion (`delta < 0`) of `|delta|` characters starting at `column`. */
export interface ILineShift {
    readonly line: number;
    readonly column: number;
    readonly delta: number;
}

export interface ILineCommentPlan {
    readonly edits: readonly ITextEdit[];
    readonly shifts: readonly ILineShift[];
}

interface ILineInfo {
    readonly line: number;
    readonly indentLength: number;
    readonly isBlank: boolean;
    readonly isCommented: boolean;
    /** Includes the trailing space, if any: this is how much remove deletes. */
    readonly markerLength: number;
}

function analyzeLine(content: string, token: string, line: number): ILineInfo {
    const indentLength = getLeadingWhitespace(content).length;
    const isBlank = indentLength === content.length;
    const isCommented = !isBlank && content.startsWith(token, indentLength);
    const markerLength = token.length + (isCommented && content[indentLength + token.length] === " " ? 1 : 0);
    return { line, indentLength, isBlank, isCommented, markerLength };
}

/** VS Code semantics: blank lines are skipped; markers go in one column at the minimal indent. */
export function planLineComments(
    getLineContent: (line: number) => string,
    lines: readonly number[],
    lineComment: string,
    mode: LineCommentMode,
): ILineCommentPlan | null {
    const infos = lines.map((line) => analyzeLine(getLineContent(line), lineComment, line));

    // "All lines blank -> comment them all" applies only to toggle (as in VS Code:
    // ForceAdd/ForceRemove always ignore blank lines).
    const allBlank = infos.every((info) => info.isBlank);
    const considered = allBlank && mode === "toggle" ? infos : infos.filter((info) => !info.isBlank);
    if (considered.length === 0) return null;

    const shouldRemove = mode === "remove" || (mode === "toggle" && considered.every((info) => info.isCommented));

    const edits: ITextEdit[] = [];
    // Stryker disable next-line ArrayDeclaration: shift accumulator; an extra entry is unobservable:
    // it has no line, and remapPositionForShifts skips it (shift.line !== pos.line)
    const shifts: ILineShift[] = [];

    if (shouldRemove) {
        for (const info of considered) {
            if (!info.isCommented) continue;
            edits.push(
                createTextEdit(
                    createRange(info.line, info.indentLength, info.line, info.indentLength + info.markerLength),
                    "",
                ),
            );
            shifts.push({ line: info.line, column: info.indentLength, delta: -info.markerLength });
        }
        return edits.length > 0 ? { edits, shifts } : null;
    }

    const insertColumn = Math.min(...considered.map((info) => info.indentLength));
    const marker = lineComment + " ";
    for (const info of considered) {
        edits.push(createTextEdit(createRange(info.line, insertColumn, info.line, insertColumn), marker));
        shifts.push({ line: info.line, column: insertColumn, delta: marker.length });
    }
    return { edits, shifts };
}

/**
 * Same convention as `shiftIndent` in `EditorViewState`: a point at column 0 is anchored
 * (an insertion at line start does not drag the cursor away from it).
 */
export function remapPositionForShifts(pos: IPosition, shifts: readonly ILineShift[]): IPosition {
    let character = pos.character;
    for (const shift of shifts) {
        if (shift.line !== pos.line) continue;
        // Stryker disable next-line EqualityOperator: a zero shift is unreachable: the marker is
        // non-empty (config resolution drops an empty lineComment), so `>= 0` is equivalent
        if (shift.delta > 0) {
            if (character !== 0 && character >= shift.column) character += shift.delta;
        } else {
            const removedEnd = shift.column - shift.delta;
            // Stryker disable next-line ConditionalExpression,EqualityOperator: at the boundary
            // (character === column) both branches yield column: the point is clamped to where it already is
            if (character > shift.column) {
                // Stryker disable next-line EqualityOperator: at character === removedEnd both branches
                // yield column (removedEnd + delta === column): the piece boundary belongs to both
                character = character >= removedEnd ? character + shift.delta : shift.column;
            }
        }
    }
    return { line: pos.line, character };
}
