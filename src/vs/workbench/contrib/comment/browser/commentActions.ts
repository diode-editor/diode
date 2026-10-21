import { LanguageConfigurationServiceDIToken } from "../../../../editor/common/languages/iLanguageConfigurationService.ts";
import type { IUndoElement } from "../../../../editor/common/model/iUndoElement.ts";
import type { EditorViewState } from "../../../../editor/common/viewModel/editorViewState.ts";
import {
    addLineComment,
    removeLineComment,
    toggleBlockComment,
    toggleLineComment,
} from "../../../../editor/contrib/comment/commentCommands.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { ICommentRule } from "../../../../platform/extensions/common/iLanguageConfiguration.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

// Comment tokens come from the language configuration; loading is lazy, the first call per language waits for the file read.

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
    // While the configuration was being read from disk, the user could switch
    // tabs or keep typing — the command must apply to the
    // state it was invoked in, or not apply at all.
    if (editor.viewState.document !== document || document.versionId !== versionBefore) return;

    editor.pushUndo(apply(editor.viewState, configuration.comments));
}

export const commentLineAction: CommandAction = {
    id: "editor.action.commentLine",
    title: "Toggle Line Comment",
    keybinding: parseKeybinding("mod+/"),
    when: "textInputFocus && !editorReadonly",
    menus: [{ menuId: MenuId.MenubarEditMenu, group: "4_comment", order: 10 }],
    run(accessor) {
        return withCommentRule(accessor, toggleLineComment);
    },
};

export const addCommentLineAction: CommandAction = {
    id: "editor.action.addCommentLine",
    title: "Add Line Comment",
    keybinding: parseChord("mod+k mod+c"),
    when: "textInputFocus && !editorReadonly",
    run(accessor) {
        return withCommentRule(accessor, addLineComment);
    },
};

export const removeCommentLineAction: CommandAction = {
    id: "editor.action.removeCommentLine",
    title: "Remove Line Comment",
    keybinding: parseChord("mod+k mod+u"),
    when: "textInputFocus && !editorReadonly",
    run(accessor) {
        return withCommentRule(accessor, removeLineComment);
    },
};

export const blockCommentAction: CommandAction = {
    id: "editor.action.blockComment",
    title: "Toggle Block Comment",
    // Shift+Alt+<letter> arrives in the legacy stream as `ESC <letter>` without the shift flag —
    // the canonical binding is declared where the terminal distinguishes Shift, and the reachable
    // path is an unconditional leader chord (Alt in the second part: a bare second part
    // leaks as a paired keypress, see docs/TODO/README.md#клавиатура).
    keybinding: parseChord("ctrl+k alt+a"),
    keybindings: [{ keys: parseKeybinding("shift+alt+a"), when: "tier != 'legacy'" }],
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
