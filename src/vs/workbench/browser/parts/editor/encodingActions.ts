import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { SUPPORTED_ENCODINGS } from "../../../../editor/common/model/encoding.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { IFileServiceDIToken } from "../../../../platform/files/common/files.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { DialogServiceDIToken } from "../../../services/dialogs/browser/dialogService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { QuickInputServiceDIToken } from "../quickinput/quickInputService.ts";

/**
 * VS Code `workbench.action.editor.changeEncoding`. "Reopen" on a dirty buffer asks for
 * confirmation, since re-reading discards unsaved changes.
 */
async function changeFileEncoding(accessor: ServiceAccessor): Promise<void> {
    const editorGroup = accessor.get(EditorServiceDIToken);
    const quickInput = accessor.get(QuickInputServiceDIToken);
    const dialogService = accessor.get(DialogServiceDIToken);

    const editor = editorGroup.getActiveEditor();
    if (editor === null) return;

    // `untitled:` has no file service provider, so exists is false for it.
    const canReopen = await accessor.get(IFileServiceDIToken).exists(editor.uri);
    // Read-only forbids writing but not re-reading, so only "Save with Encoding"
    // is dropped (like VS Code).
    const modeItems = [
        ...(canReopen ? [{ label: "Reopen with Encoding", description: "Reinterpret the file on disk" }] : []),
        ...(editor.readOnly
            ? []
            : [{ label: "Save with Encoding", description: "Write the file in a different encoding" }]),
    ];
    if (modeItems.length === 0) return;
    const mode = await quickInput.quickPick({
        title: "Change File Encoding",
        placeholder: "Select Action",
        items: modeItems,
    });
    if (mode === undefined) return;

    const current = editor.encoding;
    const encodingItems = SUPPORTED_ENCODINGS.map((info) => ({ label: info.label, description: info.id }));
    const picked = await quickInput.quickPick({
        title: mode.label,
        placeholder: "Select File Encoding",
        items: encodingItems,
        activeIndex: Math.max(
            0,
            SUPPORTED_ENCODINGS.findIndex((info) => info.id === current),
        ),
    });
    if (picked?.description === undefined) return;
    const encoding = picked.description;

    if (mode.label === "Reopen with Encoding") {
        if (editor.isModified) {
            const name = editorGroup.displayName(editor);
            dialogService.showConfirmDialog(
                {
                    title: "Reopen with Encoding",
                    message: [`"${name}" has unsaved changes.`, "Reopening the file will discard them. Continue?"],
                    confirmLabel: "Reopen",
                    cancelLabel: "Cancel",
                    defaultButton: "cancel",
                },
                {
                    onConfirm: () => {
                        editor.reopenWithEncoding(encoding).catch(onUnexpectedError);
                    },
                },
            );
            return;
        }
        // Non-Unicode encodings decode asynchronously (iconv): the command completes after the re-read.
        await editor.reopenWithEncoding(encoding);
        return;
    }

    const outcome = await editor.saveWithEncoding(encoding);
    if (outcome === "no-file") {
        accessor.get(CommandRegistryDIToken).execute("workbench.action.files.saveAs");
        return;
    }
    if (outcome === "conflict") {
        const name = editorGroup.displayName(editor);
        dialogService.showConfirmDialog(
            {
                title: "Overwrite",
                message: [
                    `The file "${name}" has been changed on disk.`,
                    "Do you want to overwrite the version on disk with your changes?",
                ],
                confirmLabel: "Overwrite",
                cancelLabel: "Cancel",
                defaultButton: "cancel",
            },
            {
                onConfirm: () => {
                    void editor.save({ overwrite: true });
                },
            },
        );
        return;
    }
}

export const changeEncodingAction: CommandAction = {
    id: "workbench.action.editor.changeEncoding",
    title: "Change File Encoding",
    run(accessor) {
        void changeFileEncoding(accessor);
    },
};
