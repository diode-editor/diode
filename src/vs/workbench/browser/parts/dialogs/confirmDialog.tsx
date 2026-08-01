import type { JsxNode } from "../../../../../../tuidom/dom/jsx/jsx-runtime.ts";
import { ButtonElement } from "../../../../../../tuidom/ui/button/buttonElement.ts";
import { BoxContainer } from "../../../../../../tuidom/ui/layout/boxContainerElement.ts";
import { HFlex, hflexFill, hflexFit, hflexFixed } from "../../../../../../tuidom/ui/layout/hFlexElement.ts";
import { PaddingContainer } from "../../../../../../tuidom/ui/layout/paddingContainerElement.ts";
import { VStack } from "../../../../../../tuidom/ui/layout/vStackElement.ts";
import { TextLabel } from "../../../../../../tuidom/ui/text/textLabelElement.ts";

import type { IDialogStyles } from "./dialogComponent.ts";
import { DialogComponent } from "./dialogComponent.ts";

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
        this.confirmButton.layoutStyle = { width: hflexFit(), height: 1 };
        this.cancelButton.layoutStyle = { width: hflexFit(), height: 1 };
        this.rebuild();
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

    protected override describe(styles: IDialogStyles): JsxNode {
        const { bg, fg } = styles;
        const lines = typeof this.options.message === "string" ? [this.options.message] : this.options.message;
        const maxLine = Math.max(...lines.map((l) => l.length + 3));
        const confirmWidth = this.options.confirmLabel.length + 4;
        const cancelWidth = (this.options.cancelLabel ?? "Cancel").length + 4;
        const buttonsWidth = confirmWidth + 2 + cancelWidth;
        const innerWidth = Math.min(MAX_INNER_WIDTH, Math.max(MIN_INNER_WIDTH, maxLine, buttonsWidth));
        const buttonsLeftPad = Math.max(0, Math.floor((innerWidth - buttonsWidth) / 2));
        const messageFg = this.options.warning ? styles.warningFg : fg;

        // Дети VStack собираем в один массив: reconcile уплощает массив-выражение, поэтому
        // строки из .map можно безопасно смешивать со спейсером и рядом кнопок.
        const children: JsxNode[] = [
            ...lines.map((line) => (
                <TextLabel text={"  " + line} fg={messageFg} bg={bg} layout={{ width: "stretch", height: 1 }} />
            )),
            <TextLabel text="" fg={fg} bg={bg} layout={{ width: "stretch", height: 1 }} />,
            <HFlex layout={{ width: "stretch", height: 1 }}>
                <TextLabel text="" fg={fg} bg={bg} layout={{ width: hflexFixed(buttonsLeftPad), height: 1 }} />
                {this.confirmButton}
                <TextLabel text="  " fg={fg} bg={bg} layout={{ width: hflexFixed(2), height: 1 }} />
                {this.cancelButton}
                <TextLabel text="" fg={fg} bg={bg} layout={{ width: hflexFill(), height: 1 }} />
            </HFlex>,
        ];

        return (
            <BoxContainer
                bg={bg}
                fg={fg}
                borderFg={styles.borderFg}
                title={this.options.title}
                titleFg={fg}
                hasSeparator
            >
                <PaddingContainer left={2} right={2} bg={bg}>
                    <VStack>{children}</VStack>
                </PaddingContainer>
            </BoxContainer>
        );
    }
}
