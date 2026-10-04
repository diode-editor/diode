import type { ICancellationToken } from "../../../base/common/cancellation.ts";
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
    /** Версия документа на момент запроса: текст провайдер берёт из своей синхронизированной копии. */
    readonly versionId: number;
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
    /**
     * `token` отменяется, как только ответ перестал быть нужен (новый запрос,
     * закрытие попапа, правка или уход каретки) — отмена доезжает до провайдера
     * расширения, и language-сервер бросает ненужную работу.
     */
    provideHover(request: IHoverRequest, token: ICancellationToken): Promise<ICoreHover | undefined>;
}
