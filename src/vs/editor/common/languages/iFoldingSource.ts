import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";

export interface IFoldingRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** The provider reads the text from its own synced copy of this version. */
    readonly versionId: number;
}

/**
 * upstream `languages.FoldingRangeProvider`. Results of all matching providers are merged
 * on top of indentation folds.
 */
export interface FoldingRangeProvider {
    provideFoldingRanges(request: IFoldingRequest, token: ICancellationToken): Promise<readonly IFoldingRegion[]>;
}
