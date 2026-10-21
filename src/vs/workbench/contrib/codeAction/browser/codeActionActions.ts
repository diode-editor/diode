import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { getCodeActions, type ICodeActionItem } from "../../../../editor/contrib/codeAction/codeAction.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { showTransientNotice } from "../../../services/statusbar/common/transientNotice.ts";
import { selectionRange } from "../../format/browser/formatActions.ts";

/**
 * Stale-гардов, как у форматирования, нет: правки применяет субпроцесс через `workspace.applyEdit`,
 * атомарно (all-or-nothing по открытым документам).
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
    const items = await getCodeActions(
        languageFeatures.codeActionProvider,
        editor,
        {
            uri: editor.uri.toString(),
            languageId: editor.languageId,
            versionId: editor.model.document.versionId,
            // Source-действия — на весь файл, выделение роли не играет (как в VS Code).
            range: createRange(0, 0, lastLine, lines[lastLine].length),
            only,
        },
        // Команда разовая: ответ нужен, даже если человек правит буфер, —
        // правки субпроцесс валидирует сам при применении.
        CancellationTokenNone,
    );
    // Неактивные (`disabled`) не применяются. Если ничего, кроме них, нет —
    // человеку показывается причина неактивного, а не «действий нет»
    // (эталон: `getInvalidActionThatWouldHaveBeenApplied` у авто-применения).
    const valid = items.filter((item) => item.action.disabled === undefined);
    if (valid.length === 0) {
        notice(items.at(0)?.action.disabled ?? `No ${noun} action for '${editor.languageId}'`);
        return;
    }

    const pick: ICodeActionItem = valid.find((item) => item.action.isPreferred === true) ?? valid[0];
    const applied = await pick.provider.applyCodeAction(pick.action.id);
    if (!applied) notice(`Code action failed: ${pick.action.title}`);
}

/**
 * Shift+Alt+O терминал без extended keys не передаёт: канонический бинд под tier-гейтом,
 * досягаемый везде путь — лидер-аккорд Ctrl+K Alt+O.
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

async function pickCodeAction(
    accessor: ServiceAccessor,
    options: { readonly only?: string; readonly title: string; readonly empty: string },
): Promise<void> {
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
    const found = await getCodeActions(
        languageFeatures.codeActionProvider,
        editor,
        {
            uri: editor.uri.toString(),
            languageId: editor.languageId,
            versionId: editor.model.document.versionId,
            // Каретка/выделение — как VS Code: действия по месту (пустое
            // выделение — строка каретки, чтобы накрыть диагностики строки).
            range: selectionRange(editor.viewState.selections[0], text),
            // Спред — про чистоту запроса: `only: undefined` значит «любой вид».
            ...(options.only === undefined ? {} : { only: options.only }),
        },
        CancellationTokenNone,
    );
    // Неактивные (`CodeAction.disabled`) — как в эталоне
    // (`CodeActionController.showCodeActionList`): Quick Fix их не показывает
    // вовсе, а меню с запрошенным видом (рефакторинги, source) показывает их,
    // только когда активных нет, — с причиной. Переключателя «Show Disabled»
    // и серой отрисовки пункта у нас нет.
    const valid = found.filter(({ action }) => action.disabled === undefined);
    const shown = valid.length > 0 || options.only === undefined ? valid : found;
    if (shown.length === 0) {
        notice(options.empty);
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
    const sorted = [...shown].sort(({ action: a }, { action: b }) => {
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
        // Причина неактивного — рядом с заголовком: в эталоне её показывает
        // подсказка пункта (меню с заголовками групп, дефолт), у нас подсказок нет.
        ...(action.disabled === undefined ? {} : { hint: action.disabled }),
    }));
    const picked = await quickInput.quickPick({
        title: options.title,
        placeholder: "Select Code Action",
        items,
    });
    if (picked === undefined) return;

    const pick = sorted[items.indexOf(picked)];
    if (pick.action.disabled !== undefined) {
        notice(pick.action.disabled);
        return;
    }
    const applied = await pick.provider.applyCodeAction(pick.action.id);
    if (!applied) notice(`Code action failed: ${pick.action.title}`);
}

/** Ctrl+. legacy-терминал с Ctrl не кодирует — досягаемый везде второй бинд Ctrl+K Ctrl+Q. */
export const quickFixAction: CommandAction = {
    id: "editor.action.quickFix",
    title: "Quick Fix",
    keybinding: parseKeybinding("mod+."),
    keybindings: [parseChord("ctrl+k ctrl+q")],
    when: "textInputFocus && !editorReadonly",
    // Своя группа эталона (`codeActionCommands.ts`): ниже блока правок.
    menus: [{ menuId: MenuId.EditorContext, group: "1_quickfix", order: 0, when: "editorHasCodeActionsProvider" }],
    run(accessor) {
        return pickCodeAction(accessor, { title: "Code Actions", empty: "No code actions available" });
    },
};

/**
 * Ctrl+Shift+R на legacy-терминале неотличим от Ctrl+R: канонический бинд под tier-гейтом,
 * рядом — досягаемый везде лидер-аккорд.
 */
export const refactorAction: CommandAction = {
    id: "editor.action.refactor",
    title: "Refactor...",
    keybinding: parseChord("ctrl+k alt+r"),
    keybindings: [{ keys: parseKeybinding("mod+shift+r"), when: "tier != 'legacy'" }],
    when: "textInputFocus && !editorReadonly",
    menus: [{ menuId: MenuId.EditorContext, group: "1_modification", order: 2, when: "editorHasCodeActionsProvider" }],
    run(accessor) {
        return pickCodeAction(accessor, { only: "refactor", title: "Refactor", empty: "No refactorings available" });
    },
};

export const sourceActionAction: CommandAction = {
    id: "editor.action.sourceAction",
    title: "Source Action...",
    when: "textInputFocus && !editorReadonly",
    menus: [
        { menuId: MenuId.EditorContext, group: "1_modification", order: 2.1, when: "editorHasCodeActionsProvider" },
    ],
    run(accessor) {
        return pickCodeAction(accessor, {
            only: "source",
            title: "Source Action",
            empty: "No source actions available",
        });
    },
};

export const fixAllAction: CommandAction = {
    id: "editor.action.fixAll",
    title: "Fix All",
    when: "textInputFocus && !editorReadonly",
    run(accessor) {
        return runSourceAction(accessor, "source.fixAll", "fix all");
    },
};

export const CODE_ACTION_ACTIONS: readonly CommandAction[] = [
    organizeImportsAction,
    fixAllAction,
    quickFixAction,
    refactorAction,
    sourceActionAction,
];
