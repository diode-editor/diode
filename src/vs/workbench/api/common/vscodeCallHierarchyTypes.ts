import type { CallHierarchyItem, Range } from "./vscodeTypes.ts";

// Apart from `vscodeTypes.ts`: only the subprocess constructs these, so they stay out of the copy of common modules
// the extension host chunk shares with the core (`sharedBudgetKb`).

export class CallHierarchyIncomingCall {
    public constructor(
        public from: CallHierarchyItem,
        public fromRanges: Range[],
    ) {}
}

export class CallHierarchyOutgoingCall {
    public constructor(
        public to: CallHierarchyItem,
        public fromRanges: Range[],
    ) {}
}
