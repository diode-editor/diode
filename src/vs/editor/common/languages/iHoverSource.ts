import type { IRange } from "../core/iRange.ts";

/**
 * Запрос «что за символ под позицией», отправляемый hover-источнику. Несёт
 * полный снапшот текста + позицию курсора (у хоста нет реестра документов —
 * как definition, снапшот передаётся целиком).
 */
export interface IHoverRequest {
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
 * Один hover в ядре (десериализованная форма расширенческого `vscode.Hover`).
 * `contents` — блоки сырого markdown в порядке от провайдера; рендер (стрип
 * разметки, перенос) — забота UI-потребителя, протокол разметку не трогает.
 */
export interface ICoreHover {
    readonly contents: readonly string[];
    /** Диапазон символа, к которому относится hover; нет — UI считает позицией запроса. */
    readonly range?: IRange;
}

/**
 * Hover-источник: по запросу возвращает hover'ы всех провайдеров расширений
 * (по элементу на непустой ответ, в порядке регистрации провайдеров).
 * Инъектируется в ядро извне (host/харнесс) — ядро не знает про extension-слой
 * (зеркало {@link ./iDefinitionSource.ts:DefinitionSource}). Пустой результат =
 * hover'а нет.
 */
export type HoverSource = (request: IHoverRequest) => Promise<readonly ICoreHover[]>;
