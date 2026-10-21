import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IRange } from "../core/iRange.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";

export interface IFormattingRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** Текст провайдер берёт из своей синхронизированной копии этой версии. */
    readonly versionId: number;
    readonly tabSize: number;
    readonly insertSpaces: boolean;
    /** 0-based, end эксклюзивен. Нет — весь документ. */
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
 * upstream `languages.DocumentRangeFormattingEditProvider`. Он же —
 * форматтер документа на полный диапазон, когда документного нет.
 */
export interface DocumentRangeFormattingEditProvider {
    provideDocumentRangeFormattingEdits(
        request: IFormattingRequest & { readonly range: IRange },
        token: ICancellationToken,
    ): Promise<readonly ITextEdit[]>;
}
