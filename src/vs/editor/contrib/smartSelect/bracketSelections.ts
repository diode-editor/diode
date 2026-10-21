import type { CharacterPair } from "../../../platform/extensions/common/iLanguageConfiguration.ts";
import type { IPosition } from "../../common/core/iPosition.ts";
import { createRange, type IRange } from "../../common/core/iRange.ts";
import { isWordChar } from "../../common/core/wordClassification.ts";
import type { ITextDocument } from "../../common/model/iTextDocument.ts";

import { firstNonWhitespaceIndex } from "./lineText.ts";

/** Скобки в литералах и комментариях пару не образуют. */
export type IsCodeAt = (line: number, character: number) => boolean;

/** `key` — открывающая скобка пары. */
interface IBracketHit {
    readonly line: number;
    readonly start: number;
    readonly end: number;
    readonly isOpen: boolean;
    readonly key: string;
}

/**
 * Upstream `smartSelect/browser/bracketSelections.ts`. Отклонения: скобки —
 * пары `brackets` из language configuration, найденные в тексте (а не
 * `model.bracketPairs` токенизатора); бюджета 30 мс на раунд нет — скан
 * линейный и идёт по команде, а не на каждое нажатие.
 */
export function provideBracketSelectionRanges(
    document: ITextDocument,
    positions: readonly IPosition[],
    brackets: readonly CharacterPair[],
    isCodeAt: IsCodeAt = () => true,
): IRange[][] {
    const scanner = new BracketScanner(document, brackets, isCodeAt);
    return positions.map((position) => {
        const bucket: IRange[] = [];
        const closings = collectUnmatchedClosings(scanner, position);
        pairUnmatchedOpenings(scanner, position, closings, (open, close) => {
            const outer = createRange(open.line, open.start, close.line, close.end);
            bucket.push(createRange(open.line, open.end, close.line, close.start), outer);
            addBracketLeading(document, outer, bucket);
        });
        return bucket;
    });
}

/** `_bracketsRightYield`: очередь незакрытых закрывающих по ключу, ближайшая первой. */
function collectUnmatchedClosings(scanner: BracketScanner, position: IPosition): Map<string, IBracketHit[]> {
    const closings = new Map<string, IBracketHit[]>();
    const depth = new Map<string, number>();
    for (let line = position.line; line < scanner.lineCount; line++) {
        for (const hit of scanner.hitsOnLine(line)) {
            if (line === position.line && hit.start < position.character) continue;
            const open = depth.get(hit.key) ?? 0;
            if (hit.isOpen) {
                depth.set(hit.key, open + 1);
            } else if (open > 0) {
                depth.set(hit.key, open - 1);
            } else {
                const queue = closings.get(hit.key) ?? [];
                queue.push(hit);
                closings.set(hit.key, queue);
            }
        }
    }
    return closings;
}

/** `_bracketsLeftYield`. */
function pairUnmatchedOpenings(
    scanner: BracketScanner,
    position: IPosition,
    closings: Map<string, IBracketHit[]>,
    onPair: (open: IBracketHit, close: IBracketHit) => void,
): void {
    const depth = new Map<string, number>();
    for (let line = position.line; line >= 0; line--) {
        const hits = scanner.hitsOnLine(line);
        for (let i = hits.length - 1; i >= 0; i--) {
            const hit = hits[i];
            if (line === position.line && hit.end > position.character) continue;
            const closed = depth.get(hit.key) ?? 0;
            if (!hit.isOpen) {
                depth.set(hit.key, closed + 1);
            } else if (closed > 0) {
                depth.set(hit.key, closed - 1);
            } else {
                const close = closings.get(hit.key)?.shift();
                if (close !== undefined) onPair(hit, close);
            }
        }
    }
}

/**
 * Многострочная пара с «заголовком» (upstream `_addBracketLeading`):
 *
 * ```
 * xxxxxxxx {      ← от первого непробельного и от начала строки
 * }
 *
 * xxxxxxxx        ← скобка на своей строке под заголовком той же колонки
 * {
 * }
 * ```
 */
function addBracketLeading(document: ITextDocument, bracket: IRange, bucket: IRange[]): void {
    if (bracket.start.line === bracket.end.line) return;
    const { end } = bracket;
    const startLine = bracket.start.line;
    const first = firstNonWhitespaceIndex(document.getLineContent(startLine));
    // Строка со скобкой не пустая: `first` есть всегда.
    if (first !== bracket.start.character) {
        bucket.push(createRange(startLine, first, end.line, end.character));
        bucket.push(createRange(startLine, 0, end.line, end.character));
    }

    const aboveLine = startLine - 1;
    if (aboveLine >= 0) {
        const aboveFirst = firstNonWhitespaceIndex(document.getLineContent(aboveLine));
        if (aboveFirst === bracket.start.character) {
            bucket.push(createRange(aboveLine, aboveFirst, end.line, end.character));
            bucket.push(createRange(aboveLine, 0, end.line, end.character));
        }
    }
}

/** Кэш на один запрос: каретки сканируют одни и те же строки. */
class BracketScanner {
    /** Скобки, длинные первыми: `[[` не должна распасться на две `[`. */
    private readonly candidates: readonly { readonly text: string; readonly isOpen: boolean; readonly key: string }[];
    private readonly cache = new Map<number, readonly IBracketHit[]>();

    public constructor(
        private readonly document: ITextDocument,
        brackets: readonly CharacterPair[],
        private readonly isCodeAt: IsCodeAt,
    ) {
        const candidates: { text: string; isOpen: boolean; key: string }[] = [];
        for (const [open, close] of brackets) {
            // Пустая «скобка» зациклила бы скан. Симметричную (`|`) отдельно не
            // отсекаем: открывающая всегда находится первой, закрывающих не будет.
            if (open === "" || close === "") continue;
            candidates.push({ text: open, isOpen: true, key: open });
            candidates.push({ text: close, isOpen: false, key: open });
        }
        this.candidates = candidates.sort((a, b) => b.text.length - a.text.length);
    }

    public get lineCount(): number {
        return this.document.lineCount;
    }

    public hitsOnLine(line: number): readonly IBracketHit[] {
        // Stryker disable all: кэш — только скорость, ответ с ним и без него один
        let hits = this.cache.get(line);
        if (hits === undefined) {
            hits = this.scanLine(line);
            this.cache.set(line, hits);
        }
        // Stryker restore all
        return hits;
    }

    private scanLine(line: number): IBracketHit[] {
        const text = this.document.getLineContent(line);
        // Stryker disable next-line ArrayDeclaration: чужой элемент — «скобка» без ключа и позиции, ни с чем не парится
        const hits: IBracketHit[] = [];
        let i = 0;
        // Stryker disable next-line EqualityOperator: на i === length непустая скобка не находится — лишний шаг ничего не добавит
        while (i < text.length) {
            const found = this.candidates.find((c) => text.startsWith(c.text, i) && isWholeBracket(text, i, c.text));
            if (found === undefined) {
                i++;
                continue;
            }
            const end = i + found.text.length;
            if (this.isCodeAt(line, i)) hits.push({ line, start: i, end, isOpen: found.isOpen, key: found.key });
            i = end;
        }
        return hits;
    }
}

/**
 * Скобка-слово (`begin`/`end`) — только целым словом: `endless` скобкой не
 * считается. Скобки из знаков препинания стоят где угодно.
 */
function isWholeBracket(text: string, start: number, bracket: string): boolean {
    const end = start + bracket.length;
    if (isWordChar(bracket[0]) && start > 0 && isWordChar(text[start - 1])) return false;
    return !(isWordChar(bracket[bracket.length - 1]) && end < text.length && isWordChar(text[end]));
}
