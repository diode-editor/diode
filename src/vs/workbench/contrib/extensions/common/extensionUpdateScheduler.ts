import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Disposable, MutableDisposable } from "../../../../base/common/lifecycle.ts";
import type { IClock } from "../../../../platform/clock/common/clock.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";

import {
    AUTO_CHECK_UPDATES_SETTING,
    AUTO_UPDATE_SETTING,
    type AutoUpdateValue,
    planAutoUpdate,
} from "./extensionAutoUpdate.ts";
import type { IExtensionsWorkbenchService, IExtensionUpdateAllResult } from "./extensionsWorkbench.ts";

/** After the `eventually` phase: startup itself never goes to the network. */
export const FIRST_CHECK_DELAY_MS = 10_000;
/** Upstream `UpdatesCheckInterval`. */
export const UPDATES_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
/**
 * Upstream `autoUpdateDelayer` (`ThrottledDelayer(1000)`): reads in quick succession are one batch, and a manual
 * Check still finds the outdated ones to put under `@outdated` before they are installed.
 */
export const AUTO_UPDATE_DEBOUNCE_MS = 1000;

export interface IAutoUpdateSettings {
    autoCheckUpdates(): boolean;
    autoUpdate(): AutoUpdateValue;
    autoUpdateDelayHours(): number;
    /** The key of a setting that changed. */
    onDidChange(listener: (key: string) => void): IDisposable;
}

export interface IExtensionUpdateSchedulerPorts {
    readonly service: Pick<
        IExtensionsWorkbenchService,
        "checkForUpdates" | "getOutdated" | "updateExtensions" | "onDidReadCatalog"
    >;
    readonly settings: IAutoUpdateSettings;
    readonly clock: IClock;
    readonly logger: Pick<ILogger, "warn">;
    /** Something was updated: the batch's one notification. Failures are not here, they are in the log. */
    onDidUpdate(result: IExtensionUpdateAllResult): void;
}

/**
 * Upstream `initializeAutoUpdate`, `eventuallyCheckForUpdates` and `autoUpdateExtensions` without a gallery or
 * shared process: the background check reads the catalog like `Check for Extension Updates`, but silently, and
 * every successful read — the user's too — is followed by auto-update. The window is never reloaded here.
 */
export class ExtensionUpdateScheduler extends Disposable {
    private readonly checkTimer = this.register(new MutableDisposable());
    private readonly autoUpdateTimer = this.register(new MutableDisposable());
    /** Upstream `delayedAutoUpdateCheckTimer`: the soonest end of a publish delay. */
    private readonly delayTimer = this.register(new MutableDisposable());
    private readonly onDidChangeAutoUpdateEmitter = this.register(new Emitter<void>());
    private started = false;
    private updating = false;
    /** A pass was asked for while a batch ran: one more after it. */
    private again = false;

    public constructor(private readonly ports: IExtensionUpdateSchedulerPorts) {
        super();
        this.register(
            ports.service.onDidReadCatalog((ok) => {
                this.onDidReadCatalog(ok);
            }),
        );
        this.register(
            ports.settings.onDidChange((key) => {
                this.onDidChangeSetting(key);
            }),
        );
    }

    public readonly onDidChangeAutoUpdate = this.onDidChangeAutoUpdateEmitter.event;

    /** The `eventually` phase: the first check after {@link FIRST_CHECK_DELAY_MS}; again — the same single timer. */
    public start(): void {
        this.started = true;
        this.scheduleCheck(FIRST_CHECK_DELAY_MS);
    }

    public isAutoUpdateEnabled(): boolean {
        return this.ports.settings.autoUpdate() === "on";
    }

    /**
     * Upstream `eventuallyAutoUpdateExtensions`: a pass over the current catalog, after the debounce. The setting is
     * read when the pass runs: turned off in between, it installs nothing.
     */
    public eventuallyAutoUpdate(): void {
        this.autoUpdateTimer.value = this.ports.clock.setTimeout(() => {
            void this.autoUpdate();
        }, AUTO_UPDATE_DEBOUNCE_MS);
    }

    /** Any read moves the next check: Refresh and a manual Check count as one (upstream `ThrottledDelayer`). */
    private onDidReadCatalog(ok: boolean): void {
        if (this.started) this.scheduleCheck(UPDATES_CHECK_INTERVAL_MS);
        if (ok) this.eventuallyAutoUpdate();
    }

    private onDidChangeSetting(key: string): void {
        if (key === AUTO_CHECK_UPDATES_SETTING) {
            if (this.started) this.check();
            return;
        }
        // The delay timer goes with the old value: off — nothing to wait for; on, or a new delay — the pass plans anew.
        this.delayTimer.clear();
        this.eventuallyAutoUpdate();
        if (key === AUTO_UPDATE_SETTING) this.onDidChangeAutoUpdateEmitter.fire();
    }

    private scheduleCheck(ms: number): void {
        this.checkTimer.value = this.ports.clock.setTimeout(() => {
            this.check();
        }, ms);
    }

    /** The read moves the schedule itself (`onDidReadCatalog`); turning the setting on again checks right away. */
    private check(): void {
        if (this.ports.settings.autoCheckUpdates()) void this.ports.service.checkForUpdates({ background: true });
    }

    /** Upstream: the delay timer is a fresh check; without background checks — a pass over what is known. */
    private onDidEndDelay(): void {
        if (this.ports.settings.autoCheckUpdates()) this.check();
        else this.eventuallyAutoUpdate();
    }

    private async autoUpdate(): Promise<void> {
        if (this.updating) {
            this.again = true;
            return;
        }
        if (!this.isAutoUpdateEnabled()) return;
        const { clock, service, settings } = this.ports;
        const plan = planAutoUpdate(service.getOutdated(), settings.autoUpdateDelayHours(), clock.now());
        const retryIn = plan.retryIn;
        this.delayTimer.value =
            retryIn === undefined
                ? undefined
                : clock.setTimeout(() => {
                      this.onDidEndDelay();
                  }, retryIn);
        if (plan.ready.length === 0) return;
        this.updating = true;
        let result: IExtensionUpdateAllResult;
        try {
            result = await service.updateExtensions(plan.ready.map((entry) => entry.id));
        } finally {
            this.updating = false;
        }
        for (const { id, error } of result.failed) this.ports.logger.warn(`Could not auto-update ${id}: ${error}`);
        if (result.updated.length > 0) this.ports.onDidUpdate({ updated: result.updated, failed: [] });
        if (this.again) {
            this.again = false;
            this.eventuallyAutoUpdate();
        }
    }
}

export const ExtensionUpdateSchedulerDIToken = token<ExtensionUpdateScheduler>("ExtensionUpdateScheduler");
