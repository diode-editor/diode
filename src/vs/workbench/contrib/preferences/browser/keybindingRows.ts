import { measureTextWidth } from "@tuidom/core/common/measureTextWidth";
import { truncateEnd } from "@tuidom/core/common/textTruncation";
import type { StyleColor } from "@tuidom/core/dom/styles/tuiStyle";
import { INHERITED_BG } from "@tuidom/core/dom/styles/tuiStyle";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { formatKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import type { IFilteredKeybindingItem } from "../common/keybindingsEditorModel.ts";

/**
 * Строки вкладки Keyboard Shortcuts: колонки `Command | Keybinding | When |
 * Source`, посчитанные руками под ширину вкладки (табличного контрола в tuidom
 * нет). Разметка — чистая функция {@link describeKeybindingRow}, её же читают
 * тесты (приём `extensionRows.ts`).
 */

/** Пробел между колонками. */
const GAP = 2;

/** Минимальная ширина, ниже которой доли колонок дают бессмысленные огрызки. */
const MIN_TABLE_WIDTH = 40;

/** Доли колонок от ширины таблицы (Command получает остаток). */
const KEY_RATIO = 0.22;
const WHEN_RATIO = 0.24;
const SOURCE_WIDTH = 9; // "Extension" — самый длинный источник

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
    /** Индексы подсвеченных символов title (fuzzy-совпадение), уже в границах видимого. */
    readonly matchIndices: readonly number[];
    /** Конфликтующая запись — колонка Keybinding красится предупреждением. */
    readonly conflict: boolean;
}

/** Цвета кусков строки (выделение и hover рисует сам `ListViewElement`). */
export interface IKeybindingRowStyles {
    /** When и Source — служебные колонки. */
    readonly dimFg: StyleColor;
    /** Подсветка fuzzy-совпадения в title. */
    readonly highlightFg: StyleColor;
    /** Колонка Keybinding конфликтующей записи. */
    readonly conflictFg: StyleColor;
}

const SOURCE_LABELS = { default: "Default", extension: "Extension", user: "User" } as const;

/** Обрезает под колонку и добивает пробелами до её ширины (по display-колонкам). */
function cell(text: string, width: number): string {
    const truncated = truncateEnd(text, width);
    return truncated + " ".repeat(Math.max(0, width - measureTextWidth(truncated)));
}

export function describeKeybindingRow(
    filtered: IFilteredKeybindingItem,
    width: number,
): IKeybindingRowLayout {
    const { item, titleMatch } = filtered;
    const widths = columnWidths(width);
    const gap = " ".repeat(GAP);

    const commandCell = cell(item.title, widths.command);
    const keyText = item.chord !== null ? formatKeybinding(item.chord) : "—";
    const keyCell = cell(keyText, widths.key);
    const whenCell = cell(item.when ?? "", widths.when);
    const sourceCell = cell(item.source !== null ? SOURCE_LABELS[item.source] : "", widths.source);

    const keyStart = commandCell.length + GAP;
    const whenStart = keyStart + keyCell.length + GAP;
    const sourceStart = whenStart + whenCell.length + GAP;

    // Подсветка не должна уехать на многоточие: оставляем только индексы,
    // попавшие в сохранённый префикс title (truncateEnd держит префикс как есть).
    const visibleTitle = truncateEnd(item.title, widths.command);
    const keptLength = visibleTitle === item.title ? item.title.length : visibleTitle.length - 1;
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

/** Заголовок таблицы — та же раскладка колонок, что у строк, приглушённым цветом. */
export function describeKeybindingHeaderRow(width: number): string {
    const widths = columnWidths(width);
    const gap = " ".repeat(GAP);
    return cell("Command", widths.command) + gap + cell("Keybinding", widths.key) + gap + cell("When", widths.when) + gap + cell("Source", widths.source);
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
