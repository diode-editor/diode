import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IRange } from "../core/iRange.ts";

export interface ICallHierarchyRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** The provider reads the text from its own synced copy of this version. */
    readonly versionId: number;
    /** 0-based. */
    readonly line: number;
    readonly character: number;
}

/** Upstream `ICallHierarchyItemDto`: the original object stays in the subprocess, `itemId` addresses it. */
export interface ICallHierarchyItem {
    readonly itemId: number;
    readonly name: string;
    readonly detail?: string;
    /** `vscode.SymbolKind`, 0-based. */
    readonly kind: number;
    /** `vscode.SymbolTag`. */
    readonly tags?: readonly number[];
    readonly uri: string;
    readonly range: IRange;
    readonly selectionRange: IRange;
}

export interface ICallHierarchySession {
    readonly sessionId: number;
    readonly items: readonly ICallHierarchyItem[];
}

export interface ICallHierarchyIncomingCall {
    readonly from: ICallHierarchyItem;
    /** Inside `from.uri`: where `from` makes the call. */
    readonly fromRanges: readonly IRange[];
}

export interface ICallHierarchyOutgoingCall {
    readonly to: ICallHierarchyItem;
    /** Inside the uri of the item that was asked, not of `to`. */
    readonly fromRanges: readonly IRange[];
}

/** Upstream `languages.CallHierarchyProvider` with its session flattened: items are addressed by id. */
export interface CallHierarchyProvider {
    prepareCallHierarchy(
        request: ICallHierarchyRequest,
        token: ICancellationToken,
    ): Promise<ICallHierarchySession | null>;
    provideIncomingCalls(
        sessionId: number,
        itemId: number,
        token: ICancellationToken,
    ): Promise<readonly ICallHierarchyIncomingCall[]>;
    provideOutgoingCalls(
        sessionId: number,
        itemId: number,
        token: ICancellationToken,
    ): Promise<readonly ICallHierarchyOutgoingCall[]>;
    releaseCallHierarchy(sessionId: number): void;
}
