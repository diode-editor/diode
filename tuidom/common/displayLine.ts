import { getCharDisplayWidth, getGraphemeDisplayWidth } from "./unicodeWidth.ts";

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

/**
 * A single visual unit in a display line — one grapheme cluster with its
 * mapping between string offset and screen column.
 */
export interface GraphemeSlot {
    /** The grapheme cluster string (may contain multiple code points) */
    readonly grapheme: string;
    /** Display width in terminal columns (1, 2, or variable for tabs) */
    readonly displayWidth: number;
    /** Start index in the original string (code unit offset) */
    readonly offset: number;
    /** Length in code units in the original string */
    readonly length: number;
}

const DEFAULT_TAB_SIZE = 4;

/**
 * Maps a raw document string to an array of grapheme slots with correct
 * display widths, providing bidirectional offset↔column conversion.
 *
 * Handles: tabs, \\r, emoji, CJK wide chars, combining marks, surrogate pairs.
 */
export class DisplayLine {
    /** Ordered array of grapheme slots */
    public readonly slots: readonly GraphemeSlot[];
    /** Total display width in terminal columns */
    public readonly displayWidth: number;
    /**
     * `true`, если строка была длиннее `stopAfter` и разобран лишь префикс —
     * рендер по этому флагу рисует маркер обрезки. При `stopAfter = Infinity`
     * (дефолт) всегда `false`.
     */
    public readonly isTruncated: boolean;

    private readonly columnMap: Int32Array;
    private readonly rawLength: number;

    /**
     * @param stopAfter Максимум code units, которые разбираем. За порогом
     * сегментация обрывается (лениво — `Intl.Segmenter` не трогает хвост), а
     * `columnMap` аллоцируется по длине **префикса**, а не всей строки, — иначе
     * одна мегабайтная строка съедала бы мегабайтный `Int32Array`. Дефолт
     * `Infinity` сохраняет прежнее поведение для всех не-редакторных вызовов.
     */
    public constructor(raw: string, tabSize: number = DEFAULT_TAB_SIZE, stopAfter: number = Infinity) {
        const slots: GraphemeSlot[] = [];
        let column = 0;
        // Длина разобранного префикса: либо вся строка, либо offset первой
        // отброшенной графемы (сегменты непрерывны, поэтому это ровно граница).
        let scannedLength = raw.length;
        let truncated = false;

        for (const { segment, index } of segmenter.segment(raw)) {
            if (index >= stopAfter) {
                truncated = true;
                scannedLength = index;
                break;
            }

            let displayWidth: number;

            if (segment === "\t") {
                displayWidth = tabSize - (column % tabSize);
            } else if (segment === "\r") {
                displayWidth = 0;
            } else if (segment.length === 1) {
                displayWidth = getCharDisplayWidth(segment.charCodeAt(0));
            } else {
                displayWidth = getGraphemeDisplayWidth(segment);
            }

            slots.push({
                grapheme: segment,
                displayWidth,
                offset: index,
                length: segment.length,
            });
            column += displayWidth;
        }

        this.slots = slots;
        this.displayWidth = column;
        this.isTruncated = truncated;
        // За порогом строка ведёт себя как оканчивающаяся на `scannedLength`:
        // офсеты в хвосте клампятся к `displayWidth` (курсор прилипает к маркеру).
        this.rawLength = scannedLength;

        // Build reverse lookup: for each code unit offset → display column
        // This allows O(1) offsetToColumn lookups.
        const map = new Int32Array(scannedLength + 1);
        column = 0;
        for (const slot of slots) {
            for (let i = 0; i < slot.length; i++) {
                map[slot.offset + i] = column;
            }
            column += slot.displayWidth;
        }
        map[scannedLength] = column; // past-the-end = total width
        this.columnMap = map;
    }

    /**
     * Convert a string offset (code unit index) to a display column.
     * For offsets pointing into the middle of a grapheme cluster,
     * returns the column of that cluster's start.
     */
    public offsetToColumn(offset: number): number {
        if (offset <= 0) return 0;
        if (offset >= this.rawLength) return this.displayWidth;
        return this.columnMap[offset];
    }

    /**
     * Convert a display column to a string offset.
     * If the column falls on the second cell of a wide character,
     * returns the offset of that wide character.
     */
    public columnToOffset(column: number): number {
        if (column <= 0) return 0;
        if (column >= this.displayWidth) return this.rawLength;

        let col = 0;
        for (const slot of this.slots) {
            if (column >= col && column < col + slot.displayWidth) {
                return slot.offset;
            }
            col += slot.displayWidth;
        }
        /* v8 ignore start -- unreachable: column < displayWidth is guaranteed to fall inside some slot, since slots tile [0, displayWidth) */
        return this.rawLength;
        /* v8 ignore stop */
    }

    /**
     * Get the grapheme slot that occupies the given display column,
     * or undefined if the column is out of range.
     */
    public graphemeAtColumn(column: number): GraphemeSlot | undefined {
        if (column < 0 || column >= this.displayWidth) return undefined;

        let col = 0;
        for (const slot of this.slots) {
            if (column >= col && column < col + slot.displayWidth) {
                return slot;
            }
            col += slot.displayWidth;
        }
        /* v8 ignore start -- unreachable: the guard above bounds column to [0, displayWidth), which always falls inside a slot */
        return undefined;
        /* v8 ignore stop */
    }

    /**
     * Get the character to render at a given display column.
     * - For the first column of a wide char: returns the grapheme.
     * - For the second column of a wide char: returns "" (continuation).
     * - For a tab: returns " " (space).
     * - For out-of-range: returns " ".
     */
    public charAtColumn(column: number): string {
        if (column < 0 || column >= this.displayWidth) return " ";

        let col = 0;
        for (const slot of this.slots) {
            const slotEnd = col + slot.displayWidth;
            if (column >= col && column < slotEnd) {
                if (slot.grapheme === "\t") {
                    return " ";
                }
                if (column === col) {
                    return slot.grapheme;
                }
                // Second (or later) column of a wide char
                return "";
            }
            col = slotEnd;
        }
        /* v8 ignore start -- unreachable: the guard above bounds column to [0, displayWidth), which always falls inside a slot */
        return " ";
        /* v8 ignore stop */
    }

    /**
     * Find the slot index for the grapheme at the given string offset,
     * or -1 if out of range.
     */
    public slotIndexAtOffset(offset: number): number {
        if (offset < 0 || offset >= this.rawLength) return -1;

        // Binary search by offset
        let lo = 0;
        let hi = this.slots.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const slot = this.slots[mid];
            if (offset < slot.offset) {
                hi = mid - 1;
            } else if (offset >= slot.offset + slot.length) {
                lo = mid + 1;
            } else {
                return mid;
            }
        }
        /* v8 ignore start -- unreachable: every offset in [0, rawLength) belongs to exactly one slot, so the binary search always hits */
        return -1;
        /* v8 ignore stop */
    }
}
