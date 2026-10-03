import type { IDisposable } from "./lifecycle.ts";

/**
 * Отложенный запуск «один раз»: `schedule()` перезаводит таймер, и функция
 * выполняется однажды — через задержку после ПОСЛЕДНЕГО вызова. Шим upstream
 * `RunOnceScheduler` (`vs/base/common/async.ts`) в той же форме, но только с
 * тем, что нам нужно: вместо поля `timer: ReturnType<typeof setTimeout> | null`
 * и пары методов «запланировать/отменить», которые каждая фича писала заново.
 */
export class RunOnceScheduler implements IDisposable {
    private timeoutToken: ReturnType<typeof setTimeout> | undefined;
    private runner: (() => void) | null;

    public constructor(
        runner: () => void,
        private readonly timeout: number,
    ) {
        this.runner = runner;
    }

    /** Снимает запланированный запуск (если есть) и планирует новый. */
    public schedule(delay = this.timeout): void {
        this.cancel();
        this.timeoutToken = setTimeout(() => {
            this.timeoutToken = undefined;
            this.runner?.();
        }, delay);
    }

    /** Снимает запланированный запуск; не запланирован — ничего не делает. */
    public cancel(): void {
        clearTimeout(this.timeoutToken);
        this.timeoutToken = undefined;
    }

    public isScheduled(): boolean {
        return this.timeoutToken !== undefined;
    }

    /** Снимает запуск и отпускает функцию: после `dispose` она уже не выполнится. */
    public dispose(): void {
        this.cancel();
        this.runner = null;
    }
}
