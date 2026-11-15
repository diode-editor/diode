// The Run and Debug viewlet (upstream `debug.contribution.ts`: the container with `order: 3`, after Source Control
// and before Extensions; the VARIABLES and WATCH views, CALL STACK and BREAKPOINTS come with #1145). Without a
// session VARIABLES shows upstream's welcome: the full-width Run and Debug button (as Source Control's Commit,
// decision 2026-11-14) and the launch.json hint. Deviations: the welcome lives in VARIABLES, not in a view of its
// own under `debugUx == simple`, and WATCH stays visible without a session; the button starts the debugging without
// the keybinding label, and the launch.json hint is text until launch.json comes (#1138).

import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import { VFlexElement, vflexFill, vflexFixed } from "@tuidom/elements/layout/vFlexElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { type CommandRegistry, CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import {
    type ContextKeyService,
    ContextKeyServiceDIToken,
} from "../../../../platform/contextkey/common/contextKeyService.ts";
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
import { State, VARIABLES_VIEW_ID, VIEWLET_ID, WATCH_VIEW_ID } from "../common/debug.ts";
import { Expression } from "../common/debugModel.ts";

import { DEBUG_START_COMMAND_ID } from "./debugCommands.ts";
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
    ] as const;

    public readonly view: TUIElement;
    public readonly variables: VariablesView;
    public readonly watch: WatchExpressionsView;
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
        this.view = this.variables.tree.element;

        this.runButton.setLabel("Run and Debug");
        this.runButton.onActivate = () => {
            Promise.resolve(commands.execute(DEBUG_START_COMMAND_ID)).catch(onUnexpectedError);
        };
        const welcome = new VFlexElement();
        welcome.addChild(new TextLabelElement(""), { height: vflexFixed(1), width: "fill" });
        welcome.addChild(new PaddingContainerElement(this.runButton, { left: 1, right: 1 }), {
            height: vflexFixed(1),
            width: "fill",
        });
        welcome.addChild(new TextLabelElement(""), { height: vflexFixed(1), width: "fill" });
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

        this.register(
            debugService.onDidChangeState(() => {
                views.setViewBody(VARIABLES_VIEW_ID, this.variablesBody());
            }),
        );
        this.register(
            configuration.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration("debug.showVariableTypes")) this.rerender();
            }),
        );
        this.register(
            icons.onDidChange(() => {
                this.rerender();
            }),
        );
    }

    public updateContextKeys(contextKeys: ContextKeyService, active: TUIElement | null): void {
        contextKeys.set("variablesFocused", contains(this.variables.tree.list, active));
        const watchFocused = contains(this.watch.tree.list, active);
        contextKeys.set("watchExpressionsFocused", watchFocused);
        const item = watchFocused ? this.watch.tree.focused : undefined;
        contextKeys.set(
            "watchItemType",
            item === undefined ? "" : item instanceof Expression ? "expression" : "variable",
        );
    }

    private variablesBody(): TUIElement {
        return this.debugService.state === State.Inactive ? this.welcome : this.variables.tree.element;
    }

    /** The look changed, not the data: no adapter request. */
    private rerender(): void {
        this.variables.tree.rerender();
        this.watch.tree.rerender();
    }
}
