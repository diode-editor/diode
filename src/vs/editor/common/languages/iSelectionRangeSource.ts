import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IPosition } from "../core/iPosition.ts";
import type { IRange } from "../core/iRange.ts";

/**
 * Запрос «иерархия выделений вокруг позиций» (Expand/Shrink Selection),
 * отправляемый selection-range-провайдеру. Позиций столько же, сколько
 * кареток: ответ выровнен по ним.
 */
export interface ISelectionRangeRequest {
    /** Ресурс документа как `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** Версия документа на момент запроса: текст провайдер берёт из своей синхронизированной копии. */
    readonly versionId: number;
    /** Позиции кареток, 0-based. */
    readonly positions: readonly IPosition[];
}

/**
 * Один selection-range-провайдер в реестре
 * `ILanguageFeaturesService.selectionRangeProvider` (upstream
 * `languages.SelectionRangeProvider`). Ответ — по массиву диапазонов на
 * позицию, от внутреннего к внешнему (цепочка `parent` расширения,
 * развёрнутая субпроцессом); пустой массив — провайдеру сказать нечего.
 * Провайдеров расширений регистрирует туда `LanguageFeaturesAdapter`.
 */
export interface SelectionRangeProvider {
    provideSelectionRanges(
        request: ISelectionRangeRequest,
        token: ICancellationToken,
    ): Promise<readonly (readonly IRange[])[]>;
}
