import { CharCode } from "../../../base/common/charCode.ts";

import type { ITextDocument } from "./iTextDocument.ts";

export interface DetectedIndentation {
    readonly insertSpaces: boolean;
    readonly tabSize: number;
}

/**
 * Чем закрывается всё, о чём содержимое файла промолчало: файл без отступов,
 * ничья «табы против пробелов», отступ табами (там ширина таба — вопрос вкуса,
 * а не файла). Сюда приезжают `editor.tabSize` / `editor.insertSpaces`.
 */
export interface IIndentationDefaults {
    readonly tabSize: number;
    readonly insertSpaces: boolean;
}

const MAX_SCAN_LINES = 10000;
const MAX_TAB_SIZE_GUESS = 8;
/** Порядок перебора: при равном счёте побеждает более ранний кандидат. */
const TAB_SIZE_GUESSES = [2, 4, 6, 8, 3, 5, 7];

interface ISpacesDiff {
    /** Величина шага отступа между двумя строками; 0 — шага нет либо сигнал негодный. */
    spacesDiff: number;
    /** Строка не отступлена, а выровнена под содержимое предыдущей. */
    looksLikeAlignment: boolean;
}

/**
 * Шаг отступа между двумя строками: общий префикс отбрасывается, сравниваются
 * хвосты. Считаем именно РАЗНИЦУ соседних строк, а не абсолютные ширины: файл с
 * отступом в 4 пробела содержит уровни 4, 8, 12, и «самая частая ширина» там
 * значит не то же самое, что шаг.
 *
 * `a`/`b` — полные тексты строк, `aLength`/`bLength` — длины их отступов.
 * Результат пишется в `result` (объект переиспользуется на весь скан).
 */
function computeSpacesDiff(a: string, aLength: number, b: string, bLength: number, result: ISpacesDiff): void {
    result.spacesDiff = 0;
    result.looksLikeAlignment = false;

    let i = 0;
    for (; i < aLength && i < bLength; i++) {
        if (a.charCodeAt(i) !== b.charCodeAt(i)) break;
    }

    let aSpaces = 0;
    let aTabs = 0;
    for (let j = i; j < aLength; j++) {
        if (a.charCodeAt(j) === CharCode.Space) aSpaces++;
        else aTabs++;
    }
    let bSpaces = 0;
    let bTabs = 0;
    for (let j = i; j < bLength; j++) {
        if (b.charCodeAt(j) === CharCode.Space) bSpaces++;
        else bTabs++;
    }

    // Смешанный хвост (и табы, и пробелы) — разницу не с чем сопоставить.
    if (aSpaces > 0 && aTabs > 0) return;
    if (bSpaces > 0 && bTabs > 0) return;

    const tabsDiff = Math.abs(aTabs - bTabs);
    const spacesDiff = Math.abs(aSpaces - bSpaces);

    if (tabsDiff === 0) {
        result.spacesDiff = spacesDiff;
        // Продолжение, выровненное под символ предыдущей строки (`foo(a,` →
        // `    b`), — это не отступ: первый непробельный символ `b` встал ровно
        // за пробелом внутри `a`, а сама `a` кончается запятой.
        if (
            spacesDiff > 0 &&
            b.charCodeAt(bSpaces) !== CharCode.Space &&
            a.charCodeAt(bSpaces - 1) === CharCode.Space &&
            a.charCodeAt(a.length - 1) === CharCode.Comma
        ) {
            result.looksLikeAlignment = true;
        }
        return;
    }
    // Табы и пробелы вперемешку по строкам: сигнал годен, только если пробелы
    // делятся на число «съеденных» табов нацело — тогда это ширина таба.
    if (spacesDiff % tabsDiff === 0) {
        result.spacesDiff = spacesDiff / tabsDiff;
    }
}

/**
 * Определяет стиль отступа по содержимому документа. Всегда возвращает ответ:
 * то, о чём файл промолчал, берётся из {@link defaults}.
 */
export function detectIndentation(document: ITextDocument, defaults: IIndentationDefaults): DetectedIndentation {
    const lineCount = Math.min(document.lineCount, MAX_SCAN_LINES);

    let tabIndentedLines = 0;
    let spaceIndentedLines = 0;
    /** Гистограмма шагов: индекс — величина шага, значение — сколько раз встретился. */
    const diffCounts = new Array<number>(MAX_TAB_SIZE_GUESS + 1).fill(0);

    let previousLineText = "";
    let previousLineIndent = 0;
    const diff: ISpacesDiff = { spacesDiff: 0, looksLikeAlignment: false };

    for (let i = 0; i < lineCount; i++) {
        const lineText = document.getLineContent(i);
        let spaces = 0;
        let tabs = 0;
        let indent = -1;
        for (let j = 0; j < lineText.length; j++) {
            const charCode = lineText.charCodeAt(j);
            if (charCode === CharCode.Tab) tabs++;
            else if (charCode === CharCode.Space) spaces++;
            else {
                indent = j;
                break;
            }
        }
        // Пустые и целиком пробельные строки сигнала не несут и предыдущую не
        // сбрасывают: отступ сравнивается сквозь них.
        if (indent === -1) continue;

        if (tabs > 0) tabIndentedLines++;
        // Ровно один ведущий пробел — это `*` в блочном комментарии, а не отступ.
        else if (spaces > 1) spaceIndentedLines++;

        computeSpacesDiff(previousLineText, previousLineIndent, lineText, indent, diff);
        // Выровненное продолжение не идёт ни в гистограмму, ни в базу для
        // следующей строки — иначе оно сдвинуло бы и её шаг.
        if (diff.looksLikeAlignment) continue;
        if (diff.spacesDiff <= MAX_TAB_SIZE_GUESS) diffCounts[diff.spacesDiff]++;

        previousLineText = lineText;
        previousLineIndent = indent;
    }

    const insertSpaces =
        tabIndentedLines === spaceIndentedLines ? defaults.insertSpaces : tabIndentedLines < spaceIndentedLines;
    // Ширина таба — свойство просмотра, а не файла: отступ табами о ней молчит.
    if (!insertSpaces) return { insertSpaces, tabSize: defaults.tabSize };

    let tabSize = defaults.tabSize;
    let bestScore = 0;
    for (const guess of TAB_SIZE_GUESSES) {
        if (diffCounts[guess] > bestScore) {
            bestScore = diffCounts[guess];
            tabSize = guess;
        }
    }
    // В файле с отступом в 2 шаг 4 встречается на каждом «двойном» переходе и
    // может обогнать 2 по частоте. Отдаём победу двойке, если она встретилась
    // хотя бы вполовину так же часто.
    if (tabSize === 4 && diffCounts[4] > 0 && diffCounts[2] >= diffCounts[4] / 2) tabSize = 2;

    return { insertSpaces, tabSize };
}
