import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IPosition } from "../core/iPosition.ts";
import type { IRange } from "../core/iRange.ts";

export interface ISelectionRangeRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** Текст провайдер берёт из своей синхронизированной копии этой версии. */
    readonly versionId: number;
    /** 0-based; ответ выровнен по ним. */
    readonly positions: readonly IPosition[];
}

/**
 * upstream `languages.SelectionRangeProvider`. Ответ — массив диапазонов на
 * позицию, от внутреннего к внешнему (цепочка `parent`, развёрнутая субпроцессом).
 */
export interface SelectionRangeProvider {
    provideSelectionRanges(
        request: ISelectionRangeRequest,
        token: ICancellationToken,
    ): Promise<readonly (readonly IRange[])[]>;
}
