import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

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
const TERMINAL_ICON = "\uea85";

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

/** Что владелец делает с действиями пользователя в списке. */
export interface ITerminalTabsListHandlers {
    /** Курсор встал на строку — стрелки или клик: терминал становится активным без фокуса. */
    onDidSelectInstance(instanceId: number): void;
    /**
     * Enter или двойной клик: фокус в терминал. Строка к этому моменту уже
     * активна — её выбрали стрелками или первым кликом.
     */
    onDidActivateInstance(): void;
    /** Правый клик по строке. */
    onDidRequestContextMenu(instanceId: number, screenX: number, screenY: number): void;
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

    /** Пока список сам переставляет курсор, его `onSelect` — эхо, не действие пользователя. */
    // Stryker disable next-line BooleanLiteral: до первого setInstances строк нет, и onSelect не приходит — начальное значение ни на что не влияет
    private syncing = false;

    public constructor(handlers: ITerminalTabsListHandlers) {
        this.list.id = TERMINAL_TABS_LIST_ID;
        this.list.onSelect = (element) => {
            if (this.syncing) return;
            handlers.onDidSelectInstance(instanceIdOf(element));
        };
        this.list.onActivate = () => {
            handlers.onDidActivateInstance();
        };
        this.list.onContextMenu = (element, screenX, screenY) => {
            handlers.onDidRequestContextMenu(instanceIdOf(element), screenX, screenY);
        };
    }

    /** Пересобрать строки по списку инстансов; курсор — на активном. */
    public setInstances(instances: readonly ITerminalInstance[], activeId: number | null): void {
        this.syncing = true;
        this.list.clear();
        for (const instance of instances) {
            const row = new TextLabelElement(` ${terminalTabLabel(instance)}`);
            row.id = terminalTabRowId(instance.id);
            // Без `label`: он нужен только typeahead'у, а тот выключен.
            this.list.appendRow(row);
        }
        // Курсор — на активном; терминалов нет — и строки нет (setCursorTo бросает на неизвестной).
        if (activeId !== null) this.list.setCursorTo(terminalTabRowId(activeId));
        this.syncing = false;
    }

    /** Инстанс под курсором списка (цель Delete в списке); `undefined` — список пуст. */
    public getCursorInstanceId(): number | undefined {
        const element = this.list.getCursorElement();
        return element === null ? undefined : instanceIdOf(element);
    }
}

/** Строки списка — только наши (`terminalTab-<id>`), поэтому разбор без проверок. */
function instanceIdOf(element: TUIElement): number {
    return Number(listRowId(element).slice(ROW_ID_PREFIX.length));
}
