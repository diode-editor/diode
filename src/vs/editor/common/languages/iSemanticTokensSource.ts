import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { Event } from "../../../base/common/event.ts";
import type { IRange } from "../core/iRange.ts";

/**
 * Shape of upstream `languages.SemanticTokens*`. `data` is quintuples of
 * `deltaLine, deltaStartChar, length, tokenType, tokenModifiers`; the type is an index
 * into `legend.tokenTypes`, modifiers are bits over `legend.tokenModifiers`.
 */
export interface ISemanticTokensLegend {
    readonly tokenTypes: readonly string[];
    readonly tokenModifiers: readonly string[];
}

export interface ISemanticTokens {
    readonly resultId: string | undefined;
    readonly data: Uint32Array;
}

/** Edit to the previous result: indices are into the `data` array, not tokens. */
export interface ISemanticTokensEdit {
    readonly start: number;
    readonly deleteCount: number;
    readonly data: Uint32Array | undefined;
}

export interface ISemanticTokensEdits {
    readonly resultId: string | undefined;
    readonly edits: readonly ISemanticTokensEdit[];
}

/** The provider reads the text from its own synced copy of this version. */
export interface ISemanticTokensRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    readonly versionId: number;
}

export interface IRangeSemanticTokensRequest extends ISemanticTokensRequest {
    /** 0-based. */
    readonly range: IRange;
}

/** `lastResultId` is from THIS provider's previous result; it may answer with a delta against it. */
export interface DocumentSemanticTokensProvider {
    readonly onDidChange?: Event<void>;
    getLegend(): ISemanticTokensLegend;
    provideDocumentSemanticTokens(
        request: ISemanticTokensRequest,
        lastResultId: string | null,
        token: ICancellationToken,
    ): Promise<ISemanticTokens | ISemanticTokensEdits | null>;
    /** The core no longer needs result `resultId`: the provider drops its data. */
    releaseDocumentSemanticTokens(resultId: string | undefined): void;
}

/** Visible range, until the full document set is available. */
export interface DocumentRangeSemanticTokensProvider {
    readonly onDidChange?: Event<void>;
    getLegend(): ISemanticTokensLegend;
    provideDocumentRangeSemanticTokens(
        request: IRangeSemanticTokensRequest,
        token: ICancellationToken,
    ): Promise<ISemanticTokens | null>;
}

export function isSemanticTokensEdits(v: ISemanticTokens | ISemanticTokensEdits): v is ISemanticTokensEdits {
    return "edits" in v;
}
