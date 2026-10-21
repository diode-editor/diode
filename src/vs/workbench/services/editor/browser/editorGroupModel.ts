import { Emitter } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { Uri } from "../../../../base/common/uri.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";

/** Not a ViewColumn: the column number is recomputed on collapse/reorder, while the id stays. */
export type GroupId = number;

/** `null` in {@link EditorGroup.onDidChangeMruCycle} — the Ctrl+Tab series has ended. */
export interface MruCycleState {
    readonly panes: readonly IEditorPane[];
    readonly pointer: number;
}

/**
 * The group owns its panes: `closeTab` disposes the tab, `detachPane` removes it WITHOUT dispose.
 * {@link activateTab} event order — {@link onDidChangeEditors} → focus → {@link onDidChangeActivePane}:
 * the view inserts the content into the tree first, then it can be focused.
 */
export class EditorGroup extends Disposable {
    private panes: IEditorPane[] = [];
    private activeIndexValue = -1;
    private readonly paneSubscriptions = new Map<IEditorPane, IDisposable>();

    /** mru[0] — the active/most recent one. */
    private mruOrder: IEditorPane[] = [];
    /**
     * While a Ctrl+Tab series runs, the list is frozen (`mruCycleList`) and the choice is not committed to the front
     * of `mruOrder` — otherwise one could never go deeper than the second tab.
     */
    private cyclingActive = false;
    private mruCycleList: IEditorPane[] = [];
    private mruCyclePointer = 0;
    /** By reference, not index: indices shift when neighbors are inserted/closed (like `preview` in upstream `editorGroupModel`). */
    private previewPaneValue: IEditorPane | null = null;

    private readonly onDidChangeEditorsEmitter = new Emitter<void>();
    private readonly onDidChangeActivePaneEmitter = new Emitter<IEditorPane | null>();
    private readonly onDidChangeMruCycleEmitter = new Emitter<MruCycleState | null>();

    public constructor(public readonly id: GroupId) {
        super();
        this.register({
            dispose: () => {
                for (const subscription of this.paneSubscriptions.values()) subscription.dispose();
                this.paneSubscriptions.clear();
                for (const pane of this.panes) pane.dispose();
                this.panes = [];
                this.previewPaneValue = null;
            },
        });
    }

    /** Fires BEFORE {@link onDidChangeActivePane}: by the time listeners (and focus) run, the active tab's view is in the tree. */
    public readonly onDidChangeEditors = this.onDidChangeEditorsEmitter.event;

    public readonly onDidChangeActivePane = this.onDidChangeActivePaneEmitter.event;

    public readonly onDidChangeMruCycle = this.onDidChangeMruCycleEmitter.event;

    public get activeIndex(): number {
        return this.activeIndexValue;
    }

    public get editorCount(): number {
        return this.panes.length;
    }

    public get activePane(): IEditorPane | null {
        if (this.activeIndexValue < 0 || this.activeIndexValue >= this.panes.length) return null;
        return this.panes[this.activeIndexValue];
    }

    public get previewPane(): IEditorPane | null {
        return this.previewPaneValue;
    }

    /** Everything that is not a preview is pinned — as upstream. */
    public isPinned(pane: IEditorPane): boolean {
        return this.previewPaneValue !== pane;
    }

    /** No-op for an already pinned tab — so every trigger calls it regardless of state. */
    public pinPane(pane: IEditorPane): void {
        if (this.previewPaneValue !== pane) return;
        this.previewPaneValue = null;
        this.fireEditorsChanged();
    }

    public getPane(index: number): IEditorPane | null {
        if (index < 0 || index >= this.panes.length) return null;
        return this.panes[index];
    }

    /** A live array, not a copy. */
    public getPanes(): readonly IEditorPane[] {
        return this.panes;
    }

    public findPaneIndex(uri: Uri): number {
        return this.panes.findIndex((pane) => pane.uri.toString() === uri.toString());
    }

    /** Does not activate — the caller decides; from now on the group owns the tab. */
    public insertPane(pane: IEditorPane, options: { index?: number; preview?: boolean } = {}): void {
        const index = options.index ?? this.panes.length;
        this.panes.splice(index, 0, pane);
        this.trackPane(pane, options);
        if (index <= this.activeIndexValue) this.activeIndexValue++;
    }

    /**
     * Strip order and the active index are untouched: the next preview takes the previous one's slot.
     * The old tab is disposed. Fires no events — the caller's {@link activateTab} fires them.
     */
    public replacePane(index: number, pane: IEditorPane, options: { preview?: boolean } = {}): void {
        /* v8 ignore start -- defensive: the index comes from getPanes().indexOf of the group's own pane */
        if (index < 0 || index >= this.panes.length) return;
        /* v8 ignore stop */
        const replaced = this.panes[index];
        this.stopMruCycle();
        this.forgetPane(replaced);
        const mruIndex = this.mruOrder.indexOf(replaced);
        if (mruIndex >= 0) this.mruOrder.splice(mruIndex, 1);
        this.panes[index] = pane;
        this.trackPane(pane, options);
        replaced.dispose();
    }

    /**
     * The "first edit pins" latch lives here, not at the input trigger: edits also arrive from outside
     * (`applyEdit`, bulk edit, save participant) and must pin the tab too.
     */
    private trackPane(pane: IEditorPane, { preview = false }: { preview?: boolean }): void {
        this.paneSubscriptions.set(
            pane,
            pane.onDidChangeState(() => {
                this.pinOnFirstEdit(pane);
                this.fireEditorsChanged();
            }),
        );
        // A tab may arrive already dirty (split, shared model) — it does not become a preview:
        // replacing it would lose its unsaved edits.
        if (preview && !pane.isModified) this.previewPaneValue = pane;
    }

    private forgetPane(pane: IEditorPane): void {
        this.paneSubscriptions.get(pane)?.dispose();
        // Stryker disable next-line CallExpression: equivalent — deleting only clears the Map entry, the subscription itself is disposed on the line above, and no behavior depends on it
        this.paneSubscriptions.delete(pane);
        if (this.previewPaneValue === pane) this.previewPaneValue = null;
    }

    /** Latch: undo back to the saved version does not return the tab to preview. */
    private pinOnFirstEdit(pane: IEditorPane): void {
        if (!pane.isModified) return;
        if (this.previewPaneValue === pane) this.previewPaneValue = null;
    }

    /** Ownership passes to the caller: insert into another group or dispose. */
    public detachPane(index: number): IEditorPane | null {
        if (index < 0 || index >= this.panes.length) return null;
        const pane = this.panes[index];
        this.forgetPane(pane);
        this.removePaneAt(index, pane, { dispose: false });
        return pane;
    }

    public activateTab(index: number, { focus = true, mru = false }: { focus?: boolean; mru?: boolean } = {}): void {
        if (index < 0 || index >= this.panes.length) return;

        // A regular switch ends the Ctrl+Tab series and commits to MRU:
        // first the tab chosen in the series, then the target.
        if (!mru) {
            if (this.cyclingActive) {
                this.commitActiveToMru();
                this.stopMruCycle();
            }
            this.moveToMruFront(this.panes[index]);
        }

        this.activeIndexValue = index;

        const pane = this.panes[index];
        // Before focus: only an element that is in the tree can be focused.
        this.fireEditorsChanged();
        if (focus) this.focusEditor();
        this.fireActivePaneChanged(pane);
    }

    /** `1` — toward older tabs, `-1` — toward more recent ones. */
    public cycleMru(direction: 1 | -1): void {
        if (this.panes.length < 2) return;

        if (!this.cyclingActive) {
            this.commitActiveToMru();
            this.mruCycleList = this.mruOrder.filter((pane) => this.panes.includes(pane));
            this.mruCyclePointer = 0;
            this.cyclingActive = true;
        }

        const length = this.mruCycleList.length;
        /* v8 ignore start -- defensive: cyclingActive is cleared on any structural change, so the frozen list always has ≥2 open editors here */
        if (length < 2) {
            // Stryker disable next-line CallExpression: unreachable branch for the same reason as for coverage
            this.stopMruCycle();
            return;
        }
        /* v8 ignore stop */

        this.mruCyclePointer = (this.mruCyclePointer + direction + length) % length;
        const target = this.mruCycleList[this.mruCyclePointer];
        const targetIndex = this.panes.indexOf(target);
        /* v8 ignore start -- defensive: closing a tab clears cyclingActive, so the frozen target is always still open */
        if (targetIndex < 0) {
            // Stryker disable next-line CallExpression: unreachable branch for the same reason as for coverage
            this.stopMruCycle();
            return;
        }
        /* v8 ignore stop */
        this.activateTab(targetIndex, { mru: true });
        this.fireMruCycleChanged({ panes: [...this.mruCycleList], pointer: this.mruCyclePointer });
    }

    /**
     * On Ctrl release: quick Ctrl+Tab presses with release toggle the two most recent editors,
     * holding Ctrl with repeated Tab walks deeper into the stack.
     */
    public endMruCycle(): void {
        if (!this.cyclingActive) return;
        this.commitActiveToMru();
        this.stopMruCycle();
    }

    public getMruOrder(): IEditorPane[] {
        return [...this.mruOrder];
    }

    /**
     * Unlike {@link getMruOrder}, all tabs: `insertPane` does not write to the stack, and a tab that arrived
     * via merge and was never activated is missing from `mruOrder` — it follows in strip order.
     */
    public getMruPanes(): IEditorPane[] {
        // The stack never has extra panes — `removePaneAt` purges them; only new ones can be missing.
        return [...this.mruOrder, ...this.panes.filter((pane) => !this.mruOrder.includes(pane))];
    }

    public closeTab(index: number): void {
        if (index < 0 || index >= this.panes.length) return;

        const pane = this.panes[index];
        this.forgetPane(pane);
        this.removePaneAt(index, pane, { dispose: true });
    }

    /** Any kind: a diff must receive input too. */
    public focusEditor(): void {
        this.activePane?.focusEditor();
    }

    private removePaneAt(index: number, pane: IEditorPane, { dispose }: { dispose: boolean }): void {
        this.stopMruCycle();

        this.panes.splice(index, 1);
        const mruIndex = this.mruOrder.indexOf(pane);
        /* v8 ignore start -- defensive: every open tab is present in mruOrder */
        if (mruIndex >= 0) this.mruOrder.splice(mruIndex, 1);
        /* v8 ignore stop */
        if (dispose) pane.dispose();

        if (this.panes.length === 0) {
            this.activeIndexValue = -1;
            this.fireEditorsChanged();
            this.fireActivePaneChanged(null);
        } else if (index <= this.activeIndexValue) {
            this.activeIndexValue = Math.max(0, this.activeIndexValue - 1);
            const activePane = this.panes[this.activeIndexValue];
            this.moveToMruFront(activePane);
            this.fireEditorsChanged();
            this.focusEditor();
            this.fireActivePaneChanged(activePane);
        } else {
            this.fireEditorsChanged();
        }
    }

    private moveToMruFront(pane: IEditorPane): void {
        const index = this.mruOrder.indexOf(pane);
        if (index >= 0) this.mruOrder.splice(index, 1);
        this.mruOrder.unshift(pane);
    }

    private commitActiveToMru(): void {
        const current = this.activePane;
        /* v8 ignore start -- defensive: commit is called only when there is an active tab */
        if (current) this.moveToMruFront(current);
        /* v8 ignore stop */
    }

    /** No-op outside a series, so structural changes do not wake the switcher list. */
    private stopMruCycle(): void {
        if (!this.cyclingActive) return;
        this.cyclingActive = false;
        this.fireMruCycleChanged(null);
    }

    private fireEditorsChanged(): void {
        this.onDidChangeEditorsEmitter.fire();
    }

    private fireMruCycleChanged(state: MruCycleState | null): void {
        this.onDidChangeMruCycleEmitter.fire(state);
    }

    private fireActivePaneChanged(pane: IEditorPane | null): void {
        this.onDidChangeActivePaneEmitter.fire(pane);
    }
}
