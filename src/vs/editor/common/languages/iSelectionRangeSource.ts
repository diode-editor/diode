import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IPosition } from "../core/iPosition.ts";
import type { IRange } from "../core/iRange.ts";

export interface ISelectionRangeRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** The provider reads the text from its own synced copy of this version. */
    readonly versionId: number;
    /** 0-based; the result is aligned with them. */
    readonly positions: readonly IPosition[];
}

/**
 * upstream `languages.SelectionRangeProvider`. The result is an array of ranges per
 * position, innermost to outermost (the `parent` chain, unrolled by the extension host).
 */
export interface SelectionRangeProvider {
    provideSelectionRanges(
        request: ISelectionRangeRequest,
        token: ICancellationToken,
    ): Promise<readonly (readonly IRange[])[]>;
}
