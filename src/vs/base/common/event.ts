//@diode:shim microsoft/vscode@1.127.0 src/vs/base/common/event.ts
// Узкий свой `Emitter`/`Event` с именами и формой API эталона, а не дословный
// перенос: upstream-файл тянет ~30 файлов графа base/common, монитор утечек с
// `console.warn` в терминал TUI и очередь доставки. Исследование и план —
// docs/TODO/Events.md.
//
// Гарантии (нумерация — по Events.md):
// - G1: слушатель, добавленный во время `fire`, в этом `fire` не зовётся —
//   массив слушателей неизменяем (copy-on-write), `fire` идёт по захваченной
//   ссылке без копирования;
// - G2: слушатель, снятый во время `fire` и ещё не достигнутый, не зовётся;
// - G3: исключение слушателя уходит в `onListenerError ?? onUnexpectedError`,
//   остальные слушатели событие получают;
// - G5: `dispose()` снимает всех; подписка на мёртвый эмиттер — пустышка;
// - G6: хуки первого/последнего слушателя.
//
// ОСОЗНАННЫЕ ОТКЛОНЕНИЯ ОТ ЭТАЛОНА: нет очереди доставки (вложенный `fire`
// доставляется вглубь), монитора утечек, оптимизации «один слушатель без
// массива», `thisArgs`/`disposables` в сигнатуре `Event`.

import { onUnexpectedError } from "./errors.ts";
import { Disposable, type IDisposable, toDisposable } from "./lifecycle.ts";

/** Событие — функция подписки: `onDidX(listener)` возвращает ручку отписки. */
export type Event<T> = (listener: (e: T) => unknown) => IDisposable;

export const Event = {
    /** Событие, которое не наступает никогда. */
    None: ((): IDisposable => Disposable.None) as Event<never>,

    /** Событие, которое доставляется слушателю один раз, после чего подписка снимается сама. */
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
    /** Перед тем как появится первый слушатель — ленивая проводка источника. */
    onWillAddFirstListener?(): void;
    /** После того как ушёл последний слушатель (в т.ч. при `dispose`). */
    onDidRemoveLastListener?(): void;
    /** Куда уходит исключение слушателя; по умолчанию — `onUnexpectedError`. */
    onListenerError?(e: unknown): void;
}

interface IListener<T> {
    readonly fn: (e: T) => unknown;
    removed: boolean;
}

/**
 * Источник события. Владелец держит эмиттер приватным и отдаёт наружу только
 * `event`:
 *
 *     private readonly onDidChangeEmitter = new Emitter<string>();
 *     public readonly onDidChange = this.onDidChangeEmitter.event;
 */
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
