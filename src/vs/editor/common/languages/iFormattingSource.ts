import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IPosition } from "../core/iPosition.ts";
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

export interface IOnTypeFormattingRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** The provider reads the text from its own synced copy of this version. */
    readonly versionId: number;
    /** 0-based: the caret after the character went in. */
    readonly position: IPosition;
    /** The character typed, `\n` for Enter. */
    readonly ch: string;
    readonly tabSize: number;
    readonly insertSpaces: boolean;
}

/** upstream `languages.OnTypeFormattingEditProvider`. */
export interface OnTypeFormattingEditProvider {
    readonly triggerCharacters: readonly string[];
    provideOnTypeFormattingEdits(
        request: IOnTypeFormattingRequest,
        token: ICancellationToken,
    ): Promise<readonly ITextEdit[]>;
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
