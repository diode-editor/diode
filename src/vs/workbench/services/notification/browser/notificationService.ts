import { Emitter } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

export const NotificationServiceDIToken = token<NotificationService>("NotificationService");

export type NotificationSeverity = "info" | "warn" | "error";

/** `NotificationsToasts.PURGE_TIMEOUT` эталона. */
export const NOTIFICATION_AUTO_HIDE_MS: Readonly<Record<NotificationSeverity, number>> = {
    info: 10000,
    warn: 12000,
    error: 15000,
};

/**
 * `NotificationsToasts.MAX_NOTIFICATIONS` эталона. Остальные ждут очереди: центра
 * уведомлений нет, и спрятать сообщение насовсем значило бы его потерять.
 */
export const MAX_VISIBLE_NOTIFICATIONS = 3;

/**
 * Конечный, а не вечный: расширение с `await show*Message(...)` стоит, пока живёт
 * показ, — вечный вопрос подвешивал `vscode-languageclient` перезапуск языкового
 * сервера (красный Windows-CI). У модального таймера нет: закрывать окно из-под рук хуже.
 */
export const NOTIFICATION_ASK_TIMEOUT_MS = 60000;

export interface INotificationMessage {
    readonly severity: NotificationSeverity;
    readonly message: string;
    /** Показывается только у модального сообщения. */
    readonly detail?: string;
    readonly modal: boolean;
    readonly items: readonly string[];
    /**
     * Кнопка для Escape у модального окна (`MessageItem.isCloseAffordance`); у
     * немодального игнорируется, как в эталоне.
     */
    readonly closeAffordance?: number;
}

export interface IActiveNotification extends INotificationMessage {
    readonly id: number;
}

/** `id` доступен сразу: мост расширений гасит показы умершего субпроцесса. */
export interface INotificationHandle {
    readonly id: number;
    /** `undefined` — закрыто без выбора. */
    readonly answered: Promise<number | undefined>;
}

interface IPassiveEntry {
    readonly notification: IActiveNotification;
    timer: ReturnType<typeof setTimeout> | null;
}

interface IAskEntry {
    readonly notification: IActiveNotification;
    readonly resolve: (index: number | undefined) => void;
    /** У модального сообщения таймера нет. */
    timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Аналог `INotificationService`. Два рода сообщений:
 * - без кнопок и не модальное — пассивный тост: уезжает сам, а обещание резолвится
 *   `undefined` СРАЗУ (отступление: в эталоне ждёт закрытия тоста — подвесило бы
 *   `await showErrorMessage(...)`);
 * - с кнопками или модальное — вопрос: по одному за раз, остальные в очереди.
 *
 * Отступление в обе стороны: в эталоне липкий только error с кнопками, а прочие
 * вопросы уезжают в центр уведомлений. Центра нет — вопрос живёт дольше тоста
 * («Activate / Use free version» у AI-автодополнения другой двери не имеет), но конечно.
 * Таймеры тостов и вопросов запускаются, когда сообщение стало видимым, — иначе
 * ждавшее очереди истекло бы, ни разу не показавшись.
 */
export class NotificationService extends Disposable {
    public static dependencies = [] as const;

    private readonly onDidChangeEmitter = this.register(new Emitter<void>());
    private nextId = 1;
    /** Старый → новый; видны первые {@link MAX_VISIBLE_NOTIFICATIONS}. */
    private readonly passiveList: IPassiveEntry[] = [];
    private readonly askList: IAskEntry[] = [];

    public constructor() {
        super();
        // Живые вопросы доводятся до «закрыто без выбора» — иначе задавший ждал бы вечно.
        this.register({
            dispose: () => {
                this.clearAll();
            },
        });
    }

    public readonly onDidChange = this.onDidChangeEmitter.event;

    public show(message: INotificationMessage): INotificationHandle {
        // Stryker disable next-line UpdateOperator: от счётчика нужна только уникальность адреса, направление шага ненаблюдаемо — `--` даёт такие же различимые id
        const notification: IActiveNotification = { ...message, id: this.nextId++ };
        if (this.isPassive(message)) {
            this.passiveList.push({ notification, timer: null });
            this.armVisibleTimers();
            this.fire();
            return { id: notification.id, answered: Promise.resolve(undefined) };
        }
        const answered = new Promise<number | undefined>((resolve) => {
            this.askList.push({ notification, resolve, timer: null });
        });
        this.armAskTimer();
        this.fire();
        return { id: notification.id, answered };
    }

    public passive(): readonly IActiveNotification[] {
        return this.passiveList.slice(0, MAX_VISIBLE_NOTIFICATIONS).map((entry) => entry.notification);
    }

    public queuedPassiveCount(): number {
        return Math.max(0, this.passiveList.length - MAX_VISIBLE_NOTIFICATIONS);
    }

    /**
     * Модальное идёт без очереди: за тостом-вопросом, который фокуса не берёт и
     * может остаться незамеченным, его бы не увидели вовсе.
     */
    public current(): IActiveNotification | null {
        return this.currentEntry()?.notification ?? null;
    }

    private currentEntry(): IAskEntry | null {
        const modal = this.askList.find((entry) => entry.notification.modal);
        return modal ?? this.askList.at(0) ?? null;
    }

    public queuedCount(): number {
        return Math.max(0, this.askList.length - 1);
    }

    /** Индекс вне набора кнопок — закрытие: ответ не про этот показ. */
    public answer(id: number, index: number): void {
        const at = this.askList.findIndex((e) => e.notification.id === id);
        if (at < 0) return;
        const { items } = this.askList[at].notification;
        this.settleAsk(at, index >= 0 && index < items.length ? index : undefined);
    }

    /** Повторный вызов на том же id — no-op. */
    public dismiss(id: number): void {
        const ask = this.askList.findIndex((e) => e.notification.id === id);
        if (ask >= 0) {
            this.settleAsk(ask, undefined);
            return;
        }
        const index = this.passiveList.findIndex((e) => e.notification.id === id);
        if (index < 0) return;
        this.clearTimer(this.passiveList[index]);
        this.passiveList.splice(index, 1);
        this.armVisibleTimers();
        this.fire();
    }

    public clearAll(): void {
        if (this.passiveList.length === 0 && this.askList.length === 0) return;
        for (const entry of this.passiveList) this.clearTimer(entry);
        this.passiveList.length = 0;
        const asks = [...this.askList];
        for (const entry of asks) this.clearTimer(entry);
        this.askList.length = 0;
        for (const entry of asks) entry.resolve(undefined);
        this.fire();
    }

    public isEmpty(): boolean {
        return this.passiveList.length === 0 && this.askList.length === 0;
    }

    /** Модальное пассивным не бывает даже без кнопок: закрыть его человек обязан сам. */
    private isPassive(message: INotificationMessage): boolean {
        return !message.modal && message.items.length === 0;
    }

    /**
     * По позиции, а не записи: оба вызывающих её уже нашли, лишний поиск потребовал
     * бы ветки «не нашли» — состояния, которого нет.
     */
    private settleAsk(at: number, index: number | undefined): void {
        const [entry] = this.askList.splice(at, 1);
        this.clearTimer(entry);
        entry.resolve(index);
        this.armAskTimer();
        this.fire();
    }

    private armVisibleTimers(): void {
        for (const entry of this.passiveList.slice(0, MAX_VISIBLE_NOTIFICATIONS)) {
            if (entry.timer !== null) continue;
            const { id, severity } = entry.notification;
            entry.timer = setTimeout(() => {
                this.dismiss(id);
            }, NOTIFICATION_AUTO_HIDE_MS[severity]);
        }
    }

    private armAskTimer(): void {
        const entry = this.currentEntry();
        if (entry?.timer !== null || entry.notification.modal) return;
        const { id } = entry.notification;
        entry.timer = setTimeout(() => {
            this.dismiss(id);
        }, NOTIFICATION_ASK_TIMEOUT_MS);
    }

    private clearTimer(entry: IPassiveEntry | IAskEntry): void {
        // Stryker disable next-line ConditionalExpression: без гарда вызов был бы `clearTimeout(null)` — та же пустая операция
        if (entry.timer === null) return;
        clearTimeout(entry.timer);
        entry.timer = null;
    }

    private fire(): void {
        this.onDidChangeEmitter.fire();
    }
}
