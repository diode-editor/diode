import { Point } from "@tuidom/core/common/geometryPromitives";
import type { OverlaySessionHandle } from "@tuidom/core/dom/overlayLayer";
import type { StyleColor } from "@tuidom/core/dom/styles/tuiStyle";
import type { OverlayHostElement } from "@tuidom/elements/contextview/overlayHostElement";
import { BoxContainerElement } from "@tuidom/elements/layout/boxContainerElement";
import { HFlexElement, hflexFit, hflexFixed } from "@tuidom/elements/layout/hFlexElement";
import { SizedBoxElement } from "@tuidom/elements/layout/sizedBoxElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { codicon, type IProductIcon } from "../../../../base/common/codicons.ts";
import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { type CommandRegistry, CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type IProductIconService,
    ProductIconServiceDIToken,
} from "../../../../platform/theme/common/productIconService.ts";
import { Component } from "../../../browser/component.ts";
import {
    type EditorPartComponent,
    EditorPartComponentDIToken,
} from "../../../browser/parts/editor/editorPartComponent.ts";
import {
    EditorGroupsServiceDIToken,
    type IEditorGroupsService,
} from "../../../services/editor/common/editorGroupsService.ts";
import { type FindComponent, FindComponentDIToken } from "../../find/browser/findComponent.ts";
import { type DebugStubModel, DebugStubModelDIToken } from "../common/debugStubModel.ts";

export const DebugToolbarComponentDIToken = token<DebugToolbarComponent>("DebugToolbarComponent");

/** The box: a border row above and below the buttons, as the find widget. */
const TOOLBAR_HEIGHT = 3;
const BUTTON_GAP = 2;

function icon(name: string, fallback: string): IProductIcon {
    const base = codicon(name);
    return { nerdFont: base.nerdFont, unicode: base.unicode === "" ? fallback : base.unicode };
}

interface IToolbarButton {
    readonly command: string;
    readonly label: string;
    readonly icon: IProductIcon;
    readonly color: StyleColor;
    readonly enabled: boolean;
}

/**
 * SPIKE: upstream's floating debug toolbar (`debugToolBar.ts`) docked where the find widget lives — the top right of
 * the active editor group, in the same `editorWidget` box. With both open they stack: the toolbar on top, find
 * under it. Buttons carry labels (a terminal has no tooltips); a narrow group drops the labels to glyphs only.
 * The keyboard stays where it was: the buttons are for the mouse, F5/F10/F11 for the keys.
 */
export class DebugToolbarComponent extends Component {
    public static dependencies = [
        DebugStubModelDIToken,
        EditorPartComponentDIToken,
        EditorGroupsServiceDIToken,
        FindComponentDIToken,
        CommandRegistryDIToken,
        ProductIconServiceDIToken,
    ] as const;

    public readonly view: SizedBoxElement;
    private readonly box = new BoxContainerElement();
    private host: OverlayHostElement | null = null;
    private session: OverlaySessionHandle | null = null;

    public constructor(
        private readonly model: DebugStubModel,
        private readonly editorPart: EditorPartComponent,
        private readonly groups: IEditorGroupsService,
        private readonly find: FindComponent,
        private readonly commands: CommandRegistry,
        private readonly icons: IProductIconService,
    ) {
        super();
        this.view = new SizedBoxElement(40, TOOLBAR_HEIGHT);
        this.view.id = "debugToolbar";
        this.box.setBg("editorWidget.background");
        this.box.setBorderFg("editorWidget.border");
        this.view.setChild(this.box);

        this.register(
            model.onDidChangeState(() => {
                this.update();
            }),
        );
        this.register(
            groups.onDidActiveGroupChange(() => {
                if (this.model.state !== "inactive") this.update();
            }),
        );
        this.register(
            icons.onDidChange(() => {
                this.update();
            }),
        );
        this.register({
            dispose: () => {
                this.session?.dispose();
                this.session = null;
            },
        });
    }

    private buttons(): IToolbarButton[] {
        const stopped = this.model.state === "stopped";
        const running = this.model.state === "running";
        return [
            running
                ? { command: "workbench.action.debug.pause", label: "Pause", icon: icon("debug-pause", "‖"), color: "debugIcon.pauseForeground", enabled: true }
                : { command: "workbench.action.debug.continue", label: "Continue", icon: icon("debug-continue", "▶"), color: "debugIcon.continueForeground", enabled: stopped },
            { command: "workbench.action.debug.stepOver", label: "Over", icon: icon("debug-step-over", "↷"), color: "debugIcon.stepOverForeground", enabled: stopped },
            { command: "workbench.action.debug.stepInto", label: "Into", icon: icon("debug-step-into", "↓"), color: "debugIcon.stepIntoForeground", enabled: stopped },
            { command: "workbench.action.debug.stepOut", label: "Out", icon: icon("debug-step-out", "↑"), color: "debugIcon.stepOutForeground", enabled: stopped },
            { command: "workbench.action.debug.restart", label: "Restart", icon: icon("debug-restart", "↻"), color: "debugIcon.restartForeground", enabled: true },
            { command: "workbench.action.debug.stop", label: "Stop", icon: icon("debug-stop", "■"), color: "debugIcon.stopForeground", enabled: true },
        ];
    }

    private update(): void {
        if (this.model.state === "inactive") {
            this.hide();
            return;
        }
        const groupId = this.groups.activeGroup.id;
        const host = this.editorPart.groupOverlayHost(groupId);
        if (host === null) return;
        if (host !== this.host) {
            this.session?.dispose();
            this.host = host;
            this.session = host.overlayLayer.createSession(this.view, new Point(0, 0), {
                visible: false,
                focusOnOpen: false,
                // Clicks around the toolbar go to the editor, as around the find widget.
                pointerPolicy: "passthrough",
                capturesKeyboard: false,
            });
        }
        const groupWidth = host.layoutSize.width;
        const buttons = this.buttons();
        const labelled = buttons.reduce((w, b) => w + 2 + b.label.length, 0) + BUTTON_GAP * (buttons.length - 1);
        const glyphsOnly = buttons.length + BUTTON_GAP * (buttons.length - 1);
        // Box border (2) and a column of padding on each side (2).
        const withLabels = labelled + 4 <= groupWidth - 2;
        const width = (withLabels ? labelled : glyphsOnly) + 4;
        this.box.setChild(this.row(buttons, withLabels));
        this.view.setPreferredWidth(width);
        this.session?.setPosition(new Point(Math.max(0, groupWidth - width - 1), 1));
        this.session?.open();
        this.find.setTopInset({ groupId, rows: TOOLBAR_HEIGHT });
    }

    private hide(): void {
        if (this.session?.isOpen() === true) this.session.close();
        this.find.setTopInset(null);
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
        const glyph = this.icons.glyph(button.icon);
        const text = withLabel ? `${glyph} ${button.label}` : glyph;
        const label = new TextLabelElement(text);
        label.style = button.enabled
            ? { when: [{ states: ["hover"], bg: "toolbar.hoverBackground" }] }
            : { fg: "disabledForeground" };
        if (button.enabled) {
            for (let i = 0; i < glyph.length; i++) label.setCharStyle(i, { fg: button.color });
            label.addEventListener("click", (event) => {
                event.preventDefault();
                void Promise.resolve(this.commands.execute(button.command)).catch(onUnexpectedError);
            });
        }
        return label;
    }
}
