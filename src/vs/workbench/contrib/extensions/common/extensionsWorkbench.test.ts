import { describe, expect, it } from "vitest";

import { filterExtensionEntries, type IExtensionListEntry, parseExtensionQuery } from "./extensionsWorkbench.ts";

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
        pinned: false,
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

describe("@outdated (ExtensionUpdates stage 2, US-2.5)", () => {
    const LIST = [
        entry({ id: "acme.tools", displayName: "Acme Tools", installedVersion: "1.0.0", availability: "outdated" }),
        entry({ id: "acme.current", installedVersion: "1.0.0", availability: "installed" }),
        entry({ id: "other.outdated", displayName: "Other", installedVersion: "0.1.0", availability: "outdated" }),
        entry({ id: "acme.fresh" }),
    ];

    it("keeps only outdated entries, whatever the case", () => {
        expect(filterExtensionEntries(LIST, "@outdated").map((e) => e.id)).toEqual(["acme.tools", "other.outdated"]);
        expect(filterExtensionEntries(LIST, "@OutDated ").map((e) => e.id)).toEqual(["acme.tools", "other.outdated"]);
    });

    it("the rest of the query filters as usual, on either side", () => {
        expect(filterExtensionEntries(LIST, "@outdated acme").map((e) => e.id)).toEqual(["acme.tools"]);
        expect(filterExtensionEntries(LIST, "other @outdated").map((e) => e.id)).toEqual(["other.outdated"]);
    });

    it("parses the filter out of the text", () => {
        expect(parseExtensionQuery("  @outdated  Acme ")).toEqual({ outdated: true, text: "acme" });
        expect(parseExtensionQuery("acme")).toEqual({ outdated: false, text: "acme" });
    });
});
