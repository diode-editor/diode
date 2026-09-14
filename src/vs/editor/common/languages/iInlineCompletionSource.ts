import type { IRange } from "../core/iRange.ts";

/**
 * Запрос инлайн-подсказки (ghost text), отправляемый inline-completion-источнику.
 * Несёт полный снапшот текста + позицию каретки — как {@link ./iCompletionSource.ts:ICompletionRequest}
 * (у хоста нет реестра документов).
 */
export interface IInlineCompletionRequest {
    /** Ресурс активного документа как `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** Полный текст документа (LF-канонический). */
    readonly text: string;
    /** Позиция каретки, 0-based. */
    readonly line: number;
    readonly character: number;
    /**
     * Чем спровоцирован запрос (`vscode.InlineCompletionTriggerKind`): 0 —
     * Invoke (явная команда), 1 — Automatic (пауза при наборе). По контракту
     * vscode на Invoke провайдер может вернуть несколько вариантов, на
     * Automatic достаточно одного.
     */
    readonly triggerKind: InlineCompletionTriggerKind;
}

/** Чем спровоцирован запрос (значения `vscode.InlineCompletionTriggerKind`). */
export const InlineCompletionTriggerKind = {
    Invoke: 0,
    Automatic: 1,
} as const;

export type InlineCompletionTriggerKind =
    (typeof InlineCompletionTriggerKind)[keyof typeof InlineCompletionTriggerKind];

/**
 * Пункт инлайн-подсказки в ядре (десериализованная форма расширенческого
 * `vscode.InlineCompletionItem`). `insertText` уже нормализован: `SnippetString`
 * субпроцесс сериализует текстом со стрипом плейсхолдеров.
 */
export interface ICoreInlineCompletionItem {
    /** Текст, которым заменяется {@link range} (и превью, и вставка). */
    readonly insertText: string;
    /**
     * Гейт показа: подсказка показывается, только если заменяемый текст —
     * префикс `filterText ?? insertText` (контракт vscode.d.ts).
     */
    readonly filterText?: string;
    /**
     * Заменяемый диапазон (по d.ts — в пределах одной строки); без него
     * вставка идёт в позицию каретки запроса.
     */
    readonly range?: IRange;
}

/**
 * Inline-completion-источник: по запросу возвращает пункты от провайдеров
 * расширений (`languages.provideInlineCompletions`). Инъектируется в ядро
 * извне (host/харнесс) — ядро не знает про extension-слой (зеркало
 * {@link ./iCompletionSource.ts:CompletionSource}). Пустой массив = подсказок нет.
 */
export type InlineCompletionSource = (
    request: IInlineCompletionRequest,
) => Promise<readonly ICoreInlineCompletionItem[]>;
