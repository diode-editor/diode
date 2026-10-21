import { Point } from "@tuidom/core/common/geometryPromitives";
import type { OverlaySessionHandle } from "@tuidom/core/dom/overlayLayer";
import type { BodyElement } from "@tuidom/elements/body/bodyElement";

import { getFileIcon } from "../../../../base/common/fileIcons.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { MruCycleState } from "../../../services/editor/browser/editorGroupModel.ts";
import type { IEditorGroupsService } from "../../../services/editor/common/editorGroupsService.ts";
import { EditorGroupsServiceDIToken } from "../../../services/editor/common/editorGroupsService.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { Component } from "../../component.ts";

import { computeTabLabels } from "./tabLabels.ts";
import { TabSwitcherElement, type TabSwitcherItem } from "./tabSwitcherElement.ts";

// Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by reference to it; the string is only a debug label
export const TabSwitcherComponentDIToken = token<TabSwitcherComponent>("TabSwitcherComponent");

/**
 * Purely reactive: the overlay lifetime is driven by model events
 * ({@link IEditorGroupsService.onDidChangeMruCycle}); commands don't know about it.
 * The session is passthrough and takes no focus: input goes to the editor and Ctrl+Tab bindings keep working.
 */
export class TabSwitcherComponent extends Component implements IContextKeyContributor {
    public static dependencies = [EditorServiceDIToken, EditorGroupsServiceDIToken] as const;

    public readonly view: TabSwitcherElement;

    private host: BodyElement | null = null;
    private session: OverlaySessionHandle | null = null;

    public constructor(
        private readonly editorService: IEditorService,
        private readonly groups: IEditorGroupsService,
    ) {
        super();
        this.view = new TabSwitcherElement();
        this.view.id = "tabSwitcher";
        this.register(
            this.groups.onDidChangeMruCycle((state) => {
                if (state !== null) this.show(state);
                else this.hide();
            }),
        );
        // Active group changes that don't end the cycle through the model (a split): the overlay
        // for the previous group must not outlive leaving it.
        this.register(
            this.groups.onDidActiveGroupChange(() => {
                this.hide();
            }),
        );
        this.register({
            dispose: () => {
                this.session?.dispose();
                this.session = null;
            },
        });
    }

    /** Must be called before the first show. */
    public attachHost(host: BodyElement): void {
        this.host = host;
        this.session = host.overlayLayer.createSession(this.view, new Point(0, 0), {
            visible: false,
            // Stryker disable next-line BooleanLiteral: the view is not focusable, so focus moves neither on open nor on close; the flag states intent and has no observable effect in tests
            restoreFocus: false,
            // Stryker disable next-line BooleanLiteral: same reason, focusOnOpen has nothing to give focus to
            focusOnOpen: false,
            // Escape hides the list by ending the cycle in the model: closing the overlay via the layer
            // session would leave the Ctrl+Tab cycle alive with the list gone.
            // Stryker disable next-line BooleanLiteral: both values give the same observable result, since the model has already closed the list by the time the layer would handle Escape
            closeOnEscape: false,
            // Stryker disable next-line StringLiteral: the keyboard is handled by the explicit capturesKeyboard below, and for the mouse "" behaves like passthrough (neither modal nor close-on-outside), so there is no observable difference
            pointerPolicy: "passthrough",
            capturesKeyboard: false,
        });
    }

    public isOpen(): boolean {
        return this.session?.isOpen() ?? false;
    }

    /**
     * Checks overlay VISIBILITY, not the cycle state: the list can disappear without the cycle
     * ending, and the arrow keys must return to the editor exactly when it does.
     */
    public updateContextKeys(contextKeys: ContextKeyService): void {
        contextKeys.set("tabSwitcherVisible", this.isOpen());
    }

    private show(state: MruCycleState): void {
        const labels = computeTabLabels(state.panes, (pane) => this.editorService.displayName(pane));
        const items: TabSwitcherItem[] = state.panes.map((pane, index) => {
            const fi = getFileIcon(this.editorService.displayName(pane));
            return {
                icon: fi.icon,
                iconColor: fi.color,
                label: labels[index],
                isModified: pane.isModified,
            };
        });
        this.updatePosition();
        this.view.setItems(items, state.pointer);
        this.session?.open();
    }

    private hide(): void {
        if (this.session?.isOpen()) this.session.close();
    }

    /** ~10% from the top of the screen, like the quick pick. */
    private updatePosition(): void {
        if (this.host === null) return;

        const screenW = this.host.layoutSize.width;
        const screenH = this.host.layoutSize.height;

        const width = Math.min(48, Math.max(24, screenW - 4));
        const px = Math.max(0, Math.floor((screenW - width) / 2));
        const py = Math.max(1, Math.floor(screenH * 0.1));

        this.view.preferredWidth = width;
        // Stryker disable next-line OptionalChaining: host and session are set together in attachHost, and the only path here goes through the host !== null guard, so the undefined branch is unreachable
        this.session?.setPosition(new Point(px, py));
    }
}
