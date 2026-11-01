export interface ILanguageConfiguration {
    readonly comments?: ICommentRule;
    readonly brackets?: readonly CharacterPair[];
    readonly autoClosingPairs?: readonly (CharacterPair | IAutoClosingPair)[];
    readonly autoCloseBefore?: string;
    readonly surroundingPairs?: readonly (CharacterPair | ISurroundingPair)[];
    readonly onEnterRules?: readonly IOnEnterRule[];
    // Not honored yet: `resolveLanguageConfiguration` drops the sections below.
    readonly colorizedBracketPairs?: readonly CharacterPair[];
    readonly wordPattern?: string | IRegExpDefinition;
    readonly indentationRules?: IIndentationRules;
    readonly folding?: IFoldingRules;
}

export type CharacterPair = readonly [string, string];

export interface ICommentRule {
    readonly lineComment?: string;
    readonly blockComment?: CharacterPair;
}

export interface IAutoClosingPair {
    readonly open: string;
    readonly close: string;
    readonly notIn?: readonly ("string" | "comment")[];
}

export interface ISurroundingPair {
    readonly open: string;
    readonly close: string;
}

export interface IRegExpDefinition {
    readonly pattern: string;
    readonly flags?: string;
}

export interface IIndentationRules {
    readonly increaseIndentPattern: string | IRegExpDefinition;
    readonly decreaseIndentPattern: string | IRegExpDefinition;
    readonly indentNextLinePattern?: string | IRegExpDefinition;
    readonly unIndentedLinePattern?: string | IRegExpDefinition;
}

export interface IFoldingRules {
    readonly offSide?: boolean;
    readonly markers?: {
        readonly start: string | IRegExpDefinition;
        readonly end: string | IRegExpDefinition;
    };
}

export interface IOnEnterRule {
    readonly beforeText: string | IRegExpDefinition;
    readonly afterText?: string | IRegExpDefinition;
    readonly previousLineText?: string | IRegExpDefinition;
    readonly action: IOnEnterAction;
}

export interface IOnEnterAction {
    readonly indent: "none" | "indent" | "indentOutdent" | "outdent";
    readonly appendText?: string;
    readonly removeText?: number;
}
