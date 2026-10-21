import { createSelection, type ISelection } from "../../../../editor/common/core/iSelection.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";

/** Структурное подмножество `TextEditorPane` (тесты работают с фейком). */
export interface IFormattableEditor {
    getText(): string;
    applyExternalEdits(edits: readonly ITextEdit[], label: string): void;
    readonly viewState: { selections: ISelection[] };
}

/**
 * Схлопывает выделения в ОДНУ каретку на прежнем месте (как VS Code): `applyEdits`
 * лишь сдвигает выделения, и каретку внутри крупной замены увело бы в конец вставки.
 */
export function applyFormattingEdits(editor: IFormattableEditor, edits: readonly ITextEdit[], label: string): void {
    const caret = editor.viewState.selections[0]?.active ?? { line: 0, character: 0 };
    editor.applyExternalEdits(edits, label);
    const lines = editor.getText().split("\n");
    const line = Math.min(caret.line, lines.length - 1);
    const character = Math.min(caret.character, lines[line].length);
    editor.viewState.selections = [createSelection(line, character, line, character)];
}
