import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IRange } from "../core/iRange.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";

export interface IFormattingRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** The provider reads the text from its own synced copy of this version. */
    readonly versionId: number;
    readonly tabSize: number;
    readonly insertSpaces: boolean;
    /** 0-based, end exclusive. Absent means the whole document. */
    readonly range?: IRange;
}

/** upstream `languages.DocumentFormattingEditProvider`. */
export interface DocumentFormattingEditProvider {
    provideDocumentFormattingEdits(
        request: IFormattingRequest,
        token: ICancellationToken,
    ): Promise<readonly ITextEdit[]>;
}

/**
 * upstream `languages.DocumentRangeFormattingEditProvider`. Also serves as the document
 * formatter over the full range when there is no document formatter.
 */
export interface DocumentRangeFormattingEditProvider {
    provideDocumentRangeFormattingEdits(
        request: IFormattingRequest & { readonly range: IRange },
        token: ICancellationToken,
    ): Promise<readonly ITextEdit[]>;
}
