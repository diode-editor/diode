import { describe, expect, it } from "vitest";

import { parseWireSecretKeys, parseWireSecretRef, parseWireSecretValue } from "./wireTypes.ts";

describe("parseWireSecretRef", () => {
    it("accepts a pair of non-empty strings", () => {
        expect(parseWireSecretRef({ extensionId: "pub.one", key: "token" })).toEqual({
            extensionId: "pub.one",
            key: "token",
        });
    });

    it.each([
        ["not an object", "string"],
        ["null", null],
        ["no extensionId", { key: "token" }],
        ["empty extensionId", { extensionId: "", key: "token" }],
        ["non-string extensionId", { extensionId: 1, key: "token" }],
        ["no key", { extensionId: "pub.one" }],
        ["empty key", { extensionId: "pub.one", key: "" }],
        ["non-string key", { extensionId: "pub.one", key: 1 }],
    ])("rejects: %s", (_name, raw) => {
        expect(parseWireSecretRef(raw)).toBeNull();
    });
});

describe("parseWireSecretValue", () => {
    it("a string is the value", () => {
        expect(parseWireSecretValue({ value: "s3cr3t" })).toBe("s3cr3t");
    });

    it.each([
        ["null in the field means 'no secret'", { value: null }],
        ["field missing entirely", {}],
        ["reply is not an object", "s3cr3t"],
        ["reply is null", null],
    ])("returns undefined: %s", (_name, raw) => {
        expect(parseWireSecretValue(raw)).toBeUndefined();
    });
});

describe("parseWireSecretKeys", () => {
    it("returns strings, dropping the rest", () => {
        expect(parseWireSecretKeys({ keys: ["token", 1, "refresh", null] })).toEqual(["token", "refresh"]);
    });

    it.each([
        ["not an object", "keys"],
        ["null", null],
        ["not an array", { keys: "token" }],
    ])("returns an empty list: %s", (_name, raw) => {
        expect(parseWireSecretKeys(raw)).toEqual([]);
    });
});
