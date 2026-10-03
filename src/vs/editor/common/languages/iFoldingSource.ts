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
    /** Полный текст документа (LF-канонический). */
    readonly text: string;
}

/**
 * Folding-провайдер в реестре `ILanguageFeaturesService.foldingRangeProvider`
 * (upstream `languages.FoldingRangeProvider`): области сворачивания документа.
 * Ответы всех подошедших провайдеров склеиваются поверх indentation-фолдов
 * (`EditorComponent`); пустой ответ — у провайдера областей нет.
 */
export interface FoldingRangeProvider {
    provideFoldingRanges(request: IFoldingRequest): Promise<readonly IFoldingRegion[]>;
}
