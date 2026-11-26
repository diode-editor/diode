/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/debugToolBar.ts
// The debug toolbar: the `navigation` buttons of `MenuId.DebugToolBar` while a session is on. Deviations (owner's
// decision 2026-11-14): it does not float over the window but sits where find lives, in the top right corner of the
// active editor group in the same `editorWidget` box, find stacked under it (`GroupCornerStack`); it is not dragged.
// Buttons carry short labels (a terminal has no tooltips), a narrow group gets glyphs only. The buttons are for the
// mouse and never take focus: F5/F10/F11 are the keys. `debug.toolBarLocation: commandCenter` shows it as `floating`
// (there is no command center); `docked` puts the same items in the Run and Debug title (`debugCommands.ts`). With
// several sessions (`multiSessionDebug`) Focus Session is upstream's select of the sessions (`FocusSessionActionViewItem`);
// in the docked title it is a button that opens Select Debug Session. Not here: the Stop button's dropdown.

import { Point } from "@tuidom/core/common/geometryPromitives";
import type { OverlaySessionHandle } from "@tuidom/core/dom/overlayLayer";
import type { OverlayHostElement } from "@tuidom/elements/contextview/overlayHostElement";
import { BoxContainerElement } from "@tuidom/elements/layout/boxContainerElement";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { HFlexElement, hflexFit, hflexFixed } from "@tuidom/elements/layout/hFlexElement";
import { SizedBoxElement } from "@tuidom/elements/layout/sizedBoxElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import {
    type IMenuEntryGroup,
    type MenuRegistry,
    MenuRegistryDIToken,
} from "../../../../platform/actions/common/menuRegistry.ts";
import { type MenuService, MenuServiceDIToken } from "../../../../platform/actions/common/menuService.ts";
import { type CommandRegistry, CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import {
    type ContextKeyService,
    ContextKeyServiceDIToken,
} from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type IProductIconService,
    ProductIconServiceDIToken,
} from "../../../../platform/theme/common/productIconService.ts";
import { containerMenuVisible } from "../../../browser/actions/menuContexts.ts";
import { CORNER_RIGHT_MARGIN, CornerDockElement } from "../../../browser/parts/editor/cornerDockElement.ts";
import { EditorPartComponentDIToken } from "../../../browser/parts/editor/editorPartComponent.ts";
import {
    CORNER_ORDER,
    type GroupCornerStack,
    GroupCornerStackDIToken,
    type IGroupCornerSlot,
} from "../../../browser/parts/editor/groupCornerStack.ts";
import { isInlineItem, NAVIGATION_GROUP, runAction } from "../../../browser/parts/views/titleMenuEntries.ts";
import {
    EditorGroupsServiceDIToken,
    type IEditorGroupsService,
} from "../../../services/editor/common/editorGroupsService.ts";
import type { IGroupOverlayHosts } from "../../find/browser/findComponent.ts";
import { type IDebugService, State, VIEWLET_ID } from "../common/debug.ts";

import { FOCUS_SESSION_ID, SELECT_DEBUG_SESSION_ID, STEP_INTO_ID, STEP_OUT_ID, STEP_OVER_ID } from "./debugCommands.ts";
import { DebugServiceDIToken } from "./debugService.ts";
import {
    FocusSessionActionViewItem,
    type ISessionSelectDebugService,
    toolbarSessionStrategy,
} from "./focusSessionActionViewItem.ts";

export const DebugToolbarDIToken = token<DebugToolbar>("DebugToolbar");
export const DebugToolbarSessionSelectDIToken = token<DebugToolbarSessionSelect>("DebugToolbarSessionSelect");

/** The toolbar's Focus Session item: picking a session runs `workbench.action.debug.focusProcess` with it. */
export class DebugToolbarSessionSelect extends FocusSessionActionViewItem {
    public static dependencies = [DebugServiceDIToken, IConfigurationServiceDIToken, CommandRegistryDIToken] as const;

    public constructor(
        debugService: ISessionSelectDebugService,
        configuration: Pick<IConfigurationService, "get">,
        commands: Pick<CommandRegistry, "execute">,
    ) {
        super(
            debugService,
            toolbarSessionStrategy(debugService, () => configuration.get("debug.showSubSessionsInToolBar")),
            (session) => {
                commands.execute(FOCUS_SESSION_ID, session);
            },
            debugService.getViewModel().focusedSession,
        );
    }
}

export const DockedDebugToolbarItemsDIToken = token<DockedDebugToolbarItems>("DockedDebugToolbarItems");

const DOCKED = "debugState != 'inactive' && config.debug.toolBarLocation == 'docked'";

/**
 * Upstream's `debugViewTitleItems` (`debugToolBar.ts`): every item of the toolbar, built-in or an extension's
 * `debug/toolBar`, has a twin in the Run and Debug title, shown while the toolbar is docked there and a session is
 * on; the twins follow the toolbar's menu as it changes.
 */
export class DockedDebugToolbarItems extends Disposable {
    public static dependencies = [MenuRegistryDIToken] as const;

    private twins: IDisposable[] = [];

    public constructor(private readonly registry: MenuRegistry) {
        super();
        this.register(
            registry.onDidChangeMenu((menuId) => {
                if (menuId === MenuId.DebugToolBar) this.update();
            }),
        );
        this.register({
            dispose: () => {
                this.clear();
            },
        });
        this.update();
    }

    private update(): void {
        this.clear();
        for (const item of this.registry.getContributions(MenuId.DebugToolBar)) {
            this.twins.push(
                this.registry.appendMenuItem({
                    ...item,
                    // Upstream's select of the sessions there is a button that opens Select Debug Session.
                    ...("command" in item && item.command === FOCUS_SESSION_ID
                        ? { command: SELECT_DEBUG_SESSION_ID }
                        : {}),
                    menuId: MenuId.ViewContainerTitle,
                    when: item.when === undefined ? DOCKED : `(${item.when}) && ${DOCKED}`,
                    visible: containerMenuVisible(VIEWLET_ID),
                }),
            );
        }
    }

    private clear(): void {
        for (const twin of this.twins.splice(0)) twin.dispose();
    }
}

/** The box: a border row above and below the buttons, as the find widget. */
const TOOLBAR_HEIGHT = 3;
const BUTTON_GAP = 2;
const WIDGET_BG = "editorWidget.background";
/** The box border and a column of padding on each side. */
const CHROME_WIDTH = 4;

/** Short labels of the steps: the toolbar has room for a word per button, the menu items say "Step Over". */
const SHORT_LABELS: Readonly<Partial<Record<string, string>>> = {
    [STEP_OVER_ID]: "Over",
    [STEP_INTO_ID]: "Into",
    [STEP_OUT_ID]: "Out",
};

interface IToolbarButton {
    readonly id: string;
    readonly glyph: string;
    readonly label: string;
    readonly color: string | undefined;
    readonly enabled: boolean;
}

interface IPlacement {
    readonly groupId: number;
    readonly host: OverlayHostElement;
    /** The row the session was put on. */
    top: number;
    readonly session: OverlaySessionHandle;
    readonly slot: IGroupCornerSlot;
}

export class DebugToolbar extends Disposable {
    public static dependencies = [
        DebugServiceDIToken,
        EditorPartComponentDIToken,
        GroupCornerStackDIToken,
        EditorGroupsServiceDIToken,
        MenuServiceDIToken,
        ContextKeyServiceDIToken,
        IConfigurationServiceDIToken,
        ProductIconServiceDIToken,
        DebugToolbarSessionSelectDIToken,
    ] as const;

    public readonly view = new CornerDockElement();
    private placement: IPlacement | null = null;
    /** What the row shows, to rebuild it only when that changes (context keys change on every cursor move). */
    private shown: string | undefined;

    /**
     * The debug state reaches it through the context keys (`debugState`, set on every state change), as the
     * enablement of its items does.
     */
    public constructor(
        private readonly debugService: Pick<IDebugService, "state" | "getModel" | "initializingOptions">,
        private readonly hosts: IGroupOverlayHosts,
        private readonly corners: GroupCornerStack,
        private readonly groups: Pick<IEditorGroupsService, "activeGroup" | "onDidActiveGroupChange">,
        private readonly menus: Pick<MenuService, "getEntryGroups" | "createMenu">,
        contextKeys: Pick<ContextKeyService, "onDidChange">,
        private readonly configuration: Pick<IConfigurationService, "get" | "onDidChangeConfiguration">,
        icons: Pick<IProductIconService, "onDidChange">,
        private readonly sessionSelect: Pick<FocusSessionActionViewItem, "element" | "onDidChange">,
    ) {
        super();
        const update = (): void => {
            this.update();
        };
        this.register(sessionSelect.onDidChange(update));
        this.view.id = "debugToolbar";
        this.view.onDidChangeWidth = update;

        this.register(groups.onDidActiveGroupChange(update));
        this.register(contextKeys.onDidChange(update));
        this.register(icons.onDidChange(update));
        const menu = this.register(menus.createMenu(MenuId.DebugToolBar));
        this.register(menu.onDidChange(update));
        this.register(
            configuration.onDidChangeConfiguration((e) => {
                // Stryker disable next-line ConditionalExpression: a fast path — for another key the toolbar resolves to what it shows and changes nothing
                if (e.affectsConfiguration("debug.toolBarLocation")) update();
            }),
        );
        this.register({
            dispose: () => {
                this.unplace();
            },
        });
        this.update();
    }

    private isVisible(): boolean {
        const state = this.debugService.state;
        if (state === State.Inactive) return false;
        const location = this.configuration.get("debug.toolBarLocation");
        return !(
            location === "docked" ||
            location === "hidden" ||
            this.debugService
                .getModel()
                .getSessions()
                .every((s) => s.suppressDebugToolbar) ||
            (state === State.Initializing && this.debugService.initializingOptions?.suppressDebugToolbar === true)
        );
    }

    private update(): void {
        if (!this.isVisible()) {
            this.hide();
            return;
        }
        const placement = this.place(this.groups.activeGroup.id);
        if (placement === null) return;
        const buttons = this.buttons();
        // With labels while they fit in the group, glyphs only in a narrow one (0 before the group's first layout:
        // the dock reports the real width after it).
        const selectWidth = this.sessionSelect.element.getMaxIntrinsicWidth(1);
        const withLabels =
            toolbarWidth(buttons, true, selectWidth) + CORNER_RIGHT_MARGIN <= placement.host.layoutSize.width;
        // The select repaints its own selection.
        const shown = JSON.stringify([buttons, withLabels, selectWidth]);
        if (shown !== this.shown) {
            this.shown = shown;
            this.view.setChild(this.toolbar(buttons, withLabels, selectWidth));
        }
        placement.slot.setHeight(TOOLBAR_HEIGHT);
        const top = placement.slot.top();
        // Stryker disable next-line ConditionalExpression: a fast path — the same position set again repaints the same frame
        if (top !== placement.top) {
            placement.top = top;
            placement.session.setPosition(new Point(0, top));
        }
        placement.session.open();
    }

    private hide(): void {
        if (this.placement === null) return;
        this.placement.slot.setHeight(0);
        this.placement.session.close();
    }

    /** The toolbar follows the active group: it moves to the new group's overlay host and corner. */
    private place(groupId: number): IPlacement | null {
        // Stryker disable next-line ConditionalExpression: a fast path — placing again in the same group recreates the same session and slot
        if (this.placement?.groupId === groupId) return this.placement;
        this.unplace();
        const host = this.hosts.groupOverlayHost(groupId);
        if (host === null) return null;
        // Clicks around the toolbar go to the editor, as around the find widget; it takes neither focus nor keys.
        // Stryker disable next-line ObjectLiteral,StringLiteral: for the mouse an absent or empty policy behaves as passthrough; the click beside the toolbar test pins the behavior
        const session = host.overlayLayer.createSession(this.view, new Point(0, 0), { pointerPolicy: "passthrough" });
        this.placement = {
            groupId,
            host,
            session,
            top: -1,
            slot: this.corners.addSlot(groupId, CORNER_ORDER.debugToolbar),
        };
        return this.placement;
    }

    private unplace(): void {
        this.placement?.session.dispose();
        this.placement?.slot.dispose();
        this.placement = null;
    }

    private menuGroups(): IMenuEntryGroup[] {
        return this.menus.getEntryGroups(MenuId.DebugToolBar);
    }

    private buttons(): IToolbarButton[] {
        const navigation = this.menuGroups().find((group) => group.group === NAVIGATION_GROUP);
        const items = navigation?.entries.filter(isInlineItem) ?? [];
        return items.map((entry) => ({
            id: entry.id,
            glyph: entry.icon,
            label: SHORT_LABELS[entry.id] ?? entry.label,
            color: entry.iconColor,
            enabled: entry.enabled,
        }));
    }

    /** The `editorWidget` box of find around a row of buttons. */
    private toolbar(buttons: readonly IToolbarButton[], withLabels: boolean, selectWidth: number): SizedBoxElement {
        const box = new BoxContainerElement();
        box.setBorderFg("editorWidget.border");
        // The box paints its frame in the first, the labels paint their text in the second (the cascade's).
        box.setBg(WIDGET_BG);
        box.style = { bg: WIDGET_BG };
        box.setChild(this.row(buttons, withLabels, selectWidth));
        const sized = new SizedBoxElement(toolbarWidth(buttons, withLabels, selectWidth), TOOLBAR_HEIGHT);
        sized.setChild(box);
        return sized;
    }

    private row(buttons: readonly IToolbarButton[], withLabels: boolean, selectWidth: number): HFlexElement {
        const row = new HFlexElement();
        row.addChild(new FillerElement(), { width: hflexFixed(1), height: 1 });
        buttons.forEach((button, index) => {
            if (index > 0) row.addChild(new FillerElement(), { width: hflexFixed(BUTTON_GAP), height: 1 });
            if (button.id === FOCUS_SESSION_ID) {
                row.addChild(this.sessionSelect.element, { width: hflexFixed(selectWidth), height: 1 });
            } else {
                row.addChild(this.buttonElement(button, withLabels), { width: hflexFit(), height: 1 });
            }
        });
        return row;
    }

    private buttonElement(button: IToolbarButton, withLabel: boolean): TextLabelElement {
        const label = new TextLabelElement(withLabel ? `${button.glyph} ${button.label}` : button.glyph);
        if (!button.enabled) {
            label.style = { fg: "disabledForeground" };
            return label;
        }
        label.style = { when: [{ states: ["hover"], bg: "toolbar.hoverBackground" }] };
        // A codicon is one character; an item without a color (an extension's) keeps the label's.
        label.setCharStyle(0, { fg: button.color });
        label.addEventListener("click", (event) => {
            if (event.button !== "left") return;
            // Resolved again at the click: the button runs only while its item is still enabled.
            runAction(this.menuGroups(), button.id);
        });
        return label;
    }
}

/** `selectWidth`: the columns of the session select, which stands for the Focus Session item. */
function toolbarWidth(buttons: readonly IToolbarButton[], withLabels: boolean, selectWidth: number): number {
    const width = (b: IToolbarButton): number => {
        if (b.id === FOCUS_SESSION_ID) return selectWidth;
        return withLabels ? b.glyph.length + 1 + b.label.length : b.glyph.length;
    };
    return buttons.reduce((sum, b) => sum + width(b), 0) + BUTTON_GAP * Math.max(0, buttons.length - 1) + CHROME_WIDTH;
}
