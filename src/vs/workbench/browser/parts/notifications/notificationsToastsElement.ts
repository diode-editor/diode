import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import type { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { ButtonElement } from "@tuidom/elements/button/buttonElement";

import type { INotification } from "../../../services/notification/common/notification.ts";

import { NotificationToastElement } from "./notificationToastElement.ts";

/**
 * Стек тостов в углу экрана: сверху — самое старое сообщение, у самого угла —
 * самое свежее (порядок VS Code).
 *
 * Клавиатура живёт здесь, а не в отдельных тостах: ходить по кнопкам надо и
 * ВНУТРИ сообщения, и между сообщениями, поэтому кнопки всех тостов
 * рассматриваются одним плоским списком — Left/Up шагает назад, Right/Down и
 * Tab вперёд. Escape закрывает весь стек (`notifications.hideToasts` в VS Code).
 *
 * Обработанные клавиши гасятся `stopPropagation`: bubble-листенер
 * {@link import("../../../services/keybinding/browser/keybindingDispatcher.ts").KeybindingDispatcher}
 * висит на корневой view, и без этого Escape/стрелки утекли бы в глобальные
 * бинды поверх сфокусированного тоста.
 */
export class NotificationsToastsElement extends TUIElement {
    /** Желаемая ширина тостов в колонках; ставит компонент по ширине экрана. */
    public preferredWidth = 48;

    /** Нажата кнопка `index` у сообщения `id`. */
    public onActivate?: (id: number, index: number) => void;
    /** Escape по сфокусированному стеку — закрыть все сообщения. */
    public onHideAll?: () => void;

    private toasts: NotificationToastElement[] = [];

    public constructor() {
        super();
        // Фокусируемый сам: у сообщения без кнопок фокусировать нечего, а закрыть
        // его с клавиатуры пользователь всё равно должен уметь.
        this.focusable = true;
        this.addEventListener("keydown", (event) => {
            this.handleKeydown(event);
        });
    }

    /**
     * Перестраивает стек под текущий набор сообщений. Пересоздаёт тосты целиком:
     * набор меняется редко (показ/ответ/закрытие), а частичное обновление стоило
     * бы сверки идентичности кнопок ради нулевой выгоды.
     */
    public setNotifications(notifications: readonly INotification[], hint: string | null): void {
        this.toasts = notifications.map((notification) => {
            const toast = new NotificationToastElement();
            toast.preferredWidth = this.preferredWidth;
            // Подсказка про фокус — только у сообщений с кнопками: сообщению без
            // вопроса отвечать нечем, и строка ушла бы под ложное обещание.
            toast.setNotification(notification, notification.items.length > 0 ? hint : null);
            toast.onActivate = (index) => this.onActivate?.(notification.id, index);
            return toast;
        });
        this.setChildren(this.toasts);
    }

    /** Полная высота стека — сумма тостов (для позиционирования компонентом). */
    public get totalHeight(): number {
        return this.toasts.reduce((sum, toast) => sum + toast.totalHeight, 0);
    }

    /**
     * Уводит фокус в стек: на первую кнопку самого свежего сообщения (у угла), а
     * если кнопок нет вовсе — на сам стек, чтобы Escape дошёл.
     */
    public focusToasts(): void {
        const target = this.lastToastButtons().at(0);
        if (target !== undefined) target.focus();
        else this.focus();
    }

    /** Наблюдаемое состояние: сколько тостов и какие у них id. */
    public override inspectState(): Record<string, unknown> {
        return { ids: this.toasts.map((toast) => toast.notificationId) };
    }

    /** Кнопки всех тостов одним списком, сверху вниз. */
    private allButtons(): readonly ButtonElement[] {
        return this.toasts.flatMap((toast) => [...toast.buttons()]);
    }

    /** Кнопки самого свежего сообщения (последнего в стеке). */
    private lastToastButtons(): readonly ButtonElement[] {
        for (let index = this.toasts.length - 1; index >= 0; index--) {
            const buttons = this.toasts[index].buttons();
            if (buttons.length > 0) return buttons;
        }
        return [];
    }

    private handleKeydown(event: TUIKeyboardEvent): void {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            this.onHideAll?.();
            return;
        }
        const step = keyStep(event);
        if (step === 0) return;
        const buttons = this.allButtons();
        if (buttons.length === 0) return;
        const current = buttons.findIndex((button) => button.isFocused);
        // Фокус не на кнопке (стек взял его сам — у сообщения кнопок нет): шаг
        // приводит его на крайнюю кнопку, а не считается от «−1».
        const next = current < 0 ? (step > 0 ? 0 : buttons.length - 1) : current + step;
        if (next < 0 || next >= buttons.length) return;
        event.preventDefault();
        event.stopPropagation();
        buttons[next].focus();
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const width = Math.min(this.preferredWidth, constraints.maxWidth);
        const size = constraints.constrain(new Size(width, this.totalHeight));
        super.performLayout(BoxConstraints.tight(size));
        let y = 0;
        for (const toast of this.toasts) {
            const height = toast.totalHeight;
            this.layoutChild(toast, 0, y, BoxConstraints.tight(new Size(size.width, height)));
            y += height;
        }
        return size;
    }
}

/** Шаг по плоскому списку кнопок: −1 назад, +1 вперёд, 0 — клавиша не наша. */
function keyStep(event: TUIKeyboardEvent): number {
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") return -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") return 1;
    if (event.key === "Tab") return event.shiftKey ? -1 : 1;
    return 0;
}
