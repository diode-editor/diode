import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Emitter } from "../../../../base/common/event.ts";
import { AdjustableClock } from "../../../../platform/clock/common/clock.ts";

import {
    AUTO_CHECK_UPDATES_SETTING,
    AUTO_UPDATE_DELAY_SETTING,
    AUTO_UPDATE_SETTING,
    type AutoUpdateValue,
} from "./extensionAutoUpdate.ts";
import type { IExtensionListEntry, IExtensionUpdateAllResult } from "./extensionsWorkbench.ts";
import {
    ExtensionUpdateScheduler,
    type IExtensionUpdateSchedulerPorts,
    UPDATES_CHECK_INTERVAL_MS,
} from "./extensionUpdateScheduler.ts";

const SECOND = 1000;
const HOUR = 60 * 60 * SECOND;
const START = Date.parse("2026-10-23T12:00:00Z");

function outdated(id: string, extra: Partial<IExtensionListEntry> = {}): IExtensionListEntry {
    return {
        id,
        publisher: "acme",
        name: id,
        displayName: id,
        description: "",
        kind: "native",
        support: undefined,
        latestVersion: "1.1.0",
        installedVersion: "1.0.0",
        availability: "outdated",
        pinned: false,
        needsReload: false,
        ...extra,
    };
}

class FakeService {
    public readonly onDidReadCatalogEmitter = new Emitter<boolean>();
    public readonly onDidReadCatalog = this.onDidReadCatalogEmitter.event;
    public outdated: IExtensionListEntry[] = [];
    /** What the next background check reads: `true` — the catalog, `false` — a failure. */
    public checkSucceeds = true;
    public readonly checks: unknown[] = [];
    public readonly updates: string[][] = [];
    public failing = new Set<string>();
    /** Resolves the running batch; unset means batches finish right away. */
    public hold: Promise<void> | undefined;

    public getOutdated(): readonly IExtensionListEntry[] {
        return this.outdated;
    }

    public checkForUpdates(options?: unknown): Promise<void> {
        this.checks.push(options);
        this.onDidReadCatalogEmitter.fire(this.checkSucceeds);
        return Promise.resolve();
    }

    public async updateExtensions(ids: readonly string[]): Promise<IExtensionUpdateAllResult> {
        this.updates.push([...ids]);
        await this.hold;
        const updated = ids.filter((id) => !this.failing.has(id)).map((id) => ({ id, version: "1.1.0" }));
        const failed = ids.filter((id) => this.failing.has(id)).map((id) => ({ id, error: "broken artifact" }));
        this.outdated = this.outdated.filter((e) => !ids.includes(e.id) || this.failing.has(e.id));
        return { updated, failed };
    }
}

class FakeSettings {
    public readonly onDidChangeEmitter = new Emitter<string>();
    public readonly onDidChange = this.onDidChangeEmitter.event;
    public values = { autoCheckUpdates: true, autoUpdate: "on" as AutoUpdateValue, autoUpdateDelayHours: 2 };

    public autoCheckUpdates(): boolean {
        return this.values.autoCheckUpdates;
    }

    public autoUpdate(): AutoUpdateValue {
        return this.values.autoUpdate;
    }

    public autoUpdateDelayHours(): number {
        return this.values.autoUpdateDelayHours;
    }

    public set(key: string, change: Partial<FakeSettings["values"]>): void {
        this.values = { ...this.values, ...change };
        this.onDidChangeEmitter.fire(key);
    }
}

describe("ExtensionUpdateScheduler", () => {
    let service: FakeService;
    let settings: FakeSettings;
    let clock: AdjustableClock;
    let results: IExtensionUpdateAllResult[];
    let warnings: string[];
    let scheduler: ExtensionUpdateScheduler;

    beforeEach(() => {
        vi.useFakeTimers({ now: START });
        service = new FakeService();
        settings = new FakeSettings();
        clock = new AdjustableClock();
        results = [];
        warnings = [];
        const ports: IExtensionUpdateSchedulerPorts = {
            service,
            settings,
            clock,
            logger: { warn: (message: string) => warnings.push(message) },
            onDidUpdate: (result) => results.push(result),
        };
        scheduler = new ExtensionUpdateScheduler(ports);
    });

    afterEach(() => {
        scheduler.dispose();
        vi.useRealTimers();
    });

    /** Time passes and every promise it starts settles. */
    async function wait(ms: number): Promise<void> {
        await vi.advanceTimersByTimeAsync(ms);
    }

    describe("the check schedule (US-3.1, US-3.2, US-3.3)", () => {
        it("nothing before start: the network waits for the `eventually` phase", async () => {
            await wait(UPDATES_CHECK_INTERVAL_MS * 2);

            expect(service.checks).toEqual([]);
        });

        it("a read before start (the viewlet shown early) does not start the schedule either", async () => {
            service.onDidReadCatalogEmitter.fire(true);
            await wait(UPDATES_CHECK_INTERVAL_MS * 2);

            expect(service.checks).toEqual([]);
        });

        it("the first check is 10 s after start, in the background", async () => {
            scheduler.start();
            await wait(10 * SECOND - 1);
            expect(service.checks).toEqual([]);

            await wait(1);

            expect(service.checks).toEqual([{ background: true }]);
        });

        it("then every 12 hours", async () => {
            scheduler.start();
            await wait(10 * SECOND);
            await wait(12 * HOUR - 1);
            expect(service.checks).toHaveLength(1);

            await wait(1);
            expect(service.checks).toHaveLength(2);
            await wait(12 * HOUR);
            expect(service.checks).toHaveLength(3);
        });

        it("a manual read in between moves the next check to 12 hours after it (upstream ThrottledDelayer)", async () => {
            scheduler.start();
            await wait(10 * SECOND);
            await wait(6 * HOUR);
            // Refresh or `Check for Extension Updates`.
            service.onDidReadCatalogEmitter.fire(true);

            await wait(12 * HOUR - 1);
            expect(service.checks).toHaveLength(1);
            await wait(1);
            expect(service.checks).toHaveLength(2);
        });

        it("a failed check keeps the schedule: the next try is in 12 hours (US-3.10)", async () => {
            service.checkSucceeds = false;
            scheduler.start();
            await wait(10 * SECOND);
            await wait(12 * HOUR);

            expect(service.checks).toHaveLength(2);
        });

        it("`autoCheckUpdates: false` — no check at all", async () => {
            settings.values.autoCheckUpdates = false;
            scheduler.start();
            await wait(10 * SECOND + 36 * HOUR);

            expect(service.checks).toEqual([]);
        });

        it("turning `autoCheckUpdates` on checks right away", async () => {
            settings.values.autoCheckUpdates = false;
            scheduler.start();
            await wait(HOUR);

            settings.set(AUTO_CHECK_UPDATES_SETTING, { autoCheckUpdates: true });
            await wait(0);

            expect(service.checks).toEqual([{ background: true }]);
        });

        it("turning it on before start does not check yet: the first check still waits for start", async () => {
            settings.values.autoCheckUpdates = false;
            settings.set(AUTO_CHECK_UPDATES_SETTING, { autoCheckUpdates: true });
            await wait(HOUR);

            expect(service.checks).toEqual([]);
        });

        it("turning it off is not a check", async () => {
            scheduler.start();
            settings.set(AUTO_CHECK_UPDATES_SETTING, { autoCheckUpdates: false });
            await wait(0);

            expect(service.checks).toEqual([]);
        });

        it("start twice is one schedule", async () => {
            scheduler.start();
            scheduler.start();
            await wait(10 * SECOND);

            expect(service.checks).toHaveLength(1);
        });

        it("dispose stops the schedule", async () => {
            scheduler.start();
            scheduler.dispose();
            await wait(10 * SECOND + 12 * HOUR);

            expect(service.checks).toEqual([]);
        });
    });

    describe("auto update (US-3.4, US-3.5, US-3.7)", () => {
        it("after a successful read the outdated ones are installed in one batch with one result", async () => {
            service.outdated = [outdated("acme.a"), outdated("acme.b")];

            service.onDidReadCatalogEmitter.fire(true);
            // Upstream `autoUpdateDelayer`: a second, so a manual Check still sees what was outdated.
            await wait(SECOND - 1);
            expect(service.updates).toEqual([]);
            await wait(1);

            expect(service.updates).toEqual([["acme.a", "acme.b"]]);
            expect(results).toEqual([
                {
                    updated: [
                        { id: "acme.a", version: "1.1.0" },
                        { id: "acme.b", version: "1.1.0" },
                    ],
                    failed: [],
                },
            ]);
        });

        it("the background check leads to the same auto-update", async () => {
            service.outdated = [outdated("acme.a")];
            scheduler.start();

            await wait(10 * SECOND + SECOND);

            expect(service.updates).toEqual([["acme.a"]]);
        });

        it("a failed read updates nothing", async () => {
            service.outdated = [outdated("acme.a")];

            service.onDidReadCatalogEmitter.fire(false);
            await wait(SECOND);

            expect(service.updates).toEqual([]);
        });

        it("reads in quick succession are one batch", async () => {
            service.outdated = [outdated("acme.a")];

            service.onDidReadCatalogEmitter.fire(true);
            await wait(SECOND / 2);
            service.onDidReadCatalogEmitter.fire(true);
            await wait(SECOND);

            expect(service.updates).toEqual([["acme.a"]]);
        });

        it("pinned ones are skipped (US-3.5); nothing left — no batch and no result", async () => {
            service.outdated = [outdated("acme.a", { pinned: true })];

            service.onDidReadCatalogEmitter.fire(true);
            await wait(SECOND);

            expect(service.updates).toEqual([]);
            expect(results).toEqual([]);
        });

        it("`autoUpdate: off` — nothing is installed", async () => {
            settings.values.autoUpdate = "off";
            service.outdated = [outdated("acme.a")];

            service.onDidReadCatalogEmitter.fire(true);
            await wait(SECOND);

            expect(service.updates).toEqual([]);
        });

        it("failures go to the log and not to the result; a batch with nothing updated reports nothing", async () => {
            service.outdated = [outdated("acme.a"), outdated("acme.b")];
            service.failing = new Set(["acme.a", "acme.b"]);

            service.onDidReadCatalogEmitter.fire(true);
            await wait(SECOND);

            expect(results).toEqual([]);
            expect(warnings).toEqual([
                "Could not auto-update acme.a: broken artifact",
                "Could not auto-update acme.b: broken artifact",
            ]);
        });

        it("a failed one is not retried by an extra pass: it waits for the next read", async () => {
            service.outdated = [outdated("acme.a")];
            service.failing = new Set(["acme.a"]);

            service.onDidReadCatalogEmitter.fire(true);
            await wait(10 * SECOND);
            expect(service.updates).toEqual([["acme.a"]]);

            service.onDidReadCatalogEmitter.fire(true);
            await wait(10 * SECOND);
            expect(service.updates).toEqual([["acme.a"], ["acme.a"]]);
        });

        it("a partial failure reports only the updated ones", async () => {
            service.outdated = [outdated("acme.a"), outdated("acme.b")];
            service.failing = new Set(["acme.a"]);

            service.onDidReadCatalogEmitter.fire(true);
            await wait(SECOND);

            expect(results).toEqual([{ updated: [{ id: "acme.b", version: "1.1.0" }], failed: [] }]);
        });

        it("a read during a running batch makes one more pass after it, not a parallel one", async () => {
            let release!: () => void;
            service.hold = new Promise((resolve) => {
                release = resolve;
            });
            service.outdated = [outdated("acme.a")];
            service.onDidReadCatalogEmitter.fire(true);
            await wait(SECOND);
            service.outdated = [...service.outdated, outdated("acme.b")];
            service.onDidReadCatalogEmitter.fire(true);
            await wait(SECOND);
            expect(service.updates).toEqual([["acme.a"]]);

            // acme.b fails and stays outdated: the extra pass is one, not a loop of retries.
            service.failing = new Set(["acme.b"]);
            service.hold = undefined;
            release();
            await wait(10 * SECOND);

            expect(service.updates).toEqual([["acme.a"], ["acme.b"]]);
        });

        it("eventuallyAutoUpdate (the page toggle) runs a pass over the current catalog", async () => {
            service.outdated = [outdated("acme.a")];

            scheduler.eventuallyAutoUpdate();
            await wait(SECOND);

            expect(service.updates).toEqual([["acme.a"]]);
            expect(service.checks).toEqual([]);
        });
    });

    describe("the publish delay (US-3.6)", () => {
        function publishedAgo(hours: number): string {
            return new Date(clock.now() - hours * HOUR).toISOString();
        }

        it("a version published 30 min ago waits 1.5 h, then a check installs it", async () => {
            service.outdated = [outdated("acme.a", { latestPublishedAt: publishedAgo(0.5) })];
            service.onDidReadCatalogEmitter.fire(true);
            await wait(SECOND);
            expect(service.updates).toEqual([]);

            await wait(1.5 * HOUR - SECOND);
            // Upstream: the timer is `eventuallyCheckForUpdates(true)`, a fresh check.
            expect(service.checks).toEqual([{ background: true }]);
            await wait(SECOND);

            expect(service.updates).toEqual([["acme.a"]]);
        });

        it("with `autoCheckUpdates: false` the timer re-plans over the current catalog, without the network", async () => {
            settings.values.autoCheckUpdates = false;
            service.outdated = [outdated("acme.a", { latestPublishedAt: publishedAgo(0.5) })];
            service.onDidReadCatalogEmitter.fire(true);
            await wait(SECOND);

            await wait(1.5 * HOUR);

            expect(service.checks).toEqual([]);
            expect(service.updates).toEqual([["acme.a"]]);
        });

        it("the moved clock counts: the e2e skips the hours with `Diode.advanceClock`", async () => {
            service.outdated = [outdated("acme.a", { latestPublishedAt: publishedAgo(0.5) })];
            service.onDidReadCatalogEmitter.fire(true);
            await wait(SECOND);

            clock.advance(1.5 * HOUR);
            await wait(SECOND);

            expect(service.updates).toEqual([["acme.a"]]);
        });

        it("`autoUpdateDelay: 0` installs it right away", async () => {
            settings.values.autoUpdateDelayHours = 0;
            service.outdated = [outdated("acme.a", { latestPublishedAt: publishedAgo(0.01) })];

            service.onDidReadCatalogEmitter.fire(true);
            await wait(SECOND);

            expect(service.updates).toEqual([["acme.a"]]);
        });

        it("a smaller delay set while waiting installs it now", async () => {
            service.outdated = [outdated("acme.a", { latestPublishedAt: publishedAgo(0.5) })];
            service.onDidReadCatalogEmitter.fire(true);
            await wait(SECOND);

            settings.set(AUTO_UPDATE_DELAY_SETTING, { autoUpdateDelayHours: 0.25 });
            await wait(SECOND);

            expect(service.updates).toEqual([["acme.a"]]);
        });

        it("a larger delay set while waiting drops the old timer and waits for the new end", async () => {
            settings.values.autoCheckUpdates = false;
            service.outdated = [outdated("acme.a", { latestPublishedAt: publishedAgo(0.5) })];
            service.onDidReadCatalogEmitter.fire(true);
            await wait(SECOND);

            settings.set(AUTO_UPDATE_DELAY_SETTING, { autoUpdateDelayHours: 4 });
            await wait(1.5 * HOUR);
            expect(service.updates).toEqual([]);
            await wait(2 * HOUR);

            expect(service.updates).toEqual([["acme.a"]]);
        });
    });

    describe("turning auto update off and on (US-3.9)", () => {
        it("off while waiting for the delay: nothing is installed, the timer is gone", async () => {
            settings.values.autoCheckUpdates = false;
            service.outdated = [outdated("acme.a", { latestPublishedAt: new Date(START - 0.5 * HOUR).toISOString() })];
            service.onDidReadCatalogEmitter.fire(true);
            await wait(SECOND);

            settings.set(AUTO_UPDATE_SETTING, { autoUpdate: "off" });
            await wait(3 * HOUR);

            expect(service.updates).toEqual([]);
        });

        it("off while waiting with background checks on: the delay timer does not check either", async () => {
            service.outdated = [outdated("acme.a", { latestPublishedAt: new Date(START - 0.5 * HOUR).toISOString() })];
            service.onDidReadCatalogEmitter.fire(true);
            await wait(SECOND);

            settings.set(AUTO_UPDATE_SETTING, { autoUpdate: "off" });
            await wait(3 * HOUR);

            expect(service.checks).toEqual([]);
            expect(service.updates).toEqual([]);
        });

        it("off between the read and the batch: nothing is installed", async () => {
            service.outdated = [outdated("acme.a")];
            service.onDidReadCatalogEmitter.fire(true);

            settings.set(AUTO_UPDATE_SETTING, { autoUpdate: "off" });
            await wait(SECOND);

            expect(service.updates).toEqual([]);
        });

        it("on again: auto-update right away over the current catalog", async () => {
            settings.values.autoUpdate = "off";
            service.outdated = [outdated("acme.a")];
            service.onDidReadCatalogEmitter.fire(true);
            await wait(SECOND);

            settings.set(AUTO_UPDATE_SETTING, { autoUpdate: "on" });
            await wait(SECOND);

            expect(service.updates).toEqual([["acme.a"]]);
            expect(service.checks).toEqual([]);
        });

        it("tells the page: isAutoUpdateEnabled and onDidChangeAutoUpdate", () => {
            const seen: boolean[] = [];
            scheduler.onDidChangeAutoUpdate(() => seen.push(scheduler.isAutoUpdateEnabled()));

            expect(scheduler.isAutoUpdateEnabled()).toBe(true);
            settings.set(AUTO_UPDATE_SETTING, { autoUpdate: "off" });
            settings.set(AUTO_UPDATE_DELAY_SETTING, { autoUpdateDelayHours: 1 });
            settings.set(AUTO_UPDATE_SETTING, { autoUpdate: "on" });

            expect(seen).toEqual([false, true]);
        });
    });
});
