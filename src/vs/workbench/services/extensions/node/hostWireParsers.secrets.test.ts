import { describe, expect, it } from "vitest";

import { parseWireSecretKeysRequest, parseWireSecretWrite } from "./hostWireParsers.ts";

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
