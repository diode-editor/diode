import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IRange } from "../core/iRange.ts";
import type { ITextDocument } from "../model/iTextDocument.ts";

/** upstream `languages.IColor`: channels in [0, 1]. */
export interface IColor {
    readonly red: number;
    readonly green: number;
    readonly blue: number;
    readonly alpha: number;
}

/** upstream `languages.IColorInformation`. */
export interface IColorInformation {
    /** 0-based. */
    readonly range: IRange;
    readonly color: IColor;
}

export interface IDocumentColorRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** An extension provider reads the text from its own synced copy of this version. */
    readonly versionId: number;
    /** The text in the core, for providers living next to it (the default detector). */
    readonly document: ITextDocument;
}

/**
 * upstream `languages.DocumentColorProvider` without `provideColorPresentations` (there is no color
 * picker). An array, even an empty one, means the provider handled the document: in `auto` mode it
 * silences the default detector.
 */
export interface DocumentColorProvider {
    provideDocumentColors(
        request: IDocumentColorRequest,
        token: ICancellationToken,
    ): Promise<readonly IColorInformation[] | null | undefined>;
}
