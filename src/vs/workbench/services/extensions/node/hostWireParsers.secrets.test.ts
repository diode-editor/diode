import { describe, expect, it } from "vitest";

import { parseWireSecretKeysRequest, parseWireSecretWrite } from "./hostWireParsers.ts";

describe("parseWireSecretWrite", () => {
    it("accepts an address with a value", () => {
        expect(parseWireSecretWrite({ extensionId: "pub.one", key: "token", value: "s3cr3t" })).toEqual({
            extensionId: "pub.one",
            key: "token",
            value: "s3cr3t",
        });
    });

    it("an empty string is a legitimate secret", () => {
        expect(parseWireSecretWrite({ extensionId: "pub.one", key: "token", value: "" })?.value).toBe("");
    });

    it.each([
        ["no value", { extensionId: "pub.one", key: "token" }],
        ["non-string value", { extensionId: "pub.one", key: "token", value: 1 }],
        ["invalid address", { extensionId: "", key: "token", value: "s3cr3t" }],
    ])("rejects: %s", (_name, raw) => {
        expect(parseWireSecretWrite(raw)).toBeNull();
    });
});

describe("parseWireSecretKeysRequest", () => {
    it("returns the extension id", () => {
        expect(parseWireSecretKeysRequest({ extensionId: "pub.one" })).toBe("pub.one");
    });

    it.each([
        ["not an object", 42],
        ["null", null],
        ["empty id", { extensionId: "" }],
        ["non-string id", { extensionId: [] }],
    ])("rejects: %s", (_name, raw) => {
        expect(parseWireSecretKeysRequest(raw)).toBeNull();
    });
});
