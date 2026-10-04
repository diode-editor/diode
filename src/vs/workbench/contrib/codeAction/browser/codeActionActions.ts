import { createRange } from "../../../../editor/common/core/iRange.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { getCodeActions, type ICodeActionItem } from "../../../../editor/contrib/codeAction/codeAction.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { showTransientNotice } from "../../../services/statusbar/common/transientNotice.ts";
import { selectionRange } from "../../format/browser/formatActions.ts";

// ─── Code actions (#196) ────────────────────────────────────
//
// Source-команды поверх провайдеров расширений
// (реестр `ILanguageFeaturesService.codeActionProvider` ← прокси host'а ←
// `languages.provideCodeActions`).
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
    const languageFeatures = accessor.get(LanguageFeaturesServiceDIToken);
    const editor = group.getActiveEditor();
    if (editor === null) return;

    const notice = (text: string): void => {
        showTransientNotice(statusBar, "codeAction.notice", text);
    };

    const text = editor.getText();
    const lines = text.split("\n");
    const lastLine = lines.length - 1;
    const items = await getCodeActions(languageFeatures.codeActionProvider, editor, {
        uri: editor.uri.toString(),
        languageId: editor.languageId,
        text,
        // Source-действия применяются к целому файлу — диапазон всегда полный,
        // выделение роли не играет (как в VS Code).
        range: createRange(0, 0, lastLine, lines[lastLine].length),
        only,
    });
    if (items.length === 0) {
        notice(`No ${noun} action for '${editor.languageId}'`);
        return;
    }

    const pick: ICodeActionItem = items.find((item) => item.action.isPreferred === true) ?? items[0];
    const applied = await pick.provider.applyCodeAction(pick.action.id);
    if (!applied) notice(`Code action failed: ${pick.action.title}`);
}

/**
 * Организует импорты активного документа source-действием провайдера.
 * Matches VS Code's `editor.action.organizeImports` (Shift+Alt+O). Шифтованные
 * alt-буквы терминал без extended keys не передаёт, поэтому канонический бинд
 * под tier-гейтом, а досягаемый везде путь — лидер-аккорд Ctrl+K Alt+O.
 */
export const organizeImportsAction: CommandAction = {
    id: "editor.action.organizeImports",
    title: "Organize Imports",
    keybinding: parseChord("ctrl+k alt+o"),
    keybindings: [{ keys: parseKeybinding("shift+alt+o"), when: "tier != 'legacy'" }],
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
    keybinding: parseKeybinding("mod+."),
    keybindings: [parseChord("ctrl+k ctrl+q")],
    when: "textInputFocus && !editorReadonly",
    async run(accessor) {
        const group = accessor.get(EditorServiceDIToken);
        const statusBar = accessor.get(StatusBarServiceDIToken);
        const quickInput = accessor.get(QuickInputServiceDIToken);
        const languageFeatures = accessor.get(LanguageFeaturesServiceDIToken);
        const editor = group.getActiveEditor();
        if (editor === null) return;

        const notice = (text: string): void => {
            showTransientNotice(statusBar, "codeAction.notice", text);
        };

        const text = editor.getText();
        const found = await getCodeActions(languageFeatures.codeActionProvider, editor, {
            uri: editor.uri.toString(),
            languageId: editor.languageId,
            text,
            // Каретка/выделение — как VS Code: действия по месту (пустое
            // выделение — строка каретки, чтобы накрыть диагностики строки).
            range: selectionRange(editor.viewState.selections[0], text),
        });
        if (found.length === 0) {
            notice("No code actions available");
            return;
        }

        // Порядок VS Code: quickfix'ы выше рефакторингов и source-действий,
        // preferred — первым в своей группе. Провайдеры обходятся в порядке
        // регистрации, и без сортировки один многословный (16 рефакторингов
        // tsserver) выталкивал фиксы линтера за край попапа.
        const kindRank = (kind: string | undefined): number => {
            if (kind === undefined) return 3;
            if (kind === "quickfix" || kind.startsWith("quickfix.")) return 0;
            if (kind === "refactor" || kind.startsWith("refactor.")) return 1;
            if (kind === "source" || kind.startsWith("source.")) return 2;
            return 3;
        };
        const sorted = [...found].sort(({ action: a }, { action: b }) => {
            const byKind = kindRank(a.kind) - kindRank(b.kind);
            if (byKind !== 0) return byKind;
            const aPreferred = a.isPreferred === true;
            // Stryker disable next-line ConditionalExpression,BooleanLiteral: какой элемент пары попадёт в `b` — деталь TimSort; для подъёма preferred достаточно aPreferred-ветки, и на стабильных входах мутант неотличим
            const bPreferred = b.isPreferred === true;
            // Stryker disable next-line ConditionalExpression: «всегда не равны» вырождается в стабильную вставку тем же порядком — наблюдаемого различия нет
            if (aPreferred === bPreferred) return 0;
            return aPreferred ? -1 : 1;
        });
        const items = sorted.map(({ action }) => ({
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

        const pick = sorted[items.indexOf(picked)];
        const applied = await pick.provider.applyCodeAction(pick.action.id);
        if (!applied) notice(`Code action failed: ${pick.action.title}`);
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

/** Экшены code actions (organize imports, fix all, quick fix). Фича отдаёт их одним массивом; регистрирует агрегатор (`WORKBENCH_ACTIONS`). */
export const CODE_ACTION_ACTIONS: readonly CommandAction[] = [organizeImportsAction, fixAllAction, quickFixAction];
