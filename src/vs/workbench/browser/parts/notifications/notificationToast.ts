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

/** Как `$(info)`/`$(warning)` в эталоне. */
const SEVERITY_HEADERS: Readonly<Record<NotificationSeverity, { readonly title: string; readonly fg: StyleColor }>> = {
    info: { title: "$(info) Information", fg: "notificationsInfoIcon.foreground" },
    warn: { title: "$(warning) Warning", fg: "notificationsWarningIcon.foreground" },
    error: { title: "$(error) Error", fg: "notificationsErrorIcon.foreground" },
};

/** Один на все тосты: их бывает несколько сразу, и адресовать нужно «любой тост». */
export const TOAST_ELEMENT_ID = "notificationToast";

/** Сообщения расширений длинные, но угол экрана узкий. */
export const TOAST_TEXT_WIDTH = 46;

/** Остальное — в логе расширений. */
export const TOAST_MAX_LINES = 6;

/** Как «×» на тосте эталона (`notification.clear`). */
export const TOAST_CLOSE_LABEL = "×";

export const TOAST_HINT_FOCUSED = "←/→ · Enter — выбрать · Esc — закрыть";

/**
 * Тост фокус не забирает, поэтому первым делом говорим, ЧЕМ добраться до
 * кнопок, — иначе вопрос остаётся без ответа у всех, кто без мыши. Комбинация —
 * от действующего бинда (человек вправе переназначить); бинда нет — называем команду.
 */
export function toastUnfocusedHint(answerKeyLabel: string | undefined): string {
    if (answerKeyLabel === undefined) return "«Notifications: Focus Message» — ответить";
    return `${answerKeyLabel} — ответить`;
}

/**
 * Фокус тост НЕ забирает никогда (как в эталоне): сообщение приходит незвано,
 * и перехватывать набор текста ему нельзя. Tab обрабатывается здесь, а не в
 * базе: сессия тоста passthrough'ная, и без перехвата фокус ушёл бы в дерево
 * под ним — у модальных диалогов фокус запирает сессия.
 */
export class NotificationToast extends DialogComponent {
    /** Индекс в `notification.items`. */
    public onSelect?: (index: number) => void;
    /** Закрыт без выбора (Escape). */
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
        // Есть у ЛЮБОГО тоста, как в эталоне: сообщение обязано быть чем убрать
        // сейчас, не дожидаясь таймаута и не открывая палитру.
        const closeButton = new ButtonElement(TOAST_CLOSE_LABEL);
        closeButton.onActivate = () => this.onClose?.();
        const buttons = [...answerButtons, closeButton];
        this.buttons = buttons;

        // Stryker disable next-line StringLiteral: спецификация ширины ряда — пустая строка даёт ту же раскладку, кадр не меняется
        stack.addChild(new TextLabelElement(""), { width: "stretch", height: 1 });
        stack.addChild(buildButtonRow(buttons), { width: "stretch", height: 1 });
        if (answerButtons.length > 0) {
            const hint = new TextLabelElement(this.unfocusedHint);
            hint.style = { fg: TOAST_STYLES.descriptionFg };
            this.hint = hint;
            stack.addChild(hint, { width: "stretch", height: 1 });
            // На переходе между кнопками blur приходит раньше focus'а — смотрим на весь ряд.
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

    /** Кнопка закрытия есть у любого тоста и вопросом его не делает. */
    public get isInteractive(): boolean {
        return this.notification.items.length > 0;
    }

    /** Ряд не пуст никогда: даже у пассивного тоста в нём есть кнопка закрытия. */
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
        // Stryker disable next-line CallExpression: ненаблюдаемо — Tab-обход слоя в этой сессии не срабатывает (проверено тестом с соседним фокусируемым), а глобальный бинд Tab до редактора не доходит: фокус не в нём. Вызов оставлен как заявление «ряд разбирает Tab сам»
        event.preventDefault();
        const focused = this.buttons.findIndex((button) => button.isFocused);
        const step = event.shiftKey ? -1 : 1;
        // Кольцо: сессия passthrough'ная, и без него Tab увёл бы фокус из тоста.
        const next = (focused + step + this.buttons.length) % this.buttons.length;
        this.buttons[next].focus();
    }
}

/** Лишние строки — с многоточием: тост не должен вырастать во весь экран. */
export function toastLines(message: string): string[] {
    const lines = wrapText(message, TOAST_TEXT_WIDTH);
    if (lines.length <= TOAST_MAX_LINES) return lines;
    return [...lines.slice(0, TOAST_MAX_LINES - 1), "…"];
}

function buildButtonRow(buttons: readonly ButtonElement[]): HFlexElement {
    const row = new HFlexElement();
    row.addChild(new TextLabelElement(""), { width: hflexFill(), height: 1 });
    for (const [index, button] of buttons.entries()) {
        // Stryker disable next-line ConditionalExpression,EqualityOperator: лишний зазор ПЕРЕД первой кнопкой невидим — ряд прижат вправо растягивающимся спейсером, и тот просто станет на колонку короче
        if (index > 0) row.addChild(new TextLabelElement(""), { width: hflexFixed(1), height: 1 });
        row.addChild(button, { width: hflexFit(), height: 1 });
    }
    return row;
}
