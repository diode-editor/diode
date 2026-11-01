import type * as vscode from "vscode";

import type { IRange } from "../../../editor/common/core/iRange.ts";
import type {
    ICallHierarchyIncomingCall,
    ICallHierarchyItem,
    ICallHierarchyOutgoingCall,
    ICallHierarchySession,
} from "../../../editor/common/languages/iCallHierarchySource.ts";

import { rangeFrom } from "./extHostTypeConverters.ts";

interface IResolvedItem {
    readonly sessionId: number;
    /** The very object the provider returned: language clients keep their `data` on it. */
    readonly item: vscode.CallHierarchyItem;
}

/**
 * Upstream `CallHierarchyAdapter`: the provider is always called with its own original object, so every item
 * sent to the core is remembered in its session until the tree releases it. An item the provider returned in a
 * broken shape costs that one item, not the answer.
 */
export class CallHierarchySessions {
    private readonly sessions = new Map<number, Map<number, unknown>>();
    private nextSessionId = 1;
    private nextItemId = 1;

    public prepare(raw: unknown): ICallHierarchySession | null {
        const list = Array.isArray(raw) ? (raw as unknown[]) : [raw];
        const sessionId = this.nextSessionId;
        const items: ICallHierarchyItem[] = [];
        const cache = new Map<number, unknown>();
        for (const item of list) {
            const wire = this.remember(cache, item);
            if (wire !== null) items.push(wire);
        }
        if (items.length === 0) return null;
        // Stryker disable next-line UpdateOperator: any step gives distinct ids
        this.nextSessionId++;
        this.sessions.set(sessionId, cache);
        return { sessionId, items };
    }

    /** @throws for a released session or an unknown item, as upstream: the caller reports it to the extension's log. */
    public item(sessionId: number, itemId: number): IResolvedItem {
        const item = this.sessions.get(sessionId)?.get(itemId);
        if (item === undefined) throw new Error("missing call hierarchy item");
        return { sessionId, item: item as vscode.CallHierarchyItem };
    }

    public incomingCalls(sessionId: number, raw: unknown): ICallHierarchyIncomingCall[] {
        return this.calls(sessionId, raw, "from", (from, fromRanges) => ({ from, fromRanges }));
    }

    public outgoingCalls(sessionId: number, raw: unknown): ICallHierarchyOutgoingCall[] {
        return this.calls(sessionId, raw, "to", (to, fromRanges) => ({ to, fromRanges }));
    }

    public release(sessionId: number): void {
        this.sessions.delete(sessionId);
    }

    private calls<T>(
        sessionId: number,
        raw: unknown,
        field: "from" | "to",
        build: (item: ICallHierarchyItem, fromRanges: readonly IRange[]) => T,
    ): T[] {
        // Released while the provider was thinking: nothing asks about this answer any more.
        const cache = this.sessions.get(sessionId);
        if (cache === undefined || !Array.isArray(raw)) return [];
        const result: T[] = [];
        for (const call of raw as unknown[]) {
            const holder = (call ?? {}) as { from?: unknown; to?: unknown; fromRanges?: unknown };
            const wire = this.remember(cache, holder[field]);
            if (wire === null) continue;
            result.push(build(wire, serializeRanges(holder.fromRanges)));
        }
        return result;
    }

    private remember(cache: Map<number, unknown>, raw: unknown): ICallHierarchyItem | null {
        const wire = serializeItem(raw, this.nextItemId);
        if (wire === null) return null;
        // Stryker disable next-line UpdateOperator: any step gives distinct ids
        this.nextItemId++;
        cache.set(wire.itemId, raw);
        return wire;
    }
}

function serializeRanges(raw: unknown): IRange[] {
    if (!Array.isArray(raw)) return [];
    return (raw as unknown[]).map(rangeFrom).filter((range) => range !== null);
}

function serializeItem(raw: unknown, itemId: number): ICallHierarchyItem | null {
    if (typeof raw !== "object" || raw === null) return null;
    const item = raw as {
        name?: unknown;
        detail?: unknown;
        kind?: unknown;
        tags?: unknown;
        uri?: unknown;
        range?: unknown;
        selectionRange?: unknown;
    };
    const range = rangeFrom(item.range);
    const selectionRange = rangeFrom(item.selectionRange);
    if (typeof item.name !== "string" || item.uri == null || range === null || selectionRange === null) return null;
    const tags = Array.isArray(item.tags) ? (item.tags as unknown[]).filter((tag) => typeof tag === "number") : [];
    return {
        itemId,
        name: item.name,
        ...(typeof item.detail === "string" && item.detail !== "" ? { detail: item.detail } : {}),
        kind: typeof item.kind === "number" ? item.kind : 0,
        ...(tags.length > 0 ? { tags } : {}),
        // Stryker disable next-line StringLiteral: an object without a custom toString is not a Uri anyway
        uri: (item.uri as { toString(): string }).toString(),
        range,
        selectionRange,
    };
}
