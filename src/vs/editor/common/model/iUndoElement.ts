import type { EndOfLine } from "../core/endOfLine.ts";
import type { ISelection } from "../core/iSelection.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";

export interface IUndoElement {
    readonly label: string;
    readonly versionBefore: number;
    readonly versionAfter: number;
    readonly forwardEdits: readonly ITextEdit[];
    readonly backwardEdits: readonly ITextEdit[];
    readonly beforeSelections: readonly ISelection[];
    readonly afterSelections: readonly ISelection[];
    /** Только у элементов, меняющих EOL. */
    readonly eolBefore?: EndOfLine;
    readonly eolAfter?: EndOfLine;
}
