import type { IWordRange } from "./wordClassification.ts";

/**
 * Калька upstream `wordHelper.ts`. Языковых `wordPattern` у нас нет: без регекса
 * расширения действует {@link DEFAULT_WORD_REGEXP}.
 */

/** upstream `createWordRegExp()` без исключений. */
export const DEFAULT_WORD_REGEXP = /(-?\d*\.\d\w*)|([^`~!@#$%^&*()\-=+[{\]}\\|;:'",.<>/?\s]+)/g;

/**
 * upstream `regExpLeadsToEndlessLoop`, но БЕЗ его белого списка (`^`, `$`, …):
 * такой регекс — не определение слова, `getWordAtText` на нём зациклился бы.
 * Свежая копия — `lastIndex` пользовательского регекса не трогаем.
 */
export function regExpMatchesEmptyString(regex: RegExp): boolean {
    return new RegExp(regex.source, regex.flags).test("");
}

/**
 * Как upstream `getWordAtText`: позиция сразу за словом — «на слове», на стыке
 * побеждает левое. Свежая копия регекса — `lastIndex` не несёт состояния между
 * вызовами.
 *
 * Сознательно без окна и бюджетов upstream (`maxLen` 1000, `windowSize` 15,
 * `timeBudget` 150 мс): они защищают UI-поток, а вызов идёт из процесса
 * расширений. Расхождение — только на строках длиннее 1000 со словом длиннее
 * 500: upstream обрезает слово по краю окна, мы отдаём целиком.
 */
export function getWordAtText(character: number, wordDefinition: RegExp, text: string): IWordRange | null {
    const regex = new RegExp(
        wordDefinition.source,
        wordDefinition.global ? wordDefinition.flags : wordDefinition.flags + "g",
    );
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
        if (match.index <= character && regex.lastIndex >= character) {
            return { start: match.index, end: regex.lastIndex };
        }
        // Пустое совпадение (`\b`, опережающая проверка) не сдвигает
        // `lastIndex` — без шага вручную `exec` вернул бы его же бесконечно.
        if (match[0].length === 0) regex.lastIndex++;
    }
    return null;
}
