import { createRange } from "../../../editor/common/core/iRange.ts";
import type { ICoreCodeAction } from "../../../editor/common/languages/iCodeActionSource.ts";
import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import type { ServiceAccessor } from "../../../platform/instantiation/common/diContainer.ts";
import { parseChord, parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { QuickInputServiceDIToken } from "../parts/quickinput/quickInputService.ts";
import { EditorServiceDIToken } from "../../services/editor/browser/editorService.ts";
import { StatusBarServiceDIToken } from "../../services/statusbar/common/statusBarService.ts";
import { showTransientNotice } from "../../services/statusbar/common/transientNotice.ts";

import { selectionRange } from "./formatActions.ts";

// ─── Code actions (#196) ────────────────────────────────────
//
// Source-команды поверх провайдеров расширений
// (`EditorService.codeActionSource` ← host ← `languages.provideCodeActions`).
// Меню выбора действий (quick fix по Ctrl+.) — отдельным PR; здесь только
// действия «на весь документ», которым меню не нужно: organize imports и
// fix all берут предпочтительное/первое действие запрошенного вида.

/**
 * Запрашивает source-действия вида `only` для ВСЕГО документа и применяет
 * предпочтительное (или первое). Правки применяет субпроцесс через
 * `workspace.applyEdit` — к моменту ответа буфер уже изменён, поэтому
 * stale-гардов, как у форматирования, здесь нет: применение атомарно
 * валидируется на хосте (all-or-nothing по открытым документам).
 */
async function runSourceAction(accessor: ServiceAccessor, only: string, noun: string): Promise<void> {
    const group = accessor.get(EditorServiceDIToken);
    const statusBar = accessor.get(StatusBarServiceDIToken);
    const editor = group.getActiveEditor();
    if (editor === null) return;

    const notice = (text: string): void => {
        showTransientNotice(statusBar, "codeAction.notice", text);
    };

    const source = group.codeActionSource;
    if (source === undefined) {
        notice(`No ${noun} action for '${editor.languageId}'`);
        return;
    }

    const text = editor.getText();
    const lines = text.split("\n");
    const lastLine = lines.length - 1;
    const actions = await source.provide({
        uri: editor.uri.toString(),
        languageId: editor.languageId,
        text,
        // Source-действия применяются к целому файлу — диапазон всегда полный,
        // выделение роли не играет (как в VS Code).
        range: createRange(0, 0, lastLine, lines[lastLine].length),
        only,
    });
    if (actions === null || actions.length === 0) {
        notice(`No ${noun} action for '${editor.languageId}'`);
        return;
    }

    const pick: ICoreCodeAction = actions.find((action) => action.isPreferred === true) ?? actions[0];
    const applied = await source.apply(pick.id);
    if (!applied) notice(`Code action failed: ${pick.title}`);
}

/**
 * Организует импорты активного документа source-действием провайдера.
 * Matches VS Code's `editor.action.organizeImports` (Shift+Alt+O; на
 * legacy-tier'е шифтованные alt-буквы терминал не передаёт — команда доступна
 * из палитры).
 */
export const organizeImportsAction: CommandAction = {
    id: "editor.action.organizeImports",
    title: "Organize Imports",
    keybinding: parseKeybinding("shift+alt+o"),
    when: "textInputFocus && !editorReadonly",
    run(accessor) {
        return runSourceAction(accessor, "source.organizeImports", "organize imports");
    },
};

/**
 * Меню code actions у каретки/выделения: запрашивает ВСЕ доступные действия
 * (без `only`), показывает их в quick pick и применяет выбранное.
 * Matches VS Code's `editor.action.quickFix` (Ctrl+.; точка не кодируется
 * legacy-терминалом с Ctrl — досягаемый везде второй бинд Ctrl+K Ctrl+Q).
 */
export const quickFixAction: CommandAction = {
    id: "editor.action.quickFix",
    title: "Quick Fix",
    keybinding: parseKeybinding("ctrl+."),
    keybindings: [parseChord("ctrl+k ctrl+q")],
    when: "textInputFocus && !editorReadonly",
    async run(accessor) {
        const group = accessor.get(EditorServiceDIToken);
        const statusBar = accessor.get(StatusBarServiceDIToken);
        const quickInput = accessor.get(QuickInputServiceDIToken);
        const editor = group.getActiveEditor();
        if (editor === null) return;

        const notice = (text: string): void => {
            showTransientNotice(statusBar, "codeAction.notice", text);
        };

        const source = group.codeActionSource;
        if (source === undefined) {
            notice("No code actions available");
            return;
        }

        const text = editor.getText();
        const actions = await source.provide({
            uri: editor.uri.toString(),
            languageId: editor.languageId,
            text,
            // Каретка/выделение — как VS Code: действия по месту (пустое
            // выделение — строка каретки, чтобы накрыть диагностики строки).
            range: selectionRange(editor.viewState.selections[0], text),
        });
        if (actions === null || actions.length === 0) {
            notice("No code actions available");
            return;
        }

        const items = actions.map((action) => ({
            label: action.title,
            ...(action.kind === undefined ? {} : { description: action.kind }),
            ...(action.isPreferred === true ? { badge: "preferred" } : {}),
        }));
        const picked = await quickInput.quickPick({
            title: "Code Actions",
            placeholder: "Select Code Action",
            items,
        });
        if (picked === undefined) return; // отмена — не событие

        const pick = actions[items.indexOf(picked)];
        const applied = await source.apply(pick.id);
        if (!applied) notice(`Code action failed: ${pick.title}`);
    },
};

/**
 * Применяет авто-фиксы провайдера ко всему документу.
 * Matches VS Code's `editor.action.fixAll` (без дефолтного бинда — палитра).
 */
export const fixAllAction: CommandAction = {
    id: "editor.action.fixAll",
    title: "Fix All",
    when: "textInputFocus && !editorReadonly",
    run(accessor) {
        return runSourceAction(accessor, "source.fixAll", "fix all");
    },
};
