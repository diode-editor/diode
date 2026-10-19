import { describe, expect, it } from "vitest";

import { parseWireOpenDialogResult, parseWireSaveDialogResult } from "./wireTypes.ts";

describe("parseWireOpenDialogResult", () => {
    it("массив — выбранные ресурсы без мусора, всё прочее — отмена", () => {
        expect(parseWireOpenDialogResult({ uris: ["file:///a", 1] })).toStrictEqual({ uris: ["file:///a"] });
        expect(parseWireOpenDialogResult({ uris: "file:///a" })).toStrictEqual({ uris: null });
        expect(parseWireOpenDialogResult(null)).toStrictEqual({ uris: null });
    });
});

describe("parseWireSaveDialogResult", () => {
    it("строка — ресурс, всё прочее — отмена", () => {
        expect(parseWireSaveDialogResult({ uri: "file:///a" })).toStrictEqual({ uri: "file:///a" });
        expect(parseWireSaveDialogResult({ uri: 1 })).toStrictEqual({ uri: null });
        expect(parseWireSaveDialogResult(null)).toStrictEqual({ uri: null });
        expect(parseWireSaveDialogResult(undefined)).toStrictEqual({ uri: null });
    });
});
