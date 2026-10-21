import { CharCode } from "../../../base/common/charCode.ts";

import type { ITextDocument } from "./iTextDocument.ts";

// number против enum CharCode линтер сравнивать не даёт (no-unsafe-enum-comparison).
const SPACE: number = CharCode.Space;
const TAB: number = CharCode.Tab;
const COMMA: number = CharCode.Comma;

export interface DetectedIndentation {
    readonly insertSpaces: boolean;
    readonly tabSize: number;
}

/** То, о чём файл промолчал: нет отступов, ничья табов и пробелов, ширина таба при отступе табами. */
export interface IIndentationDefaults {
    readonly tabSize: number;
    readonly insertSpaces: boolean;
}

const MAX_SCAN_LINES = 10000;
const MAX_TAB_SIZE_GUESS = 8;
/** Порядок перебора: при равном счёте побеждает более ранний кандидат. */
const TAB_SIZE_GUESSES = [2, 4, 6, 8, 3, 5, 7];

export interface IIndentationStep {
    /** 0 — шага нет либо сигнал негодный. */
    readonly step: number;
    /** Строка не отступлена, а выровнена под содержимое предыдущей. */
    readonly looksLikeAlignment: boolean;
}

const NO_STEP: IIndentationStep = { step: 0, looksLikeAlignment: false };

/**
 * РАЗНИЦА соседних строк, а не абсолютные ширины: у отступа в 4 уровни 4, 8, 12,
 * и самая частая ширина — не шаг. `aIndent`/`bIndent` — длины отступов.
 */
export function computeIndentationStep(a: string, aIndent: number, b: string, bIndent: number): IIndentationStep {
    // Stryker disable next-line MethodExpression: min и max тут неразличимы —
    // за более коротким отступом у одной строки стоит непробельный символ, а у
    // другой пробел или таб, так что цикл всё равно останавливается на min.
    const common = Math.min(aIndent, bIndent);
    let i = 0;
    // Stryker disable next-line EqualityOperator: лишний шаг ненаблюдаем — он
    // уходит за отступ хотя бы одной строки, а счётчики ниже ограничены её
    // длиной и всё равно ничего не насчитают.
    for (; i < common; i++) {
        if (a.charCodeAt(i) !== b.charCodeAt(i)) break;
    }

    let aSpaces = 0;
    let aTabs = 0;
    for (let j = i; j < aIndent; j++) {
        if (a.charCodeAt(j) === SPACE) aSpaces++;
        else aTabs++;
    }
    let bSpaces = 0;
    let bTabs = 0;
    for (let j = i; j < bIndent; j++) {
        if (b.charCodeAt(j) === SPACE) bSpaces++;
        else bTabs++;
    }

    // Смешанный хвост (и табы, и пробелы) — разницу не с чем сопоставить.
    if (aSpaces > 0 && aTabs > 0) return NO_STEP;
    if (bSpaces > 0 && bTabs > 0) return NO_STEP;

    // Сумма, а не модуль разности: после общего префикса хвосты однородны, и в
    // каждой паре одно из слагаемых всегда ноль.
    const tabsDiff = aTabs + bTabs;
    const spacesDiff = aSpaces + bSpaces;

    if (tabsDiff === 0) {
        // Продолжение, выровненное под символ предыдущей строки (`foo(a,` →
        // `    b`), — не отступ. Проверка «шаг ненулевой» не нужна: при
        // `bSpaces === 0` чтение `a` по индексу −1 даёт NaN.
        const looksLikeAlignment =
            b.charCodeAt(bSpaces) !== SPACE &&
            a.charCodeAt(bSpaces - 1) === SPACE &&
            a.charCodeAt(a.length - 1) === COMMA;
        return { step: spacesDiff, looksLikeAlignment };
    }
    // Табы и пробелы вперемешку по строкам: сигнал годен, только если пробелы
    // делятся на число «съеденных» табов нацело — тогда это ширина таба.
    if (spacesDiff % tabsDiff !== 0) return NO_STEP;
    return { step: spacesDiff / tabsDiff, looksLikeAlignment: false };
}

export function detectIndentation(document: ITextDocument, defaults: IIndentationDefaults): DetectedIndentation {
    const lineCount = Math.min(document.lineCount, MAX_SCAN_LINES);

    let tabIndentedLines = 0;
    let spaceIndentedLines = 0;
    // Индекс — величина шага. Типизированный массив ради жёсткого размера: запись
    // шага больше 8 молча отбрасывается, отдельная проверка не нужна.
    const diffCounts = new Int32Array(MAX_TAB_SIZE_GUESS + 1);

    // Stryker disable next-line StringLiteral: текст затравки ненаблюдаем — при
    // нулевом отступе из него читается только последний символ в проверке
    // выравнивания, а она требует и запятую в конце, и пробел под первым
    // непробельным символом следующей строки; для любого литерала-затравки
    // одновременно это недостижимо.
    let previousLineText = "";
    let previousLineIndent = 0;

    for (let i = 0; i < lineCount; i++) {
        const lineText = document.getLineContent(i);
        let spaces = 0;
        let tabs = 0;
        let indent = -1;
        for (let j = 0; j < lineText.length; j++) {
            const charCode = lineText.charCodeAt(j);
            if (charCode === TAB) tabs++;
            else if (charCode === SPACE) spaces++;
            else {
                indent = j;
                break;
            }
        }
        // Пробельные строки предыдущую не сбрасывают: отступ сравнивается сквозь них.
        if (indent === -1) continue;

        if (tabs > 0) tabIndentedLines++;
        // Ровно один ведущий пробел — это `*` в блочном комментарии, а не отступ.
        else if (spaces > 1) spaceIndentedLines++;

        const diff = computeIndentationStep(previousLineText, previousLineIndent, lineText, indent);
        // И не база для следующей строки — иначе сдвинуло бы и её шаг.
        if (diff.looksLikeAlignment) continue;
        diffCounts[diff.step]++;

        previousLineText = lineText;
        previousLineIndent = indent;
    }

    let insertSpaces = defaults.insertSpaces;
    if (spaceIndentedLines > tabIndentedLines) insertSpaces = true;
    else if (tabIndentedLines > spaceIndentedLines) insertSpaces = false;

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
    // При отступе 2 шаг 4 встречается на каждом двойном переходе и может обогнать 2.
    if (tabSize === 4 && diffCounts[4] > 0 && diffCounts[2] >= diffCounts[4] / 2) tabSize = 2;

    return { insertSpaces, tabSize };
}
