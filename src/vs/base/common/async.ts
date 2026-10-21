import type { IDisposable } from "./lifecycle.ts";
import { setTimeout0 } from "./platform.ts";

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
