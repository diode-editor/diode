import { describe, expect, it } from "vitest";

import type { IRegistryVersion } from "../../../../platform/extensionManagement/common/registryFormat.ts";

import { describeVersionPicks } from "./extensionVersionPicks.ts";

const NOW = Date.parse("2026-10-23T12:00:00Z");

function version(v: string, publishedAt?: string): IRegistryVersion {
    return {
        version: v,
        engines: { vscode: "^1.90.0" },
        artifact: { type: "path", path: `artifacts/acme.demo-${v}.vsix` },
        sha256: "a".repeat(64),
        publishedAt,
    };
}

describe("describeVersionPicks", () => {
    it("US-1.1: a row per version in the given order, the date relative like upstream fromNow(date, true)", () => {
        const picks = describeVersionPicks(
            [version("1.1.0", "2026-10-21T12:00:00Z"), version("1.0.0", "2026-08-20T12:00:00Z")],
            null,
            NOW,
        );

        expect(picks.map((p) => [p.label, p.description])).toEqual([
            ["1.1.0", "2 days ago"],
            ["1.0.0", "2 mos ago"],
        ]);
    });

    it("the installed version is marked current, after the date", () => {
        const picks = describeVersionPicks(
            [version("1.1.0", "2026-10-21T12:00:00Z"), version("1.0.0", "2026-08-20T12:00:00Z")],
            "1.1.0",
            NOW,
        );

        expect(picks.map((p) => p.description)).toEqual(["2 days ago (current)", "2 mos ago"]);
    });

    it("no date or an unparsable one leaves only the current mark, or nothing", () => {
        const picks = describeVersionPicks(
            [version("1.2.0"), version("1.1.0", "yesterday"), version("1.0.0")],
            "1.0.0",
            NOW,
        );

        expect(picks.map((p) => p.description)).toEqual([undefined, undefined, "(current)"]);
    });

    it("nothing to pick is an empty list", () => {
        expect(describeVersionPicks([], "1.0.0", NOW)).toEqual([]);
    });
});
