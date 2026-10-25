import type { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import type { StyleColor } from "@tuidom/core/dom/styles/tuiStyle";
import { HFlexElement, hflexFill, hflexFixed } from "@tuidom/elements/layout/hFlexElement";
import { LIST_ROW_ACTIVE_STATE } from "@tuidom/elements/list/listViewElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { codicon, iconGlyph } from "../../../../base/common/codicons.ts";
import type { IWorkbenchColors } from "../../../../platform/theme/common/colors/colorContributions.ts";

import type { IScmChange } from "./changesService.ts";

export const GIT_STATUS_COLOR_IDS = [
    "gitDecoration.modifiedResourceForeground",
    "gitDecoration.addedResourceForeground",
    "gitDecoration.deletedResourceForeground",
    "gitDecoration.renamedResourceForeground",
    "gitDecoration.untrackedResourceForeground",
    "gitDecoration.conflictingResourceForeground",
    "gitDecoration.ignoredResourceForeground",
] as const satisfies readonly (keyof IWorkbenchColors)[];

/** Selection and hover are painted by ListViewElement itself. */
export interface IScmRowStyles {
    readonly statusColors: Partial<Record<string, StyleColor>>;
    /** `diode.icons.nerdFont`; Nerd Font glyphs when absent. */
    readonly nerdFont?: boolean;
}

/** The container delegates the click. */
export const OPEN_FILE_ICON = codicon("go-to-file");

/** Padding around the one-cell glyph is the click area. */
export const OPEN_FILE_BUTTON_WIDTH = 3;

/**
 * The Open File button gets columns only while the row is active ({@link LIST_ROW_ACTIVE_STATE}),
 * width 0 at rest. Done in layout, not style: a background-colored button would waste the columns.
 */
export class ScmFileRowElement extends HFlexElement {
    public constructor(private readonly openButton: TextLabelElement) {
        super();
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const revealed = this.hasStyleStateWithin(LIST_ROW_ACTIVE_STATE);
        this.openButton.layoutStyle = {
            width: hflexFixed(revealed ? OPEN_FILE_BUTTON_WIDTH : 0),
            height: 1,
        };
        return super.performLayout(constraints);
    }
}

/** Kept together to recolor the row on theme change without rebuilding. */
export interface IScmFileRowParts {
    readonly root: ScmFileRowElement;
    readonly name: TextLabelElement;
    readonly openButton: TextLabelElement;
    readonly status: TextLabelElement;
}

/**
 * `rowId` follows the caller's `scmRow-<group>-<path>` convention. The button consumes click via
 * `preventDefault()` (ListViewElement delegation), and the paired dblclick so it does not activate the row.
 */
export function buildFileRow(
    rowId: string,
    change: IScmChange,
    label: string,
    styles: IScmRowStyles,
    onOpenFile: () => void,
): IScmFileRowParts {
    const name = new TextLabelElement("");
    const openButton = new TextLabelElement(` ${iconGlyph(OPEN_FILE_ICON, styles.nerdFont ?? true)} `);
    const status = new TextLabelElement("");

    // No own hover on purpose: the mouse belongs to the list, and `in:hover` would be true
    // for all expanded buttons at once.
    openButton.style = { fg: "descriptionForeground" };
    openButton.addEventListener("click", (event) => {
        event.preventDefault();
        onOpenFile();
    });
    openButton.addEventListener("dblclick", (event) => {
        event.preventDefault();
    });

    const root = new ScmFileRowElement(openButton);
    root.id = rowId;
    root.addChild(name, { width: hflexFill(), height: 1 });
    root.addChild(openButton, { width: hflexFixed(0), height: 1 });
    root.addChild(status, { width: hflexFixed(1), height: 1 });

    const parts: IScmFileRowParts = { root, name, openButton, status };
    formatFileRow(parts, change, label, styles);
    return parts;
}

export function formatFileRow(parts: IScmFileRowParts, change: IScmChange, label: string, styles: IScmRowStyles): void {
    const color: StyleColor | undefined = styles.statusColors[change.colorId];

    parts.name.setText(label);
    parts.name.clearCharStyles();
    if (color !== undefined) {
        for (let i = 0; i < label.length; i++) parts.name.setCharStyle(i, { fg: color });
    }

    parts.status.setText(change.status);
    parts.status.clearCharStyles();
    if (color !== undefined) {
        for (let i = 0; i < change.status.length; i++) parts.status.setCharStyle(i, { fg: color });
    }

    parts.root.markDirty();
}

export function buildFolderRow(id: string, label: string): TextLabelElement {
    const row = new TextLabelElement(label);
    row.id = id;
    return row;
}

export function buildGroupRow(id: string, label: string, count: number): HFlexElement {
    const root = new HFlexElement();
    root.id = id;

    const name = new TextLabelElement(label);
    const counter = new TextLabelElement(String(count));
    counter.style = { fg: "descriptionForeground" };

    root.addChild(name, { width: hflexFill(), height: 1 });
    root.addChild(counter, { width: hflexFixed(String(count).length + 1), height: 1 });
    return root;
}
