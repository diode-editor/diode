//@diode:shim microsoft/vscode@1.127.0 src/vs/base/common/event.ts
// Свой узкий `Emitter` с API эталона, гарантии G1–G6 — docs/arch/Common.md#события-eventts.
// Массив слушателей copy-on-write: `fire` идёт по захваченной ссылке, поэтому
// добавленный во время `fire` слушатель в нём не зовётся. Очереди доставки, как
// в эталоне, нет: вложенный `fire` доставляется вглубь.

import { onUnexpectedError } from "./errors.ts";
import { Disposable, type IDisposable, toDisposable } from "./lifecycle.ts";

export type Event<T> = (listener: (e: T) => unknown) => IDisposable;

export const Event = {
    None: ((): IDisposable => Disposable.None) as Event<never>,

    once<T>(event: Event<T>): Event<T> {
        return (listener) => {
            // Событие может прийти синхронно, ещё до того, как подписка вернулась:
            // тогда снимать её приходится уже после возврата.
            const state: { fired?: true; subscription?: IDisposable } = {};
            const subscription = event((e) => {
                if (state.fired) return;
                state.fired = true;
                state.subscription?.dispose();
                return listener(e);
            });
            state.subscription = subscription;
            if (state.fired) subscription.dispose();
            return subscription;
        };
    },
};

export interface IEmitterOptions {
    onWillAddFirstListener?(): void;
    /** Зовётся и при `dispose`. */
    onDidRemoveLastListener?(): void;
    onListenerError?(e: unknown): void;
}

interface IListener<T> {
    readonly fn: (e: T) => unknown;
    removed: boolean;
}

export class Emitter<T> implements IDisposable {
    private listeners: readonly IListener<T>[] = [];
    private disposed = false;

    public readonly event: Event<T> = (fn) => this.subscribe(fn);

    public constructor(private readonly options: IEmitterOptions = {}) {}

    private subscribe(fn: (e: T) => unknown): IDisposable {
        if (this.disposed) return Disposable.None;
        if (this.listeners.length === 0) this.options.onWillAddFirstListener?.();
        const listener: IListener<T> = { fn, removed: false };
        this.listeners = [...this.listeners, listener];
        return toDisposable(() => {
            this.remove(listener);
        });
    }

    private remove(listener: IListener<T>): void {
        // Снятый `dispose()` эмиттера: список уже пуст, хук уже позван.
        if (listener.removed) return;
        listener.removed = true;
        this.listeners = this.listeners.filter((l) => l !== listener);
        if (this.listeners.length === 0) this.options.onDidRemoveLastListener?.();
    }

    public fire(event: T): void {
        for (const listener of this.listeners) {
            if (listener.removed) continue;
            try {
                listener.fn(event);
            } catch (e) {
                (this.options.onListenerError ?? onUnexpectedError)(e);
            }
        }
    }

    public hasListeners(): boolean {
        return this.listeners.length > 0;
    }

    public dispose(): void {
        this.disposed = true;
        if (this.listeners.length === 0) return;
        for (const listener of this.listeners) listener.removed = true;
        this.listeners = [];
        this.options.onDidRemoveLastListener?.();
    }
}
