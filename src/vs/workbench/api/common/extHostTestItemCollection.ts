import { RunOnceScheduler } from "../../../base/common/async.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";

import { type TestItemEvent, TestItemImpl, TestItemRootImpl, toWireTestItem } from "./extHostTestItem.ts";
import {
    type IWireTestItem,
    type IWireTestItemUpdate,
    TestDiffOpType,
    TestId,
    TestItemExpandState,
    type WireTestsDiffOp,
} from "./testingWireTypes.ts";

// Upstream `TestItemCollection` (`contrib/testing/common/testItemCollection.ts`): the controller's tree as the
// host knows it, and the diffs that keep the host in step.

interface ICollectionItem {
    readonly fullId: string;
    actual: TestItemImpl;
    expand: TestItemExpandState;
    /** Levels below this item to expand once it resolves; may be infinite. */
    expandLevels?: number;
    /** Set while and after `resolveHandler` runs for the item. */
    resolve?: { readonly done: Promise<void>; settled: boolean };
}

type ItemPatch = NonNullable<IWireTestItemUpdate["item"]>;

/** Mutable while queued: updates merge into the previous op of the same test. */
type PendingOp =
    | { readonly op: typeof TestDiffOpType.Add; readonly item: { expand: TestItemExpandState; item: IWireTestItem } }
    | {
          readonly op: typeof TestDiffOpType.Update;
          readonly item: { extId: string; expand?: TestItemExpandState; item?: ItemPatch };
      }
    | { readonly op: typeof TestDiffOpType.Remove; readonly itemId: string };

/** Upstream `diffableProps`: the fields an upsert of a new instance compares. */
const DIFFABLE_FIELDS = ["range", "busy", "label", "description", "error", "sortText", "tags"] as const;

function sameValue(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function diffTestItems(a: IWireTestItem, b: IWireTestItem): ItemPatch | undefined {
    let output: Record<string, unknown> | undefined;
    for (const key of DIFFABLE_FIELDS) {
        if (!sameValue(a[key], b[key])) {
            output ??= {};
            output[key] = b[key];
        }
    }
    return output as ItemPatch | undefined;
}

/** Upstream's 200 ms `debounceSendDiff`. */
export const TEST_DIFF_DEBOUNCE_MS = 200;

export interface ITestItemCollectionOptions {
    readonly root: TestItemRootImpl;
    publishDiff(diff: readonly WireTestsDiffOp[]): void;
    /** A throwing or rejecting `resolveHandler`. */
    logError(message: string): void;
}

export class ExtHostTestItemCollection implements IDisposable {
    public readonly tree = new Map<string, ICollectionItem>();
    private readonly debounceSendDiff = new RunOnceScheduler(() => {
        this.flushDiff();
    }, TEST_DIFF_DEBOUNCE_MS);
    private diff: PendingOp[] = [];
    private resolveHandlerValue: ((item: TestItemImpl | undefined) => Thenable<void> | void) | undefined;

    public constructor(private readonly options: ITestItemCollectionOptions) {
        options.root.canResolveChildren = true;
        this.upsertItem(options.root, undefined);
    }

    public get root(): TestItemRootImpl {
        return this.options.root;
    }

    public get resolveHandler(): ((item: TestItemImpl | undefined) => Thenable<void> | void) | undefined {
        return this.resolveHandlerValue;
    }

    public set resolveHandler(handler: ((item: TestItemImpl | undefined) => Thenable<void> | void) | undefined) {
        this.resolveHandlerValue = handler;
        for (const internal of this.tree.values()) this.updateExpandability(internal);
    }

    /**
     * Expands the test and `levels` of children below it: `0` — only this one, `Infinity` — all. Resolves once
     * every handler it called has settled.
     */
    public async expand(testId: string, levels: number): Promise<void> {
        const internal = this.tree.get(testId);
        if (internal === undefined) return;
        if (internal.expandLevels === undefined || levels > internal.expandLevels) internal.expandLevels = levels;
        if (internal.expand === TestItemExpandState.Expandable) {
            await this.resolveChildren(internal).done;
        } else if (internal.expand === TestItemExpandState.Expanded) {
            await internal.resolve?.done;
        } else {
            return;
        }
        await this.expandChildren(internal, levels - 1);
    }

    /** Sends the queued diff now. */
    public flushDiff(): void {
        this.debounceSendDiff.cancel();
        const diff = this.diff;
        this.diff = [];
        if (diff.length > 0) this.options.publishDiff(diff);
    }

    public dispose(): void {
        for (const internal of this.tree.values()) TestItemImpl.apiOf(internal.actual).listener = undefined;
        this.tree.clear();
        this.diff = [];
        this.debounceSendDiff.dispose();
    }

    private pushDiff(diff: PendingOp): void {
        if (diff.op === TestDiffOpType.Update) {
            // Updates come per field: merge them into the previous op of the same test.
            const last = this.diff.at(-1);
            const lastId =
                last?.op === TestDiffOpType.Update
                    ? last.item.extId
                    : last?.op === TestDiffOpType.Add
                      ? last.item.item.extId
                      : undefined;
            if (last !== undefined && last.op !== TestDiffOpType.Remove && lastId === diff.item.extId) {
                const target = last.item;
                if (diff.item.expand !== undefined) target.expand = diff.item.expand;
                if (diff.item.item !== undefined) target.item = { ...target.item, ...diff.item.item } as IWireTestItem;
                return;
            }
        }
        this.diff.push(diff);
        if (!this.debounceSendDiff.isScheduled()) this.debounceSendDiff.schedule();
    }

    private onTestItemEvent(internal: ICollectionItem, event: TestItemEvent): void {
        switch (event.op) {
            case "removeChild":
                this.removeItem(TestId.joinToString(internal.fullId, event.item.id), event.item);
                break;
            case "upsert":
                this.upsertItem(event.item, internal);
                break;
            case "bulk":
                for (const op of event.ops) this.onTestItemEvent(internal, op);
                break;
            case "updateCanResolveChildren":
                this.updateExpandability(internal);
                break;
            case "setProp":
                this.pushDiff({ op: TestDiffOpType.Update, item: { extId: internal.fullId, item: event.update } });
                break;
        }
    }

    private upsertItem(actual: TestItemImpl, parent: ICollectionItem | undefined): void {
        const fullId = parent === undefined ? this.options.root.id : TestId.joinToString(parent.fullId, actual.id);

        // The item moves: it leaves its old parent first.
        const api = TestItemImpl.apiOf(actual);
        if (api.parent !== undefined && api.parent !== parent?.actual) api.parent.children.delete(actual.id);

        const internal = this.tree.get(fullId);
        // A brand new item.
        if (internal === undefined) {
            const created: ICollectionItem = {
                fullId,
                actual,
                expandLevels:
                    parent?.expandLevels !== undefined && parent.expandLevels > 0 ? parent.expandLevels - 1 : undefined,
                expand: TestItemExpandState.NotExpandable,
            };
            this.tree.set(fullId, created);
            this.pushDiff({
                op: TestDiffOpType.Add,
                item: { expand: created.expand, item: toWireTestItem(actual, fullId) },
            });
            this.connectItemAndChildren(actual, created, parent);
            return;
        }

        // The same instance again: only reconnect, the parent may have changed.
        if (internal.actual === actual) {
            this.connectItem(actual, internal, parent);
            return;
        }

        // A new instance under a known id; a new URI is not an update, the test is inserted anew.
        if (internal.actual.uri?.toString() !== actual.uri?.toString()) {
            this.removeItem(fullId, internal.actual);
            this.upsertItem(actual, parent);
            return;
        }
        const oldActual = internal.actual;
        const update = diffTestItems(toWireTestItem(oldActual, fullId), toWireTestItem(actual, fullId));
        TestItemImpl.apiOf(oldActual).listener = undefined;
        internal.actual = actual;
        internal.resolve = undefined;
        internal.expand = TestItemExpandState.NotExpandable;
        if (update !== undefined) this.onTestItemEvent(internal, { op: "setProp", update });
        this.connectItemAndChildren(actual, internal, parent);

        for (const [id, child] of oldActual.children) {
            if (actual.children.get(id) === undefined) this.removeItem(TestId.joinToString(fullId, id), child);
        }

        // Upstream #207574: an item that was expanded expands again, after the extension has set it up.
        const levels = internal.expandLevels;
        if (levels !== undefined) {
            queueMicrotask(() => {
                if (internal.expand !== TestItemExpandState.Expandable) return;
                internal.expandLevels = undefined;
                void this.expand(fullId, levels);
            });
        }
    }

    private connectItem(actual: TestItemImpl, internal: ICollectionItem, parent: ICollectionItem | undefined): void {
        const api = TestItemImpl.apiOf(actual);
        api.parent = parent?.actual;
        api.listener = (event) => {
            this.onTestItemEvent(internal, event);
        };
        this.updateExpandability(internal);
    }

    private connectItemAndChildren(
        actual: TestItemImpl,
        internal: ICollectionItem,
        parent: ICollectionItem | undefined,
    ): void {
        this.connectItem(actual, internal, parent);
        // Children added before the item joined the tree.
        for (const [, child] of actual.children) this.upsertItem(child, internal);
    }

    /** Recomputes `expand`; an item asked to expand before it could resolves now. */
    private updateExpandability(internal: ICollectionItem): void {
        const state =
            this.resolveHandlerValue === undefined
                ? TestItemExpandState.NotExpandable
                : internal.resolve !== undefined
                  ? internal.resolve.settled
                      ? TestItemExpandState.Expanded
                      : TestItemExpandState.BusyExpanding
                  : internal.actual.canResolveChildren
                    ? TestItemExpandState.Expandable
                    : TestItemExpandState.NotExpandable;
        if (state === internal.expand) return;
        internal.expand = state;
        this.pushDiff({ op: TestDiffOpType.Update, item: { extId: internal.fullId, expand: state } });
        if (state === TestItemExpandState.Expandable && internal.expandLevels !== undefined) {
            void this.resolveChildren(internal);
        }
    }

    private async expandChildren(internal: ICollectionItem, levels: number): Promise<void> {
        if (levels < 0) return;
        await Promise.all(
            [...internal.actual.children].map(([id]) => this.expand(TestId.joinToString(internal.fullId, id), levels)),
        );
    }

    /** Calls `resolveHandler` for the item once: the controller root goes as `undefined`. */
    private resolveChildren(internal: ICollectionItem): { readonly done: Promise<void> } {
        if (internal.resolve !== undefined) return internal.resolve;
        // The caller checked `Expandable`, which needs a handler.
        const handler = this.resolveHandlerValue as (item: TestItemImpl | undefined) => Thenable<void> | void;
        internal.expand = TestItemExpandState.BusyExpanding;
        this.pushDiff({ op: TestDiffOpType.Update, item: { extId: internal.fullId, expand: internal.expand } });
        let settle: () => void = () => undefined;
        const resolve = {
            done: new Promise<void>((resolveDone) => {
                settle = resolveDone;
            }),
            settled: false,
        };
        internal.resolve = resolve;
        void (async () => {
            try {
                await handler(internal.actual instanceof TestItemRootImpl ? undefined : internal.actual);
            } catch (error) {
                this.options.logError(
                    `Unhandled error in resolveHandler of test controller "${this.options.root.id}": ${String(error)}`,
                );
            }
            resolve.settled = true;
            this.updateExpandability(internal);
            settle();
        })();
        return resolve;
    }

    /** The test with its subtree, walked through the items themselves. */
    private removeItem(testId: string, actual: TestItemImpl): void {
        this.pushDiff({ op: TestDiffOpType.Remove, itemId: testId });
        const queue: [string, TestItemImpl][] = [[testId, actual]];
        for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
            const [id, item] = next;
            TestItemImpl.apiOf(item).listener = undefined;
            this.tree.delete(id);
            for (const [childId, child] of item.children) queue.push([TestId.joinToString(id, childId), child]);
        }
    }
}
