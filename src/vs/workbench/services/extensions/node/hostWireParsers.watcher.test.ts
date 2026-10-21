import { describe, expect, it } from "vitest";

import { parseWireWatcherCreate, parseWireWatcherDispose } from "./hostWireParsers.ts";

describe("parseWireWatcherCreate", () => {
    it("parses the request, ignore flags are off by default", () => {
        expect(parseWireWatcherCreate({ id: 1, base: "/repo", pattern: "**" })).toEqual({
            id: 1,
            base: "/repo",
            pattern: "**",
            ignoreCreateEvents: false,
            ignoreChangeEvents: false,
            ignoreDeleteEvents: false,
        });
    });

    it("flags are taken only on strict true", () => {
        const parsed = parseWireWatcherCreate({
            id: 1,
            base: "/repo",
            pattern: "*",
            ignoreCreateEvents: true,
            ignoreChangeEvents: "yes",
            ignoreDeleteEvents: 1,
        });
        expect(parsed).toMatchObject({
            ignoreCreateEvents: true,
            ignoreChangeEvents: false,
            ignoreDeleteEvents: false,
        });
    });

    it("ignoreDeleteEvents: true reaches the result", () => {
        expect(parseWireWatcherCreate({ id: 1, base: "/repo", pattern: "**", ignoreDeleteEvents: true })).toMatchObject(
            {
                ignoreCreateEvents: false,
                ignoreChangeEvents: false,
                ignoreDeleteEvents: true,
            },
        );
    });

    it("structurally foreign request → null", () => {
        expect(parseWireWatcherCreate(null)).toBeNull();
        expect(parseWireWatcherCreate("no")).toBeNull();
        expect(parseWireWatcherCreate({ base: "/repo", pattern: "**" })).toBeNull();
        expect(parseWireWatcherCreate({ id: 1.5, base: "/repo", pattern: "**" })).toBeNull();
        expect(parseWireWatcherCreate({ id: 1, base: "", pattern: "**" })).toBeNull();
        expect(parseWireWatcherCreate({ id: 1, base: "/repo" })).toBeNull();
        expect(parseWireWatcherCreate({ id: 1, base: 5, pattern: "**" })).toBeNull();
        expect(
            parseWireWatcherCreate(Object.assign(() => undefined, { id: 1, base: "/repo", pattern: "**" })),
        ).toBeNull();
    });
});

describe("parseWireWatcherDispose", () => {
    it("takes an integer id", () => {
        expect(parseWireWatcherDispose({ id: 4 })).toBe(4);
    });

    it("anything else → null", () => {
        expect(parseWireWatcherDispose(null)).toBeNull();
        expect(parseWireWatcherDispose({ id: "4" })).toBeNull();
        expect(parseWireWatcherDispose({ id: 1.5 })).toBeNull();
        expect(parseWireWatcherDispose(Object.assign(() => undefined, { id: 4 }))).toBeNull();
    });
});
