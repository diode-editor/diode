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

const IDLE = { busy: false, needsReload: false, autoUpdate: true };

const ANOTHER_VERSION = { kind: "installAnotherVersion", label: "Install Specific Version...", enabled: true };
const AUTO_UPDATE = { kind: "toggleAutoUpdate", label: "[x] Auto Update", enabled: true };

describe("describeExtensionButtons", () => {
    it("not installed — Install, then the version picker (US-1.5)", () => {
        expect(describeExtensionButtons(entry(), IDLE)).toEqual([
            { kind: "install", label: "Install", enabled: true },
            ANOTHER_VERSION,
        ]);
    });

    it("latest version installed — the version picker, uninstall and the Auto Update toggle", () => {
        const entryValue = entry({ installedVersion: "1.0.0", availability: "installed" });
        expect(describeExtensionButtons(entryValue, IDLE)).toEqual([
            ANOTHER_VERSION,
            { kind: "uninstall", label: "Uninstall", enabled: true },
            AUTO_UPDATE,
        ]);
    });

    it("a newer version exists — the update button names it and comes first", () => {
        const entryValue = entry({ installedVersion: "0.9.0", availability: "outdated" });
        expect(describeExtensionButtons(entryValue, IDLE)).toEqual([
            { kind: "update", label: "Update to 1.0.0", enabled: true },
            ANOTHER_VERSION,
            { kind: "uninstall", label: "Uninstall", enabled: true },
            AUTO_UPDATE,
        ]);
    });

    it("US-2.3: an installed version newer than the target is not an update", () => {
        const entryValue = entry({ installedVersion: "1.5.0", latestVersion: "1.1.0", availability: "installed" });
        expect(describeExtensionButtons(entryValue, IDLE).map((b) => b.label)).toEqual([
            "Install Specific Version...",
            "Uninstall",
            "[x] Auto Update",
        ]);
    });

    it("US-1.7: a pinned outdated version still offers the update (decision D1, like upstream)", () => {
        const entryValue = entry({ installedVersion: "0.9.0", availability: "outdated", pinned: true });
        expect(describeExtensionButtons(entryValue, IDLE).map((b) => b.label)).toEqual([
            "Update to 1.0.0",
            "Install Specific Version...",
            "Uninstall",
            "[ ] Auto Update",
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
            AUTO_UPDATE,
        ]);
    });

    it("neither in the registry nor on disk — no actions: nothing to install", () => {
        const entryValue = entry({ latestVersion: null, installedVersion: null });
        expect(describeExtensionButtons(entryValue, IDLE)).toEqual([]);
    });

    it("US-1.14: sideloaded — uninstall only, no version picker and no Auto Update (US-3.8)", () => {
        const entryValue = entry({ latestVersion: null, installedVersion: "0.1.0", availability: "installed" });
        expect(describeExtensionButtons(entryValue, IDLE)).toEqual([
            { kind: "uninstall", label: "Uninstall", enabled: true },
        ]);
    });

    it("after install reload window comes first — it is the user's next step", () => {
        const entryValue = entry({ installedVersion: "1.0.0", availability: "installed" });
        expect(describeExtensionButtons(entryValue, { ...IDLE, needsReload: true })).toEqual([
            { kind: "reload", label: "Reload Window", enabled: true },
            ANOTHER_VERSION,
            { kind: "uninstall", label: "Uninstall", enabled: true },
            AUTO_UPDATE,
        ]);
    });

    it("during an operation all buttons are disabled, including reload and the version picker", () => {
        const entryValue = entry({ installedVersion: "0.9.0", availability: "outdated" });
        const buttons = describeExtensionButtons(entryValue, { ...IDLE, busy: true, needsReload: true });

        expect(buttons.map((b) => b.kind)).toEqual([
            "reload",
            "update",
            "installAnotherVersion",
            "uninstall",
            "toggleAutoUpdate",
        ]);
        expect(buttons.every((b) => !b.enabled)).toBe(true);
    });

    describe("Auto Update toggle (US-3.8, decision J2: checked is not pinned)", () => {
        it("not pinned — checked; pinned — unchecked; both can be pressed", () => {
            const installed = entry({ installedVersion: "1.0.0", availability: "installed" });

            expect(describeExtensionButtons(installed, IDLE).at(-1)).toEqual(AUTO_UPDATE);
            expect(describeExtensionButtons({ ...installed, pinned: true }, IDLE).at(-1)).toEqual({
                kind: "toggleAutoUpdate",
                label: "[ ] Auto Update",
                enabled: true,
            });
        });

        it("`extensions.autoUpdate: off` — visible, unchecked and disabled, with the setting named", () => {
            const installed = entry({ installedVersion: "1.0.0", availability: "installed" });

            expect(describeExtensionButtons(installed, { ...IDLE, autoUpdate: false }).at(-1)).toEqual({
                kind: "toggleAutoUpdate",
                label: "[ ] Auto Update (extensions.autoUpdate is off)",
                enabled: false,
            });
        });

        it("not installed — no toggle", () => {
            expect(describeExtensionButtons(entry(), IDLE).map((b) => b.kind)).not.toContain("toggleAutoUpdate");
        });
    });
});
