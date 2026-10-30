import { Disposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { FileOperation, type IFileService, IFileServiceDIToken } from "../../../../platform/files/common/files.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStateDescriptor, IStateService } from "../../../../platform/state/common/iStateService.ts";
import { StateServiceDIToken } from "../../../../platform/state/common/iStateService.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";
import { movedResource } from "../../editor/browser/editorService.ts";

import { HistoryEditorSourceDIToken, type IHistoryEditorSource } from "./historyService.ts";

/** Upstream `HistoryService.MAX_HISTORY_ITEMS`. */
export const MAX_HISTORY_ITEMS = 200;

/** Upstream key (`HistoryService.HISTORY_STORAGE_KEY`); absolute paths, most recent first. */
export const EDITOR_HISTORY_STATE: IStateDescriptor<readonly string[]> = {
    key: "history.entries",
    scope: "workspace",
    default: [],
};

// Stryker disable next-line StringLiteral: token() returns a new Token and dependency resolution goes by reference to it; the string inside is only a debug label
export const EditorHistoryServiceDIToken = token<EditorHistoryService>("EditorHistoryService");

/**
 * Counterpart of upstream `IHistoryService.getHistory()`: recently opened files, separate from the
 * Back/Forward stack ({@link HistoryService}). Only `file:` resources: untitled buffers and
 * virtual documents are not reopenable from Quick Open. Closing a tab keeps the entry.
 */
export class EditorHistoryService extends Disposable implements IWorkbenchContribution {
    public static dependencies = [HistoryEditorSourceDIToken, IFileServiceDIToken, StateServiceDIToken] as const;

    private entries: Uri[] = [];

    public constructor(
        private readonly source: Pick<IHistoryEditorSource, "getActiveEditor" | "onActiveEditorChanged">,
        private readonly fileService: Pick<IFileService, "exists" | "onDidRunOperation" | "onDidFilesChange">,
        private readonly state: Pick<IStateService, "get" | "store" | "onDidOpenWorkspace">,
    ) {
        super();
        this.load();

        this.register(
            this.source.onActiveEditorChanged((editor) => {
                if (editor !== null) this.add(editor.uri);
            }),
        );
        this.register(
            this.fileService.onDidRunOperation((event) => {
                // Stryker disable next-line ConditionalExpression: for Move the service always sets `target`; the check only narrows the type
                if (event.operation === FileOperation.Move && event.target !== undefined) {
                    this.handleMove(event.resource, event.target);
                }
                if (event.operation === FileOperation.Delete) this.handleDelete(event.resource);
            }),
        );
        // The watcher reports a change without its kind: whatever of the touched entries is gone from disk drops out.
        this.register(
            this.fileService.onDidFilesChange((uris) => {
                void this.removeIfMissing(this.entries.filter((entry) => uris.some((uri) => isAffected(entry, uri))));
            }),
        );
        this.register(
            this.state.onDidOpenWorkspace(() => {
                this.load();
            }),
        );
    }

    /** Most recent first. */
    public getHistory(): readonly Uri[] {
        return [...this.entries];
    }

    /**
     * Drops files deleted while nobody watched (between runs, outside the watcher's reach). Lazy, for
     * the picker's show: a `stat` per entry is too much for every keystroke or startup.
     * `true` when something was dropped.
     */
    public removeMissing(): Promise<boolean> {
        return this.removeIfMissing(this.entries);
    }

    private add(uri: Uri): void {
        if (uri.scheme !== "file") return;
        const key = uri.toString();
        const rest = this.entries.filter((entry) => entry.toString() !== key);
        this.entries = [uri, ...rest].slice(0, MAX_HISTORY_ITEMS);
        this.save();
    }

    /** Upstream `HistoryService.move`: the entry keeps its place under the new path. */
    private handleMove(source: Uri, target: Uri): void {
        const seen = new Set<string>();
        const next: Uri[] = [];
        for (const entry of this.entries) {
            const moved = movedResource(entry, source, target) ?? entry;
            const key = moved.toString();
            if (seen.has(key)) continue;
            seen.add(key);
            next.push(moved);
        }
        this.entries = next;
        this.save();
    }

    private handleDelete(resource: Uri): void {
        this.removeIf((entry) => isAffected(entry, resource));
    }

    private async removeIfMissing(candidates: readonly Uri[]): Promise<boolean> {
        const exists = await Promise.all(candidates.map((entry) => this.fileService.exists(entry)));
        const missing = new Set(candidates.filter((_, index) => !exists[index]).map((entry) => entry.toString()));
        return this.removeIf((entry) => missing.has(entry.toString()));
    }

    private removeIf(predicate: (entry: Uri) => boolean): boolean {
        const kept = this.entries.filter((entry) => !predicate(entry));
        if (kept.length === this.entries.length) return false;
        this.entries = kept;
        this.save();
        return true;
    }

    /** The active editor goes on top: it may have been restored before this service came up. */
    private load(): void {
        const stored = this.state.get(EDITOR_HISTORY_STATE);
        this.entries = stored.slice(0, MAX_HISTORY_ITEMS).map((path) => Uri.file(path));
        const active = this.source.getActiveEditor();
        if (active !== null) this.add(active.uri);
    }

    private save(): void {
        this.state.store(
            EDITOR_HISTORY_STATE,
            this.entries.map((entry) => entry.fsPath),
        );
    }
}

/** The resource itself or something under it (a deleted or changed folder). */
function isAffected(entry: Uri, resource: Uri): boolean {
    return movedResource(entry, resource, resource) !== null;
}
