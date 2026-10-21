import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IRange } from "../core/iRange.ts";

export interface IHoverRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** The provider reads the text from its own synced copy of this version. */
    readonly versionId: number;
    /** 0-based. */
    readonly line: number;
    readonly character: number;
}

/** `contents` is raw markdown: stripping markup is the UI's job, the protocol leaves it alone. */
export interface ICoreHover {
    readonly contents: readonly string[];
    /** Absent: the UI uses the request position. */
    readonly range?: IRange;
}

/** upstream `languages.HoverProvider`. */
export interface HoverProvider {
    provideHover(request: IHoverRequest, token: ICancellationToken): Promise<ICoreHover | undefined>;
}
