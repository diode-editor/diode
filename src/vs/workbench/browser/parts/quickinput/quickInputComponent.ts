import { Point } from "@tuidom/core/common/geometryPromitives";
import type { OverlaySessionHandle } from "@tuidom/core/dom/overlayLayer";
import type { BodyElement } from "@tuidom/elements/body/bodyElement";

import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { Component } from "../../component.ts";

import { QuickPickElement } from "./quickPickElement.ts";

export const QuickInputComponentDIToken = token<QuickInputComponent>("QuickInputComponent");

/**
 * Owns the SINGLE {@link QuickPickElement} and its overlay session: the widget is shared by
 * QuickInputService and QuickOpenService, and at most one is open at a time.
 */
export class QuickInputComponent extends Component {
    public static dependencies = [] as const;

    public readonly view: QuickPickElement;

    /** Fires on ANY session close, so cancellation reaches whoever opened the picker through one path. */
    public onDidClose: (() => void) | null = null;

    private host: BodyElement | null = null;
    private session: OverlaySessionHandle | null = null;

    public constructor() {
        super();
        this.view = new QuickPickElement();
        this.view.id = "quickInput";
        this.register({
            dispose: () => {
                this.session?.dispose();
                this.session = null;
            },
        });
    }

    /** Must be called before the picker is first shown. */
    public attachHost(host: BodyElement): void {
        this.host = host;
        this.session = host.overlayLayer.createSession(this.view, new Point(0, 0), {
            visible: false,
            restoreFocus: true,
            closeOnEscape: true,
            pointerPolicy: "close-on-outside",
            onClose: () => {
                this.onDidClose?.();
            },
        });
    }

    public isOpen(): boolean {
        return this.session?.isOpen() ?? false;
    }

    /** Without an attached host, positioning and the session are no-ops. */
    public show(): void {
        this.updatePosition();
        this.session?.open();
        this.view.focus();
    }

    /** No-op if already closed. */
    public hide(): void {
        if (this.session?.isOpen()) {
            this.session.close();
        }
    }

    private updatePosition(): void {
        if (!this.host) return;

        const screenW = this.host.layoutSize.width;
        const screenH = this.host.layoutSize.height;

        const width = Math.min(80, Math.max(40, screenW - 4));
        const px = Math.max(0, Math.floor((screenW - width) / 2));
        // Below the menu bar (row 0).
        const py = Math.max(1, Math.floor(screenH * 0.1));

        this.view.preferredWidth = width;
        this.session?.setPosition(new Point(px, py));
    }
}
