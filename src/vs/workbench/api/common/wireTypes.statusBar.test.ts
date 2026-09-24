import { describe, expect, it } from "vitest";

import { parseWireStatusBarItem, parseWireStatusBarItemDispose } from "./wireTypes.ts";

describe("parseWireStatusBarItem", () => {
    const valid = { handle: 1, id: "demo", alignment: "left", text: "Demo" };

    it("разбирает минимальный конверт", () => {
        expect(parseWireStatusBarItem(valid)).toEqual(valid);
    });

    it("разбирает полный конверт", () => {
        expect(
            parseWireStatusBarItem({
                ...valid,
                alignment: "right",
                priority: 100,
                name: "Status Bar Demo",
                command: "demo.click",
                arguments: [1, "two"],
            }),
        ).toEqual({
            handle: 1,
            id: "demo",
            alignment: "right",
            text: "Demo",
            priority: 100,
            name: "Status Bar Demo",
            command: "demo.click",
            arguments: [1, "two"],
        });
    });

    it("пустой текст — валидное состояние пункта", () => {
        expect(parseWireStatusBarItem({ ...valid, text: "" })?.text).toBe("");
    });

    it.each([
        ["не объект", "nope"],
        ["null", null],
        ["без handle", { ...valid, handle: undefined }],
        ["нечисловой handle", { ...valid, handle: "1" }],
        ["бесконечный handle", { ...valid, handle: Number.POSITIVE_INFINITY }],
        ["без id", { ...valid, id: undefined }],
        ["пустой id", { ...valid, id: "" }],
        ["чужой alignment", { ...valid, alignment: "top" }],
        ["без текста", { ...valid, text: undefined }],
    ])("отбрасывает конверт: %s", (_name, raw) => {
        expect(parseWireStatusBarItem(raw)).toBeNull();
    });

    it.each([
        ["нечисловой priority", { priority: "100" }],
        ["NaN priority", { priority: Number.NaN }],
    ])("отбрасывает поле по отдельности: %s", (_name, patch) => {
        expect(parseWireStatusBarItem({ ...valid, ...patch })?.priority).toBeUndefined();
    });

    it("пустое имя не считается именем (иначе в меню видимости встал бы безымянный пункт)", () => {
        expect(parseWireStatusBarItem({ ...valid, name: "" })?.name).toBeUndefined();
    });

    it("пустая команда не считается командой", () => {
        expect(parseWireStatusBarItem({ ...valid, command: "" })?.command).toBeUndefined();
    });

    it("нестроковое имя и команда отбрасываются", () => {
        const parsed = parseWireStatusBarItem({ ...valid, name: 7, command: 7 });

        expect(parsed?.name).toBeUndefined();
        expect(parsed?.command).toBeUndefined();
    });

    it("не-массив в arguments отбрасывается", () => {
        expect(parseWireStatusBarItem({ ...valid, command: "c", arguments: "x" })?.arguments).toBeUndefined();
    });
});

describe("parseWireStatusBarItemDispose", () => {
    it("разбирает handle", () => {
        expect(parseWireStatusBarItemDispose({ handle: 3 })).toEqual({ handle: 3 });
    });

    it.each([
        ["не объект", 3],
        ["null", null],
        ["нечисловой handle", { handle: "3" }],
    ])("отбрасывает конверт: %s", (_name, raw) => {
        expect(parseWireStatusBarItemDispose(raw)).toBeNull();
    });
});
