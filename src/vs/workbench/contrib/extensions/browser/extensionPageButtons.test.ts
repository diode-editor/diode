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
        needsReload: false,
        ...overrides,
    };
}

const IDLE = { busy: false, needsReload: false };

describe("describeExtensionButtons", () => {
    it("not installed — a single Install button", () => {
        expect(describeExtensionButtons(entry(), IDLE)).toEqual([{ kind: "install", label: "Install", enabled: true }]);
    });

    it("latest version installed — uninstall only", () => {
        const entryValue = entry({ installedVersion: "1.0.0", availability: "installed" });
        expect(describeExtensionButtons(entryValue, IDLE)).toEqual([
            { kind: "uninstall", label: "Uninstall", enabled: true },
        ]);
    });

    it("a newer version exists — the update button names it and comes before uninstall", () => {
        const entryValue = entry({ installedVersion: "0.9.0", availability: "outdated" });
        expect(describeExtensionButtons(entryValue, IDLE)).toEqual([
            { kind: "update", label: "Update to 1.0.0", enabled: true },
            { kind: "uninstall", label: "Uninstall", enabled: true },
        ]);
    });

    it("an incompatible one cannot be installed: the button is visible but disabled", () => {
        expect(describeExtensionButtons(entry({ availability: "incompatible" }), IDLE)).toEqual([
            { kind: "install", label: "Install", enabled: false },
        ]);
    });

    it("an installed incompatible one can only be uninstalled — nothing to update to", () => {
        const entryValue = entry({ installedVersion: "0.9.0", availability: "incompatible" });
        expect(describeExtensionButtons(entryValue, IDLE)).toEqual([
            { kind: "uninstall", label: "Uninstall", enabled: true },
        ]);
    });

    it("neither in the registry nor on disk — no actions: nothing to install", () => {
        const entryValue = entry({ latestVersion: null, installedVersion: null });
        expect(describeExtensionButtons(entryValue, IDLE)).toEqual([]);
    });

    it("sideloaded — uninstall only", () => {
        const entryValue = entry({ latestVersion: null, installedVersion: "0.1.0", availability: "installed" });
        expect(describeExtensionButtons(entryValue, IDLE)).toEqual([
            { kind: "uninstall", label: "Uninstall", enabled: true },
        ]);
    });

    it("after install reload window comes first — it is the user's next step", () => {
        const entryValue = entry({ installedVersion: "1.0.0", availability: "installed" });
        expect(describeExtensionButtons(entryValue, { busy: false, needsReload: true })).toEqual([
            { kind: "reload", label: "Reload Window", enabled: true },
            { kind: "uninstall", label: "Uninstall", enabled: true },
        ]);
    });

    it("during an operation all buttons are disabled, including reload", () => {
        const entryValue = entry({ installedVersion: "0.9.0", availability: "outdated" });
        const buttons = describeExtensionButtons(entryValue, { busy: true, needsReload: true });

        expect(buttons.map((b) => b.kind)).toEqual(["reload", "update", "uninstall"]);
        expect(buttons.every((b) => !b.enabled)).toBe(true);
    });
});
