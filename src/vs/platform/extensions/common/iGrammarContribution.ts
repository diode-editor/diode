export interface IGrammarContribution {
    /** Absent for an injection grammar (see `injectTo`). */
    readonly language?: string;

    readonly scopeName: string;

    /** Relative to the extension directory. */
    readonly path: string;

    /** Not passed to the TextMate loader yet. */
    readonly embeddedLanguages?: Readonly<Record<string, string>>;

    readonly tokenTypes?: Readonly<Record<string, "string" | "comment" | "other">>;

    readonly injectTo?: readonly string[];

    /** Not applied. */
    readonly balancedBracketScopes?: readonly string[];
    readonly unbalancedBracketScopes?: readonly string[];
}
