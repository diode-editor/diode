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

/** Палитра тоста: та же форма, что у диалога, но токены нотификаций. */
const TOAST_STYLES: IDialogStyles = {
    bg: "notifications.background",
    fg: "notifications.foreground",
    borderFg: "notifications.border",
    descriptionFg: "descriptionForeground",
    warningFg: "notificationsWarningIcon.foreground",
    linkFg: "textLink.foreground",
};

/** Заголовок рамки и цвет акцента по строгости (как `$(info)`/`$(warning)` в эталоне). */
const SEVERITY_HEADERS: Readonly<Record<NotificationSeverity, { readonly title: string; readonly fg: StyleColor }>> = {
    info: { title: "$(info) Information", fg: "notificationsInfoIcon.foreground" },
    warn: { title: "$(warning) Warning", fg: "notificationsWarningIcon.foreground" },
    error: { title: "$(error) Error", fg: "notificationsErrorIcon.foreground" },
};

/** Ширина текста внутри рамки: сообщения расширений длинные, но угол экрана узкий. */
export const TOAST_TEXT_WIDTH = 46;

/** Сколько строк сообщения показываем; остальное — в логе расширений. */
export const TOAST_MAX_LINES = 6;

/** Подсказка, когда фокус уже в ряду кнопок: чем отвечать и чем закрыть. */
export const TOAST_HINT_FOCUSED = "←/→ · Enter — выбрать · Esc — закрыть";

/**
 * Подсказка, пока фокуса в тосте нет. Тост его не забирает (как в эталоне),
 * поэтому первым делом надо сказать, ЧЕМ до кнопок добраться, — иначе вопрос от
 * расширения остаётся без ответа у всех, кто работает без мыши.
 *
 * Комбинация приходит от действующего бинда `notifications.focusMessage`, а не
 * зашита строкой: человек вправе его переназначить. Бинда нет вовсе — называем
 * команду, её всегда можно найти в палитре.
 */
export function toastUnfocusedHint(answerKeyLabel: string | undefined): string {
    if (answerKeyLabel === undefined) return "«Notifications: Focus Message» — ответить";
    return `${answerKeyLabel} — ответить`;
}

/**
 * Тост сообщения — окно в стеке над статус-баром.
 *
 * Фокус тост НЕ забирает никогда — ни пассивный, ни с кнопками (как в эталоне:
 * сообщение приходит незвано, и перехватывать набор текста ему нельзя). Мышью
 * кнопка нажимается сразу; с клавиатуры до неё ведёт команда
 * `Notifications: Focus Message` (F6), и ровно об этом говорит подсказка в
 * рамке. Когда фокус внутри, по кнопкам ходят ←/→ и Tab, Enter выбирает (это
 * делает сам {@link ButtonElement}), Escape закрывает без выбора и возвращает
 * фокус туда, где он был.
 *
 * Tab обрабатывается здесь, а не в базе: overlay-сессия тоста passthrough'ная,
 * и без перехвата Tab фокус ушёл бы из тоста в дерево под ним — у модальных
 * диалогов, которым база принадлежит в первую очередь, фокус запирает сессия.
 */
export class NotificationToast extends DialogComponent {
    /** Человек нажал кнопку с этим индексом в `notification.items`. */
    public onSelect?: (index: number) => void;
    /** Человек закрыл тост, не выбрав (Escape). */
    public onClose?: () => void;

    public readonly notification: IActiveNotification;
    private readonly buttons: readonly ButtonElement[];
    /** Строка подсказки под кнопками; null — у тоста без кнопок её нет. */
    private hint: TextLabelElement | null = null;
    private readonly unfocusedHint: string;

    public constructor(notification: IActiveNotification, answerKeyLabel?: string) {
        super(`notificationToast-${String(notification.id)}`);
        this.notification = notification;
        this.unfocusedHint = toastUnfocusedHint(answerKeyLabel);

        const header = SEVERITY_HEADERS[notification.severity];
        const stack = this.buildFrame(renderCodicons(header.title), header.fg);

        for (const line of toastLines(notification.message)) {
            stack.addChild(new TextLabelElement(line), { width: "stretch", height: 1 });
        }

        const buttons: ButtonElement[] = notification.items.map((title, index) => {
            const button = new ButtonElement(title);
            button.onActivate = () => this.onSelect?.(index);
            return button;
        });
        this.buttons = buttons;
        if (buttons.length > 0) {
            stack.addChild(new TextLabelElement(""), { width: "stretch", height: 1 });
            stack.addChild(buildButtonRow(buttons), { width: "stretch", height: 1 });
            this.hint = new TextLabelElement(this.unfocusedHint);
            this.hint.style = { fg: TOAST_STYLES.descriptionFg };
            stack.addChild(this.hint, { width: "stretch", height: 1 });
            // Подсказка следует за фокусом: до F6 она говорит, как сюда попасть,
            // внутри — как отвечать. На переходе между кнопками blur приходит
            // раньше focus'а, поэтому смотрим на весь ряд, а не на одну кнопку.
            for (const button of buttons) {
                button.addEventListener("focus", () => {
                    this.syncHint();
                });
                button.addEventListener("blur", () => {
                    this.syncHint();
                });
            }
        }
    }

    /** Есть ли у тоста кнопки — то есть забирает ли он фокус. */
    public get isInteractive(): boolean {
        return this.buttons.length > 0;
    }

    /** Ставит фокус на первую кнопку. У тоста без кнопок фокусировать нечего. */
    public focusDefault(): void {
        this.buttons.at(0)?.focus();
    }

    /** Текст подсказки под кнопками — по нему в тестах видно, где фокус. */
    public hintText(): string | null {
        return this.hint?.getText() ?? null;
    }

    /** Приводит подсказку в соответствие тому, есть ли фокус в ряду кнопок. */
    private syncHint(): void {
        const focused = this.buttons.some((button) => button.isFocused);
        this.hint?.setText(focused ? TOAST_HINT_FOCUSED : this.unfocusedHint);
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
        if (this.buttons.length === 0) return;
        event.preventDefault();
        const focused = this.buttons.findIndex((button) => button.isFocused);
        const step = event.shiftKey ? -1 : 1;
        // Цикл по кольцу: с последней кнопки Tab возвращает на первую, а не
        // уводит фокус из тоста (сессия passthrough'ная — уводить есть куда).
        const next = (focused + step + this.buttons.length) % this.buttons.length;
        this.buttons[next].focus();
    }
}

/**
 * Текст сообщения в строки рамки: перенос по словам движком, лишние строки
 * отбрасываются с многоточием — тост не должен вырастать во весь экран.
 */
export function toastLines(message: string): string[] {
    const lines = wrapText(message, TOAST_TEXT_WIDTH);
    if (lines.length <= TOAST_MAX_LINES) return lines;
    return [...lines.slice(0, TOAST_MAX_LINES - 1), "…"];
}

/** Ряд кнопок, прижатый вправо: слева растягивающийся спейсер. */
function buildButtonRow(buttons: readonly ButtonElement[]): HFlexElement {
    const row = new HFlexElement();
    row.addChild(new TextLabelElement(""), { width: hflexFill(), height: 1 });
    for (const [index, button] of buttons.entries()) {
        if (index > 0) row.addChild(new TextLabelElement(""), { width: hflexFixed(1), height: 1 });
        row.addChild(button, { width: hflexFit(), height: 1 });
    }
    return row;
}
