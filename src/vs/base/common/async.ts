import { type IDisposable, toDisposable } from "./lifecycle.ts";
import { setTimeout0 } from "./platform.ts";

/** Upstream `timeout` without its cancellation token (no caller needs one yet). */
export function timeout(millis: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, millis));
}

/** Upstream `raceTimeout`: the promise or, after `timeout` ms, `undefined`. */
export function raceTimeout<T>(promise: Promise<T>, timeout: number): Promise<T | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
        promise.finally(() => {
            // Stryker disable next-line CallExpression: a timer left behind only resolves a race that is already settled
            clearTimeout(timer);
        }),
        new Promise<undefined>((resolve) => {
            timer = setTimeout(() => {
                resolve(undefined);
            }, timeout);
        }),
    ]);
}

/** Upstream `disposableTimeout` without its `store`: disposing the result cancels the handler. */
export function disposableTimeout(handler: () => void, timeout = 0): IDisposable {
    const timer = setTimeout(handler, timeout);
    return toDisposable(() => {
        clearTimeout(timer);
    });
}

export class RunOnceScheduler implements IDisposable {
    private timeoutToken: ReturnType<typeof setTimeout> | undefined;
    private runner: (() => void) | null;

    public constructor(
        runner: () => void,
        private readonly timeout: number,
    ) {
        this.runner = runner;
    }

    public schedule(delay = this.timeout): void {
        this.cancel();
        this.timeoutToken = setTimeout(() => {
            this.timeoutToken = undefined;
            this.runner?.();
        }, delay);
    }

    public cancel(): void {
        clearTimeout(this.timeoutToken);
        this.timeoutToken = undefined;
    }

    public isScheduled(): boolean {
        return this.timeoutToken !== undefined;
    }

    public dispose(): void {
        this.cancel();
        this.runner = null;
    }
}

export interface IdleDeadline {
    readonly didTimeout: boolean;
    timeRemaining(): number;
}

/** Only upstream's branch without `requestIdleCallback`: Node doesn't expose idle time. */
export function runWhenGlobalIdle(callback: (idle: IdleDeadline) => void): IDisposable {
    let disposed = false;
    setTimeout0(() => {
        if (disposed) return;
        const end = Date.now() + 15; // one frame at 64fps
        callback(
            Object.freeze({
                didTimeout: true,
                timeRemaining: () => Math.max(0, end - Date.now()),
            }),
        );
    });
    return {
        dispose: () => {
            disposed = true;
        },
    };
}

/** Upstream `DeferredPromise`, narrowed to what the debug model uses: resolve a promise from outside. */
export class DeferredPromise<T> {
    public readonly complete: (value: T) => void;
    public readonly p: Promise<T>;

    public constructor() {
        const { promise, resolve } = Promise.withResolvers<T>();
        this.p = promise;
        this.complete = resolve;
    }
}
