import { describe, expect, it } from "vitest";

import { filterExtensionEntries, type IExtensionListEntry } from "./extensionsWorkbench.ts";

function entry(overrides: Partial<IExtensionListEntry> & { id: string }): IExtensionListEntry {
    const [publisher, name] = overrides.id.split(".");
    return {
        publisher: publisher,
        name: name,
        displayName: name,
        description: "",
        kind: "native",
        support: undefined,
        latestVersion: "1.0.0",
        installedVersion: null,
        availability: "available",
        needsReload: false,
        ...overrides,
    };
}

const ENTRIES = [
    entry({ id: "acme.tools", displayName: "Acme Tools", description: "Formatting helpers" }),
    entry({ id: "other.thing", displayName: "Other Thing", description: "Unrelated" }),
];

describe("filterExtensionEntries", () => {
    it("an empty query returns the whole list", () => {
        expect(filterExtensionEntries(ENTRIES, "")).toEqual(ENTRIES);
        expect(filterExtensionEntries(ENTRIES, "   ")).toEqual(ENTRIES);
    });

    it("searches by id, displayName and description, case-insensitively", () => {
        expect(filterExtensionEntries(ENTRIES, "ACME").map((e) => e.id)).toEqual(["acme.tools"]);
        expect(filterExtensionEntries(ENTRIES, "Other Thing").map((e) => e.id)).toEqual(["other.thing"]);
        expect(filterExtensionEntries(ENTRIES, "other.").map((e) => e.id)).toEqual(["other.thing"]);
        expect(filterExtensionEntries(ENTRIES, "formatting").map((e) => e.id)).toEqual(["acme.tools"]);
    });

    it("no matches — an empty list", () => {
        expect(filterExtensionEntries(ENTRIES, "zzz")).toEqual([]);
    });
});
