import type { ICancellationToken } from "../../../base/common/cancellation.ts";

import type { ICallHierarchyItem, ICallHierarchyRequest, ICallHierarchySession } from "./iCallHierarchySource.ts";

// Upstream's `ITypeHierarchyItemDto` and its session mirror the call hierarchy ones field by field.
export type ITypeHierarchyRequest = ICallHierarchyRequest;
export type ITypeHierarchyItem = ICallHierarchyItem;
export type ITypeHierarchySession = ICallHierarchySession;

/** Upstream `languages.TypeHierarchyProvider` with its session flattened: items are addressed by id. */
export interface TypeHierarchyProvider {
    prepareTypeHierarchy(
        request: ITypeHierarchyRequest,
        token: ICancellationToken,
    ): Promise<ITypeHierarchySession | null>;
    provideSupertypes(
        sessionId: number,
        itemId: number,
        token: ICancellationToken,
    ): Promise<readonly ITypeHierarchyItem[]>;
    provideSubtypes(
        sessionId: number,
        itemId: number,
        token: ICancellationToken,
    ): Promise<readonly ITypeHierarchyItem[]>;
    releaseTypeHierarchy(sessionId: number): void;
}
