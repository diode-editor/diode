import { Disposable, type IDisposable } from "@tuidom/core/common/disposable";

import { token } from "../../../../platform/instantiation/common/diContainer.ts";

export const NotificationServiceDIToken = token<NotificationService>("NotificationService");

/** Строгость сообщения — она же выбирает иконку и цвет акцента. */
export type NotificationSeverity = "info" | "warn" | "error";

/**
 * Сколько тост без кнопок держится на экране сам, по строгости — значения
 * эталона (`NotificationsToasts.PURGE_TIMEOUT`): чем серьёзнее сообщение, тем
 * дольше оно висит.
 */
export const NOTIFICATION_AUTO_HIDE_MS: Readonly<Record<NotificationSeverity, number>> = {
    info: 10000,
    warn: 12000,
    error: 15000,
};

/**
 * Сколько тостов видно одновременно (в эталоне —
 * `NotificationsToasts.MAX_NOTIFICATIONS`). Остальные ЖДУТ ОЧЕРЕДИ: у нас нет
 * центра уведомлений, и спрятать сообщение насовсем значило бы его потерять.
 */
export const MAX_VISIBLE_NOTIFICATIONS = 3;

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
 *   статус-баром, фокуса не трогает и УЕЗЖАЕТ САМ через
 *   {@link NOTIFICATION_AUTO_HIDE_MS} (значения эталона по строгости). Обещание
 *   резолвится `undefined` СРАЗУ: выбирать нечего, а ждать закрытия значило бы
 *   подвесить расширение, сделавшее `await showErrorMessage(...)`. Осознанное
 *   отступление от эталона — там обещание ждёт закрытия тоста.
 * - **С кнопками или модальное** — вопрос: живёт по одному за раз (остальные
 *   ждут в очереди), САМОГАШЕНИЯ НЕ ИМЕЕТ и резолвится тем, что человек нажал,
 *   либо `undefined`, если он закрыл сообщение не выбрав.
 *
 * Второе осознанное отступление — как раз про липкость: в эталоне сам по себе
 * липкий только error С КНОПКАМИ (`NotificationViewItem.sticky`), а вопрос
 * уровня info/warning уезжает по таймауту, и вернуть его можно лишь из центра
 * уведомлений. Центра у нас нет, поэтому уехавший вопрос означал бы навсегда
 * потерянный выбор расширения (типовой случай — «Activate / Use free version» у
 * AI-автодополнения, для которого другой двери нет). Пока центра нет, вопрос
 * ждёт ответа столько, сколько нужно.
 *
 * Видно одновременно не больше {@link MAX_VISIBLE_NOTIFICATIONS} тостов (как в
 * эталоне), но лишние не прячутся насовсем, а ЖДУТ ОЧЕРЕДИ: таймер тоста
 * запускается в момент, когда он стал видимым, — иначе сообщение истекло бы,
 * ни разу не показавшись.
 *
 * Про контролы и overlay-слой сервис не знает — этим владеет компонент.
 */
export class NotificationService extends Disposable {
    public static dependencies = [] as const;

    private readonly listeners = new Set<() => void>();
    private nextId = 1;
    /**
     * Пассивные тосты в порядке появления (старый → новый). Видны первые
     * {@link MAX_VISIBLE_NOTIFICATIONS}, остальные ждут своей очереди.
     */
    private readonly passiveList: IEntry[] = [];
    /** Вопросы: `[0]` — тот, что сейчас на экране, остальные ждут очереди. */
    private readonly askList: IEntry[] = [];

    public constructor() {
        super();
        // Смерть сервиса = «всё убрали с экрана»: таймеры, которые иначе
        // выстрелят в мёртвый сервис, снимаются, а живые вопросы доводятся до
        // «закрыто без выбора» — иначе тот, кто их задал, ждал бы вечно.
        this.register({
            dispose: () => {
                this.clearAll();
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
        // Stryker disable next-line UpdateOperator: от счётчика нужна только уникальность адреса, направление шага ненаблюдаемо — `--` даёт такие же различимые id
        const notification: IActiveNotification = { ...message, id: this.nextId++ };
        if (this.isPassive(message)) {
            this.passiveList.push({ notification, resolve: () => undefined, timer: null });
            this.armVisibleTimers();
            this.fire();
            return { id: notification.id, answered: Promise.resolve(undefined) };
        }
        const answered = new Promise<number | undefined>((resolve) => {
            this.askList.push({ notification, resolve, timer: null });
        });
        this.fire();
        return { id: notification.id, answered };
    }

    /**
     * Видимые тосты (без кнопок), старый → новый: первые
     * {@link MAX_VISIBLE_NOTIFICATIONS} из живых. Остальные не потеряны — они
     * встанут на освободившееся место, см. {@link queuedPassiveCount}.
     */
    public passive(): readonly IActiveNotification[] {
        return this.passiveList.slice(0, MAX_VISIBLE_NOTIFICATIONS).map((entry) => entry.notification);
    }

    /** Сколько тостов ждёт свободного места в стеке. */
    public queuedPassiveCount(): number {
        return Math.max(0, this.passiveList.length - MAX_VISIBLE_NOTIFICATIONS);
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
        // Место освободилось — на него встаёт тот, кто ждал очереди, и только
        // теперь у него начинает течь время жизни.
        this.armVisibleTimers();
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

    /**
     * Заводит таймер самогашения каждому ВИДИМОМУ тосту, у которого его ещё нет.
     * Время жизни считается с момента показа: тост, ждавший очереди, иначе истёк
     * бы, ни разу не появившись на экране.
     */
    private armVisibleTimers(): void {
        for (const entry of this.passiveList.slice(0, MAX_VISIBLE_NOTIFICATIONS)) {
            if (entry.timer !== null) continue;
            const { id, severity } = entry.notification;
            entry.timer = setTimeout(() => {
                this.dismiss(id);
            }, NOTIFICATION_AUTO_HIDE_MS[severity]);
        }
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
