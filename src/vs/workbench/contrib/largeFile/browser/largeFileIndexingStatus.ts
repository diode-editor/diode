import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";
import { EditorServiceDIToken, type IEditorService } from "../../../services/editor/common/editorService.ts";
import type { IStatusBarEntryHandle, StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";

export const LargeFileIndexingStatusDIToken =
    // Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by reference to it; the string inside is only a debug label
    token<LargeFileIndexingStatus>("LargeFileIndexingStatus");

export const INDEXING_STATUS_ID = "status.largeFile.indexing";

/** Where window progress shows (`ProgressStatusBarContribution`): the index is the file's own progress. */
const INDEXING_PRIORITY = 60;

/** `Indexing 45%`; the percentage is of the file's bytes. */
export function indexingStatusText(indexedBytes: number, totalBytes: number): string {
    const percent = totalBytes <= 0 ? 100 : Math.min(100, Math.floor((indexedBytes / totalBytes) * 100));
    return `Indexing ${String(percent)}%`;
}

/**
 * The status bar shows how far the line index of the active editor's document on disk has got
 * (docs/arch/Editor.md): the line count grows while it runs. No upstream analog — upstream has no
 * document on disk. Transient and without a `name`: it has no place in the visibility menu.
 */
export class LargeFileIndexingStatus extends Disposable implements IWorkbenchContribution {
    public static dependencies = [EditorServiceDIToken, StatusBarServiceDIToken] as const;

    private handle: IStatusBarEntryHandle | null = null;
    private progressSubscription: IDisposable | null = null;
    private lastText: string | null = null;

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
                this.progressSubscription?.dispose();
                this.clear();
            },
        });
        this.follow(editors.getActiveEditor());
    }

    private follow(editor: TextEditorPane | null): void {
        this.progressSubscription?.dispose();
        this.progressSubscription = null;
        const model = editor !== null && !editor.detached ? editor.fileModel : null;
        if (model === null) {
            this.clear();
            return;
        }
        this.progressSubscription = model.onDidChangeDiskIndexing(() => {
            this.sync(model.diskIndexing);
        });
        this.sync(model.diskIndexing);
    }

    private sync(indexing: { indexedBytes: number; totalBytes: number; done: boolean } | null): void {
        if (indexing === null || indexing.done) {
            this.clear();
            return;
        }
        const text = indexingStatusText(indexing.indexedBytes, indexing.totalBytes);
        // Chunks arrive every few milliseconds; the bar repaints only when the percentage moves.
        if (text === this.lastText) return;
        this.lastText = text;
        if (this.handle === null) {
            this.handle = this.statusBar.addEntry({
                id: INDEXING_STATUS_ID,
                text,
                alignment: "left",
                priority: INDEXING_PRIORITY,
            });
        } else {
            this.handle.update({ text });
        }
    }

    private clear(): void {
        this.handle?.dispose();
        this.handle = null;
        this.lastText = null;
    }
}
