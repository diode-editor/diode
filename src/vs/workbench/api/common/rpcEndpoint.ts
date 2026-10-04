import { CancellationTokenSource, type ICancellationToken } from "../../../base/common/cancellation.ts";
import { BugIndicatingError } from "../../../base/common/errors.ts";
import {
    type SerializedError,
    transformErrorForSerialization,
    transformErrorFromSerialization,
} from "../../../base/common/errorSerialization.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { ILogger } from "../../../platform/log/common/iLogger.ts";

import type { IMessageChannel } from "./iMessageChannel.ts";

/**
 * Конверты сообщений host↔extension. Кастомный формат (без полного JSON-RPC):
 * минимум, нужный для request/response + notifications.
 */
export interface IRequestMessage {
    readonly kind: "req";
    readonly id: number;
    readonly method: string;
    readonly params: unknown;
}

export interface IResponseMessage {
    readonly kind: "res";
    readonly id: number;
    readonly result?: unknown;
    /**
     * Ошибка обработчика: `name`/`message`/`stack`/`code`/`cause` доезжают
     * целиком (`FileSystemError`, `CancellationError` и стек расширения не
     * теряются по дороге) — как `ReplyErrError` эталона.
     */
    readonly error?: SerializedError;
}

export interface INotificationMessage {
    readonly kind: "notif";
    readonly method: string;
    readonly params: unknown;
}

export type IProtocolMessage = IRequestMessage | IResponseMessage | INotificationMessage;

/**
 * Обработчик запроса. Второй аргумент — токен отмены этого конкретного запроса:
 * он стреляет, когда вызывающая сторона прислала {@link CANCEL_REQUEST_METHOD}
 * («ответ уже не нужен»). Долгая работа обязана на него смотреть, короткая
 * вправе игнорировать — ответ отменённого запроса вызывающий отбросит сам.
 */
export type IRequestHandler = (params: unknown, token: ICancellationToken) => unknown;
export type INotificationHandler = (params: unknown) => void;

/**
 * Карта протокола одного направления: запросы `метод → [параметры, результат]`
 * и нотификации `метод → параметры`. Только типы — на проводе ничего не
 * меняется; карта даёт компилятору проверить, что сторона шлёт и что
 * обработчик принимает и возвращает (см. `extHostProtocol.ts`).
 */
export interface IRpcProtocol {
    readonly requests: object;
    readonly notifications: object;
}

/** Протокол без карты: любой метод, параметры и результат — `unknown`. */
export interface IUntypedProtocol {
    readonly requests: Readonly<Record<string, readonly [params: unknown, result: unknown]>>;
    readonly notifications: Readonly<Record<string, unknown>>;
}

/** Методы запросов протокола. */
export type RequestMethod<P extends IRpcProtocol> = keyof P["requests"] & string;
/** Параметры запроса `K`. */
export type RequestParams<P extends IRpcProtocol, K extends RequestMethod<P>> = P["requests"][K] extends readonly [
    infer A,
    unknown,
]
    ? A
    : unknown;
/** Результат запроса `K`. */
export type RequestResult<P extends IRpcProtocol, K extends RequestMethod<P>> = P["requests"][K] extends readonly [
    unknown,
    infer R,
]
    ? R
    : unknown;
/** Методы нотификаций протокола. */
export type NotificationMethod<P extends IRpcProtocol> = keyof P["notifications"] & string;
/** Параметры нотификации `K`. */
export type NotificationParams<P extends IRpcProtocol, K extends NotificationMethod<P>> = P["notifications"][K];

/**
 * Зарезервированный метод отмены (аналог LSP `$/cancelRequest`): нотификация
 * `{ id }` — «запрос #id больше не нужен». Отменой владеет сторона, которая
 * запрос послала; принимающая гасит токен обработчика. Транспорт общий для
 * всех методов — подключение конкретного провайдера к отмене сводится к
 * проводке токена, а не к новому протоколу.
 */
// Stryker disable next-line StringLiteral: имя метода — контракт с самим собой, обе стороны читают эту же константу; наблюдаемо только против чужой реализации протокола
export const CANCEL_REQUEST_METHOD = "$/cancelRequest";

/** Параметры {@link CANCEL_REQUEST_METHOD}. */
export interface ICancelRequestParams {
    readonly id: number;
}

/**
 * Сколько отмен-сирот (отмена обогнала собственный запрос — переупорядочивание
 * транспорта) endpoint помнит, чтобы выдать обработчику уже отменённый токен.
 * Граница нужна, чтобы множество не росло без предела на чужом мусоре.
 */
const EARLY_CANCEL_MEMORY = 64;

/**
 * Тонкая обёртка поверх {@link IMessageChannel}, реализующая request/response
 * и notification поверх канального транспорта. Симметрична — оба конца
 * (host и runtime) используют один и тот же класс.
 */
export class RpcEndpoint<
    TOut extends IRpcProtocol = IUntypedProtocol,
    TIn extends IRpcProtocol = IUntypedProtocol,
> implements IDisposable {
    private readonly channel: IMessageChannel;
    private readonly logger: ILogger | undefined;
    private readonly channelSubscription: IDisposable;
    private readonly pendingRequests = new Map<
        number,
        {
            resolve: (value: unknown) => void;
            reject: (reason: Error) => void;
            /** Подписка на токен вызывающего; снимается вместе с ответом. */
            cancelSubscription: IDisposable | null;
            /** Таймер {@link IRequestOptions.timeoutMs}; гасится ответом. */
            timer: ReturnType<typeof setTimeout> | undefined;
        }
    >();
    /** Токены входящих запросов, которые сейчас исполняет эта сторона. */
    private readonly incomingCancellations = new Map<number, CancellationTokenSource>();
    /** Id отмен, пришедших раньше собственного запроса (см. {@link EARLY_CANCEL_MEMORY}). */
    private readonly earlyCancellations = new Set<number>();
    private readonly requestHandlers = new Map<string, IRequestHandler>();
    private readonly notificationHandlers = new Map<string, INotificationHandler>();
    /** Нотификации без обработчика, о которых уже предупредили (раз на метод). */
    private readonly unknownNotifications = new Set<string>();
    private nextRequestId = 1;
    private disposed = false;

    public constructor(channel: IMessageChannel, logger?: ILogger) {
        this.channel = channel;
        this.logger = logger;
        this.channelSubscription = channel.onMessage((msg) => {
            this.traceIncoming(msg);
            this.handleIncoming(msg);
        });
    }

    /**
     * Шлёт запрос и ждёт ответа. `token` — необязательный токен отмены
     * вызывающего: когда он стреляет, второй стороне уходит нотификация
     * {@link CANCEL_REQUEST_METHOD}, и обработчик там видит отменённый токен.
     * Ответ при этом всё равно ожидается: отмена — просьба, а не разрыв.
     *
     * `timeoutMs` — срок ответа: истёк — запрос отменяется так же (обработчик
     * второй стороны узнаёт об этом токеном, language server — `$/cancelRequest`),
     * а промис отклоняется {@link TimeoutError}, не дожидаясь опоздавшего ответа.
     */
    public request<K extends RequestMethod<TOut>>(
        method: K,
        params?: RequestParams<TOut, K>,
        options: IRequestOptions = {},
    ): Promise<RequestResult<TOut, K>> {
        const { token, timeoutMs } = options;
        if (this.disposed) {
            return Promise.reject(new Error(`RpcEndpoint disposed; cannot request "${method}"`));
        }
        const id = this.nextRequestId++;
        return new Promise<RequestResult<TOut, K>>((resolve, reject) => {
            const pending = {
                // Результат приходит с провода как есть: тип ему даёт карта протокола.
                resolve: resolve as (value: unknown) => void,
                reject,
                cancelSubscription: null as IDisposable | null,
                timer: undefined as ReturnType<typeof setTimeout> | undefined,
            };
            this.pendingRequests.set(id, pending);
            const msg: IRequestMessage = { kind: "req", id, method, params };
            this.logger?.trace(`-> req#${String(id)} ${method}`, params);
            this.channel.postMessage(msg);
            // Подписка ПОСЛЕ отправки: у уже отменённого токена слушатель
            // зовётся синхронно, и отмена обязана уйти следом за запросом,
            // а не впереди него.
            pending.cancelSubscription =
                token?.onCancellationRequested(() => {
                    this.cancelOutgoing(id, method);
                }) ?? null;
            if (timeoutMs !== undefined) {
                pending.timer = setTimeout(() => {
                    // Stryker disable next-line CallExpression: гигиена — опоздавший ответ нашёл бы уже отклонённый промис (повторный resolve — no-op), разница лишь в росте карты
                    this.pendingRequests.delete(id);
                    pending.cancelSubscription?.dispose();
                    this.cancelOutgoing(id, method);
                    reject(new TimeoutError(method, timeoutMs));
                }, timeoutMs);
            }
        });
    }

    public notify<K extends NotificationMethod<TOut>>(method: K, params?: NotificationParams<TOut, K>): void {
        this.sendNotification(method, params);
    }

    /** Отправка нотификации мимо карты протокола: служебный `$/cancelRequest` в ней не значится. */
    private sendNotification(method: string, params: unknown): void {
        if (this.disposed) return;
        const msg: INotificationMessage = { kind: "notif", method, params };
        this.logger?.trace(`-> notif ${method}`, params);
        this.channel.postMessage(msg);
    }

    public handleRequest<K extends RequestMethod<TIn>>(
        method: K,
        handler: (
            params: RequestParams<TIn, K>,
            token: ICancellationToken,
        ) => RequestResult<TIn, K> | Promise<RequestResult<TIn, K>>,
    ): IDisposable {
        // Второй обработчик молча вытеснил бы первый — у запроса один ответчик.
        if (this.requestHandlers.has(method)) {
            throw new BugIndicatingError(`request handler for "${method}" is already registered`);
        }
        this.requestHandlers.set(method, handler as IRequestHandler);
        return {
            dispose: (): void => {
                if (this.requestHandlers.get(method) === handler) {
                    this.requestHandlers.delete(method);
                }
            },
        };
    }

    public handleNotification<K extends NotificationMethod<TIn>>(
        method: K,
        handler: (params: NotificationParams<TIn, K>) => void,
    ): IDisposable {
        this.notificationHandlers.set(method, handler as INotificationHandler);
        return {
            dispose: (): void => {
                if (this.notificationHandlers.get(method) === handler) {
                    this.notificationHandlers.delete(method);
                }
            },
        };
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.channelSubscription.dispose();
        for (const pending of this.pendingRequests.values()) {
            pending.cancelSubscription?.dispose();
            clearTimeout(pending.timer);
            pending.reject(new Error("RpcEndpoint disposed"));
        }
        this.pendingRequests.clear();
        // Канала больше нет — ответ некуда слать; обработчикам, которые ещё
        // считают, сообщаем отменой (их работа уже никому не нужна). Сама
        // уборка за отменой (dispose источников и очистка обеих коллекций)
        // поведения не меняет — endpoint уже мёртв, читать их больше некому.
        for (const source of this.incomingCancellations.values()) {
            source.cancel();
            // Stryker disable next-line CallExpression: уборка, см. выше
            source.dispose();
        }
        // Stryker disable next-line CallExpression: уборка, см. выше
        this.incomingCancellations.clear();
        // Stryker disable next-line CallExpression: уборка, см. выше
        this.earlyCancellations.clear();
        this.requestHandlers.clear();
        this.notificationHandlers.clear();
    }

    /**
     * Токен вызывающего стрельнул — просим вторую сторону бросить запрос.
     * Отмена уже отвеченного запроса сюда не доходит: подписка на токен
     * снимается вместе с ответом (и в {@link handleResponseMessage}, и в
     * {@link dispose}) — на этом инварианте и держится «после ответа молчим».
     */
    private cancelOutgoing(id: number, method: string): void {
        // Stryker disable next-line StringLiteral: текст trace-строки ненаблюдаем (логгера в тестах endpoint'а нет)
        this.logger?.trace(`-> cancel req#${String(id)} ${method}`);
        this.sendNotification(CANCEL_REQUEST_METHOD, { id } satisfies ICancelRequestParams);
    }

    /** Отмена входящего запроса: гасит токен его обработчика. */
    private handleCancelMessage(params: unknown): void {
        // Stryker disable next-line OptionalChaining: без `?.` мусорные параметры заставляют handleCancelMessage кинуть прямо из доставки канала, то есть мимо стека теста. Тест на этот случай есть («отмена с чужой формой параметров и отмена без пары — тихие»), но он ПРОХОДИТ: unhandled-ошибка роняет раннер (RuntimeError) вместо падения теста. Это дыра в локализации ошибок слушателей (docs/TESTING.md → #275), а не пробел в тестах этой строки.
        const id = (params as ICancelRequestParams | null | undefined)?.id;
        // Гард против мусора в параметрах: без него нечисловой id просто осел
        // бы в earlyCancellations и не совпал бы ни с одним запросом (ключи
        // там — числа), то есть наблюдаемо ничего бы не изменилось.
        // Stryker disable next-line ConditionalExpression: см. выше
        if (typeof id !== "number") return;
        const source = this.incomingCancellations.get(id);
        if (source !== undefined) {
            source.cancel();
            return;
        }
        // Пары нет: либо запрос уже отвечен (отмена опоздала — просто молчим),
        // либо отмена обогнала свой запрос на переупорядоченном транспорте —
        // запоминаем, чтобы выдать обработчику уже отменённый токен.
        this.earlyCancellations.add(id);
        for (const stale of this.earlyCancellations) {
            if (this.earlyCancellations.size <= EARLY_CANCEL_MEMORY) break;
            this.earlyCancellations.delete(stale);
        }
    }

    private handleIncoming(raw: unknown): void {
        if (typeof raw !== "object" || raw === null) return;
        const message = raw as Partial<IProtocolMessage> & { kind?: string };
        switch (message.kind) {
            case "req":
                this.handleRequestMessage(message as IRequestMessage);
                return;
            case "res":
                this.handleResponseMessage(message as IResponseMessage);
                return;
            case "notif":
                if ((message as INotificationMessage).method === CANCEL_REQUEST_METHOD) {
                    this.handleCancelMessage((message as INotificationMessage).params);
                    return;
                }
                this.handleNotificationMessage(message as INotificationMessage);
                return;
            default:
                return;
        }
    }

    private handleRequestMessage(message: IRequestMessage): void {
        const handler = this.requestHandlers.get(message.method);
        if (handler === undefined) {
            const response: IResponseMessage = {
                kind: "res",
                id: message.id,
                error: serializeRejection(new Error(`No handler for method "${message.method}"`)),
            };
            this.logger?.warn(`no handler for req#${String(message.id)} ${message.method}`);
            this.channel.postMessage(response);
            return;
        }
        // Токен этого запроса: стреляет по `$/cancelRequest` с его id. Отмена,
        // обогнавшая сам запрос, лежит в earlyCancellations — тогда обработчик
        // получает токен, отменённый с самого начала.
        const source = new CancellationTokenSource();
        this.incomingCancellations.set(message.id, source);
        if (this.earlyCancellations.delete(message.id)) source.cancel();
        Promise.resolve()
            .then(() => handler(message.params, source.token))
            .then(
                (result) => {
                    // Stryker disable next-line CallExpression: уборка токена, см. finishIncoming
                    this.finishIncoming(message.id, source);
                    if (this.disposed) return;
                    const response: IResponseMessage = { kind: "res", id: message.id, result };
                    this.logger?.trace(`-> res#${String(message.id)} ${message.method}`, result);
                    this.channel.postMessage(response);
                },
                (reason: unknown) => {
                    // Stryker disable next-line CallExpression: уборка токена, см. finishIncoming
                    this.finishIncoming(message.id, source);
                    if (this.disposed) return;
                    const error = serializeRejection(reason);
                    const response: IResponseMessage = { kind: "res", id: message.id, error };
                    this.logger?.warn(`-> res#${String(message.id)} ${message.method} ERROR: ${error.message}`);
                    this.channel.postMessage(response);
                },
            );
    }

    /**
     * Входящий запрос отработал: токен больше не нужен. Чистая уборка —
     * опоздавшая отмена по этому id и так никому не адресована (обработчик
     * уже вернул ответ), поэтому наблюдаемого поведения тут нет, только
     * отсутствие роста коллекций.
     */
    // Stryker disable BlockStatement,CallExpression: уборка без наблюдаемого эффекта, см. выше
    private finishIncoming(id: number, source: CancellationTokenSource): void {
        this.incomingCancellations.delete(id);
        source.dispose();
    }
    // Stryker restore BlockStatement,CallExpression

    private handleResponseMessage(message: IResponseMessage): void {
        const pending = this.pendingRequests.get(message.id);
        if (pending === undefined) return;
        this.pendingRequests.delete(message.id);
        pending.cancelSubscription?.dispose();
        clearTimeout(pending.timer);
        if (message.error !== undefined) {
            pending.reject(transformErrorFromSerialization(message.error));
        } else {
            pending.resolve(message.result);
        }
    }

    private handleNotificationMessage(message: INotificationMessage): void {
        const handler = this.notificationHandlers.get(message.method);
        if (handler === undefined) {
            // Нотификация без обработчика — расхождение сторон протокола; поток
            // таких сообщений не должен топить лог, поэтому — раз на метод.
            if (!this.unknownNotifications.has(message.method)) {
                this.unknownNotifications.add(message.method);
                this.logger?.warn(`no handler for notification "${message.method}"`);
            }
            return;
        }
        try {
            handler(message.params);
        } catch (err) {
            // Notifications не имеют ответа — глотаем исключения молча
            // (в Phase 1 изоляция упрощённая).
            this.logger?.warn(`notification handler for "${message.method}" threw`, err);
        }
    }

    private traceIncoming(raw: unknown): void {
        if (this.logger === undefined) return;
        if (typeof raw !== "object" || raw === null) return;
        const message = raw as Partial<IProtocolMessage> & { kind?: string };
        switch (message.kind) {
            case "req":
                this.logger.trace(
                    `<- req#${String((message as IRequestMessage).id)} ${(message as IRequestMessage).method}`,
                    (message as IRequestMessage).params,
                );
                return;
            case "res": {
                const m = message as IResponseMessage;
                if (m.error !== undefined) {
                    this.logger.trace(`<- res#${String(m.id)} ERROR: ${m.error.message}`);
                } else {
                    this.logger.trace(`<- res#${String(m.id)}`, m.result);
                }
                return;
            }
            case "notif":
                this.logger.trace(
                    `<- notif ${(message as INotificationMessage).method}`,
                    (message as INotificationMessage).params,
                );
                return;
            default:
                return;
        }
    }
}

/** Параметры исходящего запроса ({@link RpcEndpoint.request}). */
export interface IRequestOptions {
    /** Токен отмены вызывающего. */
    readonly token?: ICancellationToken;
    /** Срок ответа, мс: истёк — запрос отменяется, промис — {@link TimeoutError}. */
    readonly timeoutMs?: number;
}

/** Ответ не пришёл за `timeoutMs`: запрос отменён на второй стороне. */
export class TimeoutError extends Error {
    public constructor(
        public readonly method: string,
        public readonly timeoutMs: number,
    ) {
        super(`request "${method}" timed out after ${String(timeoutMs)}ms`);
        this.name = "TimeoutError";
    }
}

/**
 * Отказ обработчика в форме провода. `Error` сериализуется целиком; бросили
 * не `Error` (строку, число) — значение едет текстом сообщения обычной ошибки.
 */
function serializeRejection(reason: unknown): SerializedError {
    if (reason instanceof Error) return transformErrorForSerialization(reason);
    return { $isError: true, name: "Error", message: String(reason), stack: "" };
}
