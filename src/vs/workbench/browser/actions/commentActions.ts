import { LanguageConfigurationServiceDIToken } from "../../../editor/common/languages/iLanguageConfigurationService.ts";
import type { IUndoElement } from "../../../editor/common/model/iUndoElement.ts";
import type { EditorViewState } from "../../../editor/common/viewModel/editorViewState.ts";
import {
    addLineComment,
    removeLineComment,
    toggleBlockComment,
    toggleLineComment,
} from "../../../editor/contrib/comment/commentCommands.ts";
import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import type { ICommentRule } from "../../../platform/extensions/common/iLanguageConfiguration.ts";
import type { ServiceAccessor } from "../../../platform/instantiation/common/diContainer.ts";
import { parseChord, parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { EditorServiceDIToken } from "../../services/editor/browser/editorService.ts";

/**
 * Команды комментирования (VS Code `editor/contrib/comment`): id, бинды и
 * заголовки дословно из VS Code, тела — `editor/contrib/comment/commentCommands`.
 * Токены комментариев берутся из language configuration активного языка —
 * загрузка ленивая, поэтому первый вызов на языке дожидается чтения файла.
 */

async function withCommentRule(
    accessor: ServiceAccessor,
    apply: (viewState: EditorViewState, comments: ICommentRule) => IUndoElement | undefined,
): Promise<void> {
    const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
    if (editor === null) return;
    const document = editor.viewState.document;
    const versionBefore = document.versionId;

    const configuration = await accessor.get(LanguageConfigurationServiceDIToken).ensureLoaded(document.languageId);
    if (configuration.comments === undefined) return;
    // Пока конфигурация читалась с диска, пользователь мог переключить
    // вкладку или продолжить печатать — команда обязана примениться к тому
    // состоянию, на котором её звали, либо не примениться вовсе.
    if (editor.viewState.document !== document || document.versionId !== versionBefore) return;

    editor.pushUndo(apply(editor.viewState, configuration.comments));
}

export const commentLineAction: CommandAction = {
    id: "editor.action.commentLine",
    title: "Toggle Line Comment",
    keybinding: parseKeybinding("ctrl+/"),
    when: "textInputFocus && !editorReadonly",
    menus: [{ menuId: MenuId.MenubarEditMenu, group: "4_comment", order: 10 }],
    run(accessor) {
        return withCommentRule(accessor, toggleLineComment);
    },
};

export const addCommentLineAction: CommandAction = {
    id: "editor.action.addCommentLine",
    title: "Add Line Comment",
    keybinding: parseChord("ctrl+k ctrl+c"),
    when: "textInputFocus && !editorReadonly",
    run(accessor) {
        return withCommentRule(accessor, addLineComment);
    },
};

export const removeCommentLineAction: CommandAction = {
    id: "editor.action.removeCommentLine",
    title: "Remove Line Comment",
    keybinding: parseChord("ctrl+k ctrl+u"),
    when: "textInputFocus && !editorReadonly",
    run(accessor) {
        return withCommentRule(accessor, removeLineComment);
    },
};

export const blockCommentAction: CommandAction = {
    id: "editor.action.blockComment",
    title: "Toggle Block Comment",
    keybinding: parseKeybinding("shift+alt+a"),
    when: "textInputFocus && !editorReadonly",
    menus: [{ menuId: MenuId.MenubarEditMenu, group: "4_comment", order: 20 }],
    run(accessor) {
        return withCommentRule(accessor, toggleBlockComment);
    },
};

export const COMMENT_ACTIONS: readonly CommandAction[] = [
    commentLineAction,
    addCommentLineAction,
    removeCommentLineAction,
    blockCommentAction,
];
