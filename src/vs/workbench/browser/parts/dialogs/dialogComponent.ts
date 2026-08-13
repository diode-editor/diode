import type { TUIKeyboardEvent } from "@tuidom/all/dom/events/tuiKeyboardEvent";
import type { StyleColor } from "@tuidom/all/dom/styles/tuiStyle";
import type { ButtonElement } from "@tuidom/all/ui/button/buttonElement";
import { BoxContainerElement } from "@tuidom/all/ui/layout/boxContainerElement";
import { FitContentElement } from "@tuidom/all/ui/layout/fitContentElement";
import { PaddingContainerElement } from "@tuidom/all/ui/layout/paddingContainerElement";
import { VStackElement } from "@tuidom/all/ui/layout/vStackElement";
import { Component } from "../../component.ts";

/**
 * Packed-цвета модального диалога. Единственный источник значений —
 * Цвета — токены темы (DIALOG_STYLES), резолвит каскад (Н3).
 * (ключи `editorWidget.*`, `descriptionForeground`, `textLink.foreground`, …).
 */
export interface IDialogStyles {
    /** Фон окна диалога. */
    readonly bg: StyleColor;
    /** Основной текст. */
    readonly fg: StyleColor;
    /** Рамка окна. */
    readonly borderFg: StyleColor;
    /** Приглушённый пояснительный текст. */
    readonly descriptionFg: StyleColor;
    /** Акцент предупреждения. */
    readonly warningFg: StyleColor;
    /** Ссылки. */
    readonly linkFg: StyleColor;
}

/** Токены темы диалога — резолвит каскад, пере-пуш при смене темы не нужен. */
export const DIALOG_STYLES: IDialogStyles = {
    bg: "editorWidget.background",
    fg: "editorWidget.foreground",
    borderFg: "editorWidget.border",
    descriptionFg: "descriptionForeground",
    warningFg: "editorWarning.foreground",
    linkFg: "textLink.foreground",
};

/**
 * База модальных диалогов Workbench. Диалог — компонент: он НЕ наследует
 * TUIElement, а владеет корневым контролом ({@link FitContentElement}), в
 * который наследник кладёт дерево примитивов, собранное в конструкторе
 * (`this.view.setChild(root)`); цвета — токены {@link DIALOG_STYLES},
 * резолвит каскад.
 *
 * База даёт диалогам общее поведение: навигацию стрелками по ряду кнопок
 * и Escape → {@link onDismiss}.
 */
export abstract class DialogComponent extends Component {
    public readonly view: FitContentElement;

    /**
     * `id` вешается на корневой контрол — это DOM-идентичность диалога для
     * `querySelector("#...")` (у компонента, в отличие от элемента, нет имени
     * класса в дереве).
     */
    protected constructor(id: string) {
        super();
        this.view = new FitContentElement();
        this.view.id = id;
        this.view.addEventListener("keydown", (event) => {
            this.handleDialogKeydown(event);
        });
    }

    /**
     * Собирает каркас окна — рамка с заголовком, отступы, вертикальный стек —
     * и кладёт его в {@link view}. Наследник наполняет возвращённый стек
     * строками; цвета контента раздаёт каскад от контейнера отступов.
     */
    protected buildFrame(title: string): VStackElement {
        const { bg, fg, borderFg } = DIALOG_STYLES;
        const box = new BoxContainerElement();
        box.setBg(bg);
        box.setBorderFg(borderFg);
        box.setTitle(title);
        box.setTitleFg(fg);
        box.setHasSeparator(true);

        const stack = new VStackElement();
        const padding = new PaddingContainerElement(stack, { left: 2, right: 2 });
        padding.style = { fg, bg };
        box.setChild(padding);
        this.view.setChild(box);
        return stack;
    }

    /** Ряд кнопок слева направо — для навигации стрелками и покраски из темы. */
    protected abstract rowButtons(): readonly ButtonElement[];

    /** Реакция на Escape (обычно — отмена/закрытие). */
    protected abstract onDismiss(): void;

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
        }
    }
}
