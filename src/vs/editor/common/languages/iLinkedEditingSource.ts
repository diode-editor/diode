import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IPosition } from "../core/iPosition.ts";
import type { IRange } from "../core/iRange.ts";

export interface ILinkedEditingRangeRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** The provider reads the text from its own synced copy of this version. */
    readonly versionId: number;
    /** 0-based. */
    readonly position: IPosition;
}

/** upstream `languages.LinkedEditingRanges`. */
export interface ILinkedEditingRanges {
    /** 0-based. */
    readonly ranges: readonly IRange[];
    /** Absent: the language's word pattern applies. */
    readonly wordPattern?: RegExp;
}

/** upstream `languages.LinkedEditingRangeProvider`. `null` means the provider declined and the next one is asked. */
export interface LinkedEditingRangeProvider {
    provideLinkedEditingRanges(
        request: ILinkedEditingRangeRequest,
        token: ICancellationToken,
    ): Promise<ILinkedEditingRanges | null>;
}
