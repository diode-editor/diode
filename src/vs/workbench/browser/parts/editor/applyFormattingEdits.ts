import { createSelection, type ISelection } from "../../../../editor/common/core/iSelection.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";

/** Structural subset of `TextEditorPane`, so tests can pass a fake. */
export interface IFormattableEditor {
    getText(): string;
    applyExternalEdits(edits: readonly ITextEdit[], label: string): void;
    readonly viewState: { selections: ISelection[] };
}

/**
 * Collapses the selections into a SINGLE cursor at its previous position (like VS Code): `applyEdits`
 * only shifts selections, so a cursor inside a large replacement would end up after the inserted text.
 */
export function applyFormattingEdits(editor: IFormattableEditor, edits: readonly ITextEdit[], label: string): void {
    const caret = editor.viewState.selections[0]?.active ?? { line: 0, character: 0 };
    editor.applyExternalEdits(edits, label);
    const lines = editor.getText().split("\n");
    const line = Math.min(caret.line, lines.length - 1);
    const character = Math.min(caret.character, lines[line].length);
    editor.viewState.selections = [createSelection(line, character, line, character)];
}
