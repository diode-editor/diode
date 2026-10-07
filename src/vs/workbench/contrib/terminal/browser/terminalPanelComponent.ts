import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { type ISelectOptionItem, SelectBoxElement } from "@tuidom/elements/selectbox/selectBoxElement";
import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { Disposable } from "../../../../base/common/lifecycle.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { ContextMenuServiceDIToken } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";

import type { ITerminalInstance, TerminalService } from "./terminalService.ts";
import { TERMINAL_VIEW_ID, TerminalServiceDIToken } from "./terminalService.ts";
import { TerminalTabbedViewElement } from "./terminalTabbedViewElement.ts";
import {
    SWITCH_TERMINAL_SHOW_TABS,
    TERMINAL_TABS_WIDTH,
    terminalIndexedLabel,
    terminalTabLabel,
    TerminalTabsList,
} from "./terminalTabsList.ts";

/**
 * Минимальный срез редакторов, нужный терминалу: куда вернуть фокус, когда
 * виджет терминала уходит со сцены (шелл вышел, а других терминалов нет).
 * `EditorService` соответствует ему структурно — связывание делает DI-модуль
 * ({@link TerminalFocusFallbackDIToken}).
 */
export interface ITerminalFocusFallback {
    focusEditor(): void;
}

export const TerminalFocusFallbackDIToken = token<ITerminalFocusFallback>("TerminalFocusFallback");
export const TerminalPanelComponentDIToken = token<TerminalPanelComponent>("TerminalPanelComponent");

/** Контекст открытия `MenuId.TerminalTabContext`: инстанс, по которому открыто меню. */
export interface TerminalTabMenuContext {
    readonly instanceId: number;
}

/** id команды переключения из дропдауна (эталон `TerminalCommandId.SwitchTerminal`). */
export const SWITCH_TERMINAL_COMMAND_ID = "workbench.action.terminal.switchTerminal";

/** Id виджета имени активного терминала в заголовке — селектор e2e/инспектора. */
export const TERMINAL_ACTIVE_TAB_ID = "terminalActiveTab";

/**
 * View-владелец встроенного терминала: по каждому инстансу {@link TerminalService}
 * строит `TerminalViewElement`, держит тело вкладки TERMINAL — терминал плюс
 * список вкладок сбоку ({@link TerminalTabbedViewElement}, эталон
 * `TerminalTabbedView`), — и виджет в заголовке вкладки: имя активного
 * терминала (`tabs.showActiveTerminal`) или дропдаун при `tabs.enabled=false`.
 *
 * Не наследник `Component`: собственного корневого контрола нет — тело и виджет
 * заголовка попадают в панель через ViewsService. ВАЖНО: у TUIElement нет
 * unmount-хуков, поэтому компонент обязан сам dispose'ить виджеты — при
 * закрытии инстанса и при своём dispose().
 */
export class TerminalPanelComponent extends Disposable implements IContextKeyContributor {
    public static dependencies = [
        TerminalServiceDIToken,
        ViewsServiceDIToken,
        TerminalFocusFallbackDIToken,
        IConfigurationServiceDIToken,
        ContextMenuServiceDIToken,
        CommandRegistryDIToken,
    ] as const;

    private widgets = new Map<number, TerminalViewElement>();
    private activeWidget: TerminalViewElement | null = null;

    public readonly tabs = new TerminalTabsList();
    public readonly view = new TerminalTabbedViewElement(this.tabs.list, TERMINAL_TABS_WIDTH);
    /** Имя активного терминала в заголовке (эталон `SingleTerminalTabActionViewItem`). */
    private readonly activeTabLabel = new TextLabelElement("");
    /** Дропдаун терминалов при выключенном списке (эталон `SwitchTerminalActionViewItem`). */
    private readonly switcher = new SelectBoxElement();

    public constructor(
        private readonly terminalService: TerminalService,
        private readonly viewsService: ViewsService,
        private readonly focusFallback: ITerminalFocusFallback,
        private readonly configuration: IConfigurationService,
        private readonly contextMenuService: ContextMenuService,
        private readonly commands: CommandRegistry,
    ) {
        super();
        this.activeTabLabel.id = TERMINAL_ACTIVE_TAB_ID;
        this.activeTabLabel.style = { fg: "descriptionForeground" };
        // Клик по имени — меню вкладки, как у эталона (там это кнопка с dropdown).
        this.activeTabLabel.addEventListener("click", (event) => {
            const active = this.terminalService.getActiveInstance();
            if (active === null) return;
            this.showTabContextMenu(active.id, event.screenX, event.screenY + 1);
        });
        this.switcher.id = "terminalSwitcher";
        this.switcher.onDidSelect = ({ selected }) => {
            void this.commands.execute(SWITCH_TERMINAL_COMMAND_ID, selected);
        };

        this.tabs.onDidSelectInstance = (id) => {
            this.terminalService.setActiveInstance(id);
            // `tabs.focusMode: singleClick` — клик (и любой выбор) сразу фокусирует терминал.
            if (this.configuration.get("terminal.integrated.tabs.focusMode") === "singleClick") {
                this.terminalService.focusActive();
            }
        };
        this.tabs.onDidActivateInstance = (id) => {
            this.terminalService.setActiveInstance(id);
            this.terminalService.focusActive();
        };
        this.tabs.onDidRequestContextMenu = (id, screenX, screenY) => {
            this.showTabContextMenu(id, screenX, screenY);
        };

        this.register(
            terminalService.onDidOpenInstance((instance) => {
                this.handleOpen(instance);
            }),
        );
        this.register(
            terminalService.onDidCloseInstance((instance) => {
                this.handleClose(instance);
            }),
        );
        this.register(
            terminalService.onDidChangeActiveInstance((instance) => {
                this.handleActiveChange(instance);
            }),
        );
        this.register(
            terminalService.onDidRequestFocus(() => {
                this.activeWidget?.focus();
            }),
        );
        // Настройки читаются на каждом обращении; событие лишь перерисовывает.
        this.register(
            configuration.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration("terminal.integrated.tabs")) this.syncChrome();
            }),
        );
        // Инстансы, созданные до компонента (сервис резолвится первым в том же модуле).
        for (const instance of terminalService.getInstances()) this.handleOpen(instance);
        this.handleActiveChange(terminalService.getActiveInstance());

        // Виджеты обязаны быть dispose'нуты (подписки на surface): и оставшиеся
        // при закрытии приложения — здесь, и по одному — в handleClose.
        this.register({
            dispose: () => {
                for (const widget of this.widgets.values()) widget.dispose();
                this.widgets.clear();
            },
        });
    }

    /** IContextKeyContributor: `terminalTabsFocus` — фокус в списке вкладок. */
    public updateContextKeys(contextKeys: ContextKeyService, active: TUIElement | null): void {
        contextKeys.set("terminalTabsFocus", active !== null && active === this.tabs.list);
    }

    /** Виден ли сейчас список вкладок (`_shouldShowTabs` эталона применён). */
    public get tabsVisible(): boolean {
        return this.view.isTabsVisible;
    }

    /**
     * Фокус в список вкладок (`focusTabs` эталона). Списка не видно — no-op:
     * `false`, чтобы команда знала, что фокусировать нечего.
     */
    public focusTabs(): boolean {
        if (!this.view.isTabsVisible) return false;
        this.tabs.list.focus();
        return true;
    }

    private handleOpen(instance: ITerminalInstance): void {
        const widget = new TerminalViewElement(instance.session);
        this.widgets.set(instance.id, widget);
    }

    private handleClose(instance: ITerminalInstance): void {
        const widget = this.widgets.get(instance.id);
        /* v8 ignore start -- defensive: сервис файрит close только для инстанса, чей open компонент уже видел */
        if (widget === undefined) return;
        /* v8 ignore stop */
        widget.dispose();
        this.widgets.delete(instance.id);
        this.syncChrome();
    }

    /** Вкидывает виджет активного инстанса в тело вкладки (null → placeholder). */
    private handleActiveChange(instance: ITerminalInstance | null): void {
        // Фокус подмену терминала не переживает: уходящий виджет снимают с
        // дерева, а FocusManager на этом обнуляет фокус — после `exit` ввод
        // проваливался в никуда. Поэтому спрашиваем ДО подмены и раздаём фокус
        // заново ПОСЛЕ.
        const hadFocus = this.activeWidget !== null && holdsFocus(this.activeWidget);
        if (instance === null) {
            this.activeWidget = null;
        } else {
            const widget = this.widgets.get(instance.id);
            /* v8 ignore start -- defensive: onDidOpenInstance всегда предшествует смене активного */
            if (widget === undefined) return;
            /* v8 ignore stop */
            this.activeWidget = widget;
        }
        this.view.setTerminal(this.activeWidget);
        this.viewsService.setViewBody(TERMINAL_VIEW_ID, this.activeWidget === null ? null : this.view);
        this.syncChrome();
        if (!hadFocus) return;
        // Следующий терминал есть — фокус идёт в него; не осталось ни одного —
        // возвращаем его редактору, как VS Code при выходе последнего шелла.
        if (this.activeWidget !== null) this.activeWidget.focus();
        else this.focusFallback.focusEditor();
    }

    /**
     * Приводит «обвязку» к состоянию сервиса и настройкам: строки списка, его
     * видимость и место, виджет заголовка. Дёшево (строк — единицы), поэтому
     * пересобирается целиком на любое изменение.
     */
    private syncChrome(): void {
        const instances = this.terminalService.getInstances();
        const active = this.terminalService.getActiveInstance();
        const hadTabsFocus = this.tabs.list.isFocused;
        this.tabs.setInstances(instances, active?.id ?? null);
        this.view.setLocation(this.configuration.get("terminal.integrated.tabs.location"));
        const showTabs = this.shouldShowTabs(instances.length);
        this.view.setTabsVisible(showTabs);
        // Список, в котором стоял фокус, спрятали (остался один терминал) —
        // фокус уходит в терминал, а не в никуда.
        if (hadTabsFocus && !showTabs) this.activeWidget?.focus();
        this.viewsService.setViewTitleWidget(TERMINAL_VIEW_ID, this.titleWidget(instances, active));
    }

    /** `_shouldShowTabs` эталона; группа = инстанс, поэтому `singleGroup` ≡ `singleTerminal`. */
    private shouldShowTabs(count: number): boolean {
        if (!this.configuration.get("terminal.integrated.tabs.enabled")) return false;
        if (this.configuration.get("terminal.integrated.tabs.hideCondition") === "never") return true;
        return count > 1;
    }

    /** Что стоит в заголовке вкладки: дропдаун, имя активного или ничего. */
    private titleWidget(instances: readonly ITerminalInstance[], active: ITerminalInstance | null): TUIElement | null {
        if (active === null) return null;
        if (!this.configuration.get("terminal.integrated.tabs.enabled")) {
            const options: ISelectOptionItem[] = instances.map((instance, index) => ({
                text: terminalIndexedLabel(index, instance),
            }));
            options.push({ text: "─", isSeparator: true });
            options.push({ text: SWITCH_TERMINAL_SHOW_TABS });
            this.switcher.setOptions(options, instances.indexOf(active));
            return this.switcher;
        }
        if (!this.shouldShowActiveTerminal(instances.length)) return null;
        this.activeTabLabel.setText(` ${terminalTabLabel(active)} `);
        return this.activeTabLabel;
    }

    /**
     * `tabs.showActiveTerminal` (эталон — when-клауза пункта Focus в `ViewTitle`).
     * Узкого «иконочного» списка у нас нет, поэтому `singleTerminalOrNarrow`
     * сводится к `singleTerminal`.
     */
    private shouldShowActiveTerminal(count: number): boolean {
        switch (this.configuration.get("terminal.integrated.tabs.showActiveTerminal")) {
            case "always":
                return true;
            case "never":
                return false;
            default:
                return count === 1;
        }
    }

    private showTabContextMenu(instanceId: number, screenX: number, screenY: number): void {
        const context: TerminalTabMenuContext = { instanceId };
        this.contextMenuService.showContextMenu({
            getOwner: () => this.view,
            getAnchor: () => ({ screenX, screenY }),
            menuId: MenuId.TerminalTabContext,
            menuContext: context,
        });
    }
}

/** Держит ли фокус сам виджет или что-то в его поддереве. */
function holdsFocus(widget: TerminalViewElement): boolean {
    const active = widget.getRoot()?.focusManager?.activeElement ?? null;
    return active?.getAncestorPath().includes(widget) === true;
}
