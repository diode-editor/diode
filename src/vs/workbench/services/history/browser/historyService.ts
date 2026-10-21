import * as fs from "node:fs";

import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { Uri } from "../../../../base/common/uri.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";

/** `TextEditorPane` matches structurally; bound by the DI module ({@link HistoryEditorSourceDIToken}). */
export interface IHistoryEditor {
    readonly uri: Uri;
    /** 0-based. */
    readonly primaryCursorLine: number;
    /** 0-based. */
    readonly primaryCursorColumn: number;
    goToPosition(line: number, column?: number): void;
}

export interface IHistoryEditorGroup {
    readonly id: number;
    getPanes(): readonly { readonly uri: Uri }[];
}

export interface IHistoryEditorSource {
    getActiveEditor(): IHistoryEditor | null;
    openUri(uri: Uri, options?: { focus?: boolean }): void;
    /**
     * A non-disk resource only while a content provider serves its scheme
     * (`jdt:`); history records nothing else, since it could not go back there.
     */
    canRestore(uri: Uri): boolean;
    onActiveEditorChanged(listener: (editor: IHistoryEditor | null) => void): IDisposable;
    onDidChangeActiveEditorSelection(listener: (editor: IHistoryEditor) => void): IDisposable;
}

/**
 * A wrapper rather than a "next move is a jump" flag: between `openUri` and `goToPosition`
 * history sees the new editor with the cursor at `0:0`, and the first Go Back would lead there.
 * Pushes exactly two entries, origin and target, bypassing the significance threshold.
 */
export interface IJumpRecorder {
    jump<T>(navigate: () => T): T;
    /** The target may arrive from a scheme provider as a promise (`jdt:`), so the destination is captured afterwards. */
    jumpAsync(navigate: () => Promise<void>): Promise<void>;
}

export const NULL_JUMP_RECORDER: IJumpRecorder = {
    jump: (navigate) => navigate(),
    jumpAsync: (navigate) => navigate(),
};

// Stryker disable StringLiteral: token() returns a new Token and dependency resolution goes by reference to it; the string inside is only a debug label, replacing it has no observable effect
export const HistoryEditorSourceDIToken = token<IHistoryEditorSource>("HistoryEditorSource");

export interface IHistoryGroupsSource {
    readonly activeGroup: IHistoryEditorGroup;
    readonly groups: readonly IHistoryEditorGroup[];
    focusGroup(id: number, options?: { focus?: boolean }): void;
}

export const HistoryGroupsSourceDIToken = token<IHistoryGroupsSource>("HistoryGroupsSource");
export const HistoryServiceDIToken = token<HistoryService>("HistoryService");
export const JumpRecorderDIToken = token<IJumpRecorder>("JumpRecorder");
// Stryker restore StringLiteral

export interface IHistoryEntry {
    readonly uri: Uri;
    /** 0-based. */
    readonly line: number;
    /** 0-based. */
    readonly character: number;
    readonly groupId: number;
}

/** Stack cap, as VS Code `EditorNavigationStack.MAX_STACK_SIZE`. */
const MAX_STACK_SIZE = 50;

/** VS Code `MAX_SELECTION_LINE_DISTANCE`: closer than this updates the current entry instead of adding one. */
const SIGNIFICANT_LINE_DISTANCE = 10;

/**
 * Counterpart of `IHistoryService` + `EditorNavigationStack`. Invariant: `entries[index]`
 * mirrors the live cursor: a small move overwrites the entry instead of growing the stack.
 *
 * A synchronous `suspended` flag is enough: `EditorViewState.selections` synchronously
 * calls `fireCursorChange()`, the event is then forwarded without microtasks; opening a
 * resource and activating a tab are synchronous as well.
 *
 * One stack per app (VS Code has a global one and one per group); the group is stored in the entry.
 */
export class HistoryService extends Disposable implements IWorkbenchContribution, IJumpRecorder {
    public static dependencies = [HistoryEditorSourceDIToken, HistoryGroupsSourceDIToken] as const;

    private readonly entries: IHistoryEntry[] = [];
    /** `-1` while the stack is empty. */
    private index = -1;
    /** While true, implicit producers stay silent: we are moving the cursor ourselves. */
    private suspended = false;

    public constructor(
        private readonly source: IHistoryEditorSource,
        private readonly groups: IHistoryGroupsSource,
    ) {
        super();

        this.register(
            this.source.onActiveEditorChanged((editor) => {
                this.recordEditor(editor);
            }),
        );
        this.register(
            this.source.onDidChangeActiveEditorSelection((editor) => {
                this.recordEditor(editor);
            }),
        );

        // Pick up an editor that became active before the service was created.
        this.recordEditor(this.source.getActiveEditor());
    }

    public get canGoBack(): boolean {
        return this.index > 0;
    }

    public get canGoForward(): boolean {
        return this.index >= 0 && this.index < this.entries.length - 1;
    }

    public getEntries(): readonly IHistoryEntry[] {
        return [...this.entries];
    }

    public get currentIndex(): number {
        return this.index;
    }

    public goBack(): void {
        this.navigate(-1);
    }

    public goForward(): void {
        this.navigate(1);
    }

    public jump<T>(navigate: () => T): T {
        const origin = this.beginJump();
        let result: T;
        try {
            result = navigate();
        } finally {
            this.suspended = false;
        }
        this.endJump(origin);
        return result;
    }

    public async jumpAsync(navigate: () => Promise<void>): Promise<void> {
        const origin = this.beginJump();
        try {
            await navigate();
        } finally {
            this.suspended = false;
        }
        this.endJump(origin);
    }

    private beginJump(): IHistoryEntry | null {
        const origin = this.capture();
        this.suspended = true;
        return origin;
    }

    private endJump(origin: IHistoryEntry | null): void {
        // origin is forced: an intentional jump must not be swallowed by the significance threshold.
        // If the position has not changed, `record` just refreshes the current entry.
        if (origin !== null) this.record(origin, true);
        const target = this.capture();
        if (target !== null) this.record(target, true);
    }

    private navigate(delta: -1 | 1): void {
        this.prune();
        const target = this.index + delta;
        if (target < 0 || target >= this.entries.length) return;
        this.index = target;
        this.restore(this.entries[target]);
    }

    /** Without `suspended` the restore would be recorded as a new entry and cut off the forward tail. */
    private restore(entry: IHistoryEntry): void {
        this.suspended = true;
        try {
            if (entry.groupId !== this.groups.activeGroup.id && this.groupExists(entry.groupId)) {
                this.groups.focusGroup(entry.groupId);
            }
            this.source.openUri(entry.uri, { focus: true });
            const editor = this.source.getActiveEditor();
            /* v8 ignore start -- defensive: openUri either activates the resource's tab or
   creates it; unreadable schemes are filtered out when the entry is captured */
            // Stryker disable next-line ConditionalExpression,LogicalOperator: the branch is unreachable for the same reason as for coverage
            if (editor?.uri.toString() !== entry.uri.toString()) return;
            /* v8 ignore stop */
            editor.goToPosition(entry.line, entry.character);
            // goToPosition clamps the position to the document bounds: record where
            // the cursor actually landed, otherwise a repeated Back gets stuck.
            this.entries[this.index] = {
                uri: entry.uri,
                line: editor.primaryCursorLine,
                character: editor.primaryCursorColumn,
                groupId: this.groups.activeGroup.id,
            };
        } finally {
            this.suspended = false;
        }
    }

    private recordEditor(editor: IHistoryEditor | null): void {
        if (editor === null) return;
        const entry = this.capture(editor);
        if (entry !== null) this.record(entry, false);
    }

    private capture(editor: IHistoryEditor | null = this.source.getActiveEditor()): IHistoryEntry | null {
        if (editor === null) return null;
        // `output:` and snapshot diff sides are skipped: their content is written by the tab owner,
        // not an addressable resource.
        if (!this.source.canRestore(editor.uri)) return null;
        return {
            uri: editor.uri,
            line: editor.primaryCursorLine,
            character: editor.primaryCursorColumn,
            groupId: this.groups.activeGroup.id,
        };
    }

    /** `force` bypasses the significance threshold, but not collapsing an entry into the very same point. */
    private record(entry: IHistoryEntry, force: boolean): void {
        if (this.suspended) return;
        const current = this.entries[this.index] as IHistoryEntry | undefined;
        if (current === undefined) {
            this.push(entry);
            return;
        }
        const sameUri = current.uri.toString() === entry.uri.toString();
        if (sameUri && current.line === entry.line) {
            this.entries[this.index] = entry;
            return;
        }
        if (!force && sameUri && Math.abs(current.line - entry.line) < SIGNIFICANT_LINE_DISTANCE) {
            // Adjacent entries of one file collapse precisely in the replace branch, not
            // in a separate pass over the stack: such a pass would eat the origin of a forced
            // jump of a couple of lines (Go to Definition next to the call site).
            this.entries[this.index] = entry;
            return;
        }
        this.push(entry);
    }

    private push(entry: IHistoryEntry): void {
        this.entries.splice(this.index + 1);
        this.entries.push(entry);
        if (this.entries.length > MAX_STACK_SIZE) this.entries.shift();
        this.index = this.entries.length - 1;
    }

    /**
     * Lazy, only from {@link navigate}: `onDidChangeEditors` fires on every keystroke
     * (via the pane's `onDidChangeContent`), and pruning with `statSync` over fifty entries
     * would run hundreds of times a second. Hence `canGoBack`/`canGoForward` are optimistic.
     */
    private prune(): void {
        const kept: IHistoryEntry[] = [];
        let nextIndex = this.index;
        for (let i = 0; i < this.entries.length; i++) {
            if (this.isReachable(this.entries[i])) {
                kept.push(this.entries[i]);
            } else if (i <= this.index) {
                nextIndex--;
            }
        }
        this.entries.splice(0, this.entries.length, ...kept);
        // The early exit only shortens the path: with an empty kept the general formula below gives
        // Math.min(something non-negative, -1), i.e. the same -1.
        // Stryker disable next-line ConditionalExpression: see above
        if (kept.length === 0) {
            this.index = -1;
            return;
        }
        // The upper clamp cannot fire: no more entries drop after the pointer than there are positions
        // after it, so nextIndex <= kept.length - 1. A safeguard in case the invariant changes.
        // Stryker disable next-line ArithmeticOperator: unreachable clamp branch, see above
        this.index = Math.min(Math.max(nextIndex, 0), kept.length - 1);
    }

    /**
     * A closed file tab stays in history: Back reopens it, as in VS Code.
     * Drops a file deleted from disk (it would open an empty buffer) and a closed
     * `untitled:`, on which `openUri` throws.
     */
    private isReachable(entry: IHistoryEntry): boolean {
        if (entry.uri.scheme === "file") return fs.existsSync(entry.uri.fsPath);
        return this.groups.groups.some((group) =>
            group.getPanes().some((pane) => pane.uri.toString() === entry.uri.toString()),
        );
    }

    private groupExists(id: number): boolean {
        return this.groups.groups.some((group) => group.id === id);
    }
}
