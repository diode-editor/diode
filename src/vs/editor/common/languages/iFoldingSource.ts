import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";

export interface IFoldingRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** Текст провайдер берёт из своей синхронизированной копии этой версии. */
    readonly versionId: number;
}

/**
 * upstream `languages.FoldingRangeProvider`. Ответы всех подошедших провайдеров
 * склеиваются поверх indentation-фолдов.
 */
export interface FoldingRangeProvider {
    provideFoldingRanges(request: IFoldingRequest, token: ICancellationToken): Promise<readonly IFoldingRegion[]>;
}
