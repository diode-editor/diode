import type { ICancellationToken } from "../../../base/common/cancellation.ts";
/** Значения `vscode.SignatureHelpTriggerKind`. */
export const SignatureHelpTriggerKind = {
    Invoke: 1,
    TriggerCharacter: 2,
    /** Правка или движение каретки при уже открытой подсказке. */
    ContentChange: 3,
} as const;

export type SignatureHelpTriggerKind = (typeof SignatureHelpTriggerKind)[keyof typeof SignatureHelpTriggerKind];

export interface ISignatureHelpRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** Текст провайдер берёт из своей синхронизированной копии этой версии. */
    readonly versionId: number;
    /** 0-based. */
    readonly line: number;
    readonly character: number;
    readonly triggerKind: SignatureHelpTriggerKind;
    readonly triggerCharacter?: string;
    readonly isRetrigger: boolean;
    /**
     * Только при ретриггере: чтобы после запятой не сбросить перегрузку,
     * выбранную стрелками, — tsserver ищет прежнюю сигнатуру среди новых по метке.
     */
    readonly activeSignatureHelp?: ICoreSignatureHelp;
}

/**
 * `label` — подстрока метки сигнатуры или офсеты `[start, end)` внутри неё
 * (клиент объявляет `labelOffsetSupport`). Документация — сырой markdown.
 */
export interface ICoreParameterInfo {
    readonly label: string | readonly [number, number];
    readonly documentation?: string;
}

export interface ICoreSignature {
    readonly label: string;
    readonly documentation?: string;
    readonly parameters: readonly ICoreParameterInfo[];
    /** Нет — берётся общий. */
    readonly activeParameter?: number;
}

/** `activeParameter` может приехать `-1` — «активного нет» (`noActiveParameterSupport`). */
export interface ICoreSignatureHelp {
    readonly signatures: readonly ICoreSignature[];
    readonly activeSignature: number;
    readonly activeParameter: number;
}

/**
 * upstream `languages.SignatureHelpProvider`. Потребитель спрашивает по очереди
 * до ПЕРВОГО ответа, а не склеивает, как hover/references — так велит vscode API.
 */
export interface SignatureHelpProvider {
    readonly triggerCharacters: readonly string[];
    /** Перезапрашивают подсказку, пока она показана («)»). */
    readonly retriggerCharacters: readonly string[];
    provideSignatureHelp(request: ISignatureHelpRequest, token: ICancellationToken): Promise<ICoreSignatureHelp | null>;
}
