import { describe, expect, it } from "vitest";

import { parseWireQuickPickDispose, parseWireQuickPickUpdate } from "./hostWireParsers.ts";

describe("parseWireQuickPickUpdate", () => {
    it("дифф — только присланные поля; null — «сброшено»", () => {
        expect(parseWireQuickPickUpdate({ handle: 3, title: null, busy: true, value: "" })).toEqual({
            handle: 3,
            title: null,
            busy: true,
            value: "",
        });
    });

    it("все поля целиком доезжают", () => {
        const full = {
            handle: 3,
            visible: false,
            title: "T",
            step: 1,
            totalSteps: 2,
            placeholder: "p",
            prompt: "pr",
            value: "v",
            busy: false,
            enabled: false,
            canSelectMany: true,
            matchOnDescription: false,
            matchOnDetail: true,
            keepScrollPosition: true,
            items: [{ handle: 4, label: "L", description: "D", detail: "De", alwaysShow: true }],
            activeItems: [4],
            selectedItems: [],
        };
        expect(parseWireQuickPickUpdate(full)).toEqual(full);
    });

    it("поле чужого типа — «не трогали», а не отказ всему диффу", () => {
        expect(
            parseWireQuickPickUpdate({
                handle: 3,
                title: 5,
                step: "два",
                visible: "да",
                value: null,
                activeItems: "нет",
                selectedItems: [1, -1, 1.5],
                items: "нет",
            }),
        ).toEqual({ handle: 3, selectedItems: [1] });
        expect(parseWireQuickPickUpdate({ handle: 3, step: null, totalSteps: Number.NaN })).toEqual({
            handle: 3,
            step: null,
        });
    });

    it("пункт без handle выбрасывается, без лейбла — остаётся с пустым", () => {
        expect(
            parseWireQuickPickUpdate({
                handle: 3,
                items: [null, { label: "без handle" }, { handle: 1.5, label: "дробный" }, { handle: 2, label: 7 }],
            }),
        ).toEqual({
            handle: 3,
            items: [{ handle: 2, label: "", description: undefined, detail: undefined, alwaysShow: false }],
        });
    });

    it("без handle или не объект — null", () => {
        expect(parseWireQuickPickUpdate(null)).toBeNull();
        expect(parseWireQuickPickUpdate("x")).toBeNull();
        expect(parseWireQuickPickUpdate({ title: "T" })).toBeNull();
    });
});

describe("parseWireQuickPickDispose", () => {
    it("handle или null", () => {
        expect(parseWireQuickPickDispose({ handle: 3 })).toBe(3);
        expect(parseWireQuickPickDispose({})).toBeNull();
        expect(parseWireQuickPickDispose(null)).toBeNull();
    });
});
