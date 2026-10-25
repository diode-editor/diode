import { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { wrapText } from "@tuidom/elements/completionlist/completionDetailsElement";
import { HFlexElement, hflexFill, hflexFit, hflexFixed } from "@tuidom/elements/layout/hFlexElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { type IProductIconService, NERD_FONT_ICONS } from "../../../../platform/theme/common/productIconService.ts";
import type {
    IActiveNotification,
    NotificationSeverity,
} from "../../../services/notification/browser/notificationService.ts";
import { DIALOG_STYLES, DialogComponent } from "../dialogs/dialogComponent.ts";

export const MESSAGE_DIALOG_ELEMENT_ID = "messageDialog";

/** A centered window has more room than a toast. */
export const MESSAGE_DIALOG_TEXT_WIDTH = 60;

/** A modal message without buttons must be closed by the user. */
export const MESSAGE_DIALOG_CLOSE_LABEL = "OK";

const SEVERITY_TITLES: Readonly<Record<NotificationSeverity, string>> = {
    info: "$(info) Information",
    warn: "$(warning) Warning",
    error: "$(error) Error",
};

/**
 * Escape picks the `isCloseAffordance` button (per vscode.d.ts), or closes without a choice
 * when there is none; "OK" of a message without buttons also means "no choice".
 */
export class MessageDialog extends DialogComponent {
    /** Index into `notification.items`. */
    public onSelect?: (index: number) => void;
    public onClose?: () => void;

    public readonly notification: IActiveNotification;
    private readonly buttons: readonly ButtonElement[];

    public constructor(notification: IActiveNotification, icons: IProductIconService = NERD_FONT_ICONS) {
        super(MESSAGE_DIALOG_ELEMENT_ID);
        this.notification = notification;

        const stack = this.buildFrame(icons.renderCodicons(SEVERITY_TITLES[notification.severity]));
        const messageLines = wrapText(notification.message, MESSAGE_DIALOG_TEXT_WIDTH);
        const detailLines =
            notification.detail === undefined ? [] : wrapText(notification.detail, MESSAGE_DIALOG_TEXT_WIDTH);
        for (const line of messageLines) {
            stack.addChild(new TextLabelElement(line), { width: "stretch", height: 1 });
        }
        if (detailLines.length > 0) {
            // Stryker disable next-line StringLiteral: row width spec — an empty string gives the same layout, the frame does not change
            stack.addChild(new TextLabelElement(""), { width: "stretch", height: 1 });
            for (const line of detailLines) {
                const label = new TextLabelElement(line);
                label.style = { fg: DIALOG_STYLES.descriptionFg };
                stack.addChild(label, { width: "stretch", height: 1 });
            }
        }

        const buttons: ButtonElement[] =
            notification.items.length > 0
                ? notification.items.map((title, index) => {
                      const button = new ButtonElement(title);
                      button.onActivate = () => this.onSelect?.(index);
                      return button;
                  })
                : [makeCloseButton(() => this.onClose?.())];
        this.buttons = buttons;

        // Use the ACTUAL window width, not the maximum: for a short message an offset
        // computed from the maximum would push the buttons to the right edge.
        const innerWidth = Math.max(0, ...messageLines.map((line) => line.length), ...detailLines.map((l) => l.length));
        // Stryker disable next-line StringLiteral: same row width spec
        stack.addChild(new TextLabelElement(""), { width: "stretch", height: 1 });
        stack.addChild(buildCenteredRow(buttons, innerWidth), { width: "stretch", height: 1 });
    }

    /** There is always a button: the constructor gives a message without buttons an "OK". */
    public focusDefault(): void {
        this.buttons[0].focus();
    }

    protected override rowButtons(): readonly ButtonElement[] {
        return this.buttons;
    }

    protected override onDismiss(): void {
        const closeAffordance = this.notification.closeAffordance;
        if (closeAffordance !== undefined) {
            this.onSelect?.(closeAffordance);
            return;
        }
        this.onClose?.();
    }
}

function makeCloseButton(onActivate: () => void): ButtonElement {
    const button = new ButtonElement(MESSAGE_DIALOG_CLOSE_LABEL);
    button.onActivate = onActivate;
    return button;
}

/**
 * A FIXED left offset and a single right spacer: `HFlexElement` allows at most
 * one `fill` child (two throw when the window is built).
 */
export function buildCenteredRow(buttons: readonly ButtonElement[], innerWidth: number): HFlexElement {
    const gap = 2;
    const buttonsWidth = buttons.reduce((sum, button) => sum + button.getMaxIntrinsicWidth(1), 0);
    const totalWidth = buttonsWidth + gap * Math.max(0, buttons.length - 1);
    const leftPad = Math.max(0, Math.floor((innerWidth - totalWidth) / 2));

    const row = new HFlexElement();
    row.addChild(new TextLabelElement(""), { width: hflexFixed(leftPad), height: 1 });
    for (const [index, button] of buttons.entries()) {
        if (index > 0) row.addChild(new TextLabelElement(""), { width: hflexFixed(gap), height: 1 });
        row.addChild(button, { width: hflexFit(), height: 1 });
    }
    row.addChild(new TextLabelElement(""), { width: hflexFill(), height: 1 });
    return row;
}
