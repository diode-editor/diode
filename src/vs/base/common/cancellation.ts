import type { IDisposable } from "./lifecycle.ts";

export type ICancellationListener = () => void;

export interface ICancellationToken {
    readonly isCancellationRequested: boolean;
    /** Уже отменённый токен зовёт слушателя сразу, синхронно. */
    readonly onCancellationRequested: (listener: ICancellationListener) => IDisposable;
}

const NO_SUBSCRIPTION: IDisposable = { dispose: (): void => undefined };

export const CancellationTokenNone: ICancellationToken = {
    isCancellationRequested: false,
    onCancellationRequested: () => NO_SUBSCRIPTION,
};

/** `dispose()` снимает слушателей, но не отменяет: запрос дожил до ответа своим ходом. */
export class CancellationTokenSource {
    private listeners: ICancellationListener[] = [];
    private cancelled = false;
    private readonly parentSubscription: IDisposable | undefined;

    public readonly token: ICancellationToken;

    public constructor(parent?: ICancellationToken) {
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
        // Stryker disable next-line ConditionalExpression: гард только экономит работу — повторный проход найдёт пустой список, мутант эквивалентен
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

export interface IRequestTicket {
    readonly token: ICancellationToken;
    isStale(): boolean;
    /** Звать после последней проверки {@link isStale}: отмена владельцем отработавший билет уже не трогает. */
    done(): void;
}

/** «Последний запрос побеждает»: `start()` отменяет предыдущий. */
export class LatestRequest implements IDisposable {
    private current: CancellationTokenSource | undefined;
    private disposed = false;

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

    public get pending(): boolean {
        return this.current !== undefined;
    }

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
