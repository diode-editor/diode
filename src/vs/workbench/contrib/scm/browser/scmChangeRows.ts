import { HFlexElement, hflexFill, hflexFixed } from "../../../../../../tuidom/ui/layout/hFlexElement.ts";
import { TextLabelElement } from "../../../../../../tuidom/ui/text/textLabelElement.ts";
import type { IWorkbenchColors } from "../../../../platform/theme/common/colors/colorContributions.ts";

import type { IScmChange } from "./changesService.ts";

/** `gitDecoration.*`, которыми расширение помечает статусы — резолвим их в цвета строк. */
export const GIT_STATUS_COLOR_IDS = [
    "gitDecoration.modifiedResourceForeground",
    "gitDecoration.addedResourceForeground",
    "gitDecoration.deletedResourceForeground",
    "gitDecoration.renamedResourceForeground",
    "gitDecoration.untrackedResourceForeground",
    "gitDecoration.conflictingResourceForeground",
    "gitDecoration.ignoredResourceForeground",
] as const satisfies readonly (keyof IWorkbenchColors)[];

/** Цвета содержимого строк Changes (выделение/hover красит сам ListViewElement). */
export interface IScmRowStyles {
    /** `gitDecoration.*` id → упакованный RGB из темы. */
    readonly statusColors: Record<string, number>;
    /** Глиф инлайн-кнопки Open File. */
    readonly dimFg: number;
}

/**  nf-cod-go_to_file — инлайн-кнопка «открыть сам файл» (клик делегирует контейнер). */
const OPEN_FILE_GLYPH = "";

/**
 * Части файловой строки: `HFlexElement`-корень (его id — идентичность строки в
 * списке) и три поля — имя (fill), глиф Open File (fixed) и буква статуса
 * (fixed 1, правый край). Части возвращаются вместе, чтобы формат-функция могла
 * перекрашивать строку при смене темы без пересборки.
 */
export interface IScmFileRowParts {
    readonly root: HFlexElement;
    readonly name: TextLabelElement;
    readonly openGlyph: TextLabelElement;
    readonly status: TextLabelElement;
}

/**
 * Строит файловую строку. `label` — display-путь (flat) или имя файла (tree).
 * `onOpenFile` вызывается кликом по глифу: глиф потребляет click через
 * `preventDefault()` (контракт делегации ListViewElement), а парный
 * dblclick-listener гасит и двойной клик, чтобы тот не активировал строку.
 */
export function buildFileRow(
    change: IScmChange,
    label: string,
    styles: IScmRowStyles,
    onOpenFile: () => void,
): IScmFileRowParts {
    const root = new HFlexElement();
    root.id = change.uri.toString();

    const name = new TextLabelElement("");
    const openGlyph = new TextLabelElement("");
    const status = new TextLabelElement("");
    openGlyph.addEventListener("click", (event) => {
        event.preventDefault();
        onOpenFile();
    });
    openGlyph.addEventListener("dblclick", (event) => {
        event.preventDefault();
    });

    root.addChild(name, { width: hflexFill(), height: 1 });
    root.addChild(openGlyph, { width: hflexFixed(2), height: 1 });
    root.addChild(status, { width: hflexFixed(1), height: 1 });

    const parts: IScmFileRowParts = { root, name, openGlyph, status };
    formatFileRow(parts, change, label, styles);
    return parts;
}

/** Перекрашивает/перезаполняет файловую строку (стрим-обновление и смена темы). */
export function formatFileRow(parts: IScmFileRowParts, change: IScmChange, label: string, styles: IScmRowStyles): void {
    const color: number | undefined = styles.statusColors[change.colorId];

    parts.name.setText(label);
    parts.name.clearCharStyles();
    if (color !== undefined) {
        for (let i = 0; i < label.length; i++) parts.name.setCharStyle(i, { fg: color });
    }

    parts.openGlyph.setText(`${OPEN_FILE_GLYPH} `);
    parts.openGlyph.clearCharStyles();
    parts.openGlyph.setCharStyle(0, { fg: styles.dimFg });

    parts.status.setText(change.status);
    parts.status.clearCharStyles();
    if (color !== undefined) {
        for (let i = 0; i < change.status.length; i++) parts.status.setCharStyle(i, { fg: color });
    }

    parts.root.markDirty();
}

/** Папочная строка tree-режима: метка-цепочка, цвета наследуются, шеврон рисует список. */
export function buildFolderRow(id: string, label: string): TextLabelElement {
    const row = new TextLabelElement(label);
    row.id = id;
    return row;
}
