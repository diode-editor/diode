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
 * Formatting-источник: по запросу возвращает правки от провайдера расширений.
 * Инъектируется в ядро извне (host/харнесс) — ядро не знает про extension-слой
 * (зеркало {@link ./iDefinitionSource.ts:DefinitionSource}).
 *
 * Трёхзначный ответ: `null` — НЕТ провайдера, матчащего документ (командный
 * слой показывает «нет форматтера»); пустой массив — провайдер есть, но менять
 * нечего (или он не ответил вовремя); иначе — правки к применению.
 */
export type FormattingSource = (request: IFormattingRequest) => Promise<readonly ITextEdit[] | null>;
