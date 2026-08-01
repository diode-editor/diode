import type { TUIKeyboardEvent } from "../../../../../../tuidom/dom/events/tuiKeyboardEvent.ts";
import type { JsxNode } from "../../../../../../tuidom/dom/jsx/jsx-runtime.ts";
import { reconcile } from "../../../../../../tuidom/dom/jsx/reconcile.ts";
import type { StyleColor } from "../../../../../../tuidom/dom/styles/tuiStyle.ts";
import type { TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";
import type { ButtonElement } from "../../../../../../tuidom/ui/button/buttonElement.ts";
import { FitContentElement } from "../../../../../../tuidom/ui/layout/fitContentElement.ts";
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
const DIALOG_STYLES: IDialogStyles = {
    bg: "editorWidget.background",
    fg: "editorWidget.foreground",
    borderFg: "editorWidget.border",
    descriptionFg: "descriptionForeground",
    warningFg: "editorWarning.foreground",
    linkFg: "textLink.foreground",
};

/**
 * База модальных диалогов Workbench. Диалог — компонент: он НЕ наследует
 * TUIElement, а владеет корневым контролом ({@link FitContentElement}) и
 * размещает в нём дерево примитивов, описанное JSX'ом в {@link describe}.
 *
 * База даёт диалогам общее поведение: reconcile-перестройку дерева
 * ({@link rebuild}; цвета — токены темы, резолвит каскад), навигацию стрелками
 * по ряду кнопок и Escape → {@link onDismiss}.
 */
export abstract class DialogComponent extends Component {
    public readonly view: FitContentElement;

    private rootChild: TUIElement | null = null;

    /**
     * `id` вешается на корневой контрол — это DOM-идентичность диалога для
     * `querySelector("#...")` (у компонента, в отличие от элемента, нет имени
     * класса в дереве). Наследник обязан вызвать `initStyles()` последней
     * строкой конструктора — это и начальная покраска, и первый rebuild.
     */
    protected constructor(id: string) {
        super();
        this.view = new FitContentElement();
        this.view.id = id;
        this.view.addEventListener("keydown", (event) => {
            this.handleDialogKeydown(event);
        });
    }

    /** JSX-дерево диалога; строится из контролов и уже созданных кнопок. */
    protected abstract describe(styles: IDialogStyles): JsxNode;

    /** Ряд кнопок слева направо — для навигации стрелками и покраски из темы. */
    protected abstract rowButtons(): readonly ButtonElement[];

    /** Реакция на Escape (обычно — отмена/закрытие). */
    protected abstract onDismiss(): void;

    /** Перестраивает дерево контролов под текущее состояние и тему. */
    protected rebuild(): void {
        this.rootChild = reconcile(this.rootChild, this.describe(DIALOG_STYLES));
        this.view.setChild(this.rootChild);
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
        }
    }
}
