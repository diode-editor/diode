import type { TUIKeyboardEvent } from "../../../../../../tuidom/dom/events/tuiKeyboardEvent.ts";
import type { JsxNode } from "../../../../../../tuidom/dom/jsx/jsx-runtime.ts";
import { reconcile } from "../../../../../../tuidom/dom/jsx/reconcile.ts";
import type { TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";
import type { ButtonElement } from "../../../../../../tuidom/ui/button/buttonElement.ts";
import { FitContentElement } from "../../../../../../tuidom/ui/layout/fitContentElement.ts";
import { getDialogStyles } from "../../../../platform/theme/browser/defaultStyles.ts";
import type { ThemeService } from "../../../services/themes/common/themeService.ts";
import { ThemedComponent } from "../../component.ts";

/**
 * Packed-цвета модального диалога. Единственный источник значений —
 * `getDialogStyles(theme)` в `Workbench/Styles/defaultStyles.ts`
 * (ключи `editorWidget.*`, `descriptionForeground`, `textLink.foreground`, …).
 */
export interface IDialogStyles {
    /** Фон окна диалога (`editorWidget.background`). */
    readonly bg: number;
    /** Основной текст (`editorWidget.foreground`). */
    readonly fg: number;
    /** Рамка окна (`editorWidget.border`). */
    readonly borderFg: number;
    /** Приглушённый пояснительный текст (`descriptionForeground`). */
    readonly descriptionFg: number;
    /** Акцент предупреждения (`editorWarning.foreground`). */
    readonly warningFg: number;
    /** Ссылки (`textLink.foreground`). */
    readonly linkFg: number;
}

/**
 * База модальных диалогов Workbench. Диалог — компонент: он НЕ наследует
 * TUIElement, а владеет корневым контролом ({@link FitContentElement}) и
 * размещает в нём дерево примитивов, описанное JSX'ом в {@link describe}.
 *
 * База даёт диалогам общее поведение: reconcile-перестройку дерева
 * ({@link rebuild}), покраску из темы ({@link updateStyles} красит ряд кнопок
 * и перестраивает дерево с новыми {@link IDialogStyles}), навигацию стрелками
 * по ряду кнопок и Escape → {@link onDismiss}.
 */
export abstract class DialogComponent extends ThemedComponent {
    public readonly view: FitContentElement;

    private rootChild: TUIElement | null = null;

    /**
     * `id` вешается на корневой контрол — это DOM-идентичность диалога для
     * `querySelector("#...")` (у компонента, в отличие от элемента, нет имени
     * класса в дереве). Наследник обязан вызвать `initStyles()` последней
     * строкой конструктора — это и начальная покраска, и первый rebuild.
     */
    protected constructor(themeService: ThemeService, id: string) {
        super(themeService);
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
        this.rootChild = reconcile(this.rootChild, this.describe(getDialogStyles(this.theme)));
        this.view.setChild(this.rootChild);
    }

    protected override updateStyles(): void {
        // Кнопки красятся токенами сами (Н3); диалогу остаётся перестройка
        // дерева с цветами текущей темы.
        this.rebuild();
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
