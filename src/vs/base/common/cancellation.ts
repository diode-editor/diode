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
 */
export class CancellationTokenSource {
    private listeners: ICancellationListener[] = [];
    private cancelled = false;

    public readonly token: ICancellationToken;

    public constructor() {
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
