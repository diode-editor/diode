import type {
    CharacterPair,
    IAutoClosingPair,
    ICommentRule,
    ILanguageConfiguration,
    ISurroundingPair,
} from "../../../platform/extensions/common/iLanguageConfiguration.ts";

/** Дефолт VS Code: пара не дописывается посреди слова. */
export const DEFAULT_AUTO_CLOSE_BEFORE = ";:.,=}])> \n\t";

export interface IResolvedAutoClosingPair {
    readonly open: string;
    readonly close: string;
    readonly notIn: readonly ("string" | "comment")[];
}

/** Как `ResolvedLanguageConfiguration` VS Code: кодировки и наследование секций уже разрешены. */
export interface IResolvedLanguageConfiguration {
    readonly comments: ICommentRule | undefined;
    readonly brackets: readonly CharacterPair[];
    readonly autoClosingPairs: readonly IResolvedAutoClosingPair[];
    readonly surroundingPairs: readonly CharacterPair[];
    readonly autoCloseBefore: string;
}

export const EMPTY_LANGUAGE_CONFIGURATION: IResolvedLanguageConfiguration = {
    comments: undefined,
    brackets: [],
    autoClosingPairs: [],
    surroundingPairs: [],
    autoCloseBefore: DEFAULT_AUTO_CLOSE_BEFORE,
};

function isCharacterPair(value: CharacterPair | IAutoClosingPair | ISurroundingPair): value is CharacterPair {
    return Array.isArray(value);
}

/**
 * `Array.isArray` на типизированном значении сужает к `any[]` и роняет типы
 * записей в `any`; предикат оставляет элементу его тип.
 */
function isArrayOf<T>(value: readonly T[] | undefined): value is readonly T[] {
    return Array.isArray(value);
}

function toAutoClosingPair(value: CharacterPair | IAutoClosingPair | null): IResolvedAutoClosingPair | undefined {
    // JSONC без валидации схемы: отсекаем только null — на нём падает чтение
    // поля; прочий мусор отсеет проверка на строки ниже.
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

/** Битые записи молча отбрасываются: одна кривая пара не должна отключать язык целиком. */
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

    return { comments, brackets, autoClosingPairs, surroundingPairs, autoCloseBefore };
}

function resolveComments(raw: ICommentRule | null | undefined): ICommentRule | undefined {
    if (raw === null || raw === undefined) return undefined;
    const lineComment = typeof raw.lineComment === "string" && raw.lineComment.length > 0 ? raw.lineComment : undefined;
    const blockComment = toCharacterPair(raw.blockComment);
    if (lineComment === undefined && blockComment === undefined) return undefined;
    return { lineComment, blockComment };
}
