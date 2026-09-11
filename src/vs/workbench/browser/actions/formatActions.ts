import { comparePositions, positionsEqual } from "../../../editor/common/core/iPosition.ts";
import { createRange, type IRange } from "../../../editor/common/core/iRange.ts";
import { createSelection } from "../../../editor/common/core/iSelection.ts";
import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { parseChord, parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import type { ServiceAccessor } from "../../../platform/instantiation/common/diContainer.ts";
import { EditorServiceDIToken } from "../../services/editor/browser/editorService.ts";
import { StatusBarServiceDIToken } from "../../services/statusbar/common/statusBarService.ts";
import { showTransientNotice } from "../../services/statusbar/common/transientNotice.ts";

// ─── Formatting (#196) ──────────────────────────────────────
//
// Команды форматирования поверх провайдеров расширений
// (`EditorService.formattingSource` ← host ← `languages.provideFormattingEdits`).
// Своего форматтера у ядра нет намеренно: без провайдера команда показывает
// «нет форматтера» в статус-баре (как VS Code), а не изобретает beautifier,
// который портил бы код.

/**
 * Форматирует активный документ (или выделение) правками провайдера и
 * применяет их одним undoable-батчем. Ответ считается от снапшота текста:
 * если за время запроса документ изменился или вкладка сменилась — правки
 * молча отбрасываются (применять их к другому тексту нельзя).
 */
async function runFormat(accessor: ServiceAccessor, useSelection: boolean, label: string): Promise<void> {
    const group = accessor.get(EditorServiceDIToken);
    const statusBar = accessor.get(StatusBarServiceDIToken);
    const editor = group.getActiveEditor();
    if (editor === null) return;

    const noFormatter = (): void => {
        showTransientNotice(statusBar, "formatting.notice", `No formatter for '${editor.languageId}' installed`);
    };

    const source = group.formattingSource;
    if (source === undefined) {
        noFormatter();
        return;
    }

    const text = editor.getText();
    const range = useSelection ? selectionRange(editor.viewState.selections[0], text) : undefined;
    const edits = await source({
        uri: editor.uri.toString(),
        languageId: editor.languageId,
        text,
        tabSize: editor.viewState.tabSize,
        insertSpaces: editor.viewState.insertSpaces,
        ...(range === undefined ? {} : { range }),
    });
    if (edits === null) {
        noFormatter();
        return;
    }
    if (edits.length === 0) return;
    const current = group.getActiveEditor();
    if (current !== editor || editor.getText() !== text) return;
    const caret = editor.viewState.selections[0]?.active ?? { line: 0, character: 0 };
    editor.applyExternalEdits(edits, label);
    // `applyEdits` ставит каретку на каждую правку (мультикурсорная семантика
    // batch-редактирования) — у форматтера их десятки. Возвращаем ОДНУ каретку
    // на прежнее место, клампнутое к новому тексту (как VS Code).
    const lines = editor.getText().split("\n");
    const line = Math.min(caret.line, lines.length - 1);
    const character = Math.min(caret.character, lines[line].length);
    editor.viewState.selections = [createSelection(line, character, line, character)];
}

/**
 * Диапазон Format Selection из первичного выделения: нормализованный
 * anchor/active; пустое выделение — строка каретки целиком (как VS Code).
 */
function selectionRange(
    selection: { anchor: { line: number; character: number }; active: { line: number; character: number } } | undefined,
    text: string,
): IRange {
    const anchor = selection?.anchor ?? { line: 0, character: 0 };
    const active = selection?.active ?? { line: 0, character: 0 };
    // Stryker disable next-line EqualityOperator: `>=` отличается только при равных позициях, а там swap равных ничего не меняет (пустое выделение уходит в ветку строки каретки)
    const reversed = comparePositions(anchor, active) > 0;
    const start = reversed ? active : anchor;
    const end = reversed ? anchor : active;
    if (positionsEqual(start, end)) {
        const lineText = text.split("\n")[start.line] ?? "";
        return createRange(start.line, 0, start.line, lineText.length);
    }
    return createRange(start.line, start.character, end.line, end.character);
}

/**
 * Форматирует активный документ провайдером расширений.
 * Matches VS Code's `editor.action.formatDocument` (Shift+Alt+F).
 *
 * Канонический Shift+Alt+F живёт только на kitty/csi-u: legacy-терминал шлёт
 * Alt+F байтами `ESC F` без shift-флага, и бинд с shift там недостижим (та же
 * грабля, что у hover'ного Ctrl+K Ctrl+I). Досягаемый везде чорд — Ctrl+K
 * Ctrl+E (буквы со спецбайтами ctrl+i/m/j заняты Tab/Enter/LF, D — мульти-
 * курсором, F — Format Selection).
 */
export const formatDocumentAction: CommandAction = {
    id: "editor.action.formatDocument",
    title: "Format Document",
    keybinding: parseKeybinding("shift+alt+f"),
    keybindings: [parseChord("ctrl+k ctrl+e")],
    when: "textInputFocus && !editorReadonly",
    run(accessor) {
        return runFormat(accessor, false, "Format Document");
    },
};

/**
 * Форматирует выделение (пустое — строку каретки) range-провайдером.
 * Matches VS Code's `editor.action.formatSelection` (Ctrl+K Ctrl+F).
 */
export const formatSelectionAction: CommandAction = {
    id: "editor.action.formatSelection",
    title: "Format Selection",
    keybinding: parseChord("ctrl+k ctrl+f"),
    when: "textInputFocus && !editorReadonly",
    run(accessor) {
        return runFormat(accessor, true, "Format Selection");
    },
};
