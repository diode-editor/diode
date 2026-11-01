import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { ExtHostQuickInput } from "./extHostQuickInput.ts";
import { type AsRelativePath, withResourceFields } from "./quickInputResource.ts";
import { EventEmitter, QuickPickItemKind } from "./vscodeTypes.ts";
import type { IWireQuickPickEvent, IWireQuickPickSessionItem } from "./wireTypes.ts";

/**
 * Upstream `ExtHostQuickPick`. An item handle is its index in the extension's `items`.
 */
export class ExtHostQuickPick<T extends vscode.QuickPickItem> extends ExtHostQuickInput implements vscode.QuickPick<T> {
    private itemsValue: readonly T[] = [];
    private canSelectManyValue = false;
    private matchOnDescriptionValue = true;
    private matchOnDetailValue = true;
    private keepScrollPositionValue = false;
    private activeItemsValue: readonly T[] = [];
    private selectedItemsValue: readonly T[] = [];

    private readonly onDidChangeActiveEmitter = new EventEmitter<readonly T[]>();
    private readonly onDidChangeSelectionEmitter = new EventEmitter<readonly T[]>();
    private readonly onDidTriggerItemButtonEmitter = new EventEmitter<vscode.QuickPickItemButtonEvent<T>>();

    public readonly onDidChangeActive = this.onDidChangeActiveEmitter.event;
    public readonly onDidChangeSelection = this.onDidChangeSelectionEmitter.event;
    /** Item buttons are not drawn, so it never fires; the member exists because extensions subscribe to it. */
    public readonly onDidTriggerItemButton = this.onDidTriggerItemButtonEmitter.event;

    public constructor(
        rpc: SubprocessRpc,
        handle: number,
        onDispose: () => void,
        private readonly asRelativePath: AsRelativePath = (uri) => uri.fsPath,
    ) {
        super(rpc, handle, onDispose);
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

    public override acceptEvent(event: IWireQuickPickEvent): void {
        switch (event.kind) {
            case "changeActive":
                this.activeItemsValue = this.toItems(event.items);
                this.onDidChangeActiveEmitter.fire(this.activeItemsValue);
                break;
            case "changeSelection":
                this.selectedItemsValue = this.toItems(event.items);
                this.onDidChangeSelectionEmitter.fire(this.selectedItemsValue);
                break;
            default:
                super.acceptEvent(event);
                break;
        }
    }

    protected override disposeEmitters(): void {
        this.onDidChangeActiveEmitter.dispose();
        this.onDidChangeSelectionEmitter.dispose();
        this.onDidTriggerItemButtonEmitter.dispose();
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
}
