// The Run and Debug viewlet (upstream `debug.contribution.ts`: the container with `order: 3`, after Source Control
// and before Extensions; the VARIABLES, WATCH, CALL STACK and BREAKPOINTS views). Without a
// session VARIABLES shows upstream's welcome: the full-width Run and Debug button (as Source Control's Commit,
// decision 2026-11-14) and the launch.json hint. Deviations: the welcome lives in VARIABLES, not in a view of its
// own under `debugUx == simple`, and WATCH stays visible without a session; the button starts the debugging without
// the keybinding label, and the launch.json hint is text until launch.json comes (#1138).

import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import { VFlexElement, vflexFill, vflexFixed } from "@tuidom/elements/layout/vFlexElement";

import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { type MenuService, MenuServiceDIToken } from "../../../../platform/actions/common/menuService.ts";
import { type CommandRegistry, CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import {
    type ContextKeyService,
    ContextKeyServiceDIToken,
} from "../../../../platform/contextkey/common/contextKeyService.ts";
import {
    type ContextMenuService,
    ContextMenuServiceDIToken,
} from "../../../../platform/contextview/browser/contextMenuService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type IProductIconService,
    ProductIconServiceDIToken,
} from "../../../../platform/theme/common/productIconService.ts";
import { Component } from "../../../browser/component.ts";
import {
    type QuickInputService,
    QuickInputServiceDIToken,
} from "../../../browser/parts/quickinput/quickInputService.ts";
import { ActionButtonElement } from "../../../browser/parts/views/actionButtonElement.ts";
import { type ViewsService, ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { type IViewWelcomeBlock, ViewWelcomeElement } from "../../../browser/parts/views/viewWelcomeElement.ts";
import {
    BREAKPOINTS_VIEW_ID,
    CALLSTACK_VIEW_ID,
    State,
    VARIABLES_VIEW_ID,
    VIEWLET_ID,
    WATCH_VIEW_ID,
} from "../common/debug.ts";
import { Variable } from "../common/debugModel.ts";

import { BreakpointSourcesDIToken, BreakpointsView, type IBreakpointSources } from "./breakpointsView.ts";
import { CallStackView, getContext, getContextForContributedActions } from "./callStackView.ts";
import { DEBUG_START_COMMAND_ID } from "./debugCommands.ts";
import {
    breakpointItemKeys,
    breakpointItemType,
    callStackItemKeys,
    type IDebugContextMenuHost,
    showDebugContextMenu,
    variableMenuKeys,
    watchItemType,
    watchMenuKeys,
} from "./debugContextMenus.ts";
import { DebugExpressionRenderer } from "./debugExpressionRenderer.ts";
import { type DebugService, DebugServiceDIToken } from "./debugService.ts";
import { VariablesView } from "./variablesView.ts";
import { WatchExpressionsView } from "./watchExpressionsView.ts";

export const DebugViewletComponentDIToken = token<DebugViewletComponent>("DebugViewletComponent");

/** Upstream's welcome of the viewlet under the button (`welcomeView.ts`). */
const WELCOME_TEXT: readonly IViewWelcomeBlock[] = [
    { kind: "text", text: "To customize Run and Debug, create a launch.json file." },
];

function contains(element: TUIElement, active: TUIElement | null): boolean {
    return active?.getAncestorPath().includes(element) === true;
}

export class DebugViewletComponent extends Component implements IContextKeyContributor {
    public static dependencies = [
        DebugServiceDIToken,
        ViewsServiceDIToken,
        CommandRegistryDIToken,
        ContextKeyServiceDIToken,
        IConfigurationServiceDIToken,
        ProductIconServiceDIToken,
        QuickInputServiceDIToken,
        BreakpointSourcesDIToken,
        MenuServiceDIToken,
        ContextMenuServiceDIToken,
    ] as const;

    public readonly view: TUIElement;
    public readonly variables: VariablesView;
    public readonly watch: WatchExpressionsView;
    public readonly callStack: CallStackView;
    public readonly breakpoints: BreakpointsView;
    public readonly runButton = new ActionButtonElement();
    private readonly welcome: TUIElement;

    public constructor(
        private readonly debugService: DebugService,
        views: ViewsService,
        commands: CommandRegistry,
        contextKeys: ContextKeyService,
        configuration: IConfigurationService,
        icons: IProductIconService,
        quickInput: QuickInputService,
        breakpointSources: IBreakpointSources,
        menus: MenuService,
        contextMenu: ContextMenuService,
    ) {
        super();
        const renderer = this.register(
            new DebugExpressionRenderer({
                icons,
                showVariableTypes: () => configuration.get("debug.showVariableTypes"),
                onHighlightsExpired: () => {
                    this.rerender();
                },
            }),
        );
        this.variables = this.register(new VariablesView(debugService, renderer));
        this.watch = this.register(new WatchExpressionsView(debugService, renderer, contextKeys, quickInput));
        this.callStack = this.register(
            new CallStackView(
                debugService,
                icons,
                (message) => {
                    views.setViewTitle(CALLSTACK_VIEW_ID, undefined, message ?? null);
                },
                () => configuration.get("workbench.list.openMode") !== "doubleClick",
            ),
        );
        this.breakpoints = this.register(
            new BreakpointsView(debugService, breakpointSources, {
                icons,
                presentation: () => configuration.get("debug.breakpointsView.presentation"),
            }),
        );
        this.view = this.variables.tree.element;
        this.registerContextMenus({ menus, contextMenu, commands });

        this.runButton.setLabel("Run and Debug");
        this.runButton.onActivate = () => {
            Promise.resolve(commands.execute(DEBUG_START_COMMAND_ID)).catch(onUnexpectedError);
        };
        const welcome = new VFlexElement();
        // A blank row above the button; the fixed height leaves one below it.
        welcome.addChild(new PaddingContainerElement(this.runButton, { top: 1, right: 1, left: 1 }), {
            height: vflexFixed(3),
            width: "fill",
        });
        welcome.addChild(new ViewWelcomeElement(WELCOME_TEXT, onUnexpectedError), {
            height: vflexFill(),
            width: "fill",
        });
        this.welcome = welcome;

        views.registerContainer({
            id: VIEWLET_ID,
            title: "RUN AND DEBUG",
            label: "Run and Debug",
            location: "sidebar",
            // Upstream `order: 3`: after Source Control, before Extensions (ours is 3).
            order: 2.5,
        });
        views.registerView({
            id: VARIABLES_VIEW_ID,
            containerId: VIEWLET_ID,
            title: "VARIABLES",
            order: 10,
            body: this.variablesBody(),
            canMoveView: true,
            focus: () => {
                if (this.debugService.state === State.Inactive) this.runButton.focus();
                else this.variables.focus();
            },
        });
        views.registerView({
            id: WATCH_VIEW_ID,
            containerId: VIEWLET_ID,
            title: "WATCH",
            order: 20,
            body: this.watch.tree.element,
            canMoveView: true,
            focus: () => {
                this.watch.focus();
            },
        });

        views.registerView({
            id: CALLSTACK_VIEW_ID,
            containerId: VIEWLET_ID,
            title: "CALL STACK",
            order: 30,
            body: this.callStack.tree.element,
            canMoveView: true,
            focus: () => {
                this.callStack.focus();
            },
        });
        views.registerView({
            id: BREAKPOINTS_VIEW_ID,
            containerId: VIEWLET_ID,
            title: "BREAKPOINTS",
            order: 40,
            body: this.breakpoints.tree.element,
            canMoveView: true,
            focus: () => {
                this.breakpoints.focus();
            },
        });

        this.register(
            debugService.onDidChangeState(() => {
                views.setViewBody(VARIABLES_VIEW_ID, this.variablesBody());
            }),
        );
        this.register(
            // `debug.showVariableTypes` among others: redrawing two trees' rows on a rare settings change is cheap.
            configuration.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration("debug.breakpointsView.presentation")) this.breakpoints.refresh();
                this.rerender();
            }),
        );
        this.register(
            icons.onDidChange(() => {
                this.rerender();
            }),
        );
    }

    /** Upstream's `onContextMenu` of each view: the row's menu with the row's keys and arguments. */
    private registerContextMenus(host: IDebugContextMenuHost): void {
        const viewModel = this.debugService.getViewModel();
        this.variables.tree.onContextMenu = (element, screenX, screenY) => {
            const owner = this.variables.tree.list;
            const anchor = { screenX, screenY };
            // Upstream's scope menu (`DebugScopesContext`) has no items but the chat integration's: a scope has none.
            if (!(element instanceof Variable) || !element.value) return;
            void variableMenuKeys(element)
                .then((keys) => {
                    const args = [element.toJSON()];
                    showDebugContextMenu(host, { owner, anchor, menuId: MenuId.DebugVariablesContext, keys, args });
                })
                .catch(onUnexpectedError);
        };
        this.watch.tree.onContextMenu = (element, screenX, screenY) => {
            if (element === undefined) return;
            void watchMenuKeys(element, viewModel.focusedStackFrame)
                .then((keys) => {
                    const owner = this.watch.tree.list;
                    const anchor = { screenX, screenY };
                    showDebugContextMenu(host, {
                        owner,
                        anchor,
                        menuId: MenuId.DebugWatchContext,
                        keys,
                        args: [element],
                    });
                })
                .catch(onUnexpectedError);
        };
        this.callStack.tree.onContextMenu = (element, screenX, screenY) => {
            showDebugContextMenu(host, {
                owner: this.callStack.tree.list,
                anchor: { screenX, screenY },
                menuId: MenuId.DebugCallStackContext,
                keys: callStackItemKeys(element),
                // Extensions get upstream's contributed argument, the built-in commands the row's ids after it.
                args: [getContextForContributedActions(element ?? null), getContext(element ?? null)],
            });
        };
        this.breakpoints.tree.onContextMenu = (element, screenX, screenY) => {
            showDebugContextMenu(host, {
                owner: this.breakpoints.tree.list,
                anchor: { screenX, screenY },
                menuId: MenuId.DebugBreakpointsContext,
                keys: breakpointItemKeys(element, this.debugService),
                args: [element],
            });
        };
    }

    public updateContextKeys(contextKeys: ContextKeyService, active: TUIElement | null): void {
        contextKeys.set("variablesFocused", contains(this.variables.tree.list, active));
        const watchFocused = contains(this.watch.tree.list, active);
        contextKeys.set("watchExpressionsFocused", watchFocused);
        const item = watchFocused ? this.watch.tree.focused : undefined;
        contextKeys.set("watchItemType", watchItemType(item));
        this.updateCallStackContextKeys(contextKeys, active);
        const breakpointsFocused = contains(this.breakpoints.tree.list, active);
        contextKeys.set("breakpointsFocused", breakpointsFocused);
        contextKeys.set(
            "breakpointItemType",
            breakpointItemType(breakpointsFocused ? this.breakpoints.tree.focused : undefined),
        );
    }

    /** Upstream's overlay keys of a row, here of the row under the cursor of the focused view. */
    private updateCallStackContextKeys(contextKeys: ContextKeyService, active: TUIElement | null): void {
        const focused = contains(this.callStack.tree.list, active);
        contextKeys.set("callStackFocused", focused);
        const keys = callStackItemKeys(focused ? this.callStack.tree.focused : undefined);
        for (const [key, value] of Object.entries(keys)) contextKeys.setRaw(key, value);
    }

    private variablesBody(): TUIElement {
        return this.debugService.state === State.Inactive ? this.welcome : this.variables.tree.element;
    }

    /** The look changed, not the data: no adapter request. */
    private rerender(): void {
        this.variables.tree.rerender();
        this.watch.tree.rerender();
        this.callStack.tree.rerender();
        this.breakpoints.tree.rerender();
    }
}
