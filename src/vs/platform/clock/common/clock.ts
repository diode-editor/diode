import type { IDisposable } from "../../../base/common/lifecycle.ts";
import { token } from "../../instantiation/common/diContainer.ts";

/**
 * Time for long timers (hours, not frames): a service, not module state — the V8 snapshot has no clock, and the
 * e2e moves it (`Diode.advanceClock`) to see a 12-hour schedule in seconds.
 */
export interface IClock {
    now(): number;
    setTimeout(callback: () => void, ms: number): IDisposable;
}

export const ClockDIToken = token<IClock>("Clock");
/** The same instance as {@link ClockDIToken}: only the inspector (`Diode.advanceClock`) moves it. */
export const AdjustableClockDIToken = token<AdjustableClock>("AdjustableClock");

interface IClockTimer {
    readonly callback: () => void;
    readonly due: number;
    handle?: ReturnType<typeof setTimeout>;
}

/**
 * Real time plus an offset that only the inspector moves: without it the clock is `Date.now` and `setTimeout`.
 * A move fires the timers it passed right away and reschedules the rest for the moved time.
 */
export class AdjustableClock implements IClock {
    private offset = 0;
    private readonly timers = new Set<IClockTimer>();

    public now(): number {
        return Date.now() + this.offset;
    }

    public setTimeout(callback: () => void, ms: number): IDisposable {
        const timer: IClockTimer = { callback, due: this.now() + ms };
        this.timers.add(timer);
        this.arm(timer);
        return {
            dispose: () => {
                clearTimeout(timer.handle);
                this.timers.delete(timer);
            },
        };
    }

    public advance(ms: number): void {
        if (ms < 0) throw new Error("The clock only moves forward");
        this.offset += ms;
        for (const timer of this.timers) {
            clearTimeout(timer.handle);
            this.arm(timer);
        }
    }

    private arm(timer: IClockTimer): void {
        timer.handle = setTimeout(
            () => {
                this.timers.delete(timer);
                timer.callback();
            },
            Math.max(0, timer.due - this.now()),
        );
    }
}
