import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { DialogService } from "../../dialogs/browser/dialogService.ts";
import { DialogServiceDIToken } from "../../dialogs/browser/dialogService.ts";
import type { LifecyclePhase } from "../common/lifecyclePhase.ts";
import { LIFECYCLE_PHASES } from "../common/lifecyclePhase.ts";

export const LifecycleServiceDIToken = token<LifecycleService>("LifecycleService");

export interface IShutdownDirtyItem {
    readonly name: string;
    /** The tab may have been closed while earlier items were answered; such an item is skipped. */
    isStillDirty(): boolean;
    /**
     * Overwrites the file even if it changed on disk: the user's choice must not be lost.
     * `false` means nothing was saved (untitled without a path, write error) and shutdown is cancelled.
     */
    save(): Promise<boolean>;
}

/** Counterpart of the vscode `onBeforeShutdown` veto. */
export interface IShutdownParticipant {
    collectDirty(): readonly IShutdownDirtyItem[];
}

/** Why the app shuts down: the reason only affects what comes after (exit or a new process). */
export type ShutdownReason = "quit" | "reload" | "inspector";

/**
 * Counterpart of vscode `WillShutdownEvent`. The phase awaits {@link join} promises, but no longer
 * than the shared timeout, so a hung participant doesn't block exit.
 */
export interface IWillShutdownEvent {
    readonly reason: ShutdownReason;
    join(promise: Promise<unknown>): void;
}

export interface ILifecycleSubscription {
    dispose(): void;
}

/** Covers a graceful extension host stop: RPC `host.shutdown` waits up to 1.5 s, then SIGTERM. */
export const SHUTDOWN_JOIN_TIMEOUT_MS = 2000;

/**
 * Counterpart of vscode `ILifecycleService`. Shutdown takes two steps: {@link requestShutdown}
 * (confirm dirty items, Cancel aborts) and {@link shutdown}, shared by quit, reload and the
 * inspector: an async {@link onWillShutdown} phase with a shared timeout, then
 * {@link onShutdownSync} in reverse subscription order, and only then the caller's `then`.
 * Participants subscribe where they are created, so a new resource isn't wired into every exit path.
 */
export class LifecycleService {
    public static dependencies = [DialogServiceDIToken] as const;

    private participants: IShutdownParticipant[] = [];
    private readonly willShutdownListeners = new Set<(event: IWillShutdownEvent) => void>();
    private readonly shutdownSyncListeners = new Set<() => void>();
    private shutdownPromise: Promise<void> | null = null;
    private currentPhase: LifecyclePhase = "starting";
    private readonly phaseListeners = new Set<(phase: LifecyclePhase) => void>();
    private readonly phaseBarriers: Readonly<Record<LifecyclePhase, IBarrier>> = {
        starting: createBarrier(),
        ready: createBarrier(),
        restored: createBarrier(),
        eventually: createBarrier(),
    };

    public constructor(
        private readonly dialogService: DialogService,
        private readonly joinTimeoutMs = SHUTDOWN_JOIN_TIMEOUT_MS,
    ) {
        this.barrier("starting").open();
    }

    public get phase(): LifecyclePhase {
        return this.currentPhase;
    }

    /**
     * Skipped intermediate phases are passed in order (their listeners fire too);
     * repeating the current phase is a no-op, going backwards is a startup ordering bug.
     */
    public setPhase(phase: LifecyclePhase): void {
        const target = LIFECYCLE_PHASES.indexOf(phase);
        const current = LIFECYCLE_PHASES.indexOf(this.currentPhase);
        if (target < current) {
            throw new Error(`Lifecycle cannot go backwards: ${this.currentPhase} → ${phase}`);
        }
        for (const next of LIFECYCLE_PHASES.slice(current + 1, target + 1)) {
            this.currentPhase = next;
            for (const listener of [...this.phaseListeners]) listener(next);
            this.barrier(next).open();
        }
    }

    /** Fires synchronously at the transition, unlike {@link when}. */
    public onDidChangePhase(listener: (phase: LifecyclePhase) => void): ILifecycleSubscription {
        return subscribe(this.phaseListeners, listener);
    }

    public when(phase: LifecyclePhase): Promise<void> {
        return this.barrier(phase).promise;
    }

    private barrier(phase: LifecyclePhase): IBarrier {
        return this.phaseBarriers[phase];
    }

    public registerShutdownParticipant(participant: IShutdownParticipant): void {
        this.participants.push(participant);
    }

    /**
     * Without dirty items `onProceed` is called synchronously (before the first await). Cancel, like
     * a Save that failed to save, leaves the app as is.
     */
    public async requestShutdown(onProceed: () => unknown): Promise<void> {
        for (const participant of this.participants) {
            for (const item of participant.collectDirty()) {
                if (!item.isStillDirty()) continue;
                const choice = await this.dialogService.confirmSave(item.name);
                if (choice === "cancel") return;
                if (choice === "save" && !(await item.save())) return;
            }
        }
        await onProceed();
    }

    /** Release here whatever needs a reply (subprocesses). */
    public onWillShutdown(listener: (event: IWillShutdownEvent) => void): ILifecycleSubscription {
        return subscribe(this.willShutdownListeners, listener);
    }

    /**
     * Synchronous code only: after `then` the event loop may never turn again (reload
     * blocks it by launching a new process).
     */
    public onShutdownSync(listener: () => void): ILifecycleSubscription {
        return subscribe(this.shutdownSyncListeners, listener);
    }

    /**
     * A repeated call joins the first shutdown. A failing participant doesn't stop the
     * others: there is no going back at exit.
     */
    public shutdown(reason: ShutdownReason, then: () => void): Promise<void> {
        this.shutdownPromise ??= this.doShutdown(reason, then);
        return this.shutdownPromise;
    }

    private async doShutdown(reason: ShutdownReason, then: () => void): Promise<void> {
        const joins = new Set<Promise<unknown>>();
        const event: IWillShutdownEvent = {
            reason,
            join: (promise) => {
                joins.add(promise.catch(() => undefined));
            },
        };
        for (const listener of [...this.willShutdownListeners]) {
            try {
                listener(event);
            } catch {
                // a participant failed to start shutting down; the others still shut down
            }
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<void>((resolve) => {
            timer = setTimeout(resolve, this.joinTimeoutMs);
        });
        await Promise.race([Promise.all(joins), timeout]);
        clearTimeout(timer);
        for (const listener of [...this.shutdownSyncListeners].reverse()) {
            try {
                listener();
            } catch {
                // same: one participant's synchronous step doesn't hold up the others
            }
        }
        then();
    }
}

interface IBarrier {
    readonly promise: Promise<void>;
    open(): void;
}

function createBarrier(): IBarrier {
    let open!: () => void;
    const promise = new Promise<void>((resolve) => {
        open = resolve;
    });
    return { promise, open };
}

function subscribe<T>(listeners: Set<T>, listener: T): ILifecycleSubscription {
    listeners.add(listener);
    return {
        dispose: () => {
            listeners.delete(listener);
        },
    };
}
