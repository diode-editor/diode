import type { IWordRange } from "./wordClassification.ts";

/**
 * Слово по регулярному выражению — минимальная калька upstream
 * `vs/editor/common/core/wordHelper.ts`: дефолтное определение слова и поиск
 * слова, накрывающего позицию в строке. Потребитель —
 * `vscode.TextDocument.getWordRangeAtPosition` расширений; языковых
 * word-definition (`wordPattern` из language configuration) у нас нет, поэтому
 * без регекса расширения всегда действует {@link DEFAULT_WORD_REGEXP}.
 */

/**
 * Дефолтное определение слова upstream (`createWordRegExp()` без исключений):
 * первая группа ловит числа, включая дробные (`-1.5`, `.5e3`), вторая — всё,
 * что не разделитель `USUAL_WORD_SEPARATORS` и не пробельный символ.
 */
export const DEFAULT_WORD_REGEXP = /(-?\d*\.\d\w*)|([^`~!@#$%^&*()\-=+[{\]}\\|;:'",.<>/?\s]+)/g;

/**
 * Матчит ли регекс пустую строку — upstream `regExpLeadsToEndlessLoop`
 * (`base/common/strings.ts`), но БЕЗ его белого списка (`^`, `$`, `^$`,
 * `^\s*$`): тот нужен поиску по тексту, а здесь такой регекс — не
 * определение слова, и upstream на нём в `getWordAtText` зацикливается
 * (`exec` не сдвигает `lastIndex` после пустого совпадения). Проверка на
 * свежей копии: `lastIndex` пользовательского регекса не трогаем.
 */
export function regExpMatchesEmptyString(regex: RegExp): boolean {
    return new RegExp(regex.source, regex.flags).test("");
}

/**
 * Слово `[start, end)`, накрывающее `character` строки `text` (`null` — позиция
 * не на слове). Позиция сразу за последним символом слова тоже «на слове»; на
 * стыке двух слов побеждает левое — как upstream `getWordAtText`.
 *
 * Регекс без флага `g` дополняется им (upstream `ensureValidWordDefinition`),
 * иначе `exec` не идёт по строке. Сканируется всегда свежая копия, поэтому
 * общий {@link DEFAULT_WORD_REGEXP} и регекс расширения не несут состояния
 * `lastIndex` между вызовами.
 *
 * Сознательно без окна и бюджетов upstream (`maxLen` 1000, `windowSize` 15,
 * `timeBudget` 150 мс): они защищают редактор от катастрофического
 * бэктрекинга на длинных строках в UI-потоке. Здесь вызов идёт из процесса
 * расширений по его собственному регексу, а обход `exec` с начала строки на
 * обычных строках даёт то же слово, что и расширяющееся окно upstream (окно
 * лишь начинает скан ближе к позиции и расширяется, пока слово не перестанет
 * меняться). Расхождение возможно только на строках длиннее 1000 символов со
 * словом длиннее 500 — там upstream обрезает слово по краю окна, а мы отдаём
 * его целиком.
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
