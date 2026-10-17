/**
 * Идентификатор-подобное «слово» для word-based автодополнения — буквы любого
 * алфавита (как эталонный `DEFAULT_WORD_REGEXP`): кириллические слова буфера
 * тоже подсказываются.
 */
const WORD_RE = /[\p{L}_][\p{L}\p{M}\p{N}_]*/gu;

/** Минимальная длина слова (одиночные буквы — шум). */
const MIN_WORD_LENGTH = 2;

/** Предельный размер документа-источника, байт: большие файлы пропускаем (как VS Code). */
const DEFAULT_MAX_BYTES_PER_TEXT = 1_000_000;

/** Кап на число собранных слов (ограничивает список и время). */
const DEFAULT_MAX_WORDS = 1000;

export interface IWordCompletionOptions {
    readonly maxBytesPerText?: number;
    readonly maxWords?: number;
}

/**
 * Собирает уникальные слова из набора текстов (все открытые редакторы) для
 * word-based автодополнения — аналог `editor.wordBasedSuggestions` в VS Code,
 * когда языковые провайдеры ничего не дали.
 *
 * Защиты для больших файлов (как VS Code, который исключает слишком большие
 * модели из фичи): документы крупнее `maxBytesPerText` пропускаются целиком, а
 * общее число слов ограничено `maxWords`. Слово `exclude` (набираемый префикс
 * под курсором) не включается.
 */
export function collectWordCompletions(
    texts: readonly string[],
    exclude: string,
    options: IWordCompletionOptions = {},
): string[] {
    const maxBytes = options.maxBytesPerText ?? DEFAULT_MAX_BYTES_PER_TEXT;
    const maxWords = options.maxWords ?? DEFAULT_MAX_WORDS;

    const seen = new Set<string>();
    const words: string[] = [];
    for (const text of texts) {
        if (text.length > maxBytes) continue; // слишком большой источник — пропускаем
        WORD_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = WORD_RE.exec(text)) !== null) {
            const word = match[0];
            if (word.length < MIN_WORD_LENGTH || word === exclude || seen.has(word)) continue;
            seen.add(word);
            words.push(word);
            if (words.length >= maxWords) return words;
        }
    }
    return words;
}
