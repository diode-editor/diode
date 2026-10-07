import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { KeybindingWeight } from "../../../../platform/keybinding/common/keybindingResolver.ts";
import { viewMenuVisible } from "../../../browser/actions/menuContexts.ts";
import { PanelServiceDIToken } from "../../../browser/parts/panel/panelService.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import { WorkbenchContextKeysDIToken } from "../../../browser/workbenchContextKeys.ts";
import { LayoutServiceDIToken } from "../../../services/layout/browser/layoutService.ts";

import type { TerminalTabMenuContext } from "./terminalPanelComponent.ts";
import { SWITCH_TERMINAL_COMMAND_ID, TerminalPanelComponentDIToken } from "./terminalPanelComponent.ts";
import { TERMINAL_VIEW_ID, TerminalServiceDIToken } from "./terminalService.ts";
import { SWITCH_TERMINAL_SHOW_TABS, terminalIndexedLabel } from "./terminalTabsList.ts";

/** Ровно те tier'ы, где Ctrl+символ кодируется однозначно (в legacy Ctrl+` — это NUL). */
const MODERN_TIER = "tier == 'kitty' || tier == 'csi-u'";

/** `$(plus)` / `$(trash)` — иконки inline-кнопок заголовка вкладки, как у эталона. */
const PLUS_ICON = "";
const TRASH_ICON = "";

/**
 * Показать вкладку TERMINAL с фокусом в активном терминале (эталон
 * `terminalGroupService.showPanel(true)`; кому фокус нужен в другом месте —
 * список вкладок, — переставляет его следом). Контекст-ключи освежает сама
 * смена фокуса (`WorkbenchContextKeys`).
 */
function showPanel(accessor: ServiceAccessor): void {
    accessor.get(PanelServiceDIToken).setActiveView(TERMINAL_VIEW_ID);
    accessor.get(LayoutServiceDIToken).setPanelVisible(true);
    accessor.get(TerminalServiceDIToken).focusActive();
}

/**
 * Число и наличие терминалов меняются без смены фокуса (фокус остался в
 * редакторе или в списке вкладок) — ключи `terminalCount`/`terminalIsOpen`
 * и кнопки заголовка освежаем явно.
 */
function refreshContextKeys(accessor: ServiceAccessor): void {
    accessor.get(WorkbenchContextKeysDIToken).update();
}

/** Инстанс из аргумента меню вкладки (`TerminalTabContext`) или `null`. */
function menuInstanceArg(context: unknown): readonly unknown[] {
    return [(context as TerminalTabMenuContext).instanceId];
}

// Integrated Terminal. Только tier csi-u/kitty умеет однозначно кодировать
// Ctrl+` (в legacy это NUL = Ctrl+Space), поэтому канонические бинды под
// tier-гейтом, а досягаемые везде пути — лидер-аккорды Ctrl+K T (в семье
// Ctrl+K F / Ctrl+K G / Ctrl+K E, которой открываются вьюлеты и панели) и
// Ctrl+K Alt+T для новой вкладки терминала.
export const toggleTerminalAction: CommandAction = {
    id: "workbench.action.terminal.toggleTerminal",
    title: "Terminal: Toggle Terminal",
    shortTitle: "Terminal",
    menus: [{ menuId: MenuId.MenubarViewMenu, group: "3_views", order: 30 }],
    keybinding: parseChord("ctrl+k t"),
    keybindings: [{ keys: parseKeybinding("ctrl+`"), when: MODERN_TIER }],
    run(accessor) {
        // Toggle like VS Code: hide the panel if Terminal is already the
        // visible view, otherwise show + spawn/focus a terminal.
        const layout = accessor.get(LayoutServiceDIToken);
        const panel = accessor.get(PanelServiceDIToken);
        const terminal = accessor.get(TerminalServiceDIToken);
        // Пустая вкладка (шелл вышел, остался placeholder) — это не «терминал показан»:
        // прятать нечего, команда должна поднять новый шелл.
        const showing =
            layout.isPanelVisible() && panel.getActiveViewId() === TERMINAL_VIEW_ID && terminal.hasOpenTerminals;
        if (showing) {
            layout.setPanelVisible(false);
        } else {
            panel.setActiveView(TERMINAL_VIEW_ID);
            layout.setPanelVisible(true);
            terminal.openTerminal();
            accessor.get(WorkbenchContextKeysDIToken).update();
        }
    },
};

// С зажатым Shift Kitty может слать shifted codepoint (`~`) вместо базового `` ` `` —
// зависит от терминала, поэтому регистрируем обе формы: Ctrl+Shift+` и Ctrl+Shift+~.
export const newTerminalAction: CommandAction = {
    id: "workbench.action.terminal.new",
    title: "Terminal: Create New Terminal",
    shortTitle: "New Terminal",
    keybinding: parseChord("ctrl+k alt+t"),
    keybindings: [
        { keys: parseKeybinding("ctrl+shift+`"), when: MODERN_TIER },
        { keys: parseKeybinding("ctrl+shift+~"), when: MODERN_TIER },
    ],
    // Кнопка «+» в заголовке вкладки — у эталона видна всегда.
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 10,
            icon: PLUS_ICON,
            visible: viewMenuVisible(TERMINAL_VIEW_ID),
        },
    ],
    run(accessor) {
        accessor.get(PanelServiceDIToken).setActiveView(TERMINAL_VIEW_ID);
        accessor.get(LayoutServiceDIToken).setPanelVisible(true);
        accessor.get(TerminalServiceDIToken).newTerminal();
        accessor.get(WorkbenchContextKeysDIToken).update();
    },
};

/** Фокус в активный терминал, создав его при нужде (эталон `TerminalCommandId.Focus`). */
export const focusTerminalAction: CommandAction = {
    id: "workbench.action.terminal.focus",
    title: "Terminal: Focus Terminal",
    run(accessor) {
        showPanel(accessor);
        accessor.get(TerminalServiceDIToken).openTerminal();
    },
};

// Ctrl+Shift+\ однозначен только в csi-u/kitty: в legacy Ctrl+\ — это байт 0x1c
// (SIGQUIT у шелла), а Shift теряется. Kitty при Shift может слать `|`. Досягаемый
// везде путь — лидер-аккорд Ctrl+K \ (семья Ctrl+K T / Ctrl+K Alt+T терминала).
export const focusTabsAction: CommandAction = {
    id: "workbench.action.terminal.focusTabs",
    title: "Terminal: Focus Terminal Tabs View",
    keybinding: parseChord("ctrl+k \\"),
    keybindings: [
        { keys: parseKeybinding("ctrl+shift+\\"), when: MODERN_TIER },
        { keys: parseKeybinding("ctrl+shift+|"), when: MODERN_TIER },
    ],
    when: "terminalTabsFocus || terminalFocus",
    weight: KeybindingWeight.WorkbenchContrib,
    run(accessor) {
        showPanel(accessor);
        accessor.get(TerminalPanelComponentDIToken).focusTabs();
    },
};

// Ctrl+PgDn/PgUp у редактора листают вкладки (`textViewFocus`), здесь — терминалы
// (`terminalFocus`): when-клаузы не пересекаются, как у эталона.
export const focusNextTerminalAction: CommandAction = {
    id: "workbench.action.terminal.focusNext",
    title: "Terminal: Focus Next Terminal Group",
    keybinding: parseKeybinding("ctrl+pagedown"),
    when: "terminalFocus",
    weight: KeybindingWeight.WorkbenchContrib,
    run(accessor) {
        accessor.get(TerminalServiceDIToken).setActiveToNext();
        showPanel(accessor);
    },
};

export const focusPreviousTerminalAction: CommandAction = {
    id: "workbench.action.terminal.focusPrevious",
    title: "Terminal: Focus Previous Terminal Group",
    keybinding: parseKeybinding("ctrl+pageup"),
    when: "terminalFocus",
    weight: KeybindingWeight.WorkbenchContrib,
    run(accessor) {
        accessor.get(TerminalServiceDIToken).setActiveToPrevious();
        showPanel(accessor);
    },
};

/** Убить инстанс; если терминалы остались — показать панель с фокусом (эталон `killInstance`). */
function killInstance(accessor: ServiceAccessor, id: number | undefined): void {
    const terminal = accessor.get(TerminalServiceDIToken);
    terminal.closeInstance(id);
    if (terminal.hasOpenTerminals) showPanel(accessor);
    refreshContextKeys(accessor);
}

export const killTerminalAction: CommandAction = {
    id: "workbench.action.terminal.kill",
    title: "Terminal: Kill the Active Terminal Instance",
    shortTitle: "Kill Terminal",
    // Кнопка «корзина» в заголовке (эталон — `tabs.showActions`, см. трекер).
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 30,
            icon: TRASH_ICON,
            visible: viewMenuVisible(TERMINAL_VIEW_ID),
            when: "terminalIsOpen",
        },
    ],
    run(accessor) {
        killInstance(accessor, accessor.get(TerminalServiceDIToken).getActiveInstance()?.id);
    },
};

/**
 * Kill из списка вкладок (Delete) и из меню вкладки: цель — инстанс из
 * аргумента меню, иначе строка под курсором списка. После kill фокус остаётся
 * в списке, пока он виден (эталон зовёт `focusTabs()`).
 */
export const killActiveTabAction: CommandAction = {
    id: "workbench.action.terminal.killActiveTab",
    title: "Terminal: Kill Terminal",
    shortTitle: "Kill Terminal",
    keybinding: parseKeybinding("delete"),
    when: "terminalTabsFocus",
    weight: KeybindingWeight.WorkbenchContrib,
    menus: [{ menuId: MenuId.TerminalTabContext, group: "7_kill", order: 10, args: menuInstanceArg }],
    run(accessor, instanceId) {
        const component = accessor.get(TerminalPanelComponentDIToken);
        const id = typeof instanceId === "number" ? instanceId : component.tabs.getCursorInstanceId();
        accessor.get(TerminalServiceDIToken).closeInstance(id);
        // Фокус — в список, пока он виден, иначе в терминал (эталон зовёт `focusTabs()`).
        component.focusTabs();
        refreshContextKeys(accessor);
    },
};

export const killAllTerminalsAction: CommandAction = {
    id: "workbench.action.terminal.killAll",
    title: "Terminal: Kill All Terminals",
    run(accessor) {
        const terminal = accessor.get(TerminalServiceDIToken);
        for (const instance of [...terminal.getInstances()]) terminal.closeInstance(instance.id);
        refreshContextKeys(accessor);
    },
};

/**
 * Выбор в дропдауне терминалов (`tabs.enabled=false`), эталон
 * `TerminalCommandId.SwitchTerminal`: аргумент — подпись пункта.
 * `N: title` активирует N-й терминал, «Show Tabs» включает список обратно.
 * Без аргумента (из палитры) — тот же выбор quick pick'ом.
 */
export const switchTerminalAction: CommandAction = {
    id: SWITCH_TERMINAL_COMMAND_ID,
    title: "Terminal: Switch Terminal",
    async run(accessor, label) {
        if (typeof label !== "string") {
            await pickTerminal(accessor);
            return;
        }
        if (label === SWITCH_TERMINAL_SHOW_TABS) {
            await accessor.get(IConfigurationServiceDIToken).updateValue("terminal.integrated.tabs.enabled", true);
            return;
        }
        // Подпись `N: title` ищем среди текущих подписей, а не разбираем: так
        // неизвестная строка (разделитель, протухший пункт) просто не находится.
        const terminal = accessor.get(TerminalServiceDIToken);
        const index = terminal.getInstances().findIndex((instance, i) => terminalIndexedLabel(i, instance) === label);
        if (index < 0) return;
        terminal.setActiveInstanceByIndex(index);
        showPanel(accessor);
    },
};

const CREATE_NEW_TERMINAL_LABEL = "Create New Terminal";

/** Quick pick терминалов (эталон `TerminalQuickAccessProvider`): `N: title` + «Create New Terminal». */
async function pickTerminal(accessor: ServiceAccessor): Promise<void> {
    const terminal = accessor.get(TerminalServiceDIToken);
    const instances = terminal.getInstances();
    const active = terminal.getActiveInstance();
    const items = [
        ...instances.map((instance, index) => ({ label: terminalIndexedLabel(index, instance) })),
        { label: CREATE_NEW_TERMINAL_LABEL },
    ];
    const picked = await accessor.get(QuickInputServiceDIToken).quickPick({
        placeholder: "Type the name of a terminal to open.",
        items,
        // Нет активного — -1, пикер клампит его к первой строке.
        activeIndex: instances.findIndex((instance) => instance === active),
    });
    if (picked === undefined) return;
    const index = items.indexOf(picked);
    if (index === instances.length) {
        newTerminalAction.run(accessor);
        return;
    }
    terminal.setActiveInstance(instances[index].id);
    showPanel(accessor);
}

export const quickOpenTermAction: CommandAction = {
    id: "workbench.action.quickOpenTerm",
    title: "Terminal: Switch Active Terminal",
    run(accessor) {
        return pickTerminal(accessor);
    },
};

/** Экшены интегрированного терминала. Фича отдаёт их одним массивом; регистрирует агрегатор (`WORKBENCH_ACTIONS`). */
export const TERMINAL_ACTIONS: readonly CommandAction[] = [
    toggleTerminalAction,
    newTerminalAction,
    focusTerminalAction,
    focusTabsAction,
    focusNextTerminalAction,
    focusPreviousTerminalAction,
    killTerminalAction,
    killActiveTabAction,
    killAllTerminalsAction,
    switchTerminalAction,
    quickOpenTermAction,
];
