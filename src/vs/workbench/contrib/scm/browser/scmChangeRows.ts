import type { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import type { StyleColor } from "@tuidom/core/dom/styles/tuiStyle";
import { HFlexElement, hflexFill, hflexFixed } from "@tuidom/elements/layout/hFlexElement";
import { LIST_ROW_ACTIVE_STATE } from "@tuidom/elements/list/listViewElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

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

/** Выделение и hover красит сам ListViewElement. */
export interface IScmRowStyles {
    readonly statusColors: Partial<Record<string, StyleColor>>;
}

/** nf-cod-go_to_file; клик делегирует контейнер. */
export const OPEN_FILE_GLYPH = "";

/** Воздух по бокам глифа — зона клика. */
export const OPEN_FILE_BUTTON_WIDTH = OPEN_FILE_GLYPH.length + 2;

/**
 * Кнопка Open File получает колонки, только пока строка активна ({@link LIST_ROW_ACTIVE_STATE}),
 * в покое — ширину 0. В layout, а не в стиле: кнопка «в цвет фона» держала бы колонки впустую.
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

/** Вместе — чтобы перекрашивать строку при смене темы без пересборки. */
export interface IScmFileRowParts {
    readonly root: ScmFileRowElement;
    readonly name: TextLabelElement;
    readonly openButton: TextLabelElement;
    readonly status: TextLabelElement;
}

/**
 * `rowId` — конвенция `scmRow-<group>-<path>` у вызывающего. Кнопка потребляет click
 * `preventDefault()` (делегация ListViewElement), парный dblclick — чтобы не активировал строку.
 */
export function buildFileRow(
    rowId: string,
    change: IScmChange,
    label: string,
    styles: IScmRowStyles,
    onOpenFile: () => void,
): IScmFileRowParts {
    const name = new TextLabelElement("");
    const openButton = new TextLabelElement(` ${OPEN_FILE_GLYPH} `);
    const status = new TextLabelElement("");

    // Своего hover нет намеренно: мышь принадлежит списку, и `in:hover` был бы истиной
    // для всех раскрытых кнопок разом.
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
