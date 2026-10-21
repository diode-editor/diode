/** VS Code `editor.wordSeparators` плюс пробельные. */
export const WORD_SEPARATORS = new Set(" \t\r\n`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?");

/** 0 = whitespace, 1 = punctuation/separator, 2 = word character. */
export function charClass(ch: string): number {
    if (ch === " " || ch === "\t") return 0;
    if (WORD_SEPARATORS.has(ch)) return 1;
    return 2;
}

/** Пустая строка (граница строки) — не символ слова. */
export function isWordChar(ch: string): boolean {
    return ch.length === 1 && charClass(ch) === 2;
}

/** `[start, end)`. */
export interface IWordRange {
    readonly start: number;
    readonly end: number;
}

/** Как `getWordAtPosition` VS Code: каретка сразу ПОСЛЕ слова (`foo|`) — тоже на слове. */
export function findWordRangeAt(line: string, character: number): IWordRange | null {
    const len = line.length;
    // Протухшая на кадр позиция роняла бы ВЕСЬ редактор: highlight вхождений
    // зовётся из render, исключение оттуда не ловит никто. Кламп — как
    // `validatePosition` в vscode.
    const caret = Math.max(0, Math.min(Math.trunc(character), len));
    let anchor: number;
    if (caret < len && isWordChar(line[caret])) {
        anchor = caret;
    } else if (caret > 0 && isWordChar(line[caret - 1])) {
        anchor = caret - 1;
    } else {
        return null;
    }

    let start = anchor;
    while (start > 0 && isWordChar(line[start - 1])) start--;
    let end = anchor + 1;
    while (end < len && isWordChar(line[end])) end++;
    return { start, end };
}
