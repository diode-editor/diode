import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IRange } from "../core/iRange.ts";

/**
 * Запрос «где определение символа», отправляемый definition-провайдеру. Несёт
 * полный снапшот текста + позицию курсора (у хоста нет реестра документов —
 * как completion, снапшот передаётся целиком).
 */
export interface IDefinitionRequest {
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
 * Один definition-провайдер в реестре `ILanguageFeaturesService.definitionProvider`
 * (upstream `languages.DefinitionProvider`). Пустой результат — определение не
 * найдено. Провайдеры расширений регистрирует туда `LanguageFeaturesAdapter`.
 */
export interface DefinitionProvider {
    /**
     * `token` отменяется, как только ответ перестал быть нужен (новый запрос,
     * закрытие попапа, правка или уход каретки) — отмена доезжает до провайдера
     * расширения, и language-сервер бросает ненужную работу.
     */
    provideDefinition(
        request: IDefinitionRequest,
        token: ICancellationToken,
    ): Promise<readonly ICoreDefinitionLocation[]>;
}
