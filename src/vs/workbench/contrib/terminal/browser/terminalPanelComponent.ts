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
import {
    type IProductIconService,
    NERD_FONT_ICONS,
    ProductIconServiceDIToken,
} from "../../../../platform/theme/common/productIconService.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";

import {
    type ITerminalColors,
    type TerminalColorsService,
    TerminalColorsServiceDIToken,
} from "./terminalColorsService.ts";
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

/** Where to return focus when the last terminal leaves; `EditorService` fits structurally. */
export interface ITerminalFocusFallback {
    focusEditor(): void;
}

export const TerminalFocusFallbackDIToken = token<ITerminalFocusFallback>("TerminalFocusFallback");
export const TerminalPanelComponentDIToken = token<TerminalPanelComponent>("TerminalPanelComponent");

export interface TerminalTabMenuContext {
    readonly instanceId: number;
}

export const SWITCH_TERMINAL_COMMAND_ID = "workbench.action.terminal.switchTerminal";

/** Selector for e2e/inspector. */
export const TERMINAL_ACTIVE_TAB_ID = "terminalActiveTab";

/**
 * Not a `Component` subclass: there is no root control — the body and title widget
 * reach the panel via ViewsService. TUIElement has no unmount hooks, so the
 * component disposes widgets itself — when an instance closes and in its own dispose().
 */
export class TerminalPanelComponent extends Disposable implements IContextKeyContributor {
    public static dependencies = [
        TerminalServiceDIToken,
        ViewsServiceDIToken,
        TerminalFocusFallbackDIToken,
        IConfigurationServiceDIToken,
        ContextMenuServiceDIToken,
        CommandRegistryDIToken,
        TerminalColorsServiceDIToken,
        ProductIconServiceDIToken,
    ] as const;

    private widgets = new Map<number, TerminalViewElement>();
    private activeWidget: TerminalViewElement | null = null;

    public readonly tabs: TerminalTabsList;
    public readonly view: TerminalTabbedViewElement;
    // Stryker disable next-line StringLiteral: titleWidget sets the text before the label reaches the title
    private readonly activeTabLabel = new TextLabelElement("");
    /** Click target of {@link activeTabLabel}. */
    private activeTabInstanceId = 0;
    private readonly switcher = new SelectBoxElement();

    public constructor(
        private readonly terminalService: TerminalService,
        private readonly viewsService: ViewsService,
        private readonly focusFallback: ITerminalFocusFallback,
        private readonly configuration: IConfigurationService,
        private readonly contextMenuService: ContextMenuService,
        private readonly commands: CommandRegistry,
        private readonly colors: TerminalColorsService,
        private readonly icons: IProductIconService = NERD_FONT_ICONS,
    ) {
        super();
        this.tabs = new TerminalTabsList({
            onDidSelectInstance: (id) => {
                this.terminalService.setActiveInstance(id);
                if (this.configuration.get("terminal.integrated.tabs.focusMode") === "singleClick") {
                    this.terminalService.focusActive();
                }
            },
            onDidActivateInstance: () => {
                this.terminalService.focusActive();
            },
            onDidRequestContextMenu: (id, screenX, screenY) => {
                this.showTabContextMenu(id, screenX, screenY);
            },
        });
        this.tabs.nerdFont = icons.nerdFont;
        this.register(
            icons.onDidChange(() => {
                this.tabs.nerdFont = icons.nerdFont;
                this.syncChrome();
            }),
        );
        this.view = new TerminalTabbedViewElement(this.tabs.list, TERMINAL_TABS_WIDTH);
        this.activeTabLabel.id = TERMINAL_ACTIVE_TAB_ID;
        this.activeTabLabel.style = { fg: "descriptionForeground" };
        // Clicking the name opens the tab menu, as in upstream (there it's a button with a dropdown).
        this.activeTabLabel.addEventListener("click", (event) => {
            this.showTabContextMenu(this.activeTabInstanceId, event.screenX, event.screenY + 1);
        });
        this.switcher.id = "terminalSwitcher";
        this.switcher.onDidSelect = ({ selected }) => {
            void this.commands.execute(SWITCH_TERMINAL_COMMAND_ID, selected);
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
            colors.onDidChange((next) => {
                for (const [id, widget] of this.widgets) {
                    const instance = this.terminalService.getInstance(id);
                    /* v8 ignore start -- defensive: the widget is removed in handleClose together with the instance */
                    // Stryker disable next-line ConditionalExpression: unreachable (see above) — equivalent mutant
                    if (instance === null) continue;
                    /* v8 ignore stop */
                    applyTerminalColors(instance, widget, next);
                }
            }),
        );
        // A task terminal restarted under another name gets a new tab label.
        this.register(
            terminalService.onDidChangeInstanceTitle(() => {
                this.syncChrome();
            }),
        );
        this.register(
            terminalService.onDidRequestFocus(() => {
                this.activeWidget?.focus();
            }),
        );
        // Settings are read on every access; the event only triggers a redraw.
        this.register(
            configuration.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration("terminal.integrated.tabs")) this.syncChrome();
            }),
        );
        // Instances created before the component (the service resolves first in the same module).
        for (const instance of terminalService.getInstances()) this.handleOpen(instance);
        this.handleActiveChange(terminalService.getActiveInstance());

        // Widgets hold surface subscriptions: the rest are disposed here, each one in handleClose.
        this.register({
            dispose: () => {
                for (const widget of this.widgets.values()) widget.dispose();
                this.widgets.clear();
            },
        });
    }

    public updateContextKeys(contextKeys: ContextKeyService, active: TUIElement | null): void {
        contextKeys.set("terminalTabsFocus", active === this.tabs.list);
    }

    public get tabsVisible(): boolean {
        return this.view.isTabsVisible;
    }

    /** The list isn't visible — focus the active terminal: upstream calls `showPanel(true)` before this. */
    public focusTabs(): void {
        if (this.view.isTabsVisible) this.tabs.list.focus();
        else this.terminalService.focusActive();
    }

    private handleOpen(instance: ITerminalInstance): void {
        const widget = new TerminalViewElement(instance.session);
        applyTerminalColors(instance, widget, this.colors.colors);
        this.widgets.set(instance.id, widget);
    }

    private handleClose(instance: ITerminalInstance): void {
        const widget = this.widgets.get(instance.id);
        /* v8 ignore start -- defensive: the service fires close only for an instance whose open the component saw */
        if (widget === undefined) return;
        /* v8 ignore stop */
        widget.dispose();
        this.widgets.delete(instance.id);
        this.syncChrome();
    }

    private handleActiveChange(instance: ITerminalInstance | null): void {
        // Focus doesn't survive a terminal swap: the outgoing widget is removed from the tree,
        // and FocusManager clears focus on that — after `exit` input went nowhere. So ask
        // BEFORE the swap and hand out focus again AFTER.
        const hadFocus = this.activeWidget !== null && holdsFocus(this.activeWidget);
        if (instance === null) {
            this.activeWidget = null;
        } else {
            const widget = this.widgets.get(instance.id);
            /* v8 ignore start -- defensive: onDidOpenInstance always precedes an active change */
            if (widget === undefined) return;
            /* v8 ignore stop */
            this.activeWidget = widget;
        }
        this.view.setTerminal(this.activeWidget);
        this.viewsService.setViewBody(TERMINAL_VIEW_ID, this.activeWidget === null ? null : this.view);
        this.syncChrome();
        if (!hadFocus) return;
        // If there is a next terminal, focus goes to it; if none is left,
        // return it to the editor, as VS Code does when the last shell exits.
        this.focusActiveOrEditor();
    }

    private focusActiveOrEditor(): void {
        if (this.activeWidget !== null) this.activeWidget.focus();
        else this.focusFallback.focusEditor();
    }

    /** Cheap (only a few rows), so it is rebuilt entirely on any change. */
    private syncChrome(): void {
        const instances = this.terminalService.getInstances();
        const active = this.terminalService.getActiveInstance();
        const hadTabsFocus = this.tabs.list.isFocused;
        this.tabs.setInstances(instances, active?.id ?? null);
        this.view.setLocation(this.configuration.get("terminal.integrated.tabs.location"));
        const showTabs = this.shouldShowTabs(instances.length);
        this.view.setTabsVisible(showTabs);
        // The focused list got hidden — focus goes to the terminal, or,
        // if no terminals are left (Kill All from the list), to the editor.
        if (hadTabsFocus && !showTabs) this.focusActiveOrEditor();
        this.viewsService.setViewTitleWidget(TERMINAL_VIEW_ID, this.titleWidget(instances, active));
    }

    /** Upstream `_shouldShowTabs`; group = instance, so `singleGroup` ≡ `singleTerminal`. */
    private shouldShowTabs(count: number): boolean {
        if (!this.configuration.get("terminal.integrated.tabs.enabled")) return false;
        if (this.configuration.get("terminal.integrated.tabs.hideCondition") === "never") return true;
        return count > 1;
    }

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
        this.activeTabInstanceId = active.id;
        this.activeTabLabel.setText(` ${terminalTabLabel(active, this.icons.nerdFont)} `);
        return this.activeTabLabel;
    }

    /** We have no narrow "icon" list — `singleTerminalOrNarrow` reduces to `singleTerminal`. */
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

/**
 * Host background/foreground override `terminal.background`/`terminal.foreground` in the widget's
 * var scope; without them, theme tokens apply.
 */
export function applyTerminalColors(
    instance: ITerminalInstance,
    widget: TerminalViewElement,
    colors: ITerminalColors,
): void {
    instance.session.setAnsiColors(colors.ansi);
    const vars: Record<string, number> = {};
    if (colors.background !== undefined) vars["terminal.background"] = colors.background;
    if (colors.foreground !== undefined) vars["terminal.foreground"] = colors.foreground;
    widget.setStyleVars(vars);
}

function holdsFocus(widget: TerminalViewElement): boolean {
    const active = widget.getRoot()?.focusManager?.activeElement ?? null;
    return active?.getAncestorPath().includes(widget) === true;
}
