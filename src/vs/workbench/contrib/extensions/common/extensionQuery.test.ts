import { describe, expect, it } from "vitest";

import { filterExtensionEntries, parseExtensionQuery } from "./extensionQuery.ts";
import type { IExtensionListEntry } from "./extensionsWorkbench.ts";

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
        categories: [],
        tags: [],
        needsReload: false,
        ...overrides,
    };
}

function search(list: readonly IExtensionListEntry[], query: string): string[] {
    return filterExtensionEntries(list, parseExtensionQuery(query)).map((e) => e.id);
}

const ENTRIES = [
    entry({ id: "acme.tools", displayName: "Acme Tools", description: "Formatting helpers" }),
    entry({ id: "other.thing", displayName: "Other Thing", description: "Unrelated" }),
];

describe("filterExtensionEntries", () => {
    it("an empty query returns the whole list", () => {
        expect(filterExtensionEntries(ENTRIES, parseExtensionQuery(""))).toEqual(ENTRIES);
        expect(filterExtensionEntries(ENTRIES, parseExtensionQuery("   "))).toEqual(ENTRIES);
    });

    it("searches by id, displayName and description, case-insensitively", () => {
        expect(search(ENTRIES, "ACME")).toEqual(["acme.tools"]);
        expect(search(ENTRIES, "Other Thing")).toEqual(["other.thing"]);
        expect(search(ENTRIES, "other.")).toEqual(["other.thing"]);
        expect(search(ENTRIES, "formatting")).toEqual(["acme.tools"]);
    });

    it("no matches — an empty list", () => {
        expect(search(ENTRIES, "zzz")).toEqual([]);
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
        expect(search(LIST, "@outdated")).toEqual(["acme.tools", "other.outdated"]);
        expect(search(LIST, "@OutDated ")).toEqual(["acme.tools", "other.outdated"]);
    });

    it("upstream @updates is the same list", () => {
        expect(search(LIST, "@updates")).toEqual(["acme.tools", "other.outdated"]);
    });

    it("the rest of the query filters as usual, on either side", () => {
        expect(search(LIST, "@outdated acme")).toEqual(["acme.tools"]);
        expect(search(LIST, "other @outdated")).toEqual(["other.outdated"]);
    });

    it("parses the filter out of the text", () => {
        expect(parseExtensionQuery("  @outdated  Acme ")).toMatchObject({ scope: "outdated", text: "acme" });
        expect(parseExtensionQuery("acme")).toMatchObject({ scope: "all", text: "acme" });
    });
});

describe("@installed", () => {
    const LIST = [
        entry({ id: "acme.tools", installedVersion: "1.0.0", availability: "outdated" }),
        entry({ id: "acme.current", installedVersion: "1.0.0", availability: "installed" }),
        entry({ id: "acme.fresh" }),
    ];

    it("keeps installed entries, outdated ones too, whatever the case", () => {
        expect(search(LIST, "@installed")).toEqual(["acme.tools", "acme.current"]);
        expect(search(LIST, "@Installed current")).toEqual(["acme.current"]);
    });

    it("beats @outdated, like upstream's check order", () => {
        expect(parseExtensionQuery("@outdated @installed").scope).toBe("installed");
    });
});

describe("category:", () => {
    const LIST = [
        entry({ id: "acme.dark", categories: ["Themes"] }),
        entry({ id: "acme.lint", categories: ["Linters", "Formatters"] }),
        entry({ id: "acme.both", categories: ["Themes", "Snippets"] }),
        entry({ id: "acme.none" }),
    ];

    it("with or without @, quoted or not, any case", () => {
        expect(search(LIST, "@category:themes")).toEqual(["acme.dark", "acme.both"]);
        expect(search(LIST, "category:Themes")).toEqual(["acme.dark", "acme.both"]);
        expect(search(LIST, '@category:"programming languages"')).toEqual([]);
        expect(search(LIST, '@category:"formatters"')).toEqual(["acme.lint"]);
    });

    it("several categories match any of them", () => {
        expect(search(LIST, "category:linters category:snippets")).toEqual(["acme.lint", "acme.both"]);
    });

    it("a dash excludes; category:none matches extensions without categories", () => {
        expect(search(LIST, "category:themes category:-snippets")).toEqual(["acme.dark"]);
        expect(search(LIST, "category:-themes")).toEqual(["acme.lint"]);
        expect(search(LIST, "category:none")).toEqual(["acme.none"]);
    });

    it("leaves the text for the usual search", () => {
        expect(search(LIST, "@category:themes dark")).toEqual(["acme.dark"]);
        expect(parseExtensionQuery('@category:"data science" foo')).toMatchObject({
            categories: ["data science"],
            text: "foo",
        });
    });
});

describe("tag:", () => {
    const LIST = [
        entry({ id: "acme.py", tags: ["Python", "lint"] }),
        entry({ id: "acme.md", tags: ["markdown"] }),
        entry({ id: "acme.none" }),
    ];

    it("matches a keyword exactly, any case, with or without @", () => {
        expect(search(LIST, "@tag:python")).toEqual(["acme.py"]);
        expect(search(LIST, "tag:PYTHON")).toEqual(["acme.py"]);
        expect(search(LIST, "@tag:pyth")).toEqual([]);
    });

    it("a quote only at the end of a bare word is part of it", () => {
        expect(parseExtensionQuery('tag:x"').tags).toEqual(['x"']);
        expect(parseExtensionQuery('category:"data science"').categories).toEqual(["data science"]);
    });

    it("several tags match any of them", () => {
        expect(search(LIST, '@tag:markdown @tag:"lint"')).toEqual(["acme.py", "acme.md"]);
    });
});

describe("@id:", () => {
    const LIST = [entry({ id: "Acme.Tools" }), entry({ id: "acme.other" })];

    it("only the given ids, any case, whatever the rest of the query says", () => {
        expect(search(LIST, "@id:acme.tools")).toEqual(["Acme.Tools"]);
        expect(search(LIST, "@id:acme.tools @id:acme.other zzz @installed")).toEqual(["Acme.Tools", "acme.other"]);
    });
});

describe("@sort:", () => {
    const LIST = [
        entry({ id: "acme.b", displayName: "Beta", latestPublishedAt: "2026-01-01T00:00:00Z" }),
        entry({ id: "acme.c", displayName: "gamma" }),
        entry({ id: "acme.a", displayName: "Alpha", latestPublishedAt: "2026-05-01T00:00:00Z" }),
    ];

    it("name sorts by the display name", () => {
        expect(search(LIST, "@sort:name")).toEqual(["acme.a", "acme.b", "acme.c"]);
    });

    it("publishedDate puts the newest first and undated last", () => {
        expect(search(LIST, "@sort:publishedDate")).toEqual(["acme.a", "acme.b", "acme.c"]);
        expect(search([LIST[1], LIST[0], LIST[2]], "@sort:publishedDate")).toEqual(["acme.a", "acme.b", "acme.c"]);
    });

    it("keys without data keep the order; the token never reaches the text search", () => {
        for (const key of ["installs", "rating", "updateDate", "bogus"]) {
            expect(search(LIST, `@sort:${key}`)).toEqual(["acme.b", "acme.c", "acme.a"]);
        }
        expect(parseExtensionQuery("@sort:name-desc acme")).toMatchObject({ sortBy: "name", text: "acme" });
        expect(parseExtensionQuery("@sort:bogus").sortBy).toBeUndefined();
    });
});
