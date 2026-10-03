import type { IRange } from "../core/iRange.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";

/**
 * Запрос «отформатируй документ (или диапазон)», отправляемый
 * formatting-источнику. Несёт полный снапшот текста (у хоста нет реестра
 * документов — как definition/hover, снапшот целиком) и настройки отступов
 * активного редактора (`vscode.FormattingOptions`).
 */
export interface IFormattingRequest {
    /** Ресурс активного документа как `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** Полный текст документа (LF-канонический). */
    readonly text: string;
    /** Ширина таба активного редактора. */
    readonly tabSize: number;
    /** Отступы пробелами (`false` — табами). */
    readonly insertSpaces: boolean;
    /**
     * Диапазон для Format Selection (0-based, end эксклюзивен по символу).
     * Отсутствие поля — форматируется весь документ.
     */
    readonly range?: IRange;
}

/**
 * Провайдер форматирования документа в реестре
 * `ILanguageFeaturesService.documentFormattingEditProvider` (upstream
 * `languages.DocumentFormattingEditProvider`). Пустой ответ — менять нечего
 * (или провайдер не ответил вовремя). Выбор провайдера — `editor/contrib/format`.
 */
export interface DocumentFormattingEditProvider {
    provideDocumentFormattingEdits(request: IFormattingRequest): Promise<readonly ITextEdit[]>;
}

/**
 * Провайдер форматирования диапазона в реестре
 * `ILanguageFeaturesService.documentRangeFormattingEditProvider` (upstream
 * `languages.DocumentRangeFormattingEditProvider`). Он же — «синтетический»
 * форматтер документа: на полный диапазон, когда документного нет.
 */
export interface DocumentRangeFormattingEditProvider {
    provideDocumentRangeFormattingEdits(
        request: IFormattingRequest & { readonly range: IRange },
    ): Promise<readonly ITextEdit[]>;
}
