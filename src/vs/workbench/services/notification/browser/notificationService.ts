import type { IDisposable } from "@tuidom/core/common/disposable";
import { Disposable } from "@tuidom/core/common/disposable";

import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { INotification, INotificationRequest } from "../common/notification.ts";

export const NotificationServiceDIToken = token<NotificationService>("NotificationService");

/**
 * Сколько тостов висит одновременно. Четвёртое сообщение выталкивает самое
 * старое (его обещание резолвится «человек закрыл») — иначе болтливое
 * расширение застелило бы экран, а список тостов рос бы без границы.
 */
export const MAX_VISIBLE_NOTIFICATIONS = 3;

/** `notifications.autoHideTimeout` по умолчанию — как 15 секунд в VS Code. */
const DEFAULT_AUTO_HIDE_MS = 15_000;

/**
 * Реестр живых сообщений (аналог `INotificationService` VS Code): поставщики
 * (`window.show*Message` расширений, наши сервисы) зовут {@link notify},
 * компонент подписывается на {@link onDidChangeNotifications} и рисует стек
 * тостов. Сервис не знает ни про контролы, ни про оверлеи.
 *
 * Сообщение с кнопками — это ВОПРОС: {@link notify} резолвится индексом
 * нажатой кнопки, а `undefined` значит «человек закрыл, ничего не выбрав».
 * Обещание обязано дорешаться на КАЖДОМ пути закрытия (кнопка, Escape,
 * вытеснение по {@link MAX_VISIBLE_NOTIFICATIONS}, `clearAll`, снос сервиса):
 * иначе команда расширения, ждущая ответа, висит навсегда, и этого ниоткуда не
 * видно — ровно та же дисциплина, что у quick input.
 *
 * Сами собой гаснут только сообщения БЕЗ кнопок и уровня `info` (семантика
 * VS Code): вопрос человеку и сообщение об ошибке ждут, пока их прочтут.
 */
export class NotificationService extends Disposable {
    public static dependencies = [IConfigurationServiceDIToken] as const;

    private readonly live: INotification[] = [];
    private readonly resolvers = new Map<number, (index: number | undefined) => void>();
    private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
    private readonly listeners = new Set<() => void>();
    private nextId = 1;

    public constructor(private readonly configurationService: IConfigurationService) {
        super();
        this.register({
            // Снос сервиса (закрытие окна) — тоже путь закрытия: ждущие
            // обещания надо дорешать, а таймеры снять.
            dispose: () => {
                this.clearAll();
            },
        });
    }

    /**
     * Показывает сообщение. Резолвится индексом нажатой кнопки в `items` либо
     * `undefined` — человек закрыл сообщение, ничего не выбрав.
     */
    public notify(request: INotificationRequest): Promise<number | undefined> {
        const id = this.nextId++;
        const entry: INotification = {
            id,
            severity: request.severity,
            message: request.message,
            items: request.items ?? [],
        };
        const answer = new Promise<number | undefined>((resolve) => {
            this.resolvers.set(id, resolve);
        });
        this.live.push(entry);
        // Вытесняем ПОСЛЕ добавления: иначе при MAX=1 новое сообщение выбрасывало
        // бы само себя.
        while (this.live.length > MAX_VISIBLE_NOTIFICATIONS) this.close(this.live[0].id, undefined);
        this.scheduleAutoHide(entry);
        this.fire();
        return answer;
    }

    /** Живые сообщения в порядке появления — то, что рисует компонент. */
    public notifications(): readonly INotification[] {
        return [...this.live];
    }

    /** Подписка на любое изменение стека (показ, ответ, закрытие). */
    public onDidChangeNotifications(listener: () => void): IDisposable {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    /** Человек нажал кнопку `index` у сообщения `id`. */
    public accept(id: number, index: number): void {
        const entry = this.live.find((candidate) => candidate.id === id);
        // Индекс за пределами кнопок — не ответ: закрыть сообщение «выбором»,
        // которого нет, значит соврать расширению.
        if (entry === undefined || index < 0 || index >= entry.items.length) return;
        this.close(id, index);
    }

    /** Человек закрыл сообщение, ничего не выбрав (Escape, автоскрытие). */
    public dismiss(id: number): void {
        this.close(id, undefined);
    }

    /** Закрывает все живые сообщения как отменённые. */
    public clearAll(): void {
        while (this.live.length > 0) this.close(this.live[0].id, undefined);
    }

    /**
     * Снимает сообщение и дорешивает его обещание. Идемпотентно: повторный вызов
     * на уже снятом id — no-op (в него приходят и таймер, и кнопка, и Escape).
     */
    private close(id: number, index: number | undefined): void {
        const position = this.live.findIndex((candidate) => candidate.id === id);
        if (position < 0) return;
        this.live.splice(position, 1);
        const timer = this.timers.get(id);
        if (timer !== undefined) {
            clearTimeout(timer);
            this.timers.delete(id);
        }
        const resolve = this.resolvers.get(id);
        this.resolvers.delete(id);
        resolve?.(index);
        this.fire();
    }

    /**
     * Ставит таймер автоскрытия, если сообщению он положен. `0` (и любое
     * неположительное) в настройке — «не гасить само»: так пользователь и
     * сценарии-демо получают детерминированный экран.
     */
    private scheduleAutoHide(entry: INotification): void {
        if (entry.items.length > 0 || entry.severity !== "info") return;
        const configured = this.configurationService.get<number>("notifications.autoHideTimeout");
        const timeout =
            typeof configured === "number" && Number.isFinite(configured) ? configured : DEFAULT_AUTO_HIDE_MS;
        if (timeout <= 0) return;
        const timer = setTimeout(() => {
            this.timers.delete(entry.id);
            this.dismiss(entry.id);
        }, timeout);
        // Таймер не должен держать event loop живым: тост — не причина не давать
        // процессу завершиться.
        timer.unref();
        this.timers.set(entry.id, timer);
    }

    private fire(): void {
        for (const listener of [...this.listeners]) listener();
    }
}
