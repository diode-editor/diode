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
// (there is no command center); `docked` puts the same items in the Run and Debug title (`debugCommands.ts`). Not
// here: the session picker of several sessions (`FocusSessionActionViewItem`) and the Stop button's dropdown.

import { Point } from "@tuidom/core/common/geometryPromitives";
import type { OverlaySessionHandle } from "@tuidom/core/dom/overlayLayer";
import type { StyleColor } from "@tuidom/core/dom/styles/tuiStyle";
import type { OverlayHostElement } from "@tuidom/elements/contextview/overlayHostElement";
import { BoxContainerElement } from "@tuidom/elements/layout/boxContainerElement";
import { HFlexElement, hflexFit, hflexFixed } from "@tuidom/elements/layout/hFlexElement";
import { SizedBoxElement } from "@tuidom/elements/layout/sizedBoxElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { Disposable } from "../../../../base/common/lifecycle.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { IMenuEntryGroup } from "../../../../platform/actions/common/menuRegistry.ts";
import { type MenuService, MenuServiceDIToken } from "../../../../platform/actions/common/menuService.ts";
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
import { type IDebugService, State } from "../common/debug.ts";

import {
    CONTINUE_ID,
    DISCONNECT_ID,
    PAUSE_ID,
    RESTART_SESSION_ID,
    STEP_INTO_ID,
    STEP_OUT_ID,
    STEP_OVER_ID,
    STOP_ID,
} from "./debugCommands.ts";
import { DebugServiceDIToken } from "./debugService.ts";

export const DebugToolbarDIToken = token<DebugToolbar>("DebugToolbar");

/** The box: a border row above and below the buttons, as the find widget. */
const TOOLBAR_HEIGHT = 3;
const BUTTON_GAP = 2;
const WIDGET_BG = "editorWidget.background";
/** The box border and a column of padding on each side. */
const CHROME_WIDTH = 4;

/** Upstream colors each icon by its command (`debugToolBar.ts`, `debugIcon.*Foreground`). */
const BUILTIN_BUTTONS: Readonly<Partial<Record<string, { readonly label: string; readonly color: StyleColor }>>> = {
    [CONTINUE_ID]: { label: "Continue", color: "debugIcon.continueForeground" },
    [PAUSE_ID]: { label: "Pause", color: "debugIcon.pauseForeground" },
    [STEP_OVER_ID]: { label: "Over", color: "debugIcon.stepOverForeground" },
    [STEP_INTO_ID]: { label: "Into", color: "debugIcon.stepIntoForeground" },
    [STEP_OUT_ID]: { label: "Out", color: "debugIcon.stepOutForeground" },
    [RESTART_SESSION_ID]: { label: "Restart", color: "debugIcon.restartForeground" },
    [STOP_ID]: { label: "Stop", color: "debugIcon.stopForeground" },
    [DISCONNECT_ID]: { label: "Disconnect", color: "debugIcon.disconnectForeground" },
};

interface IToolbarButton {
    readonly id: string;
    readonly glyph: string;
    readonly label: string;
    readonly color: StyleColor | undefined;
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
    ] as const;

    public readonly view = new CornerDockElement();
    private placement: IPlacement | null = null;
    /** What the row shows, to rebuild it only when that changes (context keys change on every cursor move). */
    private shown = "";

    public constructor(
        private readonly debugService: Pick<
            IDebugService,
            "state" | "onDidChangeState" | "getModel" | "initializingOptions"
        >,
        private readonly hosts: IGroupOverlayHosts,
        private readonly corners: GroupCornerStack,
        private readonly groups: Pick<IEditorGroupsService, "activeGroup" | "onDidActiveGroupChange">,
        private readonly menus: Pick<MenuService, "getEntryGroups" | "createMenu">,
        contextKeys: Pick<ContextKeyService, "onDidChange">,
        private readonly configuration: Pick<IConfigurationService, "get" | "onDidChangeConfiguration">,
        private readonly icons: Pick<IProductIconService, "glyph" | "onDidChange">,
    ) {
        super();
        const update = (): void => {
            this.update();
        };
        this.view.id = "debugToolbar";
        this.view.onDidChangeWidth = update;

        this.register(debugService.onDidChangeState(update));
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
        // With labels while they fit in the group, glyphs only in a narrow one. Until its first layout in this
        // group the dock's width is the group's.
        const width = this.view.width ?? placement.host.layoutSize.width;
        const withLabels = toolbarWidth(buttons, true) + CORNER_RIGHT_MARGIN <= width;
        const shown = JSON.stringify([buttons, withLabels]);
        if (shown !== this.shown) {
            this.shown = shown;
            this.view.setChild(this.toolbar(buttons, withLabels));
        }
        placement.slot.setHeight(TOOLBAR_HEIGHT);
        // Context keys change on every cursor move, and a set position repaints the layer even when it is the same.
        const top = placement.slot.top();
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
        if (this.placement?.groupId === groupId) return this.placement;
        this.unplace();
        const host = this.hosts.groupOverlayHost(groupId);
        if (host === null) return null;
        const session = host.overlayLayer.createSession(this.view, new Point(0, 0), {
            visible: false,
            focusOnOpen: false,
            // Clicks around the toolbar go to the editor, as around the find widget.
            pointerPolicy: "passthrough",
            capturesKeyboard: false,
        });
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
        return (navigation?.entries ?? []).filter(isInlineItem).map((entry) => {
            const builtin = BUILTIN_BUTTONS[entry.id];
            return {
                id: entry.id,
                glyph: entry.icon,
                label: builtin?.label ?? entry.label,
                color: builtin?.color,
                enabled: entry.enabled,
            };
        });
    }

    /** The `editorWidget` box of find around a row of buttons. */
    private toolbar(buttons: readonly IToolbarButton[], withLabels: boolean): SizedBoxElement {
        const box = new BoxContainerElement();
        box.setBg(WIDGET_BG);
        // In the cascade too: the labels paint their text in it.
        box.style = { bg: WIDGET_BG };
        box.setBorderFg("editorWidget.border");
        box.setChild(this.row(buttons, withLabels));
        const sized = new SizedBoxElement(toolbarWidth(buttons, withLabels), TOOLBAR_HEIGHT);
        sized.setChild(box);
        return sized;
    }

    private row(buttons: readonly IToolbarButton[], withLabels: boolean): HFlexElement {
        const row = new HFlexElement();
        row.addChild(new TextLabelElement(""), { width: hflexFixed(1), height: 1 });
        buttons.forEach((button, index) => {
            if (index > 0) row.addChild(new TextLabelElement(""), { width: hflexFixed(BUTTON_GAP), height: 1 });
            row.addChild(this.buttonElement(button, withLabels), { width: hflexFit(), height: 1 });
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
        const color = button.color;
        if (color !== undefined) {
            for (let i = 0; i < button.glyph.length; i++) label.setCharStyle(i, { fg: color });
        }
        label.addEventListener("click", (event) => {
            if (event.button !== "left") return;
            // Resolved again at the click: the button runs only while its item is still enabled.
            runAction(this.menuGroups(), button.id);
        });
        return label;
    }
}

function toolbarWidth(buttons: readonly IToolbarButton[], withLabels: boolean): number {
    const width = (b: IToolbarButton): number => (withLabels ? b.glyph.length + 1 + b.label.length : b.glyph.length);
    return buttons.reduce((sum, b) => sum + width(b), 0) + BUTTON_GAP * Math.max(0, buttons.length - 1) + CHROME_WIDTH;
}
