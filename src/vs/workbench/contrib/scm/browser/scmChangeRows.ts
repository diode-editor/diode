import type { BoxConstraints, Size } from "@tuidom/all/common/geometryPromitives";
import type { StyleColor } from "@tuidom/all/dom/styles/tuiStyle";
import { HFlexElement, hflexFill, hflexFixed } from "@tuidom/all/ui/layout/hFlexElement";
import { LIST_ROW_ACTIVE_STATE } from "@tuidom/all/ui/list/listViewElement";
import { TextLabelElement } from "@tuidom/all/ui/text/textLabelElement";
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
    /** `gitDecoration.*` id → цвет (число или имя токена темы). */
    readonly statusColors: Record<string, StyleColor>;
}

/** nf-cod-go_to_file () — инлайн-кнопка «открыть сам файл» (клик делегирует контейнер). */
export const OPEN_FILE_GLYPH = "";

/** Ширина кнопки Open File: глиф с воздухом по бокам — зона клика. */
export const OPEN_FILE_BUTTON_WIDTH = OPEN_FILE_GLYPH.length + 2;

/**
 * Корень файловой строки: HFlex, который отдаёт колонки кнопке Open File только
 * пока строка активна — под указателем мыши или под курсором сфокусированного
 * списка ({@link LIST_ROW_ACTIVE_STATE}). В покое кнопка получает ширину 0
 * (легальный размер, `HFlexElement` клампит детей по остатку), и всё место
 * достаётся имени файла.
 *
 * Решение живёт в layout, а не в стиле, именно потому, что это про геометрию:
 * покрасить кнопку «в цвет фона» значило бы держать колонки занятыми впустую.
 * Состояние читается до стилевого прохода — список выставляет его на обёртке
 * строки прямо перед её раскладкой.
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

/**
 * Части файловой строки: {@link ScmFileRowElement}-корень (его id — идентичность
 * строки в списке) и три поля — имя (fill), кнопка Open File (раскрывается по
 * активности строки) и буква статуса (fixed 1, правый край). Части
 * возвращаются вместе, чтобы формат-функция могла перекрашивать строку при смене
 * темы без пересборки.
 */
export interface IScmFileRowParts {
    readonly root: ScmFileRowElement;
    readonly name: TextLabelElement;
    readonly openButton: TextLabelElement;
    readonly status: TextLabelElement;
}

/**
 * Строит файловую строку. `rowId` — идентичность строки в списке (id-конвенция
 * `scmRow-<group>-<path>` живёт у вызывающего), `label` — display-путь (flat)
 * или имя файла (tree). `onOpenFile` вызывается кликом по кнопке: кнопка
 * потребляет click через `preventDefault()` (контракт делегации
 * ListViewElement), а парный dblclick-listener гасит и двойной клик, чтобы тот
 * не активировал строку.
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

    // Вид — как у кнопки «⋯» в заголовках view (`PaneHeaderElement`): глиф без
    // рамки, приглушённый, фон наследует от строки. Своего hover-варианта нет
    // намеренно: мышь принадлежит списку (строки презентационные), поэтому
    // `in:hover` был бы истиной для всех раскрытых кнопок разом. Роль
    // affordance играет само появление кнопки на активной строке.
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

/** Перекрашивает/перезаполняет файловую строку (стрим-обновление и смена темы). */
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

/** Папочная строка tree-режима: метка-цепочка, цвета наследуются, шеврон рисует список. */
export function buildFolderRow(id: string, label: string): TextLabelElement {
    const row = new TextLabelElement(label);
    row.id = id;
    return row;
}

/**
 * Заголовок группы ресурсов (Merge/Staged/Changes): метка (fill) +
 * счётчик у правого края приглушённым. Шеврон сворачивания рисует сам список —
 * у заголовка есть дети. Цвета — токены темы, рестайл не нужен.
 */
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
