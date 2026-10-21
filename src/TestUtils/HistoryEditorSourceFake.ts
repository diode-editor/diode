import type { IDisposable } from "../vs/base/common/lifecycle.ts";
import { Uri } from "../vs/base/common/uri.ts";
import type {
    IHistoryEditor,
    IHistoryEditorGroup,
    IHistoryEditorSource,
} from "../vs/workbench/services/history/browser/historyService.ts";

const UNBOUNDED = Number.MAX_SAFE_INTEGER;

class FakeHistoryPane implements IHistoryEditor {
    public line = 0;
    public character = 0;

    public constructor(
        public readonly uri: Uri,
        private readonly lineCount: number,
        private readonly onMove: (pane: FakeHistoryPane) => void,
    ) {}

    public get primaryCursorLine(): number {
        return this.line;
    }

    public get primaryCursorColumn(): number {
        return this.character;
    }

    public goToPosition(line: number, column = 0): void {
        this.line = Math.min(line, this.lineCount - 1);
        this.character = column;
        this.onMove(this);
    }
}

class FakeHistoryGroup implements IHistoryEditorGroup {
    public readonly panes: FakeHistoryPane[] = [];
    public active: FakeHistoryPane | null = null;

    public constructor(public readonly id: number) {}

    public getPanes(): readonly FakeHistoryPane[] {
        return this.panes;
    }
}

/**
 * The `EditorService` behaviors history depends on: synchronous events, a tab per resource,
 * and refusing to open a closed non-`file:` resource (the real `openUri` throws).
 */
export class FakeHistoryEditorSource implements IHistoryEditorSource {
    /** No entry — `goToPosition` does not clamp. */
    public readonly lineCounts = new Map<string, number>();
    public readonly openUriCalls: string[] = [];
    public readonly providedSchemes = new Set<string>();
    public readonly focusGroupCalls: number[] = [];

    private readonly groupList: FakeHistoryGroup[] = [new FakeHistoryGroup(1)];
    private activeGroupValue: FakeHistoryGroup = this.groupList[0];
    private readonly activeListeners = new Set<(editor: IHistoryEditor | null) => void>();
    private readonly selectionListeners = new Set<(editor: IHistoryEditor) => void>();

    public get groups(): readonly IHistoryEditorGroup[] {
        return this.groupList;
    }

    public get activeGroup(): IHistoryEditorGroup {
        return this.activeGroupValue;
    }

    public getActiveEditor(): IHistoryEditor | null {
        return this.activeGroupValue.active;
    }

    public openUri(uri: Uri): void {
        this.openUriCalls.push(uri.toString());
        const existing = this.findPane(this.activeGroupValue, uri.toString());
        // History never gets here (`isReachable`); throw so a miss fails the test instead of passing silently.
        if (existing === null && uri.scheme !== "file") {
            throw new Error(`openUri: resource ${uri.toString()} is closed and cannot be restored`);
        }
        this.activate(existing ?? this.insertPane(uri));
    }

    public canRestore(uri: Uri): boolean {
        return uri.scheme === "file" || uri.scheme === "untitled" || this.providedSchemes.has(uri.scheme);
    }

    public focusGroup(id: number): void {
        this.focusGroupCalls.push(id);
        for (const group of this.groupList) {
            if (group.id !== id) continue;
            this.activeGroupValue = group;
            this.fireActive(group.active);
        }
    }

    public onActiveEditorChanged(listener: (editor: IHistoryEditor | null) => void): IDisposable {
        this.activeListeners.add(listener);
        return {
            dispose: () => {
                this.activeListeners.delete(listener);
            },
        };
    }

    public onDidChangeActiveEditorSelection(listener: (editor: IHistoryEditor) => void): IDisposable {
        this.selectionListeners.add(listener);
        return {
            dispose: () => {
                this.selectionListeners.delete(listener);
            },
        };
    }

    /** Bypasses the scheme gate of {@link openUri}. */
    public open(uri: string): void {
        this.activate(this.findPane(this.activeGroupValue, uri) ?? this.insertPane(Uri.parse(uri)));
    }

    public moveCaret(line: number, character = 0): void {
        this.activeGroupValue.active?.goToPosition(line, character);
    }

    public close(uri: string): void {
        const group = this.activeGroupValue;
        const index = group.panes.findIndex((pane) => pane.uri.toString() === uri);
        const wasActive = group.active === group.panes[index];
        group.panes.splice(index, 1);
        if (!wasActive) return;
        group.active = group.panes[group.panes.length - 1] ?? null;
        this.fireActive(group.active);
    }

    public addGroup(id: number): void {
        const group = new FakeHistoryGroup(id);
        this.groupList.push(group);
        this.activeGroupValue = group;
        this.fireActive(null);
    }

    public removeGroup(id: number): void {
        const index = this.groupList.findIndex((group) => group.id === id);
        this.groupList.splice(index, 1);
        this.activeGroupValue = this.groupList[0];
    }

    public caret(): { uri: string; line: number; character: number } | null {
        const active = this.activeGroupValue.active;
        if (active === null) return null;
        return { uri: active.uri.toString(), line: active.line, character: active.character };
    }

    private findPane(group: FakeHistoryGroup, uri: string): FakeHistoryPane | null {
        return group.panes.find((pane) => pane.uri.toString() === uri) ?? null;
    }

    private insertPane(uri: Uri): FakeHistoryPane {
        const pane = new FakeHistoryPane(uri, this.lineCounts.get(uri.toString()) ?? UNBOUNDED, (moved) => {
            this.fireSelection(moved);
        });
        this.activeGroupValue.panes.push(pane);
        return pane;
    }

    private activate(pane: FakeHistoryPane): void {
        this.activeGroupValue.active = pane;
        this.fireActive(pane);
    }

    private fireActive(editor: IHistoryEditor | null): void {
        for (const listener of [...this.activeListeners]) listener(editor);
    }

    private fireSelection(editor: IHistoryEditor): void {
        for (const listener of [...this.selectionListeners]) listener(editor);
    }
}
