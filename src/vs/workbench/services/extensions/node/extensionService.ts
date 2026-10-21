import { mark } from "../../../../base/common/performance.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { IExtensionService } from "../common/extensions.ts";

import type { IExtensionRegistrationEnv } from "./extensionRegistration.ts";
import { toExtensionRegistration } from "./extensionRegistration.ts";
import type { IExtensionRegistration } from "./iExtensionEntry.ts";

/** Upstream's `timeout(10000)`: how long `onStartupFinished` waits for eager activation. */
export const STARTUP_FINISHED_TIMEOUT_MS = 10_000;

export interface IExtensionActivationHost {
    registerExtension(reg: IExtensionRegistration): unknown;
    /** An installed extension without code: no registration, but dependencies on it are satisfied. */
    registerDeclarativeExtension(id: string): void;
    activateByEvent(event: string): Promise<void>;
    activateByWorkspaceContains(): Promise<void>;
    restartForWorkspaceChange(): Promise<void>;
}

/**
 * An event that arrives before {@link start} isn't lost but is replayed right after `*` (like upstream
 * `_allRequestedActivateEvents`).
 */
export class ExtensionService implements IExtensionService {
    private readonly requested: string[] = [];
    private barrierOpen = false;
    private openBarrier!: () => void;
    private readonly barrier = new Promise<void>((resolve) => {
        this.openBarrier = resolve;
    });

    public constructor(
        private readonly host: IExtensionActivationHost,
        public readonly extensions: readonly IExtension[],
        private readonly registrationEnv: IExtensionRegistrationEnv,
        private readonly logger: ILogger,
        private readonly startupFinishedTimeoutMs = STARTUP_FINISHED_TIMEOUT_MS,
    ) {}

    public getExtension(id: string): IExtension | undefined {
        return this.extensions.find((ext) => ext.id === id);
    }

    public whenInstalledExtensionsRegistered(): Promise<void> {
        return this.barrier;
    }

    public activateByEvent(event: string): Promise<void> {
        if (this.barrierOpen) return this.host.activateByEvent(event);
        if (!this.requested.includes(event)) this.requested.push(event);
        return this.barrier;
    }

    public restartForWorkspaceChange(): Promise<void> {
        // Before the barrier there are neither registrations nor a process: start itself does the
        // folder pass last among the events, already against the new workspace.
        if (this.barrierOpen) return this.host.restartForWorkspaceChange();
        return this.barrier;
    }

    /**
     * Like upstream `_handleEagerExtensions`: `*` and `workspaceContains:` in parallel, `onStartupFinished`
     * after them, but no later than {@link STARTUP_FINISHED_TIMEOUT_MS}: a hung `activate()` doesn't defer
     * it forever. The barrier opens on any failure, so waiters don't hang.
     */
    public async start(): Promise<void> {
        for (const ext of this.extensions) {
            try {
                const reg = await toExtensionRegistration(ext, this.registrationEnv);
                if (reg === null) this.host.registerDeclarativeExtension(ext.id);
                else this.host.registerExtension(reg);
            } catch (err) {
                this.logger.error(`${ext.id}: failed to register${ext.isBuiltin ? " (builtin)" : ""}`, err);
            }
        }
        mark("main:extensions-registered");
        const eager = Promise.all([
            this.activateEager(),
            this.guard("workspaceContains", this.host.activateByWorkspaceContains()),
        ]);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<void>((resolve) => {
            timer = setTimeout(resolve, this.startupFinishedTimeoutMs);
        });
        await Promise.race([eager, timeout]);
        clearTimeout(timer);
        await this.guard("onStartupFinished", this.host.activateByEvent("onStartupFinished"));
        await eager;
        mark("exthost:activated");
    }

    private async activateEager(): Promise<void> {
        await this.guard("*", this.host.activateByEvent("*"));
        // Live iteration: an event arriving during the replay is replayed too.
        for (const event of this.requested) await this.guard(event, this.host.activateByEvent(event));
        this.barrierOpen = true;
        this.openBarrier();
    }

    private async guard(event: string, activation: Promise<void>): Promise<void> {
        try {
            await activation;
        } catch (err) {
            this.logger.error(`extension host activation failed (${event})`, err);
        }
    }
}
