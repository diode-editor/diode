import { TextDocument } from "../model/textDocument.ts";
import { EditorViewState } from "../viewModel/editorViewState.ts";

import type { IDiffViewRow } from "./diffViewModel.ts";

/**
 * Текст строк вью диффа: проекция {@link IDiffViewRow} на плоский текст.
 *
 * Нужна потому, что дифф — текстовая поверхность с кареткой, а каретка живёт в
 * координатах документа. Собранный отсюда текст становится синтетическим
 * read-only `TextDocument` панели диффа, и он же — единственный источник правды
 * о том, что нарисовано: рендер берёт строку из документа, а не из сторон.
 * Иначе «что видно» и «где каретка» разъезжаются на первом же несовпадении.
 */

/** Символ-плейсхолдер свёрнутого куска — он же метка в обеих колонках номеров. */
export const ELLIPSIS = "⋯";

/** Сторона диффа, с которой взята строка. */
export type DiffSide = "original" | "modified";

/** Тексты обеих сторон, уже разобранные на строки. */
export interface IDiffViewSides {
    readonly original: readonly string[];
    readonly modified: readonly string[];
}

/** Текст строки-плейсхолдера. Один на документ и на рендер, иначе они разъедутся. */
export function collapsedRowLabel(hiddenLineCount: number): string {
    return `${ELLIPSIS} ${String(hiddenLineCount)} unchanged line${hiddenLineCount === 1 ? "" : "s"}`;
}

/** С какой стороны брать текст строки; `null` — у плейсхолдера стороны нет. */
export function rowSide(row: IDiffViewRow): DiffSide | null {
    switch (row.kind) {
        case "deleted":
            return "original";
        case "collapsed":
            return null;
        default:
            return "modified";
    }
}

/** Номер строки на своей стороне; `-1` у плейсхолдера. */
export function rowLine(row: IDiffViewRow): number {
    switch (row.kind) {
        case "deleted":
            return row.originalLine;
        case "collapsed":
            return -1;
        default:
            return row.modifiedLine;
    }
}

/**
 * Текст всех строк вью, склеенный `\n` — готовое содержимое синтетического
 * документа. Строк ровно столько же, сколько в `rows`.
 */
export function buildDiffViewText(
    rows: readonly IDiffViewRow[],
    sides: IDiffViewSides,
): string {
    const lines = rows.map((row) => {
        if (row.kind === "collapsed") return collapsedRowLabel(row.hiddenLineCount);
        const side = rowSide(row);
        /* v8 ignore start -- недостижимо: side === null бывает только у collapsed, отсечённого строкой выше */
        if (side === null) return "";
        /* v8 ignore stop */
        return sides[side][rowLine(row)] ?? "";
    });
    return lines.join("\n");
}

/**
 * Текстовая поверхность диффа: read-only {@link EditorViewState} над
 * синтетическим документом. Отсюда у диффа берутся каретка, выделение,
 * навигация по словам и горизонтальная прокрутка — тем же кодом, что у
 * редактора.
 */
export function createDiffViewState(
    rows: readonly IDiffViewRow[],
    sides: IDiffViewSides,
    tabSize: number,
): EditorViewState {
    const document = new TextDocument(buildDiffViewText(rows, sides), "plaintext");
    const viewState = new EditorViewState(document);
    viewState.readOnly = true;
    // Детект отступов выключаем, а tabSize ставим явно уже ПОСЛЕ конструктора
    // (он зовёт runDetectIndentation): мерить отступы по документу из
    // перемешанных сторон бессмысленно — вышла бы ширина таба, отличная от
    // той, с которой тот же файл рисует обычный редактор.
    viewState.detectIndentation = false;
    viewState.tabSize = tabSize;
    return viewState;
}
