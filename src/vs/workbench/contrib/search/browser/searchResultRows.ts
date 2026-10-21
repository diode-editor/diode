import type { StyleColor } from "@tuidom/core/dom/styles/tuiStyle";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import type { ITextMatch } from "../../../services/search/common/textSearch.ts";

/** Выделение и hover красит сам ListViewElement. */
export interface ISearchRowStyles {
    /** Номера строк и счётчики матчей у файлов. */
    readonly dimFg: StyleColor;
    readonly matchFg: StyleColor;
    readonly matchBg: StyleColor;
}

const GAP = "  ";
const MAX_BEFORE_LENGTH = 24;
const ELLIPSIS = "…";

// setCharStyle ключуется code-unit-оффсетами — теми же, в которых предразрезан preview матча.

export function buildFileRow(id: string, relPath: string, count: number, styles: ISearchRowStyles): TextLabelElement {
    const row = new TextLabelElement("");
    row.id = id;
    formatFileRow(row, relPath, count, styles);
    return row;
}

export function formatFileRow(row: TextLabelElement, relPath: string, count: number, styles: ISearchRowStyles): void {
    const countText = String(count);
    row.setText(`${relPath}${GAP}${countText}`);
    row.clearCharStyles();
    const countStart = relPath.length + GAP.length;
    for (let i = 0; i < countText.length; i++) {
        row.setCharStyle(countStart + i, { fg: styles.dimFg });
    }
    row.markDirty();
}

export function buildFolderRow(id: string, label: string): TextLabelElement {
    const row = new TextLabelElement(label);
    row.id = id;
    return row;
}

export function buildMatchRow(id: string, match: ITextMatch, styles: ISearchRowStyles): TextLabelElement {
    const row = new TextLabelElement("");
    row.id = id;
    formatMatchRow(row, match, styles);
    return row;
}

export function formatMatchRow(row: TextLabelElement, match: ITextMatch, styles: ISearchRowStyles): void {
    const lineNumberText = String(match.lineNumber);
    const before = trimBefore(match.preview.before);
    row.setText(`${lineNumberText}${GAP}${before}${match.preview.inside}${match.preview.after}`);
    row.clearCharStyles();
    for (let i = 0; i < lineNumberText.length; i++) {
        row.setCharStyle(i, { fg: styles.dimFg });
    }
    const insideStart = lineNumberText.length + GAP.length + before.length;
    for (let i = 0; i < match.preview.inside.length; i++) {
        row.setCharStyle(insideStart + i, { fg: styles.matchFg, bg: styles.matchBg });
    }
    row.markDirty();
}

/** Чтобы сам матч оставался на экране. */
export function trimBefore(before: string): string {
    if (before.length <= MAX_BEFORE_LENGTH) return before;
    return ELLIPSIS + before.slice(before.length - (MAX_BEFORE_LENGTH - ELLIPSIS.length));
}
