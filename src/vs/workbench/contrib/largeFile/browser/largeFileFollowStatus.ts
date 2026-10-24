import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";
import { EditorServiceDIToken, type IEditorService } from "../../../services/editor/common/editorService.ts";
import type { IStatusBarEntryHandle, StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";

export const LargeFileFollowStatusDIToken =
    // Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by reference to it; the string inside is only a debug label
    token<LargeFileFollowStatus>("LargeFileFollowStatus");

export const FOLLOW_STATUS_ID = "status.largeFile.followTail";

/** Left of `Ln X, Col Y` (priority 100): the state belongs to the cursor, which decides it. */
const FOLLOW_PRIORITY = 101;

export const FOLLOW_ON_TEXT = "Follow: On";
export const FOLLOW_OFF_TEXT = "Follow: Off";

/**
 * The status bar shows whether the active editor's document on disk follows its tail (docs/arch/Editor.md,
 * `EditorViewState.followTail`): a cursor on the last line rides along as the file grows, like `less +F`. The
 * entry is a click away from toggling it, like the lock button of upstream's Output panel; it is shown for every
 * document on disk, on or off, so the mode is discoverable. No upstream analog for a file (a deviation).
 */
export class LargeFileFollowStatus extends Disposable implements IWorkbenchContribution {
    public static dependencies = [EditorServiceDIToken, StatusBarServiceDIToken] as const;

    private handle: IStatusBarEntryHandle | null = null;
    private subscriptions: IDisposable[] = [];

    public constructor(
        editors: IEditorService,
        private readonly statusBar: StatusBarService,
    ) {
        super();
        this.register(
            editors.onActiveEditorChanged((editor) => {
                this.follow(editor);
            }),
        );
        this.register({
            dispose: () => {
                this.unsubscribe();
                this.clear();
            },
        });
        this.follow(editors.getActiveEditor());
    }

    private follow(editor: TextEditorPane | null): void {
        this.unsubscribe();
        // The entry's click is bound to the editor it was made for: a new editor gets a new entry.
        this.clear();
        const model = editor !== null && !editor.detached ? editor.fileModel : null;
        if (model === null || editor === null) {
            this.clear();
            return;
        }
        const viewState = editor.viewState;
        this.subscriptions.push(
            viewState.onDidChangeFollowTail(() => {
                this.sync(editor);
            }),
            // "Enable Editing" reloads the document into memory with a flush: the entry goes with the disk.
            model.document.onDidChangeContent((change) => {
                if (change.isFlush === true) this.sync(editor);
            }),
        );
        this.sync(editor);
    }

    private sync(editor: TextEditorPane): void {
        if (editor.fileModel?.isOnDisk !== true) {
            this.clear();
            return;
        }
        const viewState = editor.viewState;
        const text = viewState.followTail ? FOLLOW_ON_TEXT : FOLLOW_OFF_TEXT;
        if (this.handle === null) {
            this.handle = this.statusBar.addEntry({
                id: FOLLOW_STATUS_ID,
                name: "Follow Tail",
                text,
                alignment: "right",
                priority: FOLLOW_PRIORITY,
                onClick: () => {
                    viewState.setFollowTail(!viewState.followTail);
                },
            });
        } else {
            this.handle.update({ text });
        }
    }

    private unsubscribe(): void {
        for (const subscription of this.subscriptions) subscription.dispose();
        this.subscriptions = [];
    }

    private clear(): void {
        this.handle?.dispose();
        this.handle = null;
    }
}
