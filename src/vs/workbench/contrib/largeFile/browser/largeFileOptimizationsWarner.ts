import { Disposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { type WorkbenchContextKeys, WorkbenchContextKeysDIToken } from "../../../browser/workbenchContextKeys.ts";
import type { BaseTextEditorModel } from "../../../common/editor/textEditorModel.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";
import { EditorServiceDIToken, type IEditorService } from "../../../services/editor/common/editorService.ts";
import {
    type NotificationService,
    NotificationServiceDIToken,
} from "../../../services/notification/browser/notificationService.ts";

import { ENABLE_EDITING_LABEL, enableLargeFileEditing } from "./largeFileActions.ts";

export const LargeFileOptimizationsWarnerDIToken =
    // Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by reference to it; the string inside is only a debug label
    token<LargeFileOptimizationsWarner>("LargeFileOptimizationsWarner");

/** Upstream's text plus our read-only (the message is prefixed with the file name, as upstream). */
export const LARGE_FILE_MESSAGE =
    "opened read-only; tokenization, wrapping, folding, word highlighting, quick diff and extension sync " +
    "have been turned off for this large file in order to reduce memory usage and avoid freezing or crashing.";

/** Appended when a file above the size threshold is in memory because the document on disk reads UTF-8 only. */
export const LOADED_INTO_MEMORY_ENCODING_NOTE =
    " The file is loaded into memory: reading from disk supports UTF-8 only.";

/**
 * Port of upstream `LargeFileOptimizationsWarner`: the toast of the large-file mode with the way out
 * (docs/arch/Editor.md). Once per model, not per tab: a file in two groups is one file. The toast is a
 * question (it has a button), so it stays for `NOTIFICATION_ASK_TIMEOUT_MS`; afterwards the command
 * `workbench.action.files.enableLargeFileEditing` is the same door.
 */
export class LargeFileOptimizationsWarner extends Disposable implements IWorkbenchContribution {
    public static dependencies = [
        EditorServiceDIToken,
        NotificationServiceDIToken,
        WorkbenchContextKeysDIToken,
    ] as const;

    private readonly warned = new WeakSet<BaseTextEditorModel>();

    public constructor(
        editors: IEditorService,
        private readonly notifications: NotificationService,
        private readonly contextKeys: WorkbenchContextKeys,
    ) {
        super();
        this.register(
            editors.onActiveEditorChanged((editor) => {
                this.warn(editor);
            }),
        );
        // The file may have become active before the contribution was created.
        this.warn(editors.getActiveEditor());
    }

    private warn(editor: TextEditorPane | null): void {
        if (editor === null || editor.detached) return;
        const { model } = editor;
        if (!model.isTooLargeForTokenization || this.warned.has(model)) return;
        this.warned.add(model);
        // Stryker disable next-line OptionalChaining: only a TextFileModel decides on the mode, so a pane in it has a fileModel; the chaining is for the type
        const note = editor.fileModel?.onDiskDeclinedReason === "encoding" ? LOADED_INTO_MEMORY_ENCODING_NOTE : "";
        const handle = this.notifications.show({
            severity: "info",
            message: `${editor.label}: ${LARGE_FILE_MESSAGE}${note}`,
            modal: false,
            items: [ENABLE_EDITING_LABEL],
        });
        // Editing enabled another way (the command, Save As): the toast's button would do nothing, so the toast goes.
        const leftMode = model.onDidChangeTooLargeForTokenization(() => {
            this.notifications.dismiss(handle.id);
        });
        void handle.answered.then((index) => {
            // Stryker disable next-line CallExpression: dismissing a settled toast is a no-op; disposing only drops the listener
            leftMode.dispose();
            if (index === 0) void enableLargeFileEditing(model, this.contextKeys, this.notifications);
        });
    }
}
