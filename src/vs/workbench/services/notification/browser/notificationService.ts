import type { IDisposable } from "@tuidom/core/common/disposable";
import { Disposable } from "@tuidom/core/common/disposable";

import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { INotification, INotificationRequest } from "../common/notification.ts";

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
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
 * Значение `notifications.autoHideTimeout` → задержка автоскрытия в мс.
 * Настройку правит человек, поэтому не-число (строка, `null`, `NaN`) читается
 * как «настройки нет» и уводит на дефолт, а не роняет показ. Ноль и любое
 * неположительное — «не гасить само»: так пользователь в узком терминале и
 * сценарии-демо получают детерминированный экран.
 *
 * Чистой функцией, а не выражением внутри `scheduleAutoHide`: разбор настройки
 * проверяется таблицей значений, без таймеров и без живого сервиса.
 */
export function resolveAutoHideTimeout(configured: unknown): number {
    if (typeof configured !== "number" || !Number.isFinite(configured)) return DEFAULT_AUTO_HIDE_MS;
    // `Math.max`, а не тернарник на `<= 0`: в тернарнике сравнение лишнее —
    // и `<`, и `<=` возвращают ноль на всём неположительном, то есть один из
    // вариантов заведомо неотличим от другого.
    return Math.max(0, configured);
}

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
        // Stryker disable next-line ConditionalExpression,EqualityOperator,BlockStatement,CallExpression: снятие таймера ненаблюдаемо снаружи — `clearTimeout(undefined)` легален, а сработавший таймер зовёт `dismiss` на уже снятом id и упирается в ранний выход ниже. Строки держим ради гигиены: иначе таймер живёт до срабатывания и держит ссылку на сервис
        if (timer !== undefined) {
            // Stryker disable next-line CallExpression: снятие таймера наружу не видно — сработавший зовёт `dismiss` на уже снятом id и упирается в ранний выход. Строка нужна, чтобы таймер не жил до срабатывания, держа ссылку на сервис
            clearTimeout(timer);
            // Stryker disable next-line CallExpression: та же причина — карта таймеров чистится ради гигиены, поведения она не меняет
            this.timers.delete(id);
        }
        const resolve = this.resolvers.get(id);
        // Stryker disable next-line CallExpression: та же причина — повторный close по этому id выходит раньше (его нет в live), так что оставшаяся запись недостижима; delete здесь чистит карту, а не меняет поведение
        this.resolvers.delete(id);
        // Stryker disable next-line OptionalChaining: resolver кладётся в карту вместе с записью и удаляется вместе с ней, поэтому пары «запись есть, resolver'а нет» не бывает; `?.` стоит защитой
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
        const timeout = resolveAutoHideTimeout(this.configurationService.get("notifications.autoHideTimeout"));
        if (timeout === 0) return;
        const timer = setTimeout(() => {
            // Stryker disable next-line CallExpression: сработавший таймер и так больше не нужен — запись чистится ради гигиены карты
            this.timers.delete(entry.id);
            this.dismiss(entry.id);
        }, timeout);
        // Таймер не должен держать event loop живым: тост — не причина не давать
        // процессу завершиться.
        // Stryker disable next-line CallExpression: unref не меняет исход — он лишь не даёт таймеру держать event loop живым, а это наблюдаемо только в момент выхода процесса
        timer.unref();
        // Stryker disable next-line CallExpression: запись в карту нужна, чтобы ответ до таймаута снял таймер; сам ответ проверен тестом, а «висит лишний таймер» наружу не видно
        this.timers.set(entry.id, timer);
    }

    private fire(): void {
        for (const listener of [...this.listeners]) listener();
    }
}
