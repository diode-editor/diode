import { comparePositions, positionsEqual } from "../../../../editor/common/core/iPosition.ts";
import { createRange, type IRange } from "../../../../editor/common/core/iRange.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { formatDocument, formatRange } from "../../../../editor/contrib/format/format.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { applyFormattingEdits } from "../../../browser/parts/editor/applyFormattingEdits.ts";
import {
    EditorStateCancellationTokenSource,
    EditorStateFlag,
} from "../../../browser/parts/editor/editorStateCancellation.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { showTransientNotice } from "../../../services/statusbar/common/transientNotice.ts";

// ─── Formatting (#196) ──────────────────────────────────────
//
// Команды форматирования поверх провайдеров расширений
// (реестры `ILanguageFeaturesService` ← прокси host'а ← `languages.provideFormattingEdits`).
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
    const languageFeatures = accessor.get(LanguageFeaturesServiceDIToken);
    const editor = group.getActiveEditor();
    if (editor === null) return;

    const text = editor.getText();
    const request = {
        uri: editor.uri.toString(),
        languageId: editor.languageId,
        text,
        tabSize: editor.viewState.tabSize,
        insertSpaces: editor.viewState.insertSpaces,
    };
    // Правка документа за время запроса делает ответ неприменимым: его
    // смещения посчитаны по снапшоту, который уже не совпадает с текстом.
    const state = new EditorStateCancellationTokenSource(editor, EditorStateFlag.Value);
    let edits: Awaited<ReturnType<typeof formatDocument>>;
    try {
        // Форматтера для документа нет — сразу «нет форматтера», без RPC.
        edits = useSelection
            ? await formatRange(languageFeatures, editor, {
                  ...request,
                  range: selectionRange(editor.viewState.selections[0], text),
              })
            : await formatDocument(languageFeatures, editor, request);
    } finally {
        state.dispose();
    }
    if (edits === null) {
        showTransientNotice(statusBar, "formatting.notice", `No formatter for '${editor.languageId}' installed`);
        return;
    }
    if (edits.length === 0) return;
    const current = group.getActiveEditor();
    if (current !== editor || state.token.isCancellationRequested) return;
    // Общий с format-on-save хвост: undoable-батч + схлопывание выделений в
    // одну каретку на прежнем месте (как VS Code).
    applyFormattingEdits(editor, edits, label);
}

/**
 * Диапазон запроса из первичного выделения (Format Selection, Quick Fix):
 * anchor/active; пустое выделение — строка каретки целиком (как VS Code).
 */
export function selectionRange(
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
    keybinding: parseChord("ctrl+k ctrl+e"),
    keybindings: [{ keys: parseKeybinding("shift+alt+f"), when: "tier != 'legacy'" }],
    when: "textInputFocus && !editorReadonly",
    // Группа и порядок — дословно upstream (`formatActions.ts`): без
    // форматтера под язык пункта нет.
    menus: [
        {
            menuId: MenuId.EditorContext,
            group: "1_modification",
            order: 1.3,
            when: "editorHasDocumentFormattingProvider",
        },
    ],
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
    keybinding: parseChord("mod+k mod+f"),
    when: "textInputFocus && !editorReadonly",
    // Upstream показывает пункт только при непустом выделении — иначе
    // «отформатировать выделенное» нечего форматировать.
    menus: [
        {
            menuId: MenuId.EditorContext,
            group: "1_modification",
            order: 1.31,
            when: "editorHasDocumentSelectionFormattingProvider && editorHasSelection",
        },
    ],
    run(accessor) {
        return runFormat(accessor, true, "Format Selection");
    },
};

/** Экшены форматирования. Фича отдаёт их одним массивом; регистрирует агрегатор (`WORKBENCH_ACTIONS`). */
export const FORMAT_ACTIONS: readonly CommandAction[] = [formatDocumentAction, formatSelectionAction];
