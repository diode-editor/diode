import { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { CODICON_GLYPHS } from "../../../../base/common/codicons.generated.ts";
import { listRowId } from "../../../../base/common/listRowId.ts";

import type { ITerminalInstance } from "./terminalService.ts";

export const TERMINAL_TABS_LIST_ID = "terminalTabsList";

/**
 * Ширина списка вкладок в колонках. У эталона список по умолчанию 120px
 * (≈15 знаков) и тянется sash'ем; перетаскиваемой ширины и «narrow»-режима
 * (одни иконки при ≤63px) у нас нет — см. docs/TODO/IntegratedTerminal.md.
 */
export const TERMINAL_TABS_WIDTH = 20;

/** Пункт дропдауна при `tabs.enabled=false`, включающий список обратно (эталон `SwitchTerminalActionViewItem`). */
export const SWITCH_TERMINAL_SHOW_TABS = "Show Tabs";

/** `$(terminal)` — иконка вкладки по умолчанию (`terminal.integrated.tabs.defaultIcon` эталона). */
const TERMINAL_ICON = CODICON_GLYPHS.terminal ?? "";

const ROW_ID_PREFIX = "terminalTab-";

export function terminalTabRowId(instanceId: number): string {
    return `${ROW_ID_PREFIX}${instanceId}`;
}

/** Текст строки списка и имени активного терминала в заголовке: `$(icon) title`, как `getSingleTabLabel` эталона. */
export function terminalTabLabel(instance: ITerminalInstance): string {
    return `${TERMINAL_ICON} ${instance.title}`;
}

/** Подпись дропдауна/quick pick'а: `N: title` (эталон `getGroupLabels` / `TerminalQuickAccessProvider`). */
export function terminalIndexedLabel(index: number, instance: ITerminalInstance): string {
    return `${index + 1}: ${instance.title}`;
}

/**
 * Список вкладок терминалов (эталон `TerminalTabList`): строка на инстанс,
 * курсор списка = активный терминал. Виджет презентационный — семантика
 * (сделать активным, сфокусировать, убить, меню) живёт у владельца через
 * колбэки; сам список лишь переводит строки в id инстансов и глушит эхо
 * собственных программных перестановок курсора.
 */
export class TerminalTabsList {
    public readonly list = new ListViewElement({ typeahead: false });

    /** Курсор встал на строку — стрелки или клик: терминал становится активным без фокуса. */
    public onDidSelectInstance: ((instanceId: number) => void) | null = null;
    /** Enter или двойной клик: терминал активируется И получает фокус. */
    public onDidActivateInstance: ((instanceId: number) => void) | null = null;
    /** Правый клик по строке. */
    public onDidRequestContextMenu: ((instanceId: number, screenX: number, screenY: number) => void) | null = null;

    /** Пока список сам переставляет курсор, его `onSelect` — эхо, не действие пользователя. */
    private syncing = false;

    public constructor() {
        this.list.id = TERMINAL_TABS_LIST_ID;
        this.list.onSelect = (element) => {
            if (this.syncing) return;
            this.forward(element, this.onDidSelectInstance);
        };
        this.list.onActivate = (element) => {
            this.forward(element, this.onDidActivateInstance);
        };
        this.list.onContextMenu = (element, screenX, screenY) => {
            const id = instanceIdOf(element);
            if (id !== null) this.onDidRequestContextMenu?.(id, screenX, screenY);
        };
    }

    /** Пересобрать строки по списку инстансов; курсор — на активном. */
    public setInstances(instances: readonly ITerminalInstance[], activeId: number | null): void {
        this.syncing = true;
        this.list.clear();
        for (const instance of instances) {
            const row = new TextLabelElement(` ${terminalTabLabel(instance)}`);
            row.id = terminalTabRowId(instance.id);
            this.list.appendRow(row, { label: instance.title });
        }
        this.syncing = false;
        this.setActive(activeId);
    }

    /** Подвинуть курсор на активный инстанс (null — терминалов нет, курсор не трогаем). */
    public setActive(activeId: number | null): void {
        if (activeId === null) return;
        this.syncing = true;
        this.list.setCursorTo(terminalTabRowId(activeId));
        this.syncing = false;
    }

    /** Инстанс под курсором списка (цель Delete в списке). */
    public getCursorInstanceId(): number | null {
        const element = this.list.getCursorElement();
        return element === null ? null : instanceIdOf(element);
    }

    private forward(
        element: Parameters<NonNullable<ListViewElement["onSelect"]>>[0],
        cb: ((id: number) => void) | null,
    ): void {
        const id = instanceIdOf(element);
        if (id !== null) cb?.(id);
    }
}

function instanceIdOf(element: Parameters<NonNullable<ListViewElement["onSelect"]>>[0]): number | null {
    const rowId = listRowId(element);
    if (!rowId.startsWith(ROW_ID_PREFIX)) return null;
    const id = Number(rowId.slice(ROW_ID_PREFIX.length));
    return Number.isInteger(id) ? id : null;
}
