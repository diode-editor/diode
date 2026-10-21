/** Letters of any script, like upstream `DEFAULT_WORD_REGEXP`. */
const WORD_RE = /[\p{L}_][\p{L}\p{M}\p{N}_]*/gu;

const MIN_WORD_LENGTH = 2;

/** Bytes; a larger source is skipped entirely (like VS Code). */
const DEFAULT_MAX_BYTES_PER_TEXT = 1_000_000;

const DEFAULT_MAX_WORDS = 1000;

export interface IWordCompletionOptions {
    readonly maxBytesPerText?: number;
    readonly maxWords?: number;
}

/** The `exclude` word (the prefix being typed under the cursor) is left out. */
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
        if (text.length > maxBytes) continue;
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
