import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IRange } from "../core/iRange.ts";

export interface IInlineCompletionRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** Текст провайдер берёт из своей синхронизированной копии этой версии. */
    readonly versionId: number;
    /** 0-based. */
    readonly line: number;
    readonly character: number;
    /** По контракту vscode на Invoke провайдер может вернуть несколько вариантов, на Automatic — один. */
    readonly triggerKind: InlineCompletionTriggerKind;
    /**
     * Мс. Едет с КАЖДЫМ запросом, а не фиксируется при создании источника: иначе
     * правка настройки применялась бы только после перезапуска.
     */
    readonly timeoutMs?: number;
}

/** Значения `vscode.InlineCompletionTriggerKind`. */
export const InlineCompletionTriggerKind = {
    Invoke: 0,
    Automatic: 1,
} as const;

export type InlineCompletionTriggerKind =
    (typeof InlineCompletionTriggerKind)[keyof typeof InlineCompletionTriggerKind];

/** `SnippetString` субпроцесс сериализует в `insertText` со стрипом плейсхолдеров. */
export interface ICoreInlineCompletionItem {
    readonly insertText: string;
    /** Показ, только если заменяемый текст — префикс `filterText ?? insertText` (контракт vscode.d.ts). */
    readonly filterText?: string;
    /** В пределах одной строки; без него вставка — в позицию каретки запроса. */
    readonly range?: IRange;
}

/**
 * upstream `languages.InlineCompletionsProvider`. Отмена `token` доезжает до
 * провайдера расширения — за ghost text может стоять платный LLM-вызов.
 */
export interface InlineCompletionsProvider {
    provideInlineCompletions(
        request: IInlineCompletionRequest,
        token: ICancellationToken,
    ): Promise<readonly ICoreInlineCompletionItem[]>;
}
