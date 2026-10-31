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

    it("uri parts of the wrong type are ignored", () => {
        const parsed = parseGoToLocationsArguments({ scheme: "file", path: "/a.ts", query: 7 }, POSITION, []);
        expect(parsed.uri.toString()).toBe("file:///a.ts");
    });

    const URI_ERROR = "uri must be a uri";
    const POSITION_ERROR = "position must be {line, character}";
    const LOCATION_ERROR = "location must be {uri, range}";
    const LOCATIONS_ERROR = "locations must be an array";

    // By message: a mutated guard would still throw a native TypeError on `undefined.line`.
    it.each([
        ["uri is missing", undefined, POSITION, [], URI_ERROR],
        ["uri is null", null, POSITION, [], URI_ERROR],
        ["uri has no scheme", { path: "/a" }, POSITION, [], URI_ERROR],
        ["position is missing", "file:///a", undefined, [], POSITION_ERROR],
        ["position is null", "file:///a", null, [], POSITION_ERROR],
        ["position has no character", "file:///a", { line: 1 }, [], POSITION_ERROR],
        ["position has no line", "file:///a", { character: 1 }, [], POSITION_ERROR],
        ["locations isn't an array", "file:///a", POSITION, {}, LOCATIONS_ERROR],
        ["a location has no range", "file:///a", POSITION, [{ uri: "file:///a" }], LOCATION_ERROR],
        ["a location is null", "file:///a", POSITION, [null], LOCATION_ERROR],
    ])("malformed input throws: %s", (_name, uri, position, locations, message) => {
        expect(() => parseGoToLocationsArguments(uri, position, locations)).toThrow(new TypeError(message));
    });
});
