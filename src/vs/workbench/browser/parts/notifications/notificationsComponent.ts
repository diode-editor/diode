import { Point } from "@tuidom/core/common/geometryPromitives";
import type { OverlaySessionHandle } from "@tuidom/core/dom/overlayLayer";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { BodyElement } from "@tuidom/elements/body/bodyElement";
import { SizedBoxElement } from "@tuidom/elements/layout/sizedBoxElement";
import { VFlexElement, vflexFit } from "@tuidom/elements/layout/vFlexElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import {
    formatKeybinding,
    keybindingLabelStyle,
    KeybindingRegistryDIToken,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import {
    type IProductIconService,
    NERD_FONT_ICONS,
    ProductIconServiceDIToken,
} from "../../../../platform/theme/common/productIconService.ts";
import type { IActiveNotification } from "../../../services/notification/browser/notificationService.ts";
import {
    type NotificationService,
    NotificationServiceDIToken,
} from "../../../services/notification/browser/notificationService.ts";
import { Component } from "../../component.ts";

import { MessageDialog } from "./messageDialog.ts";
import { NotificationToast, TOAST_TEXT_WIDTH } from "./notificationToast.ts";

// Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by reference to it — the string inside is just a debug label
export const NotificationsComponentDIToken = token<NotificationsComponent>("NotificationsComponent");

/**
 * Declared here, not in the action file: the toast renders the hint with its binding,
 * and a parts → actions import would create a cycle since the action depends on the component.
 */
export const FOCUS_MESSAGE_COMMAND_ID = "notifications.focusMessage";

/** Frame (2) plus content padding (2×2). */
export const TOAST_WIDTH = TOAST_TEXT_WIDTH + 6;

const RIGHT_MARGIN = 1;

/** The BodyElement slot takes EXACTLY one row (engine contract). */
const STATUS_BAR_ROWS = 1;

interface IAttachedHost {
    readonly host: BodyElement;
    readonly session: OverlaySessionHandle;
}

interface IOpenAsk {
    readonly id: number;
    readonly widget: NotificationToast | MessageDialog;
    /**
     * For a toast, a fixed-width wrapper: otherwise it would be narrower than passive ones
     * (which live in the same wrapper), and the right edges of the stack would not line up.
     */
    readonly element: TUIElement;
    readonly session: OverlaySessionHandle;
}

/**
 * {@link NotificationService} owns the lifetime of shown notifications; the component only
 * mirrors its state onto the overlay layer. There are two sessions because behavior differs:
 * the passive stack (no buttons) does not swallow global bindings — the user types right
 * through the toast; a question (with buttons) does not steal focus either (as upstream),
 * a click or F6 reaches the buttons. A modal message holds both focus and the screen.
 */
export class NotificationsComponent extends Component {
    public static dependencies = [
        NotificationServiceDIToken,
        KeybindingRegistryDIToken,
        ContextKeyServiceDIToken,
        ProductIconServiceDIToken,
    ] as const;

    public readonly view: SizedBoxElement;

    /** Host and session in ONE field: they appear together, and separate nullable fields would guard against impossible states. */
    private attached: IAttachedHost | null = null;
    private readonly stack = new VFlexElement();
    private passiveToasts: NotificationToast[] = [];

    /** One field for the same reason as {@link attached}. */
    private ask: IOpenAsk | null = null;

    public constructor(
        private readonly notifications: NotificationService,
        private readonly keybindings: KeybindingRegistry,
        private readonly contextKeys: ContextKeyService,
        private readonly icons: IProductIconService = NERD_FONT_ICONS,
    ) {
        super();
        this.view = new SizedBoxElement(TOAST_WIDTH);
        this.view.id = "notificationToasts";
        this.view.setChild(this.stack);
        this.register(
            this.notifications.onDidChange(() => {
                this.sync();
            }),
        );
        this.register({
            dispose: () => {
                this.closeAsk();
                // Stryker disable next-line CallExpression: the next line removes the widgets from the screen — their dispose is unobservable
                this.disposePassive();
                this.stack.replaceChildren([]);
                this.attached?.session.dispose();
                this.attached = null;
            },
        });
    }

    /** Before the first show. */
    public attachHost(host: BodyElement): void {
        const session = host.overlayLayer.createSession(this.view, new Point(0, 0), {
            // Stryker disable next-line BooleanLiteral: an explicit `open()` on the very next sync pass opens the session, and an empty stack closes it right away — initial visibility is unobservable
            visible: false,
            // Stryker disable next-line BooleanLiteral: the stack is not focusable — focus moves neither on open nor on close; the flag states intent and has no observable effect in tests
            restoreFocus: false,
            // Stryker disable next-line BooleanLiteral: same reason — focusOnOpen has nobody to give focus to
            focusOnOpen: false,
            // Escape belongs to whoever has focus; the stack is cleared by the timer or "Clear All".
            // Stryker disable next-line BooleanLiteral: the branches are indistinguishable — the stack has no focus, so Escape never reaches the layer's closeOnEscape
            closeOnEscape: false,
            // Stryker disable next-line StringLiteral: for the mouse "" behaves like passthrough (neither modal nor close-on-outside) — no observable difference, and the explicit capturesKeyboard below handles the keyboard
            pointerPolicy: "passthrough",
            capturesKeyboard: false,
        });
        this.attached = { host, session };
        this.sync();
    }

    /** For the palette command: focus went to the editor while the message is still unanswered. */
    public focusAsk(): boolean {
        const ask = this.ask;
        if (ask === null) return false;
        ask.widget.focusDefault();
        return true;
    }

    /** A live `ask` always has an open session: showing it opens one in the same sync pass. */
    public getOpenAsk(): NotificationToast | MessageDialog | null {
        return this.ask?.widget ?? null;
    }

    private sync(): void {
        const attached = this.attached;
        if (attached === null) return;
        this.syncAsk(attached);
        this.syncPassive(attached.session);
        this.updatePositions(attached);
    }

    private syncPassive(session: OverlaySessionHandle): void {
        const all = this.notifications.passive();
        // Stryker disable next-line CallExpression: the next line removes the widgets from the tree — their dispose is unobservable
        this.disposePassive();
        // Remove children TOGETHER with disposing them: disposed widgets left in the tree would eventually get rendered.
        this.stack.replaceChildren([]);
        if (all.length === 0) {
            // Stryker disable next-line ConditionalExpression,CallExpression: an empty stack has no children, so an open and a closed session render the same thing — nothing
            if (session.isOpen()) session.close();
            return;
        }
        // Not "hidden for good": the queue reaches the screen once the front toast goes away.
        const queued = this.notifications.queuedPassiveCount();
        if (queued > 0) {
            this.stack.addChild(makeQueueLabel(queued), { height: vflexFit(), width: "fill" });
        }
        this.passiveToasts = all.map((notification) => this.makeToast(notification));
        for (const toast of this.passiveToasts) {
            this.stack.addChild(toast.view, { height: vflexFit(), width: "fill" });
        }
        session.open();
    }

    private syncAsk(attached: IAttachedHost): void {
        const current = this.notifications.current();
        if (current !== null && current.id === this.ask?.id) return;
        this.closeAsk();
        if (current === null) return;
        const widget = current.modal ? new MessageDialog(current, this.icons) : this.makeToast(current);
        const element = current.modal ? widget.view : fixedWidth(widget.view);
        widget.onSelect = (index) => {
            this.notifications.answer(current.id, index);
        };
        widget.onClose = () => {
            this.notifications.dismiss(current.id);
        };
        const session = attached.host.overlayLayer.createSession(element, new Point(0, 0), {
            // Stryker disable next-line BooleanLiteral: same reason as for the passive session — an explicit `open()` in updatePositions opens it
            visible: false,
            // Only matters if focus ever went into the toast (via F6 or a click).
            restoreFocus: true,
            // A question toast does NOT take focus (as upstream): the message arrives unasked.
            focusOnOpen: current.modal,
            // The widget handles Escape (it knows about `isCloseAffordance`): the session
            // would close the overlay without answering whoever raised the message.
            // Stryker disable next-line BooleanLiteral: unobservable — Escape reaches the widget before the layer, and its handler removes the notification in both cases
            closeOnEscape: false,
            // Stryker disable next-line StringLiteral: nothing can replace the toast branch — for the mouse "" behaves like passthrough; the "modal" branch carries the difference and the click-outside-the-modal test covers it
            pointerPolicy: current.modal ? "modal" : "passthrough",
            capturesKeyboard: current.modal,
        });
        this.ask = { id: current.id, widget, element, session };
    }

    /** Positions both overlays: the question toast at the bottom, the passive stack above it. */
    private updatePositions(attached: IAttachedHost): void {
        const screenW = attached.host.layoutSize.width;
        const screenH = attached.host.layoutSize.height;
        const bottom = screenH - STATUS_BAR_ROWS;
        const right = Math.max(0, screenW - RIGHT_MARGIN - TOAST_WIDTH);

        let askRows = 0;
        const ask = this.ask;
        if (ask !== null) {
            if (ask.widget instanceof MessageDialog) {
                this.openCentered(ask, attached.host);
            } else {
                askRows = ask.element.getMaxIntrinsicHeight(TOAST_WIDTH);
                ask.session.setPosition(new Point(right, clampRow(bottom - askRows, screenH)));
                ask.session.open();
            }
        }

        const passive = attached.session;
        // Stryker disable next-line ConditionalExpression: a closed session's position is unobservable — nobody renders it anyway
        if (passive.isOpen()) {
            const passiveRows = this.view.getMaxIntrinsicHeight(TOAST_WIDTH);
            passive.setPosition(new Point(right, clampRow(bottom - askRows - passiveRows, screenH)));
        }
    }

    private openCentered(ask: IOpenAsk, host: BodyElement): void {
        const width = ask.element.getMaxIntrinsicWidth(0);
        const height = ask.element.getMaxIntrinsicHeight(width);
        const px = Math.max(0, Math.floor((host.layoutSize.width - width) / 2));
        const py = Math.max(0, Math.floor((host.layoutSize.height - height) / 2));
        ask.session.setPosition(new Point(px, py));
        if (ask.session.isOpen()) return;
        ask.session.open();
        // `focusOnOpen` focuses the dialog's container, which takes no Enter: the first button gets it, like
        // upstream's dialog. Only on the first open: positions are recomputed when a passive toast expires.
        ask.widget.focusDefault();
    }

    private closeAsk(): void {
        const ask = this.ask;
        if (ask === null) return;
        this.ask = null;
        ask.session.close();
        // Stryker disable next-line CallExpression: hygiene — a closed session is not rendered anyway; dispose only frees its entry in the layer
        ask.session.dispose();
        // Stryker disable next-line CallExpression: same for the widget: it already left the screen with the session
        ask.widget.dispose();
    }

    /** Hygiene: by now the widgets have already been removed from the stack tree. */
    // Stryker disable next-line BlockStatement: see above — disposing already removed widgets is unobservable
    private disposePassive(): void {
        // Stryker disable next-line CallExpression: same reason
        for (const toast of this.passiveToasts) toast.dispose();
        this.passiveToasts = [];
    }

    /** The hint shows the CURRENT "answer" binding: the user may rebind it. */
    private makeToast(notification: IActiveNotification): NotificationToast {
        const chord = this.keybindings.getKeybindingForCommand(FOCUS_MESSAGE_COMMAND_ID, this.contextKeys);
        const label = chord === undefined ? undefined : formatKeybinding(chord, keybindingLabelStyle(this.contextKeys));
        const toast = new NotificationToast(notification, label, this.icons);
        // A passive toast has no other way to go away before the timeout.
        toast.onClose = () => {
            this.notifications.dismiss(notification.id);
        };
        return toast;
    }
}

function fixedWidth(element: TUIElement): SizedBoxElement {
    const holder = new SizedBoxElement(TOAST_WIDTH);
    holder.setChild(element);
    return holder;
}

function makeQueueLabel(queued: number): TextLabelElement {
    const label = new TextLabelElement(`+${String(queued)} more`);
    label.style = { fg: "descriptionForeground" };
    return label;
}

/** Below the menu row (row 0): otherwise a tall toast on a short screen would go off-frame or cover the menu. */
export function clampRow(row: number, screenH: number): number {
    return Math.min(Math.max(1, row), Math.max(1, screenH - 1));
}
