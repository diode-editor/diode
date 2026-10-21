export interface IGrammarContribution {
    /** Нет — injection-грамматика (см. `injectTo`). */
    readonly language?: string;

    readonly scopeName: string;

    /** Относительно каталога расширения. */
    readonly path: string;

    /** В TextMate-loader пока не пробрасывается. */
    readonly embeddedLanguages?: Readonly<Record<string, string>>;

    readonly tokenTypes?: Readonly<Record<string, "string" | "comment" | "other">>;

    readonly injectTo?: readonly string[];

    /** Не применяется. */
    readonly balancedBracketScopes?: readonly string[];
    readonly unbalancedBracketScopes?: readonly string[];
}
