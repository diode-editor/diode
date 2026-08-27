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

/** Результат {@link computeIndentationStep}. */
export interface IIndentationStep {
    /** Величина шага отступа между двумя строками; 0 — шага нет либо сигнал негодный. */
    readonly step: number;
    /** Строка не отступлена, а выровнена под содержимое предыдущей. */
    readonly looksLikeAlignment: boolean;
}

const NO_STEP: IIndentationStep = { step: 0, looksLikeAlignment: false };

/**
 * Шаг отступа между двумя строками: общий префикс отбрасывается, сравниваются
 * хвосты. Считаем именно РАЗНИЦУ соседних строк, а не абсолютные ширины: файл с
 * отступом в 4 пробела содержит уровни 4, 8, 12, и «самая частая ширина» там
 * значит не то же самое, что шаг.
 *
 * `a`/`b` — полные тексты строк, `aIndent`/`bIndent` — длины их отступов.
 *
 * Экспортируется ради прямых тестов: через {@link detectIndentation} шаг виден
 * только как сдвиг гистограммы, и добрая половина решений этой функции на
 * итоговый `tabSize` не влияет — проверить их можно лишь здесь.
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
        if (a.charCodeAt(j) === CharCode.Space) aSpaces++;
        else aTabs++;
    }
    let bSpaces = 0;
    let bTabs = 0;
    for (let j = i; j < bIndent; j++) {
        if (b.charCodeAt(j) === CharCode.Space) bSpaces++;
        else bTabs++;
    }

    // Смешанный хвост (и табы, и пробелы) — разницу не с чем сопоставить.
    if (aSpaces > 0 && aTabs > 0) return NO_STEP;
    if (bSpaces > 0 && bTabs > 0) return NO_STEP;

    // Сумма, а не модуль разности: после общего префикса хвосты однородны и один
    // из них пуст. Строки разошлись либо на паре «пробел против таба» (тогда
    // один хвост целиком пробельный, другой целиком табовый — иначе сработала бы
    // проверка смеси выше), либо на границе более короткого отступа (тогда его
    // хвост пуст). Так что одно из слагаемых в каждой паре всегда ноль.
    const tabsDiff = aTabs + bTabs;
    const spacesDiff = aSpaces + bSpaces;

    if (tabsDiff === 0) {
        // Продолжение, выровненное под символ предыдущей строки (`foo(a,` →
        // `    b`), — это не отступ: первый непробельный символ `b` встал ровно
        // за пробелом внутри `a`, а сама `a` кончается запятой. Отдельной
        // проверки «шаг ненулевой» не нужно: при `bSpaces === 0` чтение `a` по
        // индексу −1 даёт NaN и условие не проходит.
        const looksLikeAlignment =
            b.charCodeAt(bSpaces) !== CharCode.Space &&
            a.charCodeAt(bSpaces - 1) === CharCode.Space &&
            a.charCodeAt(a.length - 1) === CharCode.Comma;
        return { step: spacesDiff, looksLikeAlignment };
    }
    // Табы и пробелы вперемешку по строкам: сигнал годен, только если пробелы
    // делятся на число «съеденных» табов нацело — тогда это ширина таба.
    if (spacesDiff % tabsDiff !== 0) return NO_STEP;
    return { step: spacesDiff / tabsDiff, looksLikeAlignment: false };
}

/**
 * Определяет стиль отступа по содержимому документа. Всегда возвращает ответ:
 * то, о чём файл промолчал, берётся из {@link defaults}.
 */
export function detectIndentation(document: ITextDocument, defaults: IIndentationDefaults): DetectedIndentation {
    const lineCount = Math.min(document.lineCount, MAX_SCAN_LINES);

    let tabIndentedLines = 0;
    let spaceIndentedLines = 0;
    /**
     * Гистограмма шагов: индекс — величина шага, значение — сколько раз встретился.
     * Типизированный массив, а не обычный, именно ради жёсткого размера: шаг
     * бывает любой ширины (строка с отступом в 40 пробелов — законный ввод), а
     * в выборе кандидата участвуют только 0..8. Запись мимо диапазона здесь
     * молча отбрасывается, поэтому проверять величину шага отдельно не нужно.
     */
    const diffCounts = new Int32Array(MAX_TAB_SIZE_GUESS + 1);

    // Затравка сравнивается с первой содержательной строкой: отступ 0 значит,
    // что её собственный отступ и есть первый шаг.
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

        const diff = computeIndentationStep(previousLineText, previousLineIndent, lineText, indent);
        // Выровненное продолжение не идёт ни в гистограмму, ни в базу для
        // следующей строки — иначе оно сдвинуло бы и её шаг.
        if (diff.looksLikeAlignment) continue;
        diffCounts[diff.step]++;

        previousLineText = lineText;
        previousLineIndent = indent;
    }

    // Ничья (включая «отступов нет вовсе») — вопрос вкуса, а не файла.
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
    // В файле с отступом в 2 шаг 4 встречается на каждом «двойном» переходе и
    // может обогнать 2 по частоте. Отдаём победу двойке, если она встретилась
    // хотя бы вполовину так же часто.
    if (tabSize === 4 && diffCounts[4] > 0 && diffCounts[2] >= diffCounts[4] / 2) tabSize = 2;

    return { insertSpaces, tabSize };
}
