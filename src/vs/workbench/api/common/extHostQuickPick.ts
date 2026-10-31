import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { type AsRelativePath, withResourceFields } from "./quickInputResource.ts";
import { EventEmitter, QuickPickItemKind } from "./vscodeTypes.ts";
import type { IWireQuickPickEvent, IWireQuickPickSessionItem } from "./wireTypes.ts";

/** `null` means "reset to undefined". */
type PendingUpdate = Record<string, unknown>;

/**
 * Upstream `ExtHostQuickPick`: an own copy of the state; setters accumulate a diff while
 * the picker is visible, and it goes to the host on a next-tick timer; `show()`/`hide()` send
 * what has accumulated immediately. An item handle is its index in the extension's `items`.
 * `busy`, `enabled`, `ignoreFocusOut` are stored but not sent to the host: the overlay has none of them.
 */
export class ExtHostQuickPick<T extends vscode.QuickPickItem> implements vscode.QuickPick<T> {
    // Defaults follow upstream even where d.ts says otherwise: until assigned,
    // the host defaults apply.
    public enabled = true;
    public busy = false;
    public ignoreFocusOut = true;

    private titleValue: string | undefined;
    private stepValue: number | undefined;
    private totalStepsValue: number | undefined;
    private valueValue = "";
    private placeholderValue: string | undefined;
    private promptValue: string | undefined;
    private itemsValue: readonly T[] = [];
    private canSelectManyValue = false;
    private matchOnDescriptionValue = true;
    private matchOnDetailValue = true;
    private keepScrollPositionValue = false;
    private activeItemsValue: readonly T[] = [];
    private selectedItemsValue: readonly T[] = [];

    private visible = false;
    /** Hiding is reported to the extension once per show (upstream, #135747). */
    private expectingHide = false;
    private disposed = false;
    private pending: PendingUpdate = {};
    private updateTimer: ReturnType<typeof setTimeout> | undefined;

    private readonly onDidChangeValueEmitter = new EventEmitter<string>();
    private readonly onDidAcceptEmitter = new EventEmitter<void>();
    private readonly onDidChangeActiveEmitter = new EventEmitter<readonly T[]>();
    private readonly onDidChangeSelectionEmitter = new EventEmitter<readonly T[]>();
    private readonly onDidHideEmitter = new EventEmitter<void>();

    public readonly onDidChangeValue = this.onDidChangeValueEmitter.event;
    public readonly onDidAccept = this.onDidAcceptEmitter.event;
    public readonly onDidChangeActive = this.onDidChangeActiveEmitter.event;
    public readonly onDidChangeSelection = this.onDidChangeSelectionEmitter.event;
    public readonly onDidHide = this.onDidHideEmitter.event;

    public constructor(
        private readonly rpc: SubprocessRpc,
        public readonly handle: number,
        private readonly onDispose: () => void,
        private readonly asRelativePath: AsRelativePath = (uri) => uri.fsPath,
    ) {}

    public get title(): string | undefined {
        return this.titleValue;
    }
    public set title(title: string | undefined) {
        this.titleValue = title;
        this.update({ title });
    }

    public get step(): number | undefined {
        return this.stepValue;
    }
    public set step(step: number | undefined) {
        this.stepValue = step;
        this.update({ step });
    }

    public get totalSteps(): number | undefined {
        return this.totalStepsValue;
    }
    public set totalSteps(totalSteps: number | undefined) {
        this.totalStepsValue = totalSteps;
        this.update({ totalSteps });
    }

    public get value(): string {
        return this.valueValue;
    }
    public set value(value: string) {
        this.valueValue = value;
        this.update({ value });
    }

    public get placeholder(): string | undefined {
        return this.placeholderValue;
    }
    public set placeholder(placeholder: string | undefined) {
        this.placeholderValue = placeholder;
        this.update({ placeholder });
    }

    public get prompt(): string | undefined {
        return this.promptValue;
    }
    public set prompt(prompt: string | undefined) {
        this.promptValue = prompt;
        this.update({ prompt });
    }

    public get items(): readonly T[] {
        return this.itemsValue;
    }
    public set items(items: readonly T[]) {
        // A copy: handles have already gone to the host for this item set.
        this.itemsValue = items.slice();
        const wire: IWireQuickPickSessionItem[] = [];
        for (const [handle, item] of items.entries()) {
            // Our list does not draw separators. Compared as a number: the extension's enum
            // comes from its own copy of d.ts.
            if ((item.kind as number | undefined) === QuickPickItemKind.Separator) continue;
            wire.push({
                handle,
                ...withResourceFields(item, this.asRelativePath),
                detail: item.detail,
                alwaysShow: item.alwaysShow === true,
            });
        }
        this.update({ items: wire });
    }

    public get canSelectMany(): boolean {
        return this.canSelectManyValue;
    }
    public set canSelectMany(canSelectMany: boolean) {
        this.canSelectManyValue = canSelectMany;
        this.update({ canSelectMany });
    }

    public get matchOnDescription(): boolean {
        return this.matchOnDescriptionValue;
    }
    public set matchOnDescription(matchOnDescription: boolean) {
        this.matchOnDescriptionValue = matchOnDescription;
        this.update({ matchOnDescription });
    }

    public get matchOnDetail(): boolean {
        return this.matchOnDetailValue;
    }
    public set matchOnDetail(matchOnDetail: boolean) {
        this.matchOnDetailValue = matchOnDetail;
        this.update({ matchOnDetail });
    }

    public get keepScrollPosition(): boolean {
        return this.keepScrollPositionValue;
    }
    public set keepScrollPosition(keepScrollPosition: boolean) {
        this.keepScrollPositionValue = keepScrollPosition;
        this.update({ keepScrollPosition });
    }

    public get activeItems(): readonly T[] {
        return this.activeItemsValue;
    }
    public set activeItems(activeItems: readonly T[]) {
        this.activeItemsValue = this.ownItems(activeItems);
        this.update({ activeItems: this.toHandles(this.activeItemsValue) });
    }

    public get selectedItems(): readonly T[] {
        return this.selectedItemsValue;
    }
    public set selectedItems(selectedItems: readonly T[]) {
        this.selectedItemsValue = this.ownItems(selectedItems);
        this.update({ selectedItems: this.toHandles(this.selectedItemsValue) });
    }

    public show(): void {
        this.visible = true;
        this.expectingHide = true;
        this.update({ visible: true });
    }

    public hide(): void {
        this.visible = false;
        this.update({ visible: false });
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.fireDidHide();
        clearTimeout(this.updateTimer);
        this.onDidChangeValueEmitter.dispose();
        this.onDidAcceptEmitter.dispose();
        this.onDidChangeActiveEmitter.dispose();
        this.onDidChangeSelectionEmitter.dispose();
        this.onDidHideEmitter.dispose();
        this.onDispose();
        this.rpc.notify("window.quickPick.dispose", { handle: this.handle });
    }

    public acceptEvent(event: IWireQuickPickEvent): void {
        switch (event.kind) {
            case "changeValue":
                this.valueValue = event.value;
                this.onDidChangeValueEmitter.fire(event.value);
                break;
            case "accept":
                this.onDidAcceptEmitter.fire();
                break;
            case "changeActive":
                this.activeItemsValue = this.toItems(event.items);
                this.onDidChangeActiveEmitter.fire(this.activeItemsValue);
                break;
            case "changeSelection":
                this.selectedItemsValue = this.toItems(event.items);
                this.onDidChangeSelectionEmitter.fire(this.selectedItemsValue);
                break;
            case "hide":
                // Visibility is NOT cleared, as upstream: the response to a previous hide() may
                // arrive during the next show. The cost: after Escape `dispose()` fires a second onDidHide.
                this.fireDidHide();
                break;
        }
    }

    private fireDidHide(): void {
        if (!this.expectingHide) return;
        // Upstream: show→hide→show→hide = two events.
        this.expectingHide = this.visible;
        this.onDidHideEmitter.fire();
    }

    private ownItems(items: readonly T[]): T[] {
        return items.filter((item) => this.itemsValue.includes(item));
    }

    private toHandles(items: readonly T[]): number[] {
        return items.map((item) => this.itemsValue.indexOf(item));
    }

    /** Late handles (not from the current `items`) are dropped. */
    private toItems(handles: readonly number[]): T[] {
        return handles.flatMap((handle) => {
            const item = this.itemsValue[handle] as T | undefined;
            return item === undefined ? [] : [item];
        });
    }

    private update(properties: PendingUpdate): void {
        if (this.disposed) return;
        for (const [key, value] of Object.entries(properties)) {
            this.pending[key] = value === undefined ? null : value;
        }
        if ("visible" in this.pending) {
            clearTimeout(this.updateTimer);
            this.updateTimer = undefined;
            this.dispatchUpdate();
        } else if (this.visible && this.updateTimer === undefined) {
            this.updateTimer = setTimeout(() => {
                this.updateTimer = undefined;
                this.dispatchUpdate();
            }, 0);
        }
    }

    private dispatchUpdate(): void {
        this.rpc.notify("window.quickPick.update", { ...this.pending, handle: this.handle });
        this.pending = {};
    }
}
