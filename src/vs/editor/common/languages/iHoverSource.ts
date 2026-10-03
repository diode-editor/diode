import type { IRange } from "../core/iRange.ts";

/**
 * Запрос «что за символ под позицией», отправляемый hover-провайдеру. Несёт
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
 * Один hover-провайдер в реестре `ILanguageFeaturesService.hoverProvider`
 * (upstream `languages.HoverProvider`). Нет ответа — `undefined`. Провайдеры
 * расширений регистрирует туда `LanguageFeaturesAdapter` — прокси по handle.
 */
export interface HoverProvider {
    provideHover(request: IHoverRequest): Promise<ICoreHover | undefined>;
}
