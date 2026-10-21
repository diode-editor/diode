import type { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { StyleColor } from "@tuidom/core/dom/styles/tuiStyle";
import { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { wrapText } from "@tuidom/elements/completionlist/completionDetailsElement";
import { HFlexElement, hflexFill, hflexFit, hflexFixed } from "@tuidom/elements/layout/hFlexElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { renderCodicons } from "../../../../base/common/codicons.ts";
import type {
    IActiveNotification,
    NotificationSeverity,
} from "../../../services/notification/browser/notificationService.ts";
import { DialogComponent, type IDialogStyles } from "../dialogs/dialogComponent.ts";

const TOAST_STYLES: IDialogStyles = {
    bg: "notifications.background",
    fg: "notifications.foreground",
    borderFg: "notifications.border",
    descriptionFg: "descriptionForeground",
    warningFg: "notificationsWarningIcon.foreground",
    linkFg: "textLink.foreground",
};

/** Like `$(info)`/`$(warning)` upstream. */
const SEVERITY_HEADERS: Readonly<Record<NotificationSeverity, { readonly title: string; readonly fg: StyleColor }>> = {
    info: { title: "$(info) Information", fg: "notificationsInfoIcon.foreground" },
    warn: { title: "$(warning) Warning", fg: "notificationsWarningIcon.foreground" },
    error: { title: "$(error) Error", fg: "notificationsErrorIcon.foreground" },
};

/** Shared by all toasts: several can be shown at once, and selectors must match "any toast". */
export const TOAST_ELEMENT_ID = "notificationToast";

/** Extension messages are long, but the screen corner is narrow. */
export const TOAST_TEXT_WIDTH = 46;

/** The rest is in the extension log. */
export const TOAST_MAX_LINES = 6;

/** Like the "×" on an upstream toast (`notification.clear`). */
export const TOAST_CLOSE_LABEL = "×";

export const TOAST_HINT_FOCUSED = "←/→ · Enter — choose · Esc — close";

/**
 * A toast never takes focus, so first tell HOW to reach the buttons — otherwise
 * keyboard-only users cannot answer. The key combo comes from the current binding
 * (the user may rebind it); without a binding, name the command.
 */
export function toastUnfocusedHint(answerKeyLabel: string | undefined): string {
    if (answerKeyLabel === undefined) return '"Notifications: Focus Message" — reply';
    return `${answerKeyLabel} — reply`;
}

/**
 * A toast NEVER takes focus (as upstream): the message arrives unasked and must not
 * steal typing. Tab is handled here, not in the base class: the toast session is
 * passthrough, and without the interception focus would leave for the tree below —
 * for modal dialogs the session traps focus.
 */
export class NotificationToast extends DialogComponent {
    /** Index into `notification.items`. */
    public onSelect?: (index: number) => void;
    /** Closed without a choice (Escape). */
    public onClose?: () => void;

    public readonly notification: IActiveNotification;
    private readonly buttons: readonly ButtonElement[];
    private hint: TextLabelElement | null = null;
    private readonly unfocusedHint: string;

    public constructor(notification: IActiveNotification, answerKeyLabel?: string) {
        super(TOAST_ELEMENT_ID);
        this.notification = notification;
        this.unfocusedHint = toastUnfocusedHint(answerKeyLabel);

        const header = SEVERITY_HEADERS[notification.severity];
        const stack = this.buildFrame(renderCodicons(header.title), header.fg);

        for (const line of toastLines(notification.message)) {
            stack.addChild(new TextLabelElement(line), { width: "stretch", height: 1 });
        }

        const answerButtons: ButtonElement[] = notification.items.map((title, index) => {
            const button = new ButtonElement(title);
            button.onActivate = () => this.onSelect?.(index);
            return button;
        });
        // EVERY toast has it, as upstream: a message must be dismissable right away,
        // without waiting for the timeout or opening the palette.
        const closeButton = new ButtonElement(TOAST_CLOSE_LABEL);
        closeButton.onActivate = () => this.onClose?.();
        const buttons = [...answerButtons, closeButton];
        this.buttons = buttons;

        // Stryker disable next-line StringLiteral: row width spec — an empty string gives the same layout, the frame does not change
        stack.addChild(new TextLabelElement(""), { width: "stretch", height: 1 });
        stack.addChild(buildButtonRow(buttons), { width: "stretch", height: 1 });
        if (answerButtons.length > 0) {
            const hint = new TextLabelElement(this.unfocusedHint);
            hint.style = { fg: TOAST_STYLES.descriptionFg };
            this.hint = hint;
            stack.addChild(hint, { width: "stretch", height: 1 });
            // When moving between buttons blur arrives before focus, so check the whole row.
            for (const button of buttons) {
                button.addEventListener("focus", () => {
                    this.syncHint(hint);
                });
                button.addEventListener("blur", () => {
                    this.syncHint(hint);
                });
            }
        }
    }

    /** Every toast has a close button; it does not make the toast a question. */
    public get isInteractive(): boolean {
        return this.notification.items.length > 0;
    }

    /** The row is never empty: even a passive toast has the close button. */
    public focusDefault(): void {
        this.buttons[0].focus();
    }

    public hintText(): string | null {
        return this.hint?.getText() ?? null;
    }

    private syncHint(hint: TextLabelElement): void {
        const focused = this.buttons.some((button) => button.isFocused);
        hint.setText(focused ? TOAST_HINT_FOCUSED : this.unfocusedHint);
    }

    protected override styles(): IDialogStyles {
        return TOAST_STYLES;
    }

    protected override rowButtons(): readonly ButtonElement[] {
        return this.buttons;
    }

    protected override onDismiss(): void {
        this.onClose?.();
    }

    protected override handleExtraKeydown(event: TUIKeyboardEvent): void {
        if (event.key !== "Tab") return;
        // Stryker disable next-line CallExpression: unobservable — layer Tab traversal does not fire in this session (checked by a test with a neighboring focusable), and the global Tab binding never reaches the editor since focus is not there. The call states that "the row handles Tab itself"
        event.preventDefault();
        const focused = this.buttons.findIndex((button) => button.isFocused);
        const step = event.shiftKey ? -1 : 1;
        // Wrap around: the session is passthrough, and without it Tab would move focus out of the toast.
        const next = (focused + step + this.buttons.length) % this.buttons.length;
        this.buttons[next].focus();
    }
}

/** Extra lines are elided: a toast must not grow to fill the screen. */
export function toastLines(message: string): string[] {
    const lines = wrapText(message, TOAST_TEXT_WIDTH);
    if (lines.length <= TOAST_MAX_LINES) return lines;
    return [...lines.slice(0, TOAST_MAX_LINES - 1), "…"];
}

function buildButtonRow(buttons: readonly ButtonElement[]): HFlexElement {
    const row = new HFlexElement();
    row.addChild(new TextLabelElement(""), { width: hflexFill(), height: 1 });
    for (const [index, button] of buttons.entries()) {
        // Stryker disable next-line ConditionalExpression,EqualityOperator: an extra gap BEFORE the first button is invisible — a stretching spacer right-aligns the row and just gets one column shorter
        if (index > 0) row.addChild(new TextLabelElement(""), { width: hflexFixed(1), height: 1 });
        row.addChild(button, { width: hflexFit(), height: 1 });
    }
    return row;
}
