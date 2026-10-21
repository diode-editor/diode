import { DisplayLine } from "@tuidom/core/common/displayLine";
import { abbreviatePath, truncateEnd } from "@tuidom/core/common/textTruncation";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { HFlexElement, hflexFill, hflexFixed } from "@tuidom/elements/layout/hFlexElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import type { QuickPickItem } from "../../../common/quickPickItem.ts";

import { CONTENT_PAD } from "./quickPickFrameElement.ts";

/**
 * Row layout is computed here, at a known width: mutating text in `performLayout` would mark the tree
 * dirty every frame. The label is shown in full while it fits, the description shrinks to whatever
 * is left, and metadata is always shown in full.
 */

const GAP = "  ";
const ICON_WIDTH = 2;
const CHECKBOX_WIDTH = 4;
/** Not `☐`/`☑`: their terminal width is ambiguous (East Asian Ambiguous). */
const CHECKED_BOX = "[✓] ";
const UNCHECKED_BOX = "[ ] ";

/**
 * A separate `when` variant instead of recomputing on cursor change: `ListViewElement` itself sets
 * `selected` on the host row, and `in:` sees it on the ancestor.
 */
function dimmed(fg: string): { fg: string; when: readonly { states: readonly string[]; fg: string }[] } {
    return {
        fg,
        when: [{ states: ["in:selected"], fg: "list.activeSelectionForeground" }],
    };
}

export function rowId(index: number): string {
    return `quickPickItem-${String(index)}`;
}

/** Which columns exist is decided for the whole list, otherwise labels would misalign between rows. */
export interface IRowColumns {
    readonly hasIcons: boolean;
    /** `undefined` means no checkbox column (single select). */
    readonly checked?: boolean;
}

/** The selection background spans the full `innerWidth`, so the row's edge fillers provide the padding. */
export function buildItemRow(
    item: QuickPickItem,
    index: number,
    innerWidth: number,
    columns: IRowColumns,
): HFlexElement {
    const { hasIcons, checked } = columns;
    const row = new HFlexElement();
    row.id = rowId(index);
    row.style = {
        when: [
            {
                states: ["in:selected"],
                fg: "list.activeSelectionForeground",
                bg: "list.activeSelectionBackground",
            },
        ],
    };

    const contentWidth = Math.max(0, innerWidth - CONTENT_PAD * 2);
    row.addChild(new FillerElement(), { width: hflexFixed(CONTENT_PAD), height: 1 });

    const checkboxWidth = checked !== undefined ? CHECKBOX_WIDTH : 0;
    if (checked !== undefined) {
        const box = new TextLabelElement(checked ? CHECKED_BOX : UNCHECKED_BOX);
        row.addChild(box, { width: hflexFixed(CHECKBOX_WIDTH), height: 1 });
    }

    const iconWidth = hasIcons ? ICON_WIDTH : 0;
    if (hasIcons) {
        const icon = new TextLabelElement(item.icon ?? " ");
        row.addChild(icon, { width: hflexFixed(ICON_WIDTH), height: 1 });
    }

    const avail = Math.max(0, contentWidth - iconWidth - checkboxWidth);

    const before: TextLabelElement[] = [];
    const after: TextLabelElement[] = [];
    if (item.badge !== undefined) {
        before.push(styled(` ★ ${item.badge}`, "quickPick.badgeForeground"));
    }
    if (item.shortcut !== undefined) {
        after.push(styled(`${GAP}${item.shortcut}`, "quickPick.shortcutForeground"));
    }
    if (item.hint !== undefined) {
        after.push(styled(`${GAP}${item.hint}`, "quickPick.hintForeground"));
    }
    const metaWidth = [...before, ...after].reduce((sum, part) => sum + textWidth(part), 0);

    const shared = Math.max(0, avail - metaWidth);
    const labelNatural = new DisplayLine(item.label).displayWidth;
    const labelFits = labelNatural <= shared;
    const labelText = labelFits ? item.label : truncateEnd(item.label, shared);

    const label = new TextLabelElement(labelText);
    applyMatchHighlight(label, labelText, item.labelMatchRanges ?? []);
    row.addChild(label, { width: hflexFixed(new DisplayLine(labelText).displayWidth), height: 1 });

    row.addChild(new FillerElement(), { width: hflexFill(), height: 1 });

    const description = buildDescription(item, labelFits ? shared - labelNatural : 0);

    for (const part of [...before, ...(description ? [description] : []), ...after]) {
        row.addChild(part, { width: hflexFixed(textWidth(part)), height: 1 });
    }

    row.addChild(new FillerElement(), { width: hflexFixed(CONTENT_PAD), height: 1 });

    return row;
}

function buildDescription(item: QuickPickItem, budget: number): TextLabelElement | null {
    const text = item.description;
    if (text === undefined || text === "") return null;
    const dirBudget = budget - GAP.length;
    if (dirBudget < 1) return null;
    const shown = new DisplayLine(text).displayWidth <= dirBudget ? text : abbreviatePath(text, dirBudget);
    return styled(`${GAP}${shown}`, "descriptionForeground");
}

function styled(text: string, fg: string): TextLabelElement {
    const label = new TextLabelElement(text);
    label.style = dimmed(fg);
    return label;
}

function textWidth(label: TextLabelElement): number {
    return new DisplayLine(label.getText()).displayWidth;
}

/** Ranges are code-unit offsets into the original label; nothing past the end of truncated text is highlighted. */
function applyMatchHighlight(label: TextLabelElement, text: string, ranges: readonly [number, number][]): void {
    for (const [start, end] of ranges) {
        for (let i = start; i < Math.min(end, text.length); i++) {
            label.setCharStyle(i, { fg: "list.highlightForeground" });
        }
    }
}
