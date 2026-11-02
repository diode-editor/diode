import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IRange } from "../core/iRange.ts";

export interface IDocumentSymbolRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** The provider reads the text from its own synced copy of this version. */
    readonly versionId: number;
}

/** upstream `languages.DocumentSymbol`. `kind` and `tags` are the `SymbolKind` and `SymbolTag` numbers. */
export interface ICoreDocumentSymbol {
    readonly name: string;
    readonly detail: string;
    readonly kind: number;
    readonly tags: readonly number[];
    /** Only a `SymbolInformation` answer has it; otherwise the parent's name stands in. */
    readonly containerName?: string;
    readonly range: IRange;
    readonly selectionRange: IRange;
    readonly children: readonly ICoreDocumentSymbol[];
}

/** upstream `languages.DocumentSymbolProvider`. */
export interface DocumentSymbolProvider {
    provideDocumentSymbols(
        request: IDocumentSymbolRequest,
        token: ICancellationToken,
    ): Promise<readonly ICoreDocumentSymbol[]>;
}
