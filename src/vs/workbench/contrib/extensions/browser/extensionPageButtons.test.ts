import { describe, expect, it } from "vitest";

import type { IExtensionListEntry } from "../common/extensionsWorkbench.ts";

import { describeExtensionButtons } from "./extensionPageButtons.ts";

function entry(overrides: Partial<IExtensionListEntry> = {}): IExtensionListEntry {
    return {
        id: "acme.tools",
        publisher: "acme",
        name: "tools",
        displayName: "Acme Tools",
        description: "Tools for acme",
        kind: "native",
        support: undefined,
        latestVersion: "1.0.0",
        installedVersion: null,
        availability: "available",
        pinned: false,
        needsReload: false,
        ...overrides,
    };
}

const IDLE = { busy: false, needsReload: false };

const ANOTHER_VERSION = { kind: "installAnotherVersion", label: "Install Specific Version...", enabled: true };

describe("describeExtensionButtons", () => {
    it("not installed — Install, then the version picker (US-1.5)", () => {
        expect(describeExtensionButtons(entry(), IDLE)).toEqual([
            { kind: "install", label: "Install", enabled: true },
            ANOTHER_VERSION,
        ]);
    });

    it("latest version installed — the version picker and uninstall", () => {
        const entryValue = entry({ installedVersion: "1.0.0", availability: "installed" });
        expect(describeExtensionButtons(entryValue, IDLE)).toEqual([
            ANOTHER_VERSION,
            { kind: "uninstall", label: "Uninstall", enabled: true },
        ]);
    });

    it("a newer version exists — the update button names it and comes first", () => {
        const entryValue = entry({ installedVersion: "0.9.0", availability: "outdated" });
        expect(describeExtensionButtons(entryValue, IDLE)).toEqual([
            { kind: "update", label: "Update to 1.0.0", enabled: true },
            ANOTHER_VERSION,
            { kind: "uninstall", label: "Uninstall", enabled: true },
        ]);
    });

    it("US-1.7: a pinned outdated version still offers the update (decision D1, like upstream)", () => {
        const entryValue = entry({ installedVersion: "0.9.0", availability: "outdated", pinned: true });
        expect(describeExtensionButtons(entryValue, IDLE).map((b) => b.label)).toEqual([
            "Update to 1.0.0",
            "Install Specific Version...",
            "Uninstall",
        ]);
    });

    it("an incompatible one cannot be installed as latest, but an older compatible version may exist", () => {
        expect(describeExtensionButtons(entry({ availability: "incompatible" }), IDLE)).toEqual([
            { kind: "install", label: "Install", enabled: false },
            ANOTHER_VERSION,
        ]);
    });

    it("an installed incompatible one — nothing to update to", () => {
        const entryValue = entry({ installedVersion: "0.9.0", availability: "incompatible" });
        expect(describeExtensionButtons(entryValue, IDLE)).toEqual([
            ANOTHER_VERSION,
            { kind: "uninstall", label: "Uninstall", enabled: true },
        ]);
    });

    it("neither in the registry nor on disk — no actions: nothing to install", () => {
        const entryValue = entry({ latestVersion: null, installedVersion: null });
        expect(describeExtensionButtons(entryValue, IDLE)).toEqual([]);
    });

    it("US-1.14: sideloaded — uninstall only, no version picker", () => {
        const entryValue = entry({ latestVersion: null, installedVersion: "0.1.0", availability: "installed" });
        expect(describeExtensionButtons(entryValue, IDLE)).toEqual([
            { kind: "uninstall", label: "Uninstall", enabled: true },
        ]);
    });

    it("after install reload window comes first — it is the user's next step", () => {
        const entryValue = entry({ installedVersion: "1.0.0", availability: "installed" });
        expect(describeExtensionButtons(entryValue, { busy: false, needsReload: true })).toEqual([
            { kind: "reload", label: "Reload Window", enabled: true },
            ANOTHER_VERSION,
            { kind: "uninstall", label: "Uninstall", enabled: true },
        ]);
    });

    it("during an operation all buttons are disabled, including reload and the version picker", () => {
        const entryValue = entry({ installedVersion: "0.9.0", availability: "outdated" });
        const buttons = describeExtensionButtons(entryValue, { busy: true, needsReload: true });

        expect(buttons.map((b) => b.kind)).toEqual(["reload", "update", "installAnotherVersion", "uninstall"]);
        expect(buttons.every((b) => !b.enabled)).toBe(true);
    });
});
