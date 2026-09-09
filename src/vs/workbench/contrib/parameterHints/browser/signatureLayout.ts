import { DisplayLine } from "@tuidom/core/common/displayLine";

import type { ICoreSignature } from "../../../../editor/common/languages/iSignatureHelpSource.ts";

/**
 * Кусок метки сигнатуры, помещающийся в одну строку попапа. `start` — офсет
 * куска в исходной метке (в code unit'ах), поэтому подсветку активного
 * параметра можно наложить прямо на перенесённые строки: рисовалка отдаёт
 * офсет внутри строки, а он плюс `start` — офсет в метке.
 */
export interface ISignatureChunk {
    readonly text: string;
    readonly start: number;
}

/**
 * Диапазон активного параметра в метке сигнатуры — `[start, end)` в code
 * unit'ах. Пустой диапазон (`[0, 0]`) означает «подсвечивать нечего»:
 * параметра нет, метка пустая или подстрока в метке не нашлась.
 *
 * Две формы метки параметра (обе легальны — клиент объявляет серверу
 * `labelOffsetSupport`): пара офсетов берётся как есть, строка ищется в метке
 * сигнатуры по границе слова. Голый `indexOf` промахивался бы: у
 * `greet(nameLength: number, name: string)` параметр `name` нашёлся бы внутри
 * `nameLength`.
 */
export function activeParameterSpan(signature: ICoreSignature, index: number): readonly [number, number] {
    const parameter = signature.parameters[index];
    if (parameter === undefined) return [0, 0];
    if (typeof parameter.label !== "string") {
        const [start, end] = parameter.label;
        return end > start ? [start, end] : [0, 0];
    }
    if (parameter.label === "") return [0, 0];
    const start = indexOfWithBoundary(signature.label, parameter.label);
    return start === -1 ? [0, 0] : [start, start + parameter.label.length];
}

/**
 * Первое вхождение `needle`, у которого по краям нет word-символов, или `-1`.
 * Зеркало приёма VS Code (`(\W|^)label(?=\W|$)`), только без сборки регулярки
 * из чужой строки — экранировать её пришлось бы вручную.
 */
function indexOfWithBoundary(haystack: string, needle: string): number {
    // Единственный выход — «вхождений больше нет»: за концом строки `indexOf`
    // сам вернёт -1, поэтому своего условия у цикла нет.
    let from = 0;
    for (;;) {
        const index = haystack.indexOf(needle, from);
        if (index === -1) return -1;
        // `charAt` вместо индексации: за краями строки он отдаёт пустую строку,
        // которая word-символом не считается, — тернарники с `??` не нужны.
        const before = haystack.charAt(index - 1);
        const after = haystack.charAt(index + needle.length);
        if (!isWordChar(before) && !isWordChar(after)) return index;
        from = index + 1;
    }
}

/** Word-символ; пустая строка («соседа нет») им не считается. */
function isWordChar(char: string): boolean {
    return /\w/u.test(char);
}

/**
 * Переносит метку сигнатуры по словам в ширину `width`, сохраняя офсеты: текст
 * каждого куска — ПОДСТРОКА исходной метки, а не пересобранная строка. Именно
 * поэтому здесь свой перенос, а не `wrapText` из tuidom: тот схлопывает
 * пробелы, и связь с офсетами (а значит, и подсветка параметра) теряется.
 *
 * Слово шире строки режется по ширине; переводы строк в метке — жёсткие
 * переносы (сервер вправе прислать многострочную сигнатуру).
 */
export function wrapSignature(label: string, width: number): ISignatureChunk[] {
    if (width <= 0) return [];
    const chunks: ISignatureChunk[] = [];
    let base = 0;
    for (const line of label.split("\n")) {
        wrapLine(line, base, width, chunks);
        // +1 — сам «\n», который ни в один кусок не попадает.
        base += line.length + 1;
    }
    return chunks;
}

function wrapLine(line: string, base: number, width: number, chunks: ISignatureChunk[]): void {
    const widths = cumulativeWidths(line);
    const measure = (from: number, to: number): number => widths[to] - widths[from];
    // Границы строки-кандидата в офсетах `line`; `null` — строка ещё не начата.
    let lineStart: number | null = null;
    let lineEnd = 0;
    const flush = (): void => {
        if (lineStart === null) return;
        chunks.push({ text: line.slice(lineStart, lineEnd), start: base + lineStart });
        lineStart = null;
    };

    for (const word of wordsOf(line)) {
        // Слово влезает в остаток строки — забираем его вместе с разделителем,
        // который стоит перед ним в метке (кусок обязан быть непрерывным).
        // Stryker disable next-line ConditionalExpression: без начатой строки `measure(null, …)` даёт NaN, и сравнение всё равно ложно — проверка лишь называет причину
        if (lineStart !== null && measure(lineStart, word.end) <= width) {
            lineEnd = word.end;
            continue;
        }
        flush();
        // Слово шире строки — режем его по ширине; хвост (или всё слово, если
        // оно помещается) становится началом новой строки.
        let cut = word.start;
        // Stryker disable next-line EqualityOperator: на слове ровно в ширину обе границы дают тот же разбор — кусок закрывается либо здесь, либо flush'ем следующего слова
        while (measure(cut, word.end) > width) {
            const next = offsetAtWidth(line, widths, cut, width);
            // Символ шире всей строки (широкий CJK при width 1) — сдвигаемся на
            // одну графему, иначе цикл не сойдётся.
            const end = next > cut ? next : cut + 1;
            chunks.push({ text: line.slice(cut, end), start: base + cut });
            cut = end;
        }
        if (cut < word.end) {
            lineStart = cut;
            lineEnd = word.end;
        }
    }
    flush();
}

/** Слова строки (непробельные куски) с офсетами. */
function wordsOf(line: string): { start: number; end: number }[] {
    // Stryker disable next-line ArrayDeclaration: непустая затравка проезжает раскладку насквозь (у строки нет `end`, а NaN-сравнения ложны) — кусков она не добавляет
    const words: { start: number; end: number }[] = [];
    let start: number | null = null;
    // Stryker disable next-line EqualityOperator: лишняя итерация за концом строки даёт пустое слово нулевой ширины, которое сливается с предыдущим куском (а на пустой строке не даёт куска вовсе)
    for (let i = 0; i < line.length; i++) {
        const isSpace = /\s/u.test(line[i]);
        if (!isSpace && start === null) start = i;
        // Stryker disable next-line ConditionalExpression: пробел без открытого слова даёт слово с `start: null`, а такое раскладка проезжает насквозь (NaN-сравнения ложны, `null < end` тоже) — кусков от него не появляется
        if (isSpace && start !== null) {
            words.push({ start, end: i });
            start = null;
        }
    }
    // Stryker disable next-line ConditionalExpression: см. выше — слово с `start: null` в хвосте раскладка так же проезжает без куска
    if (start !== null) words.push({ start, end: line.length });
    return words;
}

/** Экранная ширина префикса строки по каждому офсету (длина массива = length + 1). */
function cumulativeWidths(line: string): number[] {
    const widths = new Array<number>(line.length + 1).fill(0);
    let total = 0;
    let offset = 0;
    for (const slot of new DisplayLine(line).slots) {
        total += slot.displayWidth;
        // Внутренние офсеты графемы (суррогатная пара, комбинирующий знак)
        // получают ширину целой графемы: резать внутри неё мы всё равно не будем.
        for (let i = 0; i < slot.length; i++) widths[++offset] = total;
    }
    return widths;
}

/** Наибольший офсет от `from`, чья ширина ещё не превышает `width`. */
function offsetAtWidth(line: string, widths: readonly number[], from: number, width: number): number {
    let offset = from;
    for (const slot of new DisplayLine(line).slots) {
        // Stryker disable next-line ConditionalExpression,EqualityOperator: графемы левее `from` дают отрицательную ширину и всё равно перетираются следующей итерацией — пропуск экономит сравнения, а не меняет разбор
        if (slot.offset < from) continue;
        if (widths[slot.offset + slot.length] - widths[from] > width) break;
        offset = slot.offset + slot.length;
    }
    return offset;
}
