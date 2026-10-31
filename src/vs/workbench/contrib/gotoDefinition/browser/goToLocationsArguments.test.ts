import { describe, expect, it } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";

import { parseGoToLocationsArguments } from "./goToLocationsArguments.ts";

const POSITION = { line: 3, character: 7 };
const RANGE = createRange(1, 2, 3, 4);

describe("parseGoToLocationsArguments", () => {
    it("takes uri as a string, a Uri and a JSON-serialized Uri", () => {
        const uri = Uri.file("/w/a.ts");
        for (const form of [uri.toString(), uri, JSON.parse(JSON.stringify(uri)) as unknown]) {
            expect(parseGoToLocationsArguments(form, POSITION, []).uri.toString()).toBe(uri.toString());
        }
    });

    it("a bare {scheme, path} keeps every uri part it was given", () => {
        const parsed = parseGoToLocationsArguments(
            { scheme: "jdt", authority: "contents", path: "/a.java", query: "q=1", fragment: "f" },
            POSITION,
            [],
        );
        expect(parsed.uri.toString(true)).toBe("jdt://contents/a.java?q=1#f");
    });

    it("parses the position and the locations, each with either uri form", () => {
        const uri = Uri.file("/w/a.ts");
        const parsed = parseGoToLocationsArguments(uri, POSITION, [
            { uri: uri.toString(), range: RANGE },
            { uri: { scheme: "file", path: "/w/b.ts" }, range: RANGE },
        ]);
        expect(parsed.position).toEqual(POSITION);
        expect(parsed.locations).toEqual([
            { uri: uri.toString(), range: RANGE },
            { uri: Uri.file("/w/b.ts").toString(), range: RANGE },
        ]);
    });

    it("passes the optional arguments of the right type, the rest default", () => {
        const uri = "file:///w/a.ts";
        expect(parseGoToLocationsArguments(uri, POSITION, [], "goto", "Nothing", true)).toMatchObject({
            multiple: "goto",
            noResultsMessage: "Nothing",
            openInPeek: true,
        });
        expect(parseGoToLocationsArguments(uri, POSITION, [], 1, 2, "yes")).toMatchObject({
            multiple: undefined,
            noResultsMessage: undefined,
            openInPeek: false,
        });
    });

    it.each([
        ["uri is missing", undefined, POSITION, []],
        ["uri has no scheme", { path: "/a" }, POSITION, []],
        ["position is missing", "file:///a", undefined, []],
        ["position has no character", "file:///a", { line: 1 }, []],
        ["position has no line", "file:///a", { character: 1 }, []],
        ["locations isn't an array", "file:///a", POSITION, {}],
        ["a location has no range", "file:///a", POSITION, [{ uri: "file:///a" }]],
        ["a location is null", "file:///a", POSITION, [null]],
    ])("malformed input throws: %s", (_name, uri, position, locations) => {
        expect(() => parseGoToLocationsArguments(uri, position, locations)).toThrow(TypeError);
    });
});
