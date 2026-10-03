import type { IDisposable } from "@tuidom/core/common/disposable";

/** Слушатель отмены — вызывается один раз, без аргументов. */
export type ICancellationListener = () => void;

/**
 * Токен отмены — форма `vscode.CancellationToken`, но в слое base: запрос,
 * который уже никому не нужен, сообщает об этом исполнителю. Ядро раздаёт
 * токены дорогим асинхронным запросам (RPC к расширениям), исполнитель смотрит
 * на {@link isCancellationRequested} или подписывается на
 * {@link onCancellationRequested}.
 */
export interface ICancellationToken {
    /** `true`, как только запрос отменён; обратно не переключается. */
    readonly isCancellationRequested: boolean;
    /**
     * Подписка на отмену. Если токен УЖЕ отменён, слушатель зовётся сразу
     * (синхронно) — подписчику не нужно отдельно проверять флаг.
     */
    readonly onCancellationRequested: (listener: ICancellationListener) => IDisposable;
}

const NO_SUBSCRIPTION: IDisposable = { dispose: (): void => undefined };

/** Токен, который не отменяется никогда (запрос без владельца отмены). */
export const CancellationTokenNone: ICancellationToken = {
    isCancellationRequested: false,
    onCancellationRequested: () => NO_SUBSCRIPTION,
};

/**
 * Владелец токена: один источник на один запрос. Кто запрос завёл, тот и
 * отменяет — `cancel()` идемпотентен, `dispose()` снимает слушателей, не
 * отменяя (запрос дожил до ответа своим ходом).
 *
 * Родительский токен (как `new CancellationTokenSource(parent)` у upstream):
 * отмена родителя отменяет и этот источник; подписку на родителя снимает
 * `dispose()`. Уже отменённый родитель отменяет источник сразу, в конструкторе.
 */
export class CancellationTokenSource {
    private listeners: ICancellationListener[] = [];
    private cancelled = false;
    private readonly parentSubscription: IDisposable | undefined;

    public readonly token: ICancellationToken;

    public constructor(parent?: ICancellationToken) {
        // Геттер объекта-литерала стрелкой быть не может, поэтому до состояния
        // источника он добирается через замыкание, а не через алиас `this`.
        const isCancelled = (): boolean => this.cancelled;
        const subscribe = (listener: ICancellationListener): IDisposable => this.subscribe(listener);
        this.token = {
            get isCancellationRequested(): boolean {
                return isCancelled();
            },
            onCancellationRequested: subscribe,
        };
        this.parentSubscription = parent?.onCancellationRequested(() => {
            this.cancel();
        });
    }

    public cancel(): void {
        // Гард только экономит работу: повторный проход всё равно нашёл бы
        // пустой список слушателей и уже взведённый флаг — мутант эквивалентен.
        // Stryker disable next-line ConditionalExpression: см. выше
        if (this.cancelled) return;
        this.cancelled = true;
        // Снапшот: слушатель вправе отписаться (или отписать соседа) из колбэка.
        const listeners = [...this.listeners];
        this.listeners.length = 0;
        for (const listener of listeners) listener();
    }

    public dispose(): void {
        this.listeners.length = 0;
        this.parentSubscription?.dispose();
    }

    private subscribe(listener: ICancellationListener): IDisposable {
        if (this.cancelled) {
            listener();
            return NO_SUBSCRIPTION;
        }
        this.listeners.push(listener);
        return {
            dispose: (): void => {
                const idx = this.listeners.indexOf(listener);
                if (idx >= 0) this.listeners.splice(idx, 1);
            },
        };
    }
}

/**
 * Билет одного запроса из {@link LatestRequest}. Устаревание — это отмена:
 * следующий `start()` или `cancel()` владельца отменяет билет, поэтому
 * {@link isStale} заменяет прежнее сравнение номеров поколений.
 */
export interface IRequestTicket {
    /** Токен запроса — отдать исполнителю (провайдеру), чтобы он бросил работу. */
    readonly token: ICancellationToken;
    /** `true`, если запрос перебит следующим или отменён владельцем. */
    isStale(): boolean;
    /**
     * Запрос отработал: билет перестаёт быть текущим ({@link LatestRequest.pending}
     * гаснет), слушатели и подписка на родительский токен снимаются. Звать
     * после последней проверки {@link isStale}: отмена владельцем уже
     * отработавший билет не трогает.
     */
    done(): void;
}

/**
 * «Последний запрос побеждает»: `start()` отменяет предыдущий запрос и выдаёт
 * билет нового. Общий примитив вместо рукописных счётчиков
 * `const seq = ++this.requestSeq; await …; if (seq !== this.requestSeq) return`
 * — после `await` достаточно `if (ticket.isStale()) return`, а токен билета
 * заодно доезжает до исполнителя. У upstream такого класса нет: там каждая
 * фича держит свой `CancellationTokenSource` и перезаводит его вручную —
 * здесь этот ритуал собран в одном месте.
 */
export class LatestRequest implements IDisposable {
    private current: CancellationTokenSource | undefined;
    private disposed = false;

    /**
     * Отменяет текущий запрос и заводит новый. `parent` — внешний токен
     * (например, состояние редактора): его отмена тоже делает билет устаревшим.
     * После {@link dispose} билет выдаётся уже отменённым.
     */
    public start(parent?: ICancellationToken): IRequestTicket {
        this.cancel();
        const source = new CancellationTokenSource(parent);
        if (this.disposed) source.cancel();
        else this.current = source;
        return {
            token: source.token,
            isStale: () => source.token.isCancellationRequested,
            done: () => {
                if (this.current === source) this.current = undefined;
                source.dispose();
            },
        };
    }

    /** Есть ли запрос в полёте: начат, ещё не отменён и не отработал (`done()`). */
    public get pending(): boolean {
        return this.current !== undefined;
    }

    /** Отменяет текущий запрос (замена `this.requestSeq++` в `close()`). */
    public cancel(): void {
        const current = this.current;
        this.current = undefined;
        current?.cancel();
        current?.dispose();
    }

    public dispose(): void {
        this.disposed = true;
        this.cancel();
    }
}
