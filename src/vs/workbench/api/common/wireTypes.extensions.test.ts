import { describe, expect, it } from "vitest";

import { parseWireExtensionActivated, parseWireExtensionCatalog } from "./wireTypes.ts";

describe("parseWireExtensionCatalog", () => {
    it("parses a full catalog", () => {
        expect(
            parseWireExtensionCatalog({
                extensions: [
                    { id: "pub.one", extensionPath: "/ext/one", packageJSON: { name: "one" }, isActive: true },
                    { id: "pub.two", extensionPath: "/ext/two", packageJSON: { name: "two" }, isActive: false },
                ],
            }),
        ).toEqual({
            extensions: [
                { id: "pub.one", extensionPath: "/ext/one", packageJSON: { name: "one" }, isActive: true },
                { id: "pub.two", extensionPath: "/ext/two", packageJSON: { name: "two" }, isActive: false },
            ],
        });
    });

    it("entry order is preserved — the subprocess uses it to decide whether the set changed", () => {
        const parsed = parseWireExtensionCatalog({
            extensions: [
                { id: "pub.two", extensionPath: "/b", packageJSON: {}, isActive: false },
                { id: "pub.one", extensionPath: "/a", packageJSON: {}, isActive: false },
            ],
        });
        expect(parsed?.extensions.map((e) => e.id)).toEqual(["pub.two", "pub.one"]);
    });

    it("isActive is strictly `true`, anything else means 'inactive'", () => {
        const parsed = parseWireExtensionCatalog({
            extensions: [
                { id: "pub.one", extensionPath: "/a", packageJSON: {}, isActive: 1 },
                { id: "pub.two", extensionPath: "/b", packageJSON: {} },
            ],
        });
        expect(parsed?.extensions.map((e) => e.isActive)).toEqual([false, false]);
    });

    it.each([
        ["as a string", "not an object"],
        // `typeof null === "object"` — without an explicit null check it would slip
        // into `packageJSON`, and extensions read it unguarded (`ext.packageJSON.name`).
        ["null", null],
        ["missing", undefined],
    ])("manifest %s becomes an empty object, but the entry stays", (_name, packageJSON) => {
        const parsed = parseWireExtensionCatalog({
            extensions: [{ id: "pub.one", extensionPath: "/a", packageJSON, isActive: true }],
        });
        expect(parsed?.extensions).toEqual([{ id: "pub.one", extensionPath: "/a", packageJSON: {}, isActive: true }]);
    });

    it("invalid entries are dropped one by one, valid ones get through", () => {
        const parsed = parseWireExtensionCatalog({
            extensions: [
                null,
                // A hole in the array: dereferencing `entry.id` on it would throw
                // a TypeError and lose the whole catalog, not just one entry.
                undefined,
                "string",
                { extensionPath: "/a", packageJSON: {} },
                { id: "", extensionPath: "/a", packageJSON: {} },
                { id: "pub.nopath", packageJSON: {} },
                { id: "pub.emptypath", extensionPath: "", packageJSON: {} },
                { id: "pub.ok", extensionPath: "/ok", packageJSON: {}, isActive: true },
            ],
        });
        expect(parsed?.extensions.map((e) => e.id)).toEqual(["pub.ok"]);
    });

    it.each([
        ["not an object", "catalog"],
        ["null", null],
        ["no extensions field", {}],
        ["extensions is not an array", { extensions: { "pub.one": {} } }],
    ])("rejects entirely: %s", (_name, raw) => {
        expect(parseWireExtensionCatalog(raw)).toBeNull();
    });

    it("an empty catalog is a valid catalog, not a rejection", () => {
        expect(parseWireExtensionCatalog({ extensions: [] })).toEqual({ extensions: [] });
    });
});

describe("parseWireExtensionActivated", () => {
    it("returns the id", () => {
        expect(parseWireExtensionActivated({ id: "pub.one" })).toBe("pub.one");
    });

    it.each([
        ["not an object", "pub.one"],
        ["null", null],
        ["empty id", { id: "" }],
        ["non-string id", { id: 42 }],
    ])("rejects: %s", (_name, raw) => {
        expect(parseWireExtensionActivated(raw)).toBeNull();
    });
});
