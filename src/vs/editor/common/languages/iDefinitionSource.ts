import type { IRange } from "../core/iRange.ts";

/**
 * Запрос «где определение символа», отправляемый definition-источнику. Несёт
 * полный снапшот текста + позицию курсора (у хоста нет реестра документов —
 * как completion, снапшот передаётся целиком).
 */
export interface IDefinitionRequest {
    /** Ресурс активного документа как `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** Полный текст документа (LF-канонический). */
    readonly text: string;
    /** Позиция курсора, 0-based. */
    readonly line: number;
    readonly character: number;
}

/**
 * Одна цель definition в ядре (десериализованная форма расширенческого
 * `vscode.Location` / `LocationLink`). `range` — прицельный диапазон символа
 * (у LocationLink это `targetSelectionRange ?? targetRange`).
 */
export interface ICoreDefinitionLocation {
    /** Ресурс цели как `uri.toString()` — может отличаться от запрошенного (кросс-файловый прыжок). */
    readonly uri: string;
    readonly range: IRange;
}

/**
 * Definition-источник: по запросу возвращает цели от провайдеров расширений.
 * Инъектируется в ядро извне (host/харнесс) — ядро не знает про extension-слой
 * (зеркало {@link ./iCompletionSource.ts:CompletionSource}). Пустой результат =
 * определение не найдено.
 */
export type DefinitionSource = (request: IDefinitionRequest) => Promise<readonly ICoreDefinitionLocation[]>;
