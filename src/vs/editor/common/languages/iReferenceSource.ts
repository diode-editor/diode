import type { IRange } from "../core/iRange.ts";

/**
 * Запрос «где используется символ», отправляемый references-провайдеру. Несёт
 * полный снапшот текста + позицию курсора (у хоста нет реестра документов —
 * как definition, снапшот передаётся целиком).
 */
export interface IReferenceRequest {
    /** Ресурс активного документа как `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** Полный текст документа (LF-канонический). */
    readonly text: string;
    /** Позиция курсора, 0-based. */
    readonly line: number;
    readonly character: number;
    /**
     * LSP `ReferenceContext.includeDeclaration`: считать ли само объявление
     * символа одной из ссылок. VS Code просит `true` — в списке «Find All
     * References» объявление стоит первой строкой.
     */
    readonly includeDeclaration: boolean;
}

/**
 * Одна ссылка на символ в ядре (десериализованная форма расширенческого
 * `vscode.Location`). Форма совпадает с definition-целью, но смысл другой:
 * это не «куда прыгнуть», а «где ещё упомянут символ», и таких в ответе много.
 */
export interface ICoreReference {
    /** Ресурс ссылки как `uri.toString()` — как правило, чужой файл. */
    readonly uri: string;
    readonly range: IRange;
}

/**
 * Один references-провайдер в реестре `ILanguageFeaturesService.referenceProvider`
 * (upstream `languages.ReferenceProvider`). Провайдеры расширений регистрирует
 * туда `LanguageFeaturesAdapter`.
 */
export interface ReferenceProvider {
    provideReferences(request: IReferenceRequest): Promise<readonly ICoreReference[]>;
}
