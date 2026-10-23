import { describe, expect, it } from "vitest";

import { planAutoUpdate, toAutoUpdateValue } from "./extensionAutoUpdate.ts";
import type { IExtensionListEntry } from "./extensionsWorkbench.ts";

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-10-23T12:00:00Z");

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
        latestPublishedAt: null,
        ...extra,
    };
}

function hoursAgo(hours: number): string {
    return new Date(NOW - hours * HOUR).toISOString();
}

function ids(entries: readonly IExtensionListEntry[]): string[] {
    return entries.map((e) => e.id);
}

describe("toAutoUpdateValue (upstream getAutoUpdateValue)", () => {
    it.each([
        ["on", "on"],
        ["off", "off"],
        [true, "on"],
        [false, "off"],
        // Upstream's older values: anything but off/false/onlySelectedExtensions is on.
        ["onlySelectedExtensions", "off"],
        ["onlyEnabledExtensions", "on"],
        [undefined, "on"],
    ] as const)("%s reads as %s", (raw, expected) => {
        expect(toAutoUpdateValue(raw)).toBe(expected);
    });
});

describe("planAutoUpdate", () => {
    it("pinned entries are not candidates (upstream shouldAutoUpdateExtension)", () => {
        const plan = planAutoUpdate([outdated("a"), outdated("b", { pinned: true })], 0, NOW);

        expect(ids(plan.ready)).toEqual(["a"]);
        expect(plan.retryIn).toBeUndefined();
    });

    it("a version published within the delay waits for the rest of it; an older one goes now", () => {
        const plan = planAutoUpdate(
            [
                outdated("fresh", { latestPublishedAt: hoursAgo(0.5) }),
                outdated("old", { latestPublishedAt: hoursAgo(3) }),
            ],
            2,
            NOW,
        );

        expect(ids(plan.ready)).toEqual(["old"]);
        expect(plan.retryIn).toBe(1.5 * HOUR);
    });

    it("the retry is for the soonest of the delayed ones", () => {
        const plan = planAutoUpdate(
            [outdated("a", { latestPublishedAt: hoursAgo(0.5) }), outdated("b", { latestPublishedAt: hoursAgo(1.75) })],
            2,
            NOW,
        );

        expect(ids(plan.ready)).toEqual([]);
        expect(plan.retryIn).toBe(0.25 * HOUR);
    });

    it("published this very moment — the whole delay", () => {
        const plan = planAutoUpdate([outdated("a", { latestPublishedAt: new Date(NOW).toISOString() })], 2, NOW);

        expect(ids(plan.ready)).toEqual([]);
        expect(plan.retryIn).toBe(2 * HOUR);
    });

    it("exactly at the end of the delay it goes", () => {
        const plan = planAutoUpdate([outdated("a", { latestPublishedAt: hoursAgo(2) })], 2, NOW);

        expect(ids(plan.ready)).toEqual(["a"]);
        expect(plan.retryIn).toBeUndefined();
    });

    it("one millisecond before the end it waits that millisecond", () => {
        const plan = planAutoUpdate(
            [outdated("a", { latestPublishedAt: new Date(NOW - 2 * HOUR + 1).toISOString() })],
            2,
            NOW,
        );

        expect(ids(plan.ready)).toEqual([]);
        expect(plan.retryIn).toBe(1);
    });

    it("no date, an unreadable date or a date in the future (clock skew) — no delay, like upstream", () => {
        const plan = planAutoUpdate(
            [
                outdated("none"),
                outdated("garbage", { latestPublishedAt: "yesterday" }),
                outdated("future", { latestPublishedAt: new Date(NOW + HOUR).toISOString() }),
            ],
            2,
            NOW,
        );

        expect(ids(plan.ready)).toEqual(["none", "garbage", "future"]);
        expect(plan.retryIn).toBeUndefined();
    });

    it("an unknown date (the metadata was not read) waits for the next read, with no timer (QA #796 bug 2)", () => {
        const plan = planAutoUpdate([outdated("a", { latestPublishedAt: undefined }), outdated("b")], 2, NOW);

        expect(ids(plan.ready)).toEqual(["b"]);
        expect(plan.retryIn).toBeUndefined();
    });

    it("an unknown date waits even with `autoUpdateDelay: 0`", () => {
        expect(ids(planAutoUpdate([outdated("a", { latestPublishedAt: undefined })], 0, NOW).ready)).toEqual([]);
    });

    it("`autoUpdateDelay: 0` — a version published a second ago goes now", () => {
        const plan = planAutoUpdate([outdated("a", { latestPublishedAt: new Date(NOW - 1000).toISOString() })], 0, NOW);

        expect(ids(plan.ready)).toEqual(["a"]);
    });

    it("a pinned entry does not set a retry even when its version is fresh", () => {
        const plan = planAutoUpdate([outdated("a", { pinned: true, latestPublishedAt: hoursAgo(0.5) })], 2, NOW);

        expect(plan.retryIn).toBeUndefined();
    });
});
