import type {
    CharacterPair,
    IAutoClosingPair,
    ICommentRule,
    ILanguageConfiguration,
    IOnEnterAction,
    IOnEnterRule,
    IRegExpDefinition,
    ISurroundingPair,
} from "../../../platform/extensions/common/iLanguageConfiguration.ts";

/** VS Code default: no pair is auto-closed in the middle of a word. */
export const DEFAULT_AUTO_CLOSE_BEFORE = ";:.,=}])> \n\t";

export interface IResolvedAutoClosingPair {
    readonly open: string;
    readonly close: string;
    readonly notIn: readonly ("string" | "comment")[];
}

export interface IResolvedOnEnterRule {
    readonly beforeText: RegExp;
    readonly afterText: RegExp | undefined;
    readonly previousLineText: RegExp | undefined;
    readonly action: IOnEnterAction;
}

/** Like VS Code `ResolvedLanguageConfiguration`: encodings and section inheritance are resolved. */
export interface IResolvedLanguageConfiguration {
    readonly comments: ICommentRule | undefined;
    readonly brackets: readonly CharacterPair[];
    readonly autoClosingPairs: readonly IResolvedAutoClosingPair[];
    readonly surroundingPairs: readonly CharacterPair[];
    readonly autoCloseBefore: string;
    readonly onEnterRules: readonly IResolvedOnEnterRule[];
    /** `undefined`: the language has none, upstream's `getWordDefinition` falls back to the default. */
    readonly wordPattern: RegExp | undefined;
}

export const EMPTY_LANGUAGE_CONFIGURATION: IResolvedLanguageConfiguration = {
    comments: undefined,
    brackets: [],
    autoClosingPairs: [],
    surroundingPairs: [],
    autoCloseBefore: DEFAULT_AUTO_CLOSE_BEFORE,
    onEnterRules: [],
    wordPattern: undefined,
};

function isCharacterPair(value: CharacterPair | IAutoClosingPair | ISurroundingPair): value is CharacterPair {
    return Array.isArray(value);
}

/**
 * `Array.isArray` on a typed value narrows to `any[]` and drops the entry types to `any`;
 * the predicate keeps the element type.
 */
function isArrayOf<T>(value: readonly T[] | undefined): value is readonly T[] {
    return Array.isArray(value);
}

function toAutoClosingPair(value: CharacterPair | IAutoClosingPair | null): IResolvedAutoClosingPair | undefined {
    // JSONC without schema validation: reject only null, since reading a field throws on it;
    // the string checks below filter out other junk.
    if (value === null) return undefined;
    const open = isCharacterPair(value) ? value[0] : value.open;
    const close = isCharacterPair(value) ? value[1] : value.close;
    if (typeof open !== "string" || typeof close !== "string" || open.length === 0 || close.length === 0) {
        return undefined;
    }
    const notIn = isCharacterPair(value) ? undefined : value.notIn;
    return { open, close, notIn: Array.isArray(notIn) ? notIn : [] };
}

function toCharacterPair(value: CharacterPair | ISurroundingPair | null | undefined): CharacterPair | undefined {
    if (value === null || value === undefined) return undefined;
    const open = isCharacterPair(value) ? value[0] : value.open;
    const close = isCharacterPair(value) ? value[1] : value.close;
    if (typeof open !== "string" || typeof close !== "string" || open.length === 0 || close.length === 0) {
        return undefined;
    }
    return [open, close];
}

function mapSection<T, R>(value: readonly T[] | undefined, convert: (entry: T) => R | undefined): R[] {
    if (!isArrayOf(value)) return [];
    const result: R[] = [];
    for (const entry of value) {
        const converted = convert(entry);
        if (converted !== undefined) result.push(converted);
    }
    return result;
}

/** Broken entries are silently dropped: one bad pair must not disable the whole language. */
export function resolveLanguageConfiguration(raw: ILanguageConfiguration): IResolvedLanguageConfiguration {
    const comments = resolveComments(raw.comments);

    const brackets = mapSection(raw.brackets, toCharacterPair);

    const autoClosingPairs =
        raw.autoClosingPairs !== undefined
            ? mapSection(raw.autoClosingPairs, toAutoClosingPair)
            : brackets.map((pair) => ({ open: pair[0], close: pair[1], notIn: [] as const }));

    const surroundingPairs =
        raw.surroundingPairs !== undefined
            ? mapSection(raw.surroundingPairs, toCharacterPair)
            : autoClosingPairs.map((pair): CharacterPair => [pair.open, pair.close]);

    const autoCloseBefore = typeof raw.autoCloseBefore === "string" ? raw.autoCloseBefore : DEFAULT_AUTO_CLOSE_BEFORE;

    const onEnterRules = mapSection(raw.onEnterRules, toOnEnterRule);

    const wordPattern = toRegExp(raw.wordPattern);

    return { comments, brackets, autoClosingPairs, surroundingPairs, autoCloseBefore, onEnterRules, wordPattern };
}

function toRegExp(value: string | IRegExpDefinition | null | undefined): RegExp | undefined {
    const definition = typeof value === "string" ? { pattern: value } : value;
    if (typeof definition?.pattern !== "string") return undefined;
    // Stryker disable BlockStatement: an empty catch returns undefined as well
    try {
        return new RegExp(definition.pattern, definition.flags);
    } catch {
        return undefined;
    }
    // Stryker restore BlockStatement
}

/** As upstream `_extractValidOnEnterRules`: a broken `beforeText` or `indent` drops the rule, a broken optional regex only itself. */
function toOnEnterRule(rule: IOnEnterRule | null): IResolvedOnEnterRule | undefined {
    if (rule === null) return undefined;
    const action = rule.action as IOnEnterAction | null | undefined;
    if (typeof action !== "object" || action === null) return undefined;
    if (!["none", "indent", "indentOutdent", "outdent"].includes(action.indent)) return undefined;
    const beforeText = toRegExp(rule.beforeText);
    if (beforeText === undefined) return undefined;
    return {
        beforeText,
        afterText: toRegExp(rule.afterText),
        previousLineText: toRegExp(rule.previousLineText),
        action: {
            indent: action.indent,
            ...(typeof action.appendText === "string" ? { appendText: action.appendText } : {}),
            ...(typeof action.removeText === "number" ? { removeText: action.removeText } : {}),
        },
    };
}

function resolveComments(raw: ICommentRule | null | undefined): ICommentRule | undefined {
    if (raw === null || raw === undefined) return undefined;
    const lineComment = typeof raw.lineComment === "string" && raw.lineComment.length > 0 ? raw.lineComment : undefined;
    const blockComment = toCharacterPair(raw.blockComment);
    if (lineComment === undefined && blockComment === undefined) return undefined;
    return { lineComment, blockComment };
}
