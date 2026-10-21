import { measureTextWidth } from "@tuidom/core/common/measureTextWidth";
import { truncateEnd } from "@tuidom/core/common/textTruncation";
import type { StyleColor } from "@tuidom/core/dom/styles/tuiStyle";
import { INHERITED_BG } from "@tuidom/core/dom/styles/tuiStyle";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import {
    formatKeybinding,
    type KeybindingLabelStyle,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { IFilteredKeybindingItem } from "../common/keybindingsEditorModel.ts";

// Columns are computed by hand for the tab width: tuidom has no table control.

const GAP = 2;

/** Minimum width below which the column ratios produce meaningless stubs. */
const MIN_TABLE_WIDTH = 40;

/** Command gets the remainder. */
const KEY_RATIO = 0.22;
const WHEN_RATIO = 0.24;
const SOURCE_WIDTH = 9; // "Extension" is the longest source

interface IColumnWidths {
    readonly command: number;
    readonly key: number;
    readonly when: number;
    readonly source: number;
}

function columnWidths(width: number): IColumnWidths {
    const table = Math.max(width, MIN_TABLE_WIDTH) - 3 * GAP;
    const key = Math.floor(table * KEY_RATIO);
    const when = Math.floor(table * WHEN_RATIO);
    const command = table - key - when - SOURCE_WIDTH;
    return { command, key, when, source: SOURCE_WIDTH };
}

interface ISpan {
    readonly start: number;
    readonly length: number;
}

export interface IKeybindingRowLayout {
    readonly text: string;
    readonly keySpan: ISpan;
    readonly whenSpan: ISpan;
    readonly sourceSpan: ISpan;
    /** Already clipped to the visible part. */
    readonly matchIndices: readonly number[];
    readonly conflict: boolean;
}

/** Selection and hover are drawn by `ListViewElement` itself. */
export interface IKeybindingRowStyles {
    readonly dimFg: StyleColor;
    readonly highlightFg: StyleColor;
    readonly conflictFg: StyleColor;
}

const SOURCE_LABELS = { default: "Default", extension: "Extension", user: "User" } as const;

/** In display columns. */
function cell(text: string, width: number): string {
    const truncated = truncateEnd(text, width);
    return truncated + " ".repeat(Math.max(0, width - measureTextWidth(truncated)));
}

export function describeKeybindingRow(
    filtered: IFilteredKeybindingItem,
    width: number,
    style: KeybindingLabelStyle = "pc",
): IKeybindingRowLayout {
    const { item, titleMatch } = filtered;
    const widths = columnWidths(width);
    const gap = " ".repeat(GAP);

    const commandCell = cell(item.title, widths.command);
    const keyText = item.chord !== null ? formatKeybinding(item.chord, style) : "—";
    const keyCell = cell(keyText, widths.key);
    const whenCell = cell(item.when ?? "", widths.when);
    const sourceCell = cell(item.source !== null ? SOURCE_LABELS[item.source] : "", widths.source);

    const keyStart = commandCell.length + GAP;
    const whenStart = keyStart + keyCell.length + GAP;
    const sourceStart = whenStart + whenCell.length + GAP;

    // The highlight must not slide onto the ellipsis: keep only indices
    // that fall into the kept title prefix (truncateEnd keeps the prefix as is).
    const visibleTitle = truncateEnd(item.title, widths.command);
    const keptLength = visibleTitle === item.title ? item.title.length : visibleTitle.length - 1;
    // Stryker disable next-line ArrayDeclaration: the fallback is reachable only when titleMatch === null (no indices at all); a non-empty substitute is filtered out anyway by index < keptLength.
    const matchIndices = (titleMatch?.matchedIndices ?? []).filter((index) => index < keptLength);

    return {
        text: commandCell + gap + keyCell + gap + whenCell + gap + sourceCell,
        keySpan: { start: keyStart, length: keyCell.length },
        whenSpan: { start: whenStart, length: whenCell.length },
        sourceSpan: { start: sourceStart, length: sourceCell.length },
        matchIndices,
        conflict: item.hasConflict,
    };
}

export function describeKeybindingHeaderRow(width: number): string {
    const widths = columnWidths(width);
    const gap = " ".repeat(GAP);
    return (
        cell("Command", widths.command) +
        gap +
        cell("Keybinding", widths.key) +
        gap +
        cell("When", widths.when) +
        gap +
        cell("Source", widths.source)
    );
}

export function buildKeybindingRow(
    id: string,
    layout: IKeybindingRowLayout,
    styles: IKeybindingRowStyles,
): TextLabelElement {
    const row = new TextLabelElement(layout.text);
    row.id = id;
    paintSpan(row, layout.whenSpan, styles.dimFg);
    paintSpan(row, layout.sourceSpan, styles.dimFg);
    if (layout.conflict) paintSpan(row, layout.keySpan, styles.conflictFg);
    for (const index of layout.matchIndices) {
        row.setCharStyle(index, { fg: styles.highlightFg });
    }
    return row;
}

export function buildKeybindingHeaderRow(id: string, width: number, dimFg: StyleColor): TextLabelElement {
    const row = new TextLabelElement(describeKeybindingHeaderRow(width));
    row.id = id;
    row.setColors(dimFg, INHERITED_BG);
    return row;
}

function paintSpan(row: TextLabelElement, span: ISpan, fg: StyleColor): void {
    for (let i = span.start; i < span.start + span.length; i++) {
        row.setCharStyle(i, { fg });
    }
}
