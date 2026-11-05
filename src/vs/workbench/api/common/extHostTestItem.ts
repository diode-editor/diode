import type * as vscode from "vscode";

import { rangeFrom } from "./extHostTypeConverters.ts";
import { type IWireTestItem, type IWireTestItemUpdate, TEST_ID_DELIMITER } from "./testingWireTypes.ts";

// Upstream `extHostTestItem.ts` + `createTestItemChildren` of `testItemCollection.ts`: an item tells its
// collection about every change through the listener the collection hangs on it.

export type TestItemChildOp =
    | { readonly op: "upsert"; readonly item: TestItemImpl }
    | { readonly op: "removeChild"; readonly item: TestItemImpl };

export type TestItemEvent =
    | TestItemChildOp
    | { readonly op: "bulk"; readonly ops: readonly TestItemChildOp[] }
    | { readonly op: "setProp"; readonly update: NonNullable<IWireTestItemUpdate["item"]> }
    | { readonly op: "updateCanResolveChildren" };

/** Upstream `IExtHostTestItemApi`: hidden from the extension, the item's own fields are all it sees. */
export interface ITestItemApi {
    readonly controllerId: string;
    parent: TestItemImpl | undefined;
    listener: ((event: TestItemEvent) => void) | undefined;
}

/** Upstream `Convert.TestTag.namespace`. */
export function namespaceTestTag(controllerId: string, tagId: string): string {
    return controllerId + TEST_ID_DELIMITER + tagId;
}

function errorText(error: string | vscode.MarkdownString | undefined): string | null {
    const text = typeof error === "string" ? error : error?.value;
    return text === undefined || text === "" ? null : text;
}

function sameTags(a: readonly vscode.TestTag[], b: readonly vscode.TestTag[]): boolean {
    return a.length === b.length && a.every((tag) => b.some((other) => other.id === tag.id));
}

function sameRange(a: vscode.Range | undefined, b: vscode.Range | undefined): boolean {
    return a === b || (a !== undefined && b !== undefined && a.isEqual(b));
}

export class DuplicateTestItemError extends Error {
    public constructor(id: string) {
        super(`Attempted to insert a duplicate test item ID ${id}`);
    }
}

export class InvalidTestItemError extends Error {
    public constructor(id: string) {
        super(`TestItem with ID "${id}" is invalid. Make sure to create it from the createTestItem method.`);
    }
}

export class MixedTestItemController extends Error {
    public constructor(id: string, ctrlA: string, ctrlB: string) {
        super(
            `TestItem with ID "${id}" is from controller "${ctrlA}" and cannot be added as a child of an item from controller "${ctrlB}".`,
        );
    }
}

function checkItem(item: vscode.TestItem): TestItemImpl {
    if (!(item instanceof TestItemImpl)) throw new InvalidTestItemError(item.id);
    return item;
}

/** Upstream `createTestItemChildren`. */
class TestItemChildren implements vscode.TestItemCollection {
    private mapped = new Map<string, TestItemImpl>();

    public constructor(private readonly api: ITestItemApi) {}

    public get size(): number {
        return this.mapped.size;
    }

    public replace(items: readonly vscode.TestItem[]): void {
        const next = new Map<string, TestItemImpl>();
        const ops: TestItemChildOp[] = [];
        for (const raw of items) {
            const item = checkItem(raw);
            const itemController = TestItemImpl.apiOf(item).controllerId;
            if (itemController !== this.api.controllerId) {
                throw new MixedTestItemController(item.id, itemController, this.api.controllerId);
            }
            if (next.has(item.id)) throw new DuplicateTestItemError(item.id);
            next.set(item.id, item);
            ops.push({ op: "upsert", item });
        }
        for (const [id, item] of this.mapped) {
            if (!next.has(id)) ops.push({ op: "removeChild", item });
        }
        this.api.listener?.({ op: "bulk", ops });
        // After the event, as upstream: a throwing listener saves nothing.
        this.mapped = next;
    }

    public forEach(
        callback: (item: vscode.TestItem, collection: vscode.TestItemCollection) => unknown,
        thisArg?: unknown,
    ): void {
        for (const item of this.mapped.values()) callback.call(thisArg, item, this);
    }

    public add(raw: vscode.TestItem): void {
        const item = checkItem(raw);
        this.mapped.set(item.id, item);
        this.api.listener?.({ op: "upsert", item });
    }

    public delete(itemId: string): void {
        const item = this.mapped.get(itemId);
        if (item === undefined) return;
        this.mapped.delete(itemId);
        this.api.listener?.({ op: "removeChild", item });
    }

    public get(itemId: string): TestItemImpl | undefined {
        return this.mapped.get(itemId);
    }

    public [Symbol.iterator](): Iterator<[id: string, testItem: TestItemImpl]> {
        return this.mapped.entries();
    }
}

/** Upstream `TestItemImpl`; a changed field reaches the collection as an event. */
export class TestItemImpl implements vscode.TestItem {
    public readonly children: TestItemChildren;
    private readonly api: ITestItemApi;
    private labelValue: string;
    private descriptionValue: string | undefined = undefined;
    private sortTextValue: string | undefined = undefined;
    private busyValue = false;
    private errorValue: string | vscode.MarkdownString | undefined = undefined;
    private canResolveChildrenValue = false;
    private tagsValue: readonly vscode.TestTag[] = [];
    private rangeValue: vscode.Range | undefined = undefined;

    public constructor(
        controllerId: string,
        public readonly id: string,
        label: string,
        public readonly uri: vscode.Uri | undefined,
    ) {
        if (id.includes(TEST_ID_DELIMITER))
            throw new Error(`Test IDs may not include the ${JSON.stringify(id)} symbol`);
        this.api = { controllerId, parent: undefined, listener: undefined };
        this.labelValue = label;
        this.children = new TestItemChildren(this.api);
    }

    /** Upstream `getPrivateApiFor`: a static member, so the extension does not see it on the item. */
    public static apiOf(item: TestItemImpl): ITestItemApi {
        return item.api;
    }

    public get parent(): TestItemImpl | undefined {
        const parent = this.api.parent;
        return parent instanceof TestItemRootImpl ? undefined : parent;
    }

    public get label(): string {
        return this.labelValue;
    }

    public set label(value: string) {
        if (value === this.labelValue) return;
        this.labelValue = value;
        this.api.listener?.({ op: "setProp", update: { label: value } });
    }

    public get description(): string | undefined {
        return this.descriptionValue;
    }

    public set description(value: string | undefined) {
        if (value === this.descriptionValue) return;
        this.descriptionValue = value;
        this.api.listener?.({ op: "setProp", update: { description: value ?? null } });
    }

    public get sortText(): string | undefined {
        return this.sortTextValue;
    }

    public set sortText(value: string | undefined) {
        if (value === this.sortTextValue) return;
        this.sortTextValue = value;
        this.api.listener?.({ op: "setProp", update: { sortText: value ?? null } });
    }

    public get busy(): boolean {
        return this.busyValue;
    }

    public set busy(value: boolean) {
        if (value === this.busyValue) return;
        this.busyValue = value;
        this.api.listener?.({ op: "setProp", update: { busy: value } });
    }

    public get error(): string | vscode.MarkdownString | undefined {
        return this.errorValue;
    }

    public set error(value: string | vscode.MarkdownString | undefined) {
        if (value === this.errorValue) return;
        this.errorValue = value;
        this.api.listener?.({ op: "setProp", update: { error: errorText(value) } });
    }

    public get canResolveChildren(): boolean {
        return this.canResolveChildrenValue;
    }

    public set canResolveChildren(value: boolean) {
        if (value === this.canResolveChildrenValue) return;
        this.canResolveChildrenValue = value;
        this.api.listener?.({ op: "updateCanResolveChildren" });
    }

    public get tags(): readonly vscode.TestTag[] {
        return this.tagsValue;
    }

    public set tags(value: readonly vscode.TestTag[]) {
        if (sameTags(value, this.tagsValue)) return;
        this.tagsValue = value;
        const { controllerId } = this.api;
        this.api.listener?.({
            op: "setProp",
            update: { tags: value.map((tag) => namespaceTestTag(controllerId, tag.id)) },
        });
    }

    public get range(): vscode.Range | undefined {
        return this.rangeValue;
    }

    public set range(value: vscode.Range | undefined) {
        if (sameRange(value, this.rangeValue)) return;
        this.rangeValue = value;
        this.api.listener?.({ op: "setProp", update: { range: rangeFrom(value) } });
    }
}

/** Upstream `TestItemRootImpl`: the controller's own node, its children are `controller.items`. */
export class TestItemRootImpl extends TestItemImpl {
    public constructor(controllerId: string, label: string) {
        super(controllerId, controllerId, label, undefined);
    }
}

/** Upstream `Convert.TestItem.from`. */
export function toWireTestItem(item: TestItemImpl, extId: string): IWireTestItem {
    const { controllerId } = TestItemImpl.apiOf(item);
    return {
        extId,
        label: item.label,
        tags: item.tags.map((tag) => namespaceTestTag(controllerId, tag.id)),
        busy: item.busy,
        uri: item.uri?.toString(),
        range: rangeFrom(item.range),
        description: item.description ?? null,
        error: errorText(item.error),
        sortText: item.sortText ?? null,
    };
}
