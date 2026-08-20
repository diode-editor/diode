import { describe, expect, it } from "vitest";

import { parseWireWatcherCreate, parseWireWatcherDispose, parseWireWatcherEvents } from "./wireTypes.ts";

describe("parseWireWatcherCreate", () => {
    it("разбирает запрос, ignore-флаги по умолчанию выключены", () => {
        expect(parseWireWatcherCreate({ id: 1, base: "/repo", pattern: "**" })).toEqual({
            id: 1,
            base: "/repo",
            pattern: "**",
            ignoreCreateEvents: false,
            ignoreChangeEvents: false,
            ignoreDeleteEvents: false,
        });
    });

    it("флаги берутся только строгим true", () => {
        const parsed = parseWireWatcherCreate({
            id: 1,
            base: "/repo",
            pattern: "*",
            ignoreCreateEvents: true,
            ignoreChangeEvents: "да",
            ignoreDeleteEvents: 1,
        });
        expect(parsed).toMatchObject({ ignoreCreateEvents: true, ignoreChangeEvents: false, ignoreDeleteEvents: false });
    });

    it("структурно чужой запрос — null", () => {
        expect(parseWireWatcherCreate(null)).toBeNull();
        expect(parseWireWatcherCreate("нет")).toBeNull();
        expect(parseWireWatcherCreate({ base: "/repo", pattern: "**" })).toBeNull();
        expect(parseWireWatcherCreate({ id: 1.5, base: "/repo", pattern: "**" })).toBeNull();
        expect(parseWireWatcherCreate({ id: 1, base: "", pattern: "**" })).toBeNull();
        expect(parseWireWatcherCreate({ id: 1, base: "/repo" })).toBeNull();
    });
});

describe("parseWireWatcherDispose", () => {
    it("берёт целочисленный id", () => {
        expect(parseWireWatcherDispose({ id: 4 })).toBe(4);
    });

    it("всё прочее — null", () => {
        expect(parseWireWatcherDispose(null)).toBeNull();
        expect(parseWireWatcherDispose({ id: "4" })).toBeNull();
        expect(parseWireWatcherDispose({ id: 1.5 })).toBeNull();
    });
});

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
                events: [null, "нет", { type: "moved", uri: "file:///a" }, { type: "changed", uri: "" }, { type: "changed" }],
            }),
        ).toEqual({ id: 2, events: [] });
    });

    it("структурно чужая пачка — null", () => {
        expect(parseWireWatcherEvents(null)).toBeNull();
        expect(parseWireWatcherEvents({ id: "2", events: [] })).toBeNull();
        expect(parseWireWatcherEvents({ id: 2, events: "нет" })).toBeNull();
    });
});
