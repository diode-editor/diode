import type * as vscode from "vscode";

import type { IRange } from "../../../editor/common/core/iRange.ts";
import type {
    ICallHierarchyIncomingCall,
    ICallHierarchyItem,
    ICallHierarchyOutgoingCall,
} from "../../../editor/common/languages/iCallHierarchySource.ts";

import { HierarchySessions } from "./extHostHierarchySessions.ts";
import { rangeFrom } from "./extHostTypeConverters.ts";

export class CallHierarchySessions extends HierarchySessions<vscode.CallHierarchyItem> {
    public constructor() {
        super("missing call hierarchy item");
    }

    public incomingCalls(sessionId: number, raw: unknown): ICallHierarchyIncomingCall[] {
        return this.calls(sessionId, raw, "from", (from, fromRanges) => ({ from, fromRanges }));
    }

    public outgoingCalls(sessionId: number, raw: unknown): ICallHierarchyOutgoingCall[] {
        return this.calls(sessionId, raw, "to", (to, fromRanges) => ({ to, fromRanges }));
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
}

function serializeRanges(raw: unknown): IRange[] {
    if (!Array.isArray(raw)) return [];
    return (raw as unknown[]).map(rangeFrom).filter((range) => range !== null);
}
