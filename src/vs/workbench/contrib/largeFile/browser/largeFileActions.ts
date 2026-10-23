import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { type WorkbenchContextKeys, WorkbenchContextKeysDIToken } from "../../../browser/workbenchContextKeys.ts";
import type { BaseTextEditorModel } from "../../../common/editor/textEditorModel.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

export const ENABLE_LARGE_FILE_EDITING_COMMAND_ID = "workbench.action.files.enableLargeFileEditing";

/** The button of the large-file toast (upstream: "Forcefully Enable Features"). */
export const ENABLE_EDITING_LABEL = "Enable Editing";

/**
 * Upstream's "Forcefully Enable Features", for this model and this session only: upstream turns
 * `editor.largeFileOptimizations` off in settings.json and asks to reopen the file; here the tabs
 * leave read-only and the features come back at once, through the model event (docs/arch/Editor.md).
 */
export function enableLargeFileEditing(model: BaseTextEditorModel, contextKeys: WorkbenchContextKeys): void {
    model.forcefullyEnableFeatures();
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
        if (editor === null || editor.detached || !editor.isTooLargeForTokenization) return;
        enableLargeFileEditing(editor.model, accessor.get(WorkbenchContextKeysDIToken));
    },
};

export const LARGE_FILE_ACTIONS: readonly CommandAction[] = [enableLargeFileEditingAction];
