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
 * Один definition-провайдер в реестре `ILanguageFeaturesService.definitionProvider`
 * (upstream `languages.DefinitionProvider`). Пустой результат — определение не
 * найдено. Провайдеры расширений регистрирует туда `LanguageFeaturesAdapter`.
 */
export interface DefinitionProvider {
    provideDefinition(request: IDefinitionRequest): Promise<readonly ICoreDefinitionLocation[]>;
}
