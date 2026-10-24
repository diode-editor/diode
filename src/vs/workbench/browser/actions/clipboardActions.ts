import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import { inMemoryClipboardMetadata } from "../../../platform/clipboard/common/clipboardMetadata.ts";
import { ClipboardDIToken } from "../../../platform/clipboard/common/iClipboard.ts";
import { IConfigurationServiceDIToken } from "../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { ServiceAccessor } from "../../../platform/instantiation/common/diContainer.ts";
import { parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { EditorServiceDIToken } from "../../services/editor/common/editorService.ts";
import { NotificationServiceDIToken } from "../../services/notification/browser/notificationService.ts";

/** A document on disk refuses a text no string can hold (`DiskTextBuffer`); the user is told instead of the log. */
export const COPY_TOO_LARGE_MESSAGE = "The selection is too large to copy: it does not fit in memory. Select less.";

function isEmptySelectionClipboardEnabled(accessor: ServiceAccessor): boolean {
    return accessor.get(IConfigurationServiceDIToken).get("editor.emptySelectionClipboard");
}

export const clipboardCopyAction: CommandAction = {
    id: "editor.action.clipboardCopyAction",
    title: "Copy",
    keybinding: parseKeybinding("ctrl+c"),
    // Wider than Cut/Paste: copying from a read-only diff is allowed too.
    when: "textViewFocus",
    menus: [
        { menuId: MenuId.EditorContext, group: "9_cutcopypaste", order: 2 },
        { menuId: MenuId.MenubarEditMenu, group: "2_clipboard", order: 20 },
    ],
    async run(accessor) {
        // Via the pane, not viewState: the diff drops the placeholder lines of collapsed regions.
        const editorService = accessor.get(EditorServiceDIToken);
        let text: string;
        try {
            text = joinSelectedTexts(editorService.getActivePane()?.getSelectedTexts() ?? []);
        } catch (error) {
            // Select All on a 2 GB document on disk: the text is refused up front (docs/arch/Editor.md).
            if (!(error instanceof RangeError)) throw error;
            accessor
                .get(NotificationServiceDIToken)
                .show({ severity: "warn", message: COPY_TOO_LARGE_MESSAGE, modal: false, items: [] });
            return;
        }
        if (text !== "") {
            await accessor.get(ClipboardDIToken).writeText(text);
            // Stryker disable next-line ObjectLiteral: an empty object is equivalent — a missing isFromEmptySelection reads as false
            inMemoryClipboardMetadata.set(text, { isFromEmptySelection: false });
            return;
        }
        // viewState, not the pane: works on the read-only side of a diff too.
        const viewState = editorService.getActiveViewState();
        if (!viewState || !isEmptySelectionClipboardEnabled(accessor)) return;
        // Empty cursors always carry their line with \n — the text is non-empty by construction.
        const lineCopy = viewState.getTextToCopy(true);
        await accessor.get(ClipboardDIToken).writeText(lineCopy.text);
        inMemoryClipboardMetadata.set(lineCopy.text, { isFromEmptySelection: lineCopy.isFromEmptySelection });
    },
};

/** Collapsed cursors are skipped: an empty line in the clipboard would be garbage. */
function joinSelectedTexts(texts: readonly string[]): string {
    return texts.filter((text) => text !== "").join("\n");
}

export const clipboardCutAction: CommandAction = {
    id: "editor.action.clipboardCutAction",
    title: "Cut",
    keybinding: parseKeybinding("ctrl+x"),
    when: "textInputFocus && !editorReadonly",
    menus: [
        { menuId: MenuId.EditorContext, group: "9_cutcopypaste", order: 1 },
        { menuId: MenuId.MenubarEditMenu, group: "2_clipboard", order: 10 },
    ],
    async run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (!editor) return;
        const emptySelectionClipboard = isEmptySelectionClipboardEnabled(accessor);
        // One source for "what to copy" and "what to delete": empty cursors take and cut their whole line.
        const copy = editor.viewState.getTextToCopy(emptySelectionClipboard);
        if (copy.text === "") return;
        await accessor.get(ClipboardDIToken).writeText(copy.text);
        inMemoryClipboardMetadata.set(copy.text, { isFromEmptySelection: copy.isFromEmptySelection });
        editor.pushUndo(editor.viewState.cutSelections(emptySelectionClipboard));
    },
};

export const clipboardPasteAction: CommandAction = {
    id: "editor.action.clipboardPasteAction",
    title: "Paste",
    keybinding: parseKeybinding("ctrl+v"),
    when: "textInputFocus && !editorReadonly",
    menus: [
        { menuId: MenuId.EditorContext, group: "9_cutcopypaste", order: 4 },
        { menuId: MenuId.MenubarEditMenu, group: "2_clipboard", order: 30 },
    ],
    async run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (!editor) return;
        const text = await accessor.get(ClipboardDIToken).readText();
        if (text === "") return;
        // The metadata is valid only for the text of OUR last Copy/Cut — a foreign clipboard is pasted as is.
        const pasteOnNewLine =
            (inMemoryClipboardMetadata.get(text)?.isFromEmptySelection ?? false) &&
            isEmptySelectionClipboardEnabled(accessor);
        editor.pushUndo(editor.viewState.pasteText(text, pasteOnNewLine));
    },
};
