import { describe, expect, it } from "vitest";

import {
    parseWireSecretKeys,
    parseWireSecretKeysRequest,
    parseWireSecretRef,
    parseWireSecretValue,
    parseWireSecretWrite,
} from "./wireTypes.ts";

describe("parseWireSecretRef", () => {
    it("принимает пару непустых строк", () => {
        expect(parseWireSecretRef({ extensionId: "pub.one", key: "token" })).toEqual({
            extensionId: "pub.one",
            key: "token",
        });
    });

    it.each([
        ["не объект", "строка"],
        ["null", null],
        ["без extensionId", { key: "token" }],
        ["пустой extensionId", { extensionId: "", key: "token" }],
        ["нестроковый extensionId", { extensionId: 1, key: "token" }],
        ["без key", { extensionId: "pub.one" }],
        ["пустой key", { extensionId: "pub.one", key: "" }],
        ["нестроковый key", { extensionId: "pub.one", key: 1 }],
    ])("отвергает: %s", (_name, raw) => {
        expect(parseWireSecretRef(raw)).toBeNull();
    });
});

describe("parseWireSecretWrite", () => {
    it("принимает адрес со значением", () => {
        expect(parseWireSecretWrite({ extensionId: "pub.one", key: "token", value: "s3cr3t" })).toEqual({
            extensionId: "pub.one",
            key: "token",
            value: "s3cr3t",
        });
    });

    it("пустая строка — законный секрет", () => {
        expect(parseWireSecretWrite({ extensionId: "pub.one", key: "token", value: "" })?.value).toBe("");
    });

    it.each([
        ["без значения", { extensionId: "pub.one", key: "token" }],
        ["нестроковое значение", { extensionId: "pub.one", key: "token", value: 1 }],
        ["негодный адрес", { extensionId: "", key: "token", value: "s3cr3t" }],
    ])("отвергает: %s", (_name, raw) => {
        expect(parseWireSecretWrite(raw)).toBeNull();
    });
});

describe("parseWireSecretKeysRequest", () => {
    it("отдаёт id расширения", () => {
        expect(parseWireSecretKeysRequest({ extensionId: "pub.one" })).toBe("pub.one");
    });

    it.each([
        ["не объект", 42],
        ["null", null],
        ["пустой id", { extensionId: "" }],
        ["нестроковый id", { extensionId: [] }],
    ])("отвергает: %s", (_name, raw) => {
        expect(parseWireSecretKeysRequest(raw)).toBeNull();
    });
});

describe("parseWireSecretValue", () => {
    it("строка — это значение", () => {
        expect(parseWireSecretValue({ value: "s3cr3t" })).toBe("s3cr3t");
    });

    it.each([
        ["null в поле — «секрета нет»", { value: null }],
        ["поля нет вовсе", {}],
        ["ответ не объект", "s3cr3t"],
        ["ответ null", null],
    ])("отдаёт undefined: %s", (_name, raw) => {
        expect(parseWireSecretValue(raw)).toBeUndefined();
    });
});

describe("parseWireSecretKeys", () => {
    it("отдаёт строки, отбрасывая чужое", () => {
        expect(parseWireSecretKeys({ keys: ["token", 1, "refresh", null] })).toEqual(["token", "refresh"]);
    });

    it.each([
        ["не объект", "keys"],
        ["null", null],
        ["не массив", { keys: "token" }],
    ])("отдаёт пустой список: %s", (_name, raw) => {
        expect(parseWireSecretKeys(raw)).toEqual([]);
    });
});
