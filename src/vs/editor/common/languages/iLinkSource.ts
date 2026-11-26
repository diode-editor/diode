import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IRange } from "../core/iRange.ts";
import type { ITextDocument } from "../model/iTextDocument.ts";

/** Upstream `languages.ILink`, 0-based. */
export interface ILink {
    readonly range: IRange;
    /** `uri.toString()`; absent — ask {@link resolve}. */
    readonly url?: string;
    readonly tooltip?: string;
    /**
     * Upstream `LinkProvider.resolveLink`, bound to its link: what identifies a link in the extension host stays
     * with the proxy. `null` — no target.
     */
    readonly resolve?: (token: ICancellationToken) => Promise<string | null>;
}

export interface ILinkRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** An extension provider reads the text from its own synced copy of this version. */
    readonly versionId: number;
    /** The text in the core, for providers living next to it (the built-in detector). */
    readonly document: ITextDocument;
}

/** Upstream `languages.LinkProvider`. */
export interface LinkProvider {
    provideLinks(request: ILinkRequest, token: ICancellationToken): Promise<readonly ILink[] | null | undefined>;
}
