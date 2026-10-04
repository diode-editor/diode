import { describe, expect, it } from "vitest";

import { parseWireWatcherEvents } from "./wireTypes.ts";

describe("parseWireWatcherEvents", () => {
    it("разбирает пачку событий", () => {
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

    it("мусорные записи отбрасываются, пачка остаётся валидной", () => {
        expect(
            parseWireWatcherEvents({
                id: 2,
                events: [
                    null,
                    "нет",
                    { type: "moved", uri: "file:///a" },
                    { type: "changed", uri: "" },
                    { type: "changed" },
                ],
            }),
        ).toEqual({ id: 2, events: [] });
    });

    it("структурно чужая пачка — null", () => {
        expect(parseWireWatcherEvents(null)).toBeNull();
        expect(parseWireWatcherEvents({ id: "2", events: [] })).toBeNull();
        expect(parseWireWatcherEvents({ id: 2, events: "нет" })).toBeNull();
    });
});
