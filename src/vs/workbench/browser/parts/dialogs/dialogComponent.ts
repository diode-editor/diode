import type { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import type { StyleColor } from "@tuidom/core/dom/styles/tuiStyle";
import type { ButtonElement } from "@tuidom/elements/button/buttonElement";
import { BoxContainerElement } from "@tuidom/elements/layout/boxContainerElement";
import { FitContentElement } from "@tuidom/elements/layout/fitContentElement";
import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import { VStackElement } from "@tuidom/elements/layout/vStackElement";

import { Component } from "../../component.ts";

export interface IDialogStyles {
    readonly bg: StyleColor;
    readonly fg: StyleColor;
    readonly borderFg: StyleColor;
    readonly descriptionFg: StyleColor;
    readonly warningFg: StyleColor;
    readonly linkFg: StyleColor;
}

/** Резолвит каскад — пере-пуш при смене темы не нужен. */
export const DIALOG_STYLES: IDialogStyles = {
    bg: "editorWidget.background",
    fg: "editorWidget.foreground",
    borderFg: "editorWidget.border",
    descriptionFg: "descriptionForeground",
    warningFg: "editorWarning.foreground",
    linkFg: "textLink.foreground",
};

/** База модальных диалогов и тостов нотификаций: рамка с заголовком, стрелки по ряду кнопок, Escape → {@link onDismiss}. */
export abstract class DialogComponent extends Component {
    public readonly view: FitContentElement;

    /** У компонента, в отличие от элемента, нет имени класса в дереве — `id` даёт `querySelector("#...")`. */
    protected constructor(id: string) {
        super();
        this.view = new FitContentElement();
        this.view.id = id;
        this.view.addEventListener("keydown", (event) => {
            this.handleDialogKeydown(event);
        });
    }

    /**
     * Зовётся из {@link buildFrame}, то есть ещё из конструктора наследника —
     * читать в переопределении поля наследника нельзя, только константы.
     */
    protected styles(): IDialogStyles {
        return DIALOG_STYLES;
    }

    /** Цвета контента раздаёт каскад от контейнера отступов. */
    protected buildFrame(title: string, titleFg?: StyleColor): VStackElement {
        const { bg, fg, borderFg } = this.styles();
        const box = new BoxContainerElement();
        box.setBg(bg);
        box.setBorderFg(borderFg);
        box.setTitle(title);
        box.setTitleFg(titleFg ?? fg);
        box.setHasSeparator(true);

        const stack = new VStackElement();
        const padding = new PaddingContainerElement(stack, { left: 2, right: 2 });
        padding.style = { fg, bg };
        box.setChild(padding);
        this.view.setChild(box);
        return stack;
    }

    /** Слева направо. */
    protected abstract rowButtons(): readonly ButtonElement[];

    protected abstract onDismiss(): void;

    /** Зовётся, когда нажатие не подошло ни под одну ветку разбора базы. */
    protected handleExtraKeydown(_event: TUIKeyboardEvent): void {
        // База лишних клавиш не разбирает — переопределяют наследники.
    }

    private handleDialogKeydown(event: TUIKeyboardEvent): void {
        const buttons = this.rowButtons();
        const focusedIndex = buttons.findIndex((b) => b.isFocused);
        switch (event.key) {
            case "ArrowLeft":
                if (focusedIndex > 0) {
                    event.preventDefault();
                    buttons[focusedIndex - 1].focus();
                }
                break;
            case "ArrowRight":
                if (focusedIndex < buttons.length - 1) {
                    event.preventDefault();
                    buttons[focusedIndex + 1].focus();
                }
                break;
            case "Escape":
                event.preventDefault();
                this.onDismiss();
                break;
            default:
                this.handleExtraKeydown(event);
                break;
        }
    }
}
