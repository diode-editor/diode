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
    /** Indices into `text` (lowercase normalised) that were matched. */
    matchedIndices: readonly number[];
}

const WORD_START_BONUS = 80;
const CONSECUTIVE_BONUS = 40;
const FIRST_CHAR_BONUS = 60;
const GAP_PENALTY = 1;

/**
 * Returns true if position `i` in `text` is the start of a "word" for
 * scoring purposes.  A word boundary occurs:
 *  - at index 0
 *  - after a path separator, dash, underscore, dot, or space
 *  - at an uppercase letter preceded by a lowercase letter (camelCase)
 */
function isWordBoundary(text: string, i: number): boolean {
    if (i === 0) return true;
    const prev = text[i - 1];
    if ("/\\-_.  ".includes(prev)) return true;
    const cur = text[i];
    // camelCase: lowercase → uppercase transition
    if (cur >= "A" && cur <= "Z" && prev >= "a" && prev <= "z") return true;
    return false;
}

/**
 * Greedy sequential fuzzy match of `query` inside `text`.
 *
 * Returns `null` if not all characters of `query` can be found in order.
 * Empty query always matches with score 0.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
    if (query.length === 0) {
        return { score: 0, matchedIndices: [] };
    }
    return fuzzyMatchLower(query.toLowerCase(), text, text.toLowerCase());
}

/**
 * Picks the better of two candidate match positions for the first query
 * character.  When the greedy algorithm lands on a low-value position,
 * we scan ahead looking for a word-boundary occurrence and compare scores.
 *
 * This is a lightweight "best-of-two" heuristic — not full backtracking.
 */
export function fuzzyMatchBest(query: string, text: string): FuzzyMatch | null {
    if (query.length === 0) return { score: 0, matchedIndices: [] };
    return fuzzyMatchBestLower(query.toLowerCase(), text, text.toLowerCase());
}

/**
 * Same as `fuzzyMatch` but takes a pre-lowercased query and text. This avoids
 * re-allocating lowercase strings on every call — the hot path (file search)
 * pre-computes `textLower` once per entry at index-build time and lowercases the
 * query once per keystroke. `text` (original case) is still needed for
 * word-boundary/camelCase scoring.
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

/**
 * Same as `fuzzyMatchBest` but takes a pre-lowercased query and text.
 * See {@link fuzzyMatchLower} for why this matters on the hot path.
 */
export function fuzzyMatchBestLower(queryLower: string, text: string, textLower: string): FuzzyMatch | null {
    if (queryLower.length === 0) return { score: 0, matchedIndices: [] };

    const qFirst = queryLower[0];

    // Collect candidate start positions for the first character
    const candidates: number[] = [];
    for (let i = 0; i < textLower.length; i++) {
        if (textLower[i] === qFirst) {
            candidates.push(i);
            // Don't bother trying more than 8 starting positions
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

/**
 * Like `fuzzyMatchLower` but forces the first matched index to be `startAt`.
 * Returns null if remaining characters cannot be matched.
 */
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

/**
 * Scores a set of matched positions in `text` (original case) using gap
 * penalties and word-boundary / first-char / consecutive bonuses.
 */
function scoreMatch(text: string, matchedIndices: readonly number[]): number {
    let score = 0;
    let prevMatched = -1;

    for (let i = 0; i < matchedIndices.length; i++) {
        const pos = matchedIndices[i];

        // Gap penalty: characters between previous match and this one
        const gapFrom = i === 0 ? 0 : prevMatched + 1;
        const gap = pos - gapFrom;
        score -= gap * GAP_PENALTY;

        // Position bonuses
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
 *
 * Pass an already-lowercased string so the mask is case-insensitive, matching
 * the case-folding of {@link fuzzyMatchLower}.
 */
export function charMask(textLower: string): number {
    let mask = 0;
    for (let i = 0; i < textLower.length; i++) {
        mask |= 1 << (textLower.charCodeAt(i) & 31);
    }
    return mask;
}

// ─── Подготовленный запрос: термы вместо одной строки ────────────────────────

/** Разделитель термов запроса: любая непустая последовательность пробельных. */
const QUERY_SEPARATOR = /\s+/;

/**
 * Запрос, разобранный один раз на термы — наш аналог `prepareQuery` VS Code
 * (`vs/base/common/fuzzyScorer.ts`).
 *
 * Пробел в запросе — **разделитель термов**, а не символ, который надо найти в
 * тексте: `src other` ищет записи, где есть и `src`, и `other`, в любом порядке
 * и в любом месте. Без этого пробел уезжал в матчер обычным символом, и запрос
 * из двух слов находил только текст, где пробел стоит ровно между ними.
 */
export interface PreparedQuery {
    /**
     * Термы в нижнем регистре, в порядке набора. Пустой массив — пустой запрос
     * (в том числе из одних пробелов): он совпадает со всем.
     */
    readonly terms: readonly string[];
    /**
     * Объединённая маска символов всех термов ({@link charMask}) — готовый
     * отсев для вызывающего, который держит такие же маски у своих записей.
     * Пробелов в ней нет: они разделители, а не искомые символы.
     */
    readonly bits: number;
}

/**
 * Разбирает строку запроса на термы. Считать результат надо **один раз на
 * нажатие**, до цикла по записям: это и есть смысл «подготовленного» запроса —
 * лоуэркейс, сплит и маска не повторяются на каждую запись (ровно то свойство,
 * ради которого существуют `*Lower`-варианты матчера).
 *
 * Лишние пробелы термами не становятся: ведущий, хвостовой и повторные
 * игнорируются, поэтому `go  line` и `go line ` ведут себя как `go line` —
 * пользователь набирает на ходу, и хвостовой пробел не должен гасить список.
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
 * Матчит подготовленный запрос против `text`: совпасть обязаны **все** термы
 * (AND), каждый — самостоятельным {@link fuzzyMatchBest} в любом месте текста.
 * Очки суммируются по термам, индексы совпадений сводятся в один возрастающий
 * набор.
 *
 * Границы слов считаются по самому `text`, поэтому разбиение запроса бонусов не
 * отнимает: терм `panel` в «View: Toggle Panel Visibility» по-прежнему попадает
 * на границу слова после пробела.
 */
export function fuzzyMatchPrepared(query: PreparedQuery, text: string): FuzzyMatch | null {
    return fuzzyMatchPreparedLower(query, text, text.toLowerCase());
}

/**
 * Как {@link fuzzyMatchPrepared}, но с заранее приведённым к нижнему регистру
 * текстом. См. {@link fuzzyMatchLower} — зачем это нужно на горячем пути.
 */
export function fuzzyMatchPreparedLower(query: PreparedQuery, text: string, textLower: string): FuzzyMatch | null {
    const { terms } = query;
    // Пустой запрос совпадает со всем на нулевые очки и без подсветки — список
    // остаётся целым и в исходном порядке источника.
    if (terms.length === 0) return { score: 0, matchedIndices: [] };

    const first = fuzzyMatchBestLower(terms[0], text, textLower);
    // AND по термам: ненайденный терм отбрасывает запись целиком.
    if (first === null) return null;
    // Один терм — его набор уже возрастающий и без повторов, сводить нечего.
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
 * Сводит индексы, набранные по термам, в один возрастающий набор без повторов:
 * термы матчатся независимо, поэтому их наборы идут вразнобой и могут накрыть
 * одну и ту же позицию (`ab ba` в «aba»). Потребители подсветки ждут именно
 * возрастающий набор — соседние индексы они склеивают в диапазон по хвосту.
 *
 * Сортирует `indices` на месте: массив собран вызывающим и больше никому не
 * принадлежит.
 */
function ascendingUnique(indices: number[]): number[] {
    indices.sort((a, b) => a - b);
    const unique: number[] = [];
    for (const index of indices) {
        if (unique.at(-1) !== index) unique.push(index);
    }
    return unique;
}
