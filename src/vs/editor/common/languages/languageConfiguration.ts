import type {
    CharacterPair,
    IAutoClosingPair,
    ICommentRule,
    ILanguageConfiguration,
    ISurroundingPair,
} from "../../../platform/extensions/common/iLanguageConfiguration.ts";

/**
 * Дефолт VS Code для `autoCloseBefore`: авто-закрытие пары срабатывает, только
 * когда сразу за кареткой один из этих символов (или конец строки). Не даёт
 * скобке/кавычке дописывать пару посреди слова.
 */
export const DEFAULT_AUTO_CLOSE_BEFORE = ";:.,=}])> \n\t";

/** Нормализованная пара авто-закрытия: всегда `{ open, close, notIn }`. */
export interface IResolvedAutoClosingPair {
    readonly open: string;
    readonly close: string;
    readonly notIn: readonly ("string" | "comment")[];
}

/**
 * `language-configuration.json`, приведённый к виду для потребителей —
 * команд комментирования и перехватчика набора. Сырой формат
 * ({@link ILanguageConfiguration}) допускает несколько кодировок одного и
 * того же (`CharacterPair` против `{ open, close }`) и наследование
 * отсутствующих секций; здесь всё это уже разрешено, как в
 * `ResolvedLanguageConfiguration` VS Code:
 *
 *  - `autoClosingPairs` отсутствуют → выводятся из `brackets`;
 *  - `surroundingPairs` отсутствуют → совпадают с `autoClosingPairs`.
 */
export interface IResolvedLanguageConfiguration {
    readonly comments: ICommentRule | undefined;
    readonly brackets: readonly CharacterPair[];
    readonly autoClosingPairs: readonly IResolvedAutoClosingPair[];
    readonly surroundingPairs: readonly CharacterPair[];
    readonly autoCloseBefore: string;
}

/** Конфигурация языка, у которого файла конфигурации нет вовсе (plaintext). */
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
    // JSONC без валидации схемы: запись может оказаться чем угодно (null, число,
    // строка). Отсекаем только null — на нём падает чтение поля; всё остальное
    // отсеется проверкой на строки ниже (у числа нет ни [0], ни .open).
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

/**
 * Разбирает секцию-массив: не-массив (JSONC не валидирован схемой) — пустая
 * секция, разобранные записи — без тех, что конвертер отверг.
 */
function mapSection<T, R>(value: readonly T[] | undefined, convert: (entry: T) => R | undefined): R[] {
    if (!isArrayOf(value)) return [];
    const result: R[] = [];
    for (const entry of value) {
        const converted = convert(entry);
        if (converted !== undefined) result.push(converted);
    }
    return result;
}

/**
 * Разворачивает сырой `language-configuration.json` в
 * {@link IResolvedLanguageConfiguration}. Битые записи (не-строки, пустые
 * open/close) молча отбрасываются — реальные файлы расширений пишутся руками,
 * и одна кривая пара не должна отключать язык целиком.
 */
export function resolveLanguageConfiguration(raw: ILanguageConfiguration): IResolvedLanguageConfiguration {
    const comments = resolveComments(raw.comments);

    const brackets = mapSection(raw.brackets, toCharacterPair);

    // Как в VS Code: без своей секции autoClosingPairs пары выводятся из brackets.
    const autoClosingPairs =
        raw.autoClosingPairs !== undefined
            ? mapSection(raw.autoClosingPairs, toAutoClosingPair)
            : brackets.map((pair) => ({ open: pair[0], close: pair[1], notIn: [] as const }));

    // Как в VS Code: без своей секции surroundingPairs обрамляют те же пары, что закрываются.
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
