import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";

/**
 * Запрос областей сворачивания к folding-источнику. Несёт полный снапшот текста
 * документа (у хоста нет реестра документов — как и в completion/will-save,
 * снапшот передаётся целиком).
 */
export interface IFoldingRequest {
    /** Ресурс активного документа как `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** Версия документа на момент запроса: текст провайдер берёт из своей синхронизированной копии. */
    readonly versionId: number;
}

/**
 * Folding-провайдер в реестре `ILanguageFeaturesService.foldingRangeProvider`
 * (upstream `languages.FoldingRangeProvider`): области сворачивания документа.
 * Ответы всех подошедших провайдеров склеиваются поверх indentation-фолдов
 * (`EditorComponent`); пустой ответ — у провайдера областей нет.
 */
export interface FoldingRangeProvider {
    /**
     * `token` отменяется, как только ответ перестал быть нужен (правка,
     * смена состава провайдеров, закрытие редактора) — отмена доезжает до
     * провайдера расширения.
     */
    provideFoldingRanges(request: IFoldingRequest, token: ICancellationToken): Promise<readonly IFoldingRegion[]>;
}
