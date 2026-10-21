import { comparePositions, positionsEqual } from "../../../../editor/common/core/iPosition.ts";
import { createRange, type IRange } from "../../../../editor/common/core/iRange.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { documentRange, formatDocument, formatRange } from "../../../../editor/contrib/format/format.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { applyFormattingEdits } from "../../../browser/parts/editor/applyFormattingEdits.ts";
import {
    EditorStateCancellationTokenSource,
    EditorStateFlag,
} from "../../../browser/parts/editor/editorStateCancellation.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { showTransientNotice } from "../../../services/statusbar/common/transientNotice.ts";

// The core intentionally has no formatter of its own: without a provider it's "no formatter" in the status bar
// (like VS Code), not a beautifier that would mangle the code.

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
        versionId: editor.model.document.versionId,
        tabSize: editor.viewState.tabSize,
        insertSpaces: editor.viewState.insertSpaces,
    };
    // A document edit during the request makes the response inapplicable: its
    // offsets were computed against a snapshot that no longer matches the text.
    // The same edit cancels the token, and with it the extension formatter's work.
    const state = new EditorStateCancellationTokenSource(editor, EditorStateFlag.Value);
    let edits: Awaited<ReturnType<typeof formatDocument>>;
    try {
        edits = useSelection
            ? await formatRange(
                  languageFeatures,
                  editor,
                  { ...request, range: selectionRange(editor.viewState.selections[0], text) },
                  state.token,
              )
            : await formatDocument(languageFeatures, editor, request, documentRange(text), state.token);
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
    applyFormattingEdits(editor, edits, label);
}

/** An empty selection means the whole cursor line (as in VS Code). */
export function selectionRange(
    selection: { anchor: { line: number; character: number }; active: { line: number; character: number } } | undefined,
    text: string,
): IRange {
    const anchor = selection?.anchor ?? { line: 0, character: 0 };
    const active = selection?.active ?? { line: 0, character: 0 };
    // Stryker disable next-line EqualityOperator: `>=` differs only for equal positions, where swapping equals changes nothing (an empty selection takes the cursor-line branch)
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
 * Shift+Alt+F works only on kitty/csi-u: a legacy terminal sends Alt+F as `ESC F` without shift. The chord
 * reachable everywhere is Ctrl+K Ctrl+E (i/m/j are taken by Tab/Enter/LF, D by multi-cursor, F by Format Selection).
 */
export const formatDocumentAction: CommandAction = {
    id: "editor.action.formatDocument",
    title: "Format Document",
    keybinding: parseChord("ctrl+k ctrl+e"),
    keybindings: [{ keys: parseKeybinding("shift+alt+f"), when: "tier != 'legacy'" }],
    when: "textInputFocus && !editorReadonly",
    // Group and order are copied from upstream (`formatActions.ts`): with no
    // formatter for the language there is no menu item.
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

export const formatSelectionAction: CommandAction = {
    id: "editor.action.formatSelection",
    title: "Format Selection",
    keybinding: parseChord("mod+k mod+f"),
    when: "textInputFocus && !editorReadonly",
    // Upstream shows the item only with a non-empty selection; otherwise
    // "format selection" has nothing to format.
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

export const FORMAT_ACTIONS: readonly CommandAction[] = [formatDocumentAction, formatSelectionAction];
