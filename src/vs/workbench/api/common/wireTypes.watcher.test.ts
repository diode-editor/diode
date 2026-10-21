import { describe, expect, it } from "vitest";

import { parseWireWatcherEvents } from "./wireTypes.ts";

describe("parseWireWatcherEvents", () => {
    it("parses an event batch", () => {
        expect(
            parseWireWatcherEvents({
                id: 2,
                events: [
                    { type: "created", uri: "file:///a" },
                    { type: "deleted", uri: "file:///b" },
                ],
            }),
        ).toEqual({
            id: 2,
            events: [
                { type: "created", uri: "file:///a" },
                { type: "deleted", uri: "file:///b" },
            ],
        });
    });

    it("garbage entries are dropped, the batch stays valid", () => {
        expect(
            parseWireWatcherEvents({
                id: 2,
                events: [
                    null,
                    "no",
                    { type: "moved", uri: "file:///a" },
                    { type: "changed", uri: "" },
                    { type: "changed" },
                ],
            }),
        ).toEqual({ id: 2, events: [] });
    });

    it("a structurally foreign batch gives null", () => {
        expect(parseWireWatcherEvents(null)).toBeNull();
        expect(parseWireWatcherEvents({ id: "2", events: [] })).toBeNull();
        expect(parseWireWatcherEvents({ id: 2, events: "no" })).toBeNull();
    });
});
