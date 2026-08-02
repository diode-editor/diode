import { ButtonElement } from "../../../../../../tuidom/ui/button/buttonElement.ts";
import { HFlexElement, hflexFill, hflexFit, hflexFixed } from "../../../../../../tuidom/ui/layout/hFlexElement.ts";
import { TextLabelElement } from "../../../../../../tuidom/ui/text/textLabelElement.ts";

import { DIALOG_STYLES, DialogComponent } from "./dialogComponent.ts";

const MAX_INNER_WIDTH = 70;
const MIN_INNER_WIDTH = 40;

export interface ConfirmDialogOptions {
    readonly title: string;
    /** Текст вопроса — одна или несколько строк. */
    readonly message: string | readonly string[];
    readonly confirmLabel: string;
    readonly cancelLabel?: string;
    /** Подсветить сообщение как предупреждение (жёлтым) — для необратимых действий. */
    readonly warning?: boolean;
    /** Какая кнопка в фокусе по умолчанию. По умолчанию — Cancel (безопаснее). */
    readonly defaultButton?: "confirm" | "cancel";
}

/**
 * Универсальный модальный диалог подтверждения (заголовок + текст +
 * Confirm/Cancel). Ответ — через callback-поля `onConfirm`/`onCancel`;
 * Esc = отмена. Под разные вопросы создаётся новый экземпляр (метки кнопок
 * неизменяемы). Открывается через `DialogService`.
 */
export class ConfirmDialog extends DialogComponent {
    public onConfirm?: () => void;
    public onCancel?: () => void;

    private readonly options: ConfirmDialogOptions;
    private readonly confirmButton: ButtonElement;
    private readonly cancelButton: ButtonElement;

    public constructor(options: ConfirmDialogOptions) {
        super("confirmDialog");
        this.options = options;
        this.confirmButton = new ButtonElement(options.confirmLabel);
        this.cancelButton = new ButtonElement(options.cancelLabel ?? "Cancel");
        this.confirmButton.onActivate = () => this.onConfirm?.();
        this.cancelButton.onActivate = () => this.onCancel?.();

        const lines = typeof options.message === "string" ? [options.message] : options.message;
        const maxLine = Math.max(...lines.map((l) => l.length + 3));
        const confirmWidth = options.confirmLabel.length + 4;
        const cancelWidth = (options.cancelLabel ?? "Cancel").length + 4;
        const buttonsWidth = confirmWidth + 2 + cancelWidth;
        // Ширину окна задаёт самый широкий ряд: ряд кнопок расширяется
        // левым спейсером до innerWidth, центрируя кнопки.
        const innerWidth = Math.min(MAX_INNER_WIDTH, Math.max(MIN_INNER_WIDTH, maxLine, buttonsWidth));
        const buttonsLeftPad = Math.max(0, Math.floor((innerWidth - buttonsWidth) / 2));

        const stack = this.buildFrame(options.title);
        for (const line of lines) {
            const label = new TextLabelElement("  " + line);
            if (options.warning) {
                label.style = { fg: DIALOG_STYLES.warningFg };
            }
            stack.addChild(label, { width: "stretch", height: 1 });
        }
        stack.addChild(new TextLabelElement(""), { width: "stretch", height: 1 });

        const row = new HFlexElement();
        row.addChild(new TextLabelElement(""), { width: hflexFixed(buttonsLeftPad), height: 1 });
        row.addChild(this.confirmButton, { width: hflexFit(), height: 1 });
        row.addChild(new TextLabelElement(""), { width: hflexFixed(2), height: 1 });
        row.addChild(this.cancelButton, { width: hflexFit(), height: 1 });
        row.addChild(new TextLabelElement(""), { width: hflexFill(), height: 1 });
        stack.addChild(row, { width: "stretch", height: 1 });
    }

    public focusDefault(): void {
        if (this.options.defaultButton === "confirm") {
            this.confirmButton.focus();
        } else {
            this.cancelButton.focus();
        }
    }

    protected override rowButtons(): readonly ButtonElement[] {
        return [this.confirmButton, this.cancelButton];
    }

    protected override onDismiss(): void {
        this.onCancel?.();
    }
}
