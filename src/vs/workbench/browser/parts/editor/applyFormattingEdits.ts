import { createSelection, type ISelection } from "../../../../editor/common/core/iSelection.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";

/**
 * Редактирующая поверхность, достаточная для применения правок форматтера:
 * структурное подмножество {@link ./textEditorPane.ts:TextEditorPane}
 * (команды и save-участник работают с настоящей панелью, тесты — с фейком).
 */
export interface IFormattableEditor {
    getText(): string;
    applyExternalEdits(edits: readonly ITextEdit[], label: string): void;
    readonly viewState: { selections: ISelection[] };
}

/**
 * Применяет правки форматтера одним undoable-батчем и схлопывает выделения в
 * ОДНУ каретку на прежнем месте (клампнутом к новому тексту, как VS Code):
 * `applyEdits` ставит каретку на каждую правку (мультикурсорная семантика
 * batch-редактирования), а у форматтера их десятки. Общий хвост команд
 * Format Document/Selection и участника format-on-save.
 */
export function applyFormattingEdits(editor: IFormattableEditor, edits: readonly ITextEdit[], label: string): void {
    const caret = editor.viewState.selections[0]?.active ?? { line: 0, character: 0 };
    editor.applyExternalEdits(edits, label);
    const lines = editor.getText().split("\n");
    const line = Math.min(caret.line, lines.length - 1);
    const character = Math.min(caret.character, lines[line].length);
    editor.viewState.selections = [createSelection(line, character, line, character)];
}
