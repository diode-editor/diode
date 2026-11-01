import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import type { IPosition } from "../../../../editor/common/core/iPosition.ts";
import { comparePositions } from "../../../../editor/common/core/iPosition.ts";
import type {
    CallHierarchyProvider,
    ICallHierarchyItem,
} from "../../../../editor/common/languages/iCallHierarchySource.ts";
import type { CallHierarchyMode } from "../../../common/stateKeys.ts";

import { HierarchyModel, type IHierarchyNode } from "./hierarchyTree.ts";

/** One tree of calls: the direction and the session its items live in. */
export class CallsModel extends HierarchyModel {
    public constructor(
        private readonly provider: CallHierarchyProvider,
        private readonly sessionId: number,
        public readonly direction: CallHierarchyMode,
        roots: readonly ICallHierarchyItem[],
        private readonly token: ICancellationToken,
    ) {
        super(roots);
    }

    protected async resolveChildren(node: IHierarchyNode): Promise<IHierarchyNode[]> {
        const { itemId } = node.item;
        return this.direction === "incoming"
            ? (await this.provider.provideIncomingCalls(this.sessionId, itemId, this.token)).map((call) => ({
                  item: call.from,
                  fromRanges: call.fromRanges,
              }))
            : (await this.provider.provideOutgoingCalls(this.sessionId, itemId, this.token)).map((call) => ({
                  item: call.to,
                  fromRanges: call.fromRanges,
              }));
    }
}

/**
 * Upstream `CallItemDataProvider.getTreeItem`: outgoing opens the target, incoming the earliest call inside the
 * caller. `fromRanges` of an incoming call are inside `item.uri` by the API's contract.
 */
export function callNodeTarget(direction: CallHierarchyMode, node: IHierarchyNode): IPosition {
    const start = node.item.selectionRange.start;
    if (direction === "outgoing") return start;
    let first: IPosition | undefined;
    // Stryker disable next-line ArrayDeclaration: a junk element has no `start`, so `first` stays empty just the same
    for (const range of node.fromRanges ?? []) {
        // Stryker disable next-line EqualityOperator: equal positions are the same answer
        if (first === undefined || comparePositions(range.start, first) < 0) first = range.start;
    }
    return first ?? start;
}
