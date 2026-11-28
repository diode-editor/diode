// Port of upstream `services/userActivity/common/userActivityService.ts` (1.127): same holds, same debounce. Upstream
// registers trackers through `userActivityRegistry` on idle; here the one tracker (input on the root view) is attached
// by the workbench itself.

import { disposableTimeout, RunOnceScheduler } from "../../../../base/common/async.ts";
import { Emitter, type Event } from "../../../../base/common/event.ts";
import { Disposable, DisposableStore, type IDisposable, toDisposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

export interface IMarkActiveOptions {
    /** Count the hold only once it has lasted this long (ms). */
    readonly whenHeldFor?: number;
    /** Only extend an already active state: background work must not mark an absent user active (upstream #237386). */
    readonly extendOnly?: boolean;
}

export interface IUserActivityService {
    readonly isActive: boolean;
    readonly onDidChangeIsActive: Event<boolean>;
    /** The user counts as active until every returned hold is disposed. */
    markActive(opts?: IMarkActiveOptions): IDisposable;
}

export const UserActivityServiceDIToken = token<IUserActivityService>("UserActivityService");

/** Upstream `ProgressService.withProgress`: a task held this long extends the user's activity, never starts it. */
export const PROGRESS_ACTIVITY_HOLD: IMarkActiveOptions = { extendOnly: true, whenHeldFor: 15_000 };

/** After the last hold is released the state stays active this long (ms). */
export const MARK_INACTIVE_DEBOUNCE = 10_000;

export class UserActivityService extends Disposable implements IUserActivityService {
    public static dependencies = [] as const;

    private readonly changeEmitter = this.register(new Emitter<boolean>());
    public readonly onDidChangeIsActive = this.changeEmitter.event;

    private readonly markInactive = this.register(
        new RunOnceScheduler(() => {
            this.active = false;
            this.changeEmitter.fire(false);
        }, MARK_INACTIVE_DEBOUNCE),
    );

    private holds = 0;
    /** Initially `true`: the user just did something to open the window; the tracker unsets it if they walk away. */
    private active = true;

    public get isActive(): boolean {
        return this.active;
    }

    public markActive(opts?: IMarkActiveOptions): IDisposable {
        if (opts?.extendOnly === true && !this.active) return Disposable.None;

        if (opts?.whenHeldFor !== undefined) {
            const store = new DisposableStore();
            store.add(disposableTimeout(() => store.add(this.markActive()), opts.whenHeldFor));
            return store;
        }

        if (++this.holds === 1) {
            this.active = true;
            this.changeEmitter.fire(true);
            this.markInactive.cancel();
        }

        return toDisposable(() => {
            if (--this.holds === 0) this.markInactive.schedule();
        });
    }
}
