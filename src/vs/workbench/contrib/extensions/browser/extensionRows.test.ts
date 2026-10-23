import { Point } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import type { IExtensionListEntry } from "../common/extensionsWorkbench.ts";

import { buildExtensionRow, buildGroupRow, describeExtensionRow, type IExtensionRowStyles } from "./extensionRows.ts";

const STYLES: IExtensionRowStyles = {
    dimFg: "descriptionForeground",
    updateFg: "textLink.foreground",
    warningFg: "editorWarning.foreground",
};

function entry(overrides: Partial<IExtensionListEntry> = {}): IExtensionListEntry {
    return {
        id: "acme.tools",
        publisher: "acme",
        name: "tools",
        displayName: "Acme Tools",
        description: "",
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

describe("describeExtensionRow", () => {
    it("not installed — name and registry version, no badge", () => {
        const row = describeExtensionRow(entry());
        expect(row.text).toBe("Acme Tools  1.0.0");
        expect(row.badge).toBeNull();
        // The version span points exactly at it; the row paints it dimmed by this span.
        expect(row.version).toEqual({ start: 12, length: 5 });
        expect(row.text.slice(row.version.start, row.version.start + row.version.length)).toBe("1.0.0");
    });

    it("latest version installed — Installed badge", () => {
        const row = describeExtensionRow(entry({ installedVersion: "1.0.0", availability: "installed" }));
        expect(row.text).toBe("Acme Tools  1.0.0  Installed");
        expect(row.badge?.kind).toBe("installed");
    });

    it("an update exists — the badge names the version install will update to", () => {
        const row = describeExtensionRow(entry({ installedVersion: "0.9.0", availability: "outdated" }));
        expect(row.text).toBe("Acme Tools  0.9.0  Update 1.0.0");
        expect(row.badge).toEqual({ start: 19, length: 12, kind: "update" });
        expect(row.text.slice(row.badge!.start, row.badge!.start + row.badge!.length)).toBe("Update 1.0.0");
    });

    it("US-2.3: an installed version newer than the target is Installed, not an update", () => {
        const row = describeExtensionRow(
            entry({ installedVersion: "1.5.0", latestVersion: "1.1.0", availability: "installed" }),
        );
        expect(row.text).toBe("Acme Tools  1.5.0  Installed");
    });

    it("reload pending — the badge says so before anything else", () => {
        // The installed version is visible, but it starts working only after
        // a window reload, which is the key fact about such an entry.
        const row = describeExtensionRow(
            entry({ installedVersion: "1.0.0", availability: "installed", needsReload: true }),
        );
        expect(row.text).toBe("Acme Tools  1.0.0  Reload");
        expect(row.badge?.kind).toBe("reload");
    });

    it("incompatible — a badge instead of update, even if the version is old", () => {
        const row = describeExtensionRow(entry({ installedVersion: "0.9.0", availability: "incompatible" }));
        expect(row.text).toBe("Acme Tools  0.9.0  Incompatible");
        expect(row.badge?.kind).toBe("incompatible");
    });

    it("sideloaded — Installed badge without update", () => {
        const row = describeExtensionRow(
            entry({ latestVersion: null, installedVersion: "0.1.0", availability: "installed" }),
        );
        expect(row.text).toBe("Acme Tools  0.1.0  Installed");
    });

    it("no version at all — the row is just the name", () => {
        const row = describeExtensionRow(entry({ latestVersion: null, installedVersion: null }));
        expect(row.text).toBe("Acme Tools");
        expect(row.version.length).toBe(0);
    });
});

describe("list rows", () => {
    it("a row carries its id and layout text", () => {
        const row = buildExtensionRow("row-1", entry(), STYLES);
        expect(row.id).toBe("row-1");
        expect(row.getText()).toBe("Acme Tools  1.0.0");
    });

    it("each badge kind gets its own color", () => {
        const fgOfBadge = (e: IExtensionListEntry): number => {
            const row = buildExtensionRow("row-1", e, STYLES);
            const screen = renderElement(row, 40, 1, { themeVars: true });
            return screen.getFgAt(new Point(describeExtensionRow(e).badge!.start, 0));
        };

        const installed = fgOfBadge(entry({ installedVersion: "1.0.0", availability: "installed" }));
        const update = fgOfBadge(entry({ installedVersion: "0.9.0", availability: "outdated" }));
        const incompatible = fgOfBadge(entry({ availability: "incompatible" }));

        expect(new Set([installed, update, incompatible]).size).toBe(3);
    });

    it("highlighting does not spill past the version span", () => {
        const entryWithBadge = entry({ availability: "incompatible" });
        const row = buildExtensionRow("row-1", entryWithBadge, STYLES);
        const screen = renderElement(row, 40, 1, { themeVars: true });
        const layout = describeExtensionRow(entryWithBadge);

        // The space right after the version has the row color, not the dimmed one.
        const afterVersion = layout.version.start + layout.version.length;
        expect(screen.getFgAt(new Point(afterVersion, 0))).toBe(screen.getFgAt(new Point(0, 0)));
    });

    it("name, version and badge are colored differently — visible in the frame", () => {
        const row = buildExtensionRow("row-1", entry({ availability: "incompatible" }), STYLES);
        const screen = renderElement(row, 40, 1, { themeVars: true });
        const layout = describeExtensionRow(entry({ availability: "incompatible" }));

        expect(screen.screenToString()).toContain("Incompatible");
        const nameFg = screen.getFgAt(new Point(0, 0));
        const versionFg = screen.getFgAt(new Point(layout.version.start, 0));
        const badgeFg = screen.getFgAt(new Point(layout.badge!.start, 0));
        expect(versionFg).not.toBe(nameFg);
        expect(badgeFg).not.toBe(nameFg);
        expect(badgeFg).not.toBe(versionFg);
    });

    it("a group header is a dimmed row with its own id", () => {
        const row = buildGroupRow("group-1", "MARKETPLACE", "descriptionForeground");
        expect(row.id).toBe("group-1");
        expect(row.getText()).toBe("MARKETPLACE");

        // Dimmed, not inherited: the group title is fainter than entries.
        const groupFg = renderElement(row, 20, 1, { themeVars: true }).getFgAt(new Point(0, 0));
        const entryFg = renderElement(buildExtensionRow("row-1", entry(), STYLES), 20, 1, {
            themeVars: true,
        }).getFgAt(new Point(0, 0));
        expect(groupFg).not.toBe(entryFg);
    });
});

describe("partial support marker", () => {
    it("sits between the version and the state badge", () => {
        const row = describeExtensionRow(
            entry({ support: { level: "partial", limits: ["Chat needs a webview"] }, installedVersion: "1.0.0" }),
        );
        expect(row.text).toBe("Acme Tools  1.0.0  Partial  Installed");
        expect(row.partialSupport).not.toBeNull();
        expect(row.text.slice(row.partialSupport!.start, row.partialSupport!.start + row.partialSupport!.length)).toBe(
            "Partial",
        );
        expect(row.text.slice(row.badge!.start, row.badge!.start + row.badge!.length)).toBe("Installed");
    });

    it("is shown for a non-installed extension too", () => {
        const row = describeExtensionRow(entry({ support: { level: "partial", limits: ["Chat"] } }));
        expect(row.text).toBe("Acme Tools  1.0.0  Partial");
        expect(row.badge).toBeNull();
    });

    it("full support and a missing marker are not shown", () => {
        expect(describeExtensionRow(entry({ support: { level: "full" } })).partialSupport).toBeNull();
        expect(describeExtensionRow(entry()).partialSupport).toBeNull();
        expect(describeExtensionRow(entry({ support: { level: "full" } })).text).toBe("Acme Tools  1.0.0");
    });

    it("is colored differently from the rest of the row text", () => {
        const withPartial = entry({ support: { level: "partial", limits: ["Chat"] }, installedVersion: "1.0.0" });
        const row = buildExtensionRow("row-1", withPartial, STYLES);
        const screen = renderElement(row, 40, 1, { themeVars: true });
        const layout = describeExtensionRow(withPartial);
        const partialFg = screen.getFgAt(new Point(layout.partialSupport!.start, 0));
        const nameFg = screen.getFgAt(new Point(0, 0));
        const badgeFg = screen.getFgAt(new Point(layout.badge!.start, 0));
        // The warning differs from both the name and the dimmed "Installed".
        expect(partialFg).not.toBe(nameFg);
        expect(partialFg).not.toBe(badgeFg);
    });
});
