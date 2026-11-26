import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IRange } from "../core/iRange.ts";

/** A partial symbol has no `range`: the provider fills it in on resolve. */
export interface ICoreWorkspaceSymbolLocation {
    readonly uri: string;
    readonly range?: IRange;
}

/** Upstream `IWorkspaceSymbol`. */
export interface ICoreWorkspaceSymbol {
    readonly name: string;
    readonly kind: number;
    readonly tags: readonly number[];
    readonly containerName?: string;
    readonly location: ICoreWorkspaceSymbolLocation;
}

/** Upstream `IWorkspaceSymbolProvider`; `resolveWorkspaceSymbol` exists only if the provider can resolve. */
export interface WorkspaceSymbolProvider {
    provideWorkspaceSymbols(query: string, token: ICancellationToken): Promise<readonly ICoreWorkspaceSymbol[]>;
    resolveWorkspaceSymbol?(
        symbol: ICoreWorkspaceSymbol,
        token: ICancellationToken,
    ): Promise<ICoreWorkspaceSymbolLocation | null>;
}
