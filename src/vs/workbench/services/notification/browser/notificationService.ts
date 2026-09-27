import { Disposable, type IDisposable } from "@tuidom/core/common/disposable";

import { token } from "../../../../platform/instantiation/common/diContainer.ts";

export const NotificationServiceDIToken = token<NotificationService>("NotificationService");

/** Строгость сообщения — она же выбирает иконку и цвет акцента. */
export type NotificationSeverity = "info" | "warn" | "error";

/** Сколько info/warning-сообщение без кнопок держится на экране само. */
export const NOTIFICATION_AUTO_HIDE_MS = 8000;

/** Просьба показать сообщение. Кнопки — заголовками, ответ — индексом в них. */
export interface INotificationMessage {
    readonly severity: NotificationSeverity;
    readonly message: string;
    /** Приглушённая вторая строка; показывается только у модального сообщения. */
    readonly detail?: string;
    /** Модальное сообщение — окно по центру вместо тоста в углу. */
    readonly modal: boolean;
    readonly items: readonly string[];
    /**
     * Индекс кнопки, которую отдать при закрытии модального окна по Escape
     * (`MessageItem.isCloseAffordance`). Отсутствие — закрыть без выбора.
     * У немодального сообщения игнорируется (так в эталоне).
     */
    readonly closeAffordance?: number;
}

/** Живое сообщение: то, что рисует компонент. */
export interface IActiveNotification extends INotificationMessage {
    /** Адрес показа внутри сервиса — по нему компонент отвечает и гасит. */
    readonly id: number;
}

/**
 * Ручка поднятого сообщения: адрес показа доступен СРАЗУ, не дожидаясь ответа.
 * Нужен тем, кто должен уметь погасить свой показ извне (мост расширений гасит
 * сообщения умершего субпроцесса).
 */
export interface INotificationHandle {
    readonly id: number;
    /** Индекс нажатой кнопки либо `undefined` — закрыто без выбора. */
    readonly answered: Promise<number | undefined>;
}

/** Запись сервиса: сообщение + кому отдать ответ + таймер самогашения. */
interface IEntry {
    readonly notification: IActiveNotification;
    readonly resolve: (index: number | undefined) => void;
    timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Сообщения человеку (аналог `INotificationService` VS Code): модель показа для
 * {@link import("../../../browser/parts/notifications/notificationsComponent.ts").NotificationsComponent}
 * и для тех, кто сообщения поднимает — прежде всего мост расширений
 * (`window.show{Information,Warning,Error}Message`).
 *
 * Сервис делит сообщения на два рода, и это деление определяет ВСЁ остальное:
 *
 * - **Без кнопок и не модальное** — пассивный тост: показывается в стеке над
 *   статус-баром, фокус не трогает, info/warning гаснет сам через
 *   {@link NOTIFICATION_AUTO_HIDE_MS}, error висит до закрытия. Обещание
 *   резолвится `undefined` СРАЗУ: выбирать нечего, а ждать закрытия значило бы
 *   подвесить расширение, сделавшее `await showErrorMessage(...)`, на время
 *   жизни тоста, который сам не гаснет. Осознанное отступление от эталона.
 * - **С кнопками или модальное** — вопрос: живёт по одному за раз (остальные
 *   ждут в очереди), самогашения не имеет и резолвится тем, что человек нажал,
 *   либо `undefined`, если он закрыл сообщение не выбрав.
 *
 * Про контролы и overlay-слой сервис не знает — этим владеет компонент.
 */
export class NotificationService extends Disposable {
    public static dependencies = [] as const;

    private readonly listeners = new Set<() => void>();
    private nextId = 1;
    /** Пассивные тосты в порядке появления (старый → новый). */
    private readonly passiveList: IEntry[] = [];
    /** Вопросы: `[0]` — тот, что сейчас на экране, остальные ждут очереди. */
    private readonly askList: IEntry[] = [];

    public constructor() {
        super();
        this.register({
            dispose: () => {
                // Таймеры переживают сервис, если их не снять: в тестах это
                // удерживает раннер, в приложении — стреляет в мёртвый сервис.
                for (const entry of this.passiveList) this.clearTimer(entry);
                this.passiveList.length = 0;
                this.askList.length = 0;
                this.listeners.clear();
            },
        });
    }

    /** Подписка на любое изменение набора живых сообщений. */
    public onDidChange(listener: () => void): IDisposable {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    /**
     * Показывает сообщение. `answered` резолвится индексом нажатой кнопки в
     * `items` либо `undefined` — закрыто без выбора (у сообщения без кнопок —
     * сразу же, см. описание класса).
     */
    public show(message: INotificationMessage): INotificationHandle {
        const notification: IActiveNotification = { ...message, id: this.nextId++ };
        if (this.isPassive(message)) {
            const entry: IEntry = { notification, resolve: () => undefined, timer: null };
            this.passiveList.push(entry);
            if (message.severity !== "error") {
                entry.timer = setTimeout(() => {
                    this.dismiss(notification.id);
                }, NOTIFICATION_AUTO_HIDE_MS);
            }
            this.fire();
            return { id: notification.id, answered: Promise.resolve(undefined) };
        }
        const answered = new Promise<number | undefined>((resolve) => {
            this.askList.push({ notification, resolve, timer: null });
        });
        this.fire();
        return { id: notification.id, answered };
    }

    /** Пассивные тосты (без кнопок), старый → новый. */
    public passive(): readonly IActiveNotification[] {
        return this.passiveList.map((entry) => entry.notification);
    }

    /**
     * Вопрос, который сейчас на экране; `null` — вопросов нет.
     *
     * Модальное сообщение идёт БЕЗ ОЧЕРЕДИ: оно требует ответа здесь и сейчас, и
     * держать его за тостом-вопросом (который человек вправе не заметить вовсе,
     * фокуса тот не забирает) значило бы не показать его вообще. Внутри своего
     * рода порядок обычный, FIFO.
     */
    public current(): IActiveNotification | null {
        const modal = this.askList.find((entry) => entry.notification.modal);
        return (modal ?? this.askList.at(0))?.notification ?? null;
    }

    /** Сколько вопросов ждёт своей очереди за текущим. */
    public queuedCount(): number {
        return Math.max(0, this.askList.length - 1);
    }

    /**
     * Человек нажал кнопку — отдаём её индекс тому, кто сообщение поднял.
     * Индекс вне набора кнопок трактуем как закрытие: ответ не про этот показ.
     */
    public answer(id: number, index: number): void {
        const entry = this.askList.find((e) => e.notification.id === id);
        if (entry === undefined) return;
        const answer = index >= 0 && index < entry.notification.items.length ? index : undefined;
        this.settleAsk(entry, answer);
    }

    /**
     * Закрыть сообщение без выбора (Escape, самогашение, «Clear All», смерть
     * субпроцесса). Повторный вызов на том же id — no-op.
     */
    public dismiss(id: number): void {
        const ask = this.askList.find((e) => e.notification.id === id);
        if (ask !== undefined) {
            this.settleAsk(ask, undefined);
            return;
        }
        const index = this.passiveList.findIndex((e) => e.notification.id === id);
        if (index < 0) return;
        this.clearTimer(this.passiveList[index]);
        this.passiveList.splice(index, 1);
        this.fire();
    }

    /** Убирает всё с экрана: вопросы получают «закрыто без выбора». */
    public clearAll(): void {
        if (this.passiveList.length === 0 && this.askList.length === 0) return;
        for (const entry of this.passiveList) this.clearTimer(entry);
        this.passiveList.length = 0;
        const asks = [...this.askList];
        this.askList.length = 0;
        for (const entry of asks) entry.resolve(undefined);
        this.fire();
    }

    /** Есть ли что показывать (для тестов и для гигиены оверлеев). */
    public isEmpty(): boolean {
        return this.passiveList.length === 0 && this.askList.length === 0;
    }

    /**
     * Пассивное ли сообщение. Модальное пассивным не бывает даже без кнопок: у
     * него своё окно, и закрыть его человек обязан сам.
     */
    private isPassive(message: INotificationMessage): boolean {
        return !message.modal && message.items.length === 0;
    }

    private settleAsk(entry: IEntry, index: number | undefined): void {
        const at = this.askList.indexOf(entry);
        // Stryker disable next-line ConditionalExpression: запись приходит сюда только найденной в askList; гард страхует от повторного ответа на уже снятое сообщение
        if (at < 0) return;
        this.askList.splice(at, 1);
        entry.resolve(index);
        this.fire();
    }

    private clearTimer(entry: IEntry): void {
        if (entry.timer === null) return;
        clearTimeout(entry.timer);
        entry.timer = null;
    }

    private fire(): void {
        for (const listener of [...this.listeners]) listener();
    }
}
