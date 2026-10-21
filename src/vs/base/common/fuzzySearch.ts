/**
 * VS Code-like fuzzy matching with word-boundary and consecutive bonuses.
 *
 * Scoring constants are tuned so that:
 *   - matches at word boundaries ("AC" → "AppContainer") beat sequential
 *     matches in the middle of a word ("AC" → "abstract")
 *   - consecutive matched characters beat scattered ones
 *   - a match on the basename beats a match only in the directory path
 */

export interface FuzzyMatch {
    score: number;
    matchedIndices: readonly number[];
}

const WORD_START_BONUS = 80;
const CONSECUTIVE_BONUS = 40;
const FIRST_CHAR_BONUS = 60;
const GAP_PENALTY = 1;

function isWordBoundary(text: string, i: number): boolean {
    if (i === 0) return true;
    const prev = text[i - 1];
    if ("/\\-_.  ".includes(prev)) return true;
    const cur = text[i];
    if (cur >= "A" && cur <= "Z" && prev >= "a" && prev <= "z") return true;
    return false;
}

/** Greedy sequential match, no backtracking. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
    if (query.length === 0) {
        return { score: 0, matchedIndices: [] };
    }
    return fuzzyMatchLower(query.toLowerCase(), text, text.toLowerCase());
}

/** Tries several start positions for the first character and keeps the best — a cheap heuristic, not full backtracking. */
export function fuzzyMatchBest(query: string, text: string): FuzzyMatch | null {
    if (query.length === 0) return { score: 0, matchedIndices: [] };
    return fuzzyMatchBestLower(query.toLowerCase(), text, text.toLowerCase());
}

/**
 * Pre-lowercased variant for the hot path: file search lowercases each entry once
 * at index-build time and the query once per keystroke. `text` (original case) is
 * still needed for camelCase scoring.
 */
export function fuzzyMatchLower(queryLower: string, text: string, textLower: string): FuzzyMatch | null {
    if (queryLower.length === 0) {
        return { score: 0, matchedIndices: [] };
    }

    const matchedIndices: number[] = [];
    let ti = 0;
    for (const ch of queryLower) {
        let found = false;
        while (ti < textLower.length) {
            if (textLower[ti] === ch) {
                matchedIndices.push(ti);
                ti++;
                found = true;
                break;
            }
            ti++;
        }
        if (!found) return null;
    }

    return { score: scoreMatch(text, matchedIndices), matchedIndices };
}

export function fuzzyMatchBestLower(queryLower: string, text: string, textLower: string): FuzzyMatch | null {
    if (queryLower.length === 0) return { score: 0, matchedIndices: [] };

    const qFirst = queryLower[0];

    const candidates: number[] = [];
    for (let i = 0; i < textLower.length; i++) {
        if (textLower[i] === qFirst) {
            candidates.push(i);
            if (candidates.length >= 8) break;
        }
    }

    if (candidates.length === 0) return null;

    let best: FuzzyMatch | null = null;
    for (const start of candidates) {
        const result = fuzzyMatchFromLower(queryLower, text, textLower, start);
        if (result !== null && (best === null || result.score > best.score)) {
            best = result;
        }
    }
    return best;
}

function fuzzyMatchFromLower(queryLower: string, text: string, textLower: string, startAt: number): FuzzyMatch | null {
    /* v8 ignore start -- defensive: the only caller passes startAt positions where textLower[startAt] already equals queryLower[0] */
    if (textLower[startAt] !== queryLower[0]) return null;
    /* v8 ignore stop */

    const matchedIndices: number[] = [startAt];
    let ti = startAt + 1;

    for (let qi = 1; qi < queryLower.length; qi++) {
        const ch = queryLower[qi];
        let found = false;
        while (ti < textLower.length) {
            if (textLower[ti] === ch) {
                matchedIndices.push(ti);
                ti++;
                found = true;
                break;
            }
            ti++;
        }
        if (!found) return null;
    }

    return { score: scoreMatch(text, matchedIndices), matchedIndices };
}

function scoreMatch(text: string, matchedIndices: readonly number[]): number {
    let score = 0;
    let prevMatched = -1;

    for (let i = 0; i < matchedIndices.length; i++) {
        const pos = matchedIndices[i];

        const gapFrom = i === 0 ? 0 : prevMatched + 1;
        const gap = pos - gapFrom;
        score -= gap * GAP_PENALTY;

        if (pos === 0) score += FIRST_CHAR_BONUS;
        if (isWordBoundary(text, pos)) score += WORD_START_BONUS;
        if (prevMatched !== -1 && pos === prevMatched + 1) score += CONSECUTIVE_BONUS;

        prevMatched = pos;
    }

    return score;
}

/**
 * Folds the set of characters present in `textLower` into a 32-bit presence
 * mask: bit `code & 31` is set for every character code in the string.
 *
 * Used as a cheap **necessary-condition prefilter** for fuzzy matching: a fuzzy
 * match requires every query character to appear in the text, so if
 * `(textMask & queryMask) !== queryMask` the match is impossible and the
 * expensive matcher can be skipped. Because distinct characters may fold onto
 * the same bit (e.g. digits collide with some letters), the filter can let a
 * non-matching entry through to the matcher — but it can **never** reject a real
 * match, so results are unchanged. The `a`–`z` range (codes 97–122) maps to bits
 * 1–26 collision-free, which keeps the common file alphabet well separated.
 */
export function charMask(textLower: string): number {
    let mask = 0;
    for (let i = 0; i < textLower.length; i++) {
        mask |= 1 << (textLower.charCodeAt(i) & 31);
    }
    return mask;
}

const QUERY_SEPARATOR = /\s+/;

/**
 * Запрос, разобранный один раз на термы — аналог `prepareQuery` VS Code
 * (`vs/base/common/fuzzyScorer.ts`). Пробел — **разделитель термов**, а не искомый
 * символ: `src other` ищет записи, где есть и `src`, и `other`, в любом порядке.
 */
export interface PreparedQuery {
    /** Пустой массив (в том числе из одних пробелов) совпадает со всем. */
    readonly terms: readonly string[];
    /** Маска всех термов ({@link charMask}) для отсева на стороне вызывающего; пробелов в ней нет. */
    readonly bits: number;
}

/**
 * Считать **один раз на нажатие**, до цикла по записям. Ведущий, хвостовой и
 * повторные пробелы термами не становятся: пользователь набирает на ходу, и
 * хвостовой пробел не должен гасить список.
 */
export function prepareQuery(query: string): PreparedQuery {
    const terms: string[] = [];
    let bits = 0;
    for (const word of query.split(QUERY_SEPARATOR)) {
        if (word === "") continue;
        const term = word.toLowerCase();
        terms.push(term);
        bits |= charMask(term);
    }
    return { terms, bits };
}

/**
 * Совпасть обязаны **все** термы (AND), каждый — самостоятельным
 * {@link fuzzyMatchBest} в любом месте текста. Границы слов считаются по самому
 * `text`, поэтому разбиение запроса бонусов не отнимает.
 */
export function fuzzyMatchPrepared(query: PreparedQuery, text: string): FuzzyMatch | null {
    return fuzzyMatchPreparedLower(query, text, text.toLowerCase());
}

export function fuzzyMatchPreparedLower(query: PreparedQuery, text: string, textLower: string): FuzzyMatch | null {
    const { terms } = query;
    if (terms.length === 0) return { score: 0, matchedIndices: [] };

    const first = fuzzyMatchBestLower(terms[0], text, textLower);
    if (first === null) return null;
    // Ветка чисто за скорость: горячий путь (10k записей индекса на каждое
    // нажатие) лишнего копирования не прощает — замерено бенчом
    // `FileSearchService.search`, на запросе `dir2` сведение стоит ×1.6.
    // Stryker disable next-line ConditionalExpression: мутант в `false` эквивалентен — общий путь ниже на одном терме даёт тот же результат, отличить его тестом нельзя, только бенчом.
    if (terms.length === 1) return first;

    let score = first.score;
    const indices = [...first.matchedIndices];
    for (const term of terms.slice(1)) {
        const match = fuzzyMatchBestLower(term, text, textLower);
        if (match === null) return null;
        score += match.score;
        indices.push(...match.matchedIndices);
    }

    return { score, matchedIndices: ascendingUnique(indices) };
}

/**
 * Термы матчатся независимо, поэтому их наборы идут вразнобой и могут накрыть
 * одну позицию (`ab ba` в «aba»), а потребители подсветки склеивают соседние
 * индексы в диапазон и ждут возрастающий набор. Сортирует `indices` на месте.
 */
function ascendingUnique(indices: number[]): number[] {
    indices.sort((a, b) => a - b);
    const unique: number[] = [];
    for (const index of indices) {
        if (unique.at(-1) !== index) unique.push(index);
    }
    return unique;
}
