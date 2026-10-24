import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { type WorkbenchContextKeys, WorkbenchContextKeysDIToken } from "../../../browser/workbenchContextKeys.ts";
import type { BaseTextEditorModel, EnableEditingRefusal } from "../../../common/editor/textEditorModel.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import {
    type NotificationService,
    NotificationServiceDIToken,
} from "../../../services/notification/browser/notificationService.ts";

export const ENABLE_LARGE_FILE_EDITING_COMMAND_ID = "workbench.action.files.enableLargeFileEditing";

/** The button of the large-file toast (upstream: "Forcefully Enable Features"). */
export const ENABLE_EDITING_LABEL = "Enable Editing";

/**
 * The toast for each refusal of `BaseTextEditorModel.enableEditing`; a cancelled load (the file was reloaded or
 * closed meanwhile) says nothing.
 */
export const ENABLE_EDITING_REFUSALS: Readonly<Record<Exclude<EnableEditingRefusal, "cancelled">, string>> = {
    "too-large":
        "This file is too large to edit: it holds more text than fits in one string. It stays read-only on disk.",
    "out-of-memory": "There is not enough free memory to load this file for editing. It stays read-only on disk.",
    "read-failed": "The file could not be read into memory for editing. It stays read-only on disk.",
};

/**
 * Upstream's "Forcefully Enable Features", for this model and this session only: upstream turns
 * `editor.largeFileOptimizations` off in settings.json and asks to reopen the file; here the tabs
 * leave read-only and the features come back at once, through the model event (docs/arch/Editor.md).
 * A document on disk streams into memory first, with progress in the status bar, or is refused with a toast.
 */
export async function enableLargeFileEditing(
    model: BaseTextEditorModel,
    contextKeys: WorkbenchContextKeys,
    notifications: NotificationService,
): Promise<void> {
    const refusal = await model.enableEditing();
    if (refusal === "cancelled") return;
    if (refusal !== null) {
        notifications.show({ severity: "warn", message: ENABLE_EDITING_REFUSALS[refusal], modal: false, items: [] });
        return;
    }
    // `editorReadonly` derives from editor state, not focus: it won't recompute by itself.
    contextKeys.update();
}

/** The toast's door, reachable from the palette after the toast has gone. A no-op on an ordinary file. */
export const enableLargeFileEditingAction: CommandAction = {
    id: ENABLE_LARGE_FILE_EDITING_COMMAND_ID,
    title: "File: Enable Editing of Large File",
    shortTitle: ENABLE_EDITING_LABEL,
    run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (editor === null || editor.detached || !editor.isTooLargeForTokenization) return undefined;
        return enableLargeFileEditing(
            editor.model,
            accessor.get(WorkbenchContextKeysDIToken),
            accessor.get(NotificationServiceDIToken),
        );
    },
};

export const TOGGLE_FOLLOW_TAIL_COMMAND_ID = "workbench.action.editor.toggleFollowTail";

/**
 * Follow of a document on disk (docs/arch/Editor.md): the counterpart of upstream's
 * `workbench.output.action.toggleAutoScroll` of the Output panel, for a file — a deviation, upstream has no
 * document on disk. On: the cursor goes to the end and rides the tail; off: it stays. A no-op on a document in
 * memory, like the sibling above; the status bar entry (`largeFileFollowStatus.ts`) is the usual door.
 */
export const toggleFollowTailAction: CommandAction = {
    id: TOGGLE_FOLLOW_TAIL_COMMAND_ID,
    title: "File: Toggle Follow Tail of Large File",
    shortTitle: "Toggle Follow Tail",
    run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (editor === null || editor.detached || editor.fileModel?.isOnDisk !== true) return;
        editor.viewState.setFollowTail(!editor.viewState.followTail);
    },
};

export const LARGE_FILE_ACTIONS: readonly CommandAction[] = [enableLargeFileEditingAction, toggleFollowTailAction];
