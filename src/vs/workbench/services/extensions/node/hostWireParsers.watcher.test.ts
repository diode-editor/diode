import { describe, expect, it } from "vitest";

import { parseWireWatcherCreate, parseWireWatcherDispose } from "./hostWireParsers.ts";

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
        expect(parsed).toMatchObject({
            ignoreCreateEvents: true,
            ignoreChangeEvents: false,
            ignoreDeleteEvents: false,
        });
    });

    it("ignoreDeleteEvents: true доходит до результата", () => {
        expect(parseWireWatcherCreate({ id: 1, base: "/repo", pattern: "**", ignoreDeleteEvents: true })).toMatchObject(
            {
                ignoreCreateEvents: false,
                ignoreChangeEvents: false,
                ignoreDeleteEvents: true,
            },
        );
    });

    it("структурно чужой запрос — null", () => {
        expect(parseWireWatcherCreate(null)).toBeNull();
        expect(parseWireWatcherCreate("нет")).toBeNull();
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
    it("берёт целочисленный id", () => {
        expect(parseWireWatcherDispose({ id: 4 })).toBe(4);
    });

    it("всё прочее — null", () => {
        expect(parseWireWatcherDispose(null)).toBeNull();
        expect(parseWireWatcherDispose({ id: "4" })).toBeNull();
        expect(parseWireWatcherDispose({ id: 1.5 })).toBeNull();
        expect(parseWireWatcherDispose(Object.assign(() => undefined, { id: 4 }))).toBeNull();
    });
});
