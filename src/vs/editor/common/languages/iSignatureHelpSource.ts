/** Чем спровоцирован запрос подсказки (значения `vscode.SignatureHelpTriggerKind`). */
export const SignatureHelpTriggerKind = {
    /** Ручной вызов командой. */
    Invoke: 1,
    /** Набран триггер-символ (`(`, `,`, `<` у tsserver) или ретриггер-символ. */
    TriggerCharacter: 2,
    /** Правка или движение каретки при уже открытой подсказке. */
    ContentChange: 3,
} as const;

export type SignatureHelpTriggerKind = (typeof SignatureHelpTriggerKind)[keyof typeof SignatureHelpTriggerKind];

/**
 * Запрос «какая сигнатура вызывается в этой позиции», отправляемый
 * signature-help-провайдеру. Несёт полный снапшот текста + позицию каретки
 * (у хоста нет реестра документов — как definition/hover, снапшот целиком).
 */
export interface ISignatureHelpRequest {
    /** Ресурс активного документа как `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** Полный текст документа (LF-канонический). */
    readonly text: string;
    /** Позиция каретки, 0-based. */
    readonly line: number;
    readonly character: number;
    readonly triggerKind: SignatureHelpTriggerKind;
    /** Набранный символ, когда `triggerKind === TriggerCharacter`. */
    readonly triggerCharacter?: string;
    /** Подсказка уже показана — сервер по этому флагу удерживает выбранную перегрузку. */
    readonly isRetrigger: boolean;
    /**
     * Показываемая сейчас подсказка (только при ретриггере). Нужна серверу,
     * чтобы после запятой не сбросить перегрузку, которую пользователь выбрал
     * стрелками: tsserver ищет прежнюю сигнатуру среди новых по метке.
     */
    readonly activeSignatureHelp?: ICoreSignatureHelp;
}

/**
 * Параметр сигнатуры. `label` — либо подстрока метки сигнатуры, либо пара
 * офсетов `[start, end)` внутри неё (обе формы легальны: клиент объявляет
 * серверу `labelOffsetSupport`). Документация — сырой markdown, как у hover:
 * стрип разметки — забота UI.
 */
export interface ICoreParameterInfo {
    readonly label: string | readonly [number, number];
    readonly documentation?: string;
}

/** Одна сигнатура (перегрузка) вызываемого символа. */
export interface ICoreSignature {
    readonly label: string;
    readonly documentation?: string;
    readonly parameters: readonly ICoreParameterInfo[];
    /** Активный параметр именно этой сигнатуры; нет — берётся общий. */
    readonly activeParameter?: number;
}

/**
 * Подсказка параметров в ядре (десериализованная форма `vscode.SignatureHelp`).
 * `activeParameter` может приехать `-1` — «активного параметра нет»
 * (`noActiveParameterSupport` протокола).
 */
export interface ICoreSignatureHelp {
    readonly signatures: readonly ICoreSignature[];
    readonly activeSignature: number;
    readonly activeParameter: number;
}

/**
 * Один провайдер подсказки параметров в реестре
 * `ILanguageFeaturesService.signatureHelpProvider` (upstream
 * `languages.SignatureHelpProvider` + метаданные регистрации). Потребитель
 * спрашивает подошедших по очереди до ПЕРВОГО ответа (в отличие от
 * hover/references, где ответы склеиваются — так предписывает vscode API).
 * `null` = подсказки нет.
 */
export interface SignatureHelpProvider {
    /** Символы, набор которых сам открывает подсказку («(», «,», «<» у tsserver). */
    readonly triggerCharacters: readonly string[];
    /** Символы, перезапрашивающие подсказку, пока она показана («)»). */
    readonly retriggerCharacters: readonly string[];
    provideSignatureHelp(request: ISignatureHelpRequest): Promise<ICoreSignatureHelp | null>;
}
