import { describe, expect, it } from "vitest";

import { parseWireConfigurationUpdate } from "./hostWireParsers.ts";

describe("hostWireParsers — configuration.update", () => {
    it("accepts key, value, target and resource; adds nothing extra", () => {
        expect(
            parseWireConfigurationUpdate({
                key: "a.b",
                value: { x: [1] },
                target: "workspaceFolder",
                resource: "file:///ws",
            }),
        ).toStrictEqual({ key: "a.b", value: { x: [1] }, target: "workspaceFolder", resource: "file:///ws" });
        expect(parseWireConfigurationUpdate({ key: "a.b", target: "user" })).toStrictEqual({
            key: "a.b",
            target: "user",
        });
        expect(parseWireConfigurationUpdate({ key: "a.b", value: false, target: "workspace" })).toStrictEqual({
            key: "a.b",
            value: false,
            target: "workspace",
        });
        // Falsy values are values, not key removal.
        expect(parseWireConfigurationUpdate({ key: "a.b", value: null })).toStrictEqual({ key: "a.b", value: null });
        expect(parseWireConfigurationUpdate({ key: "a.b", value: 0 })).toStrictEqual({ key: "a.b", value: 0 });
    });

    it.each([
        ["not an object", "x"],
        ["null", null],
        ["no key", { value: 1 }],
        ["empty key", { key: "", value: 1 }],
        ["key not a string", { key: 1, value: 1 }],
        ["unknown target", { key: "a", target: "memory" }],
        ["numeric target", { key: "a", target: 1 }],
        ["resource not a string", { key: "a", resource: {} }],
    ])("rejects a foreign shape: %s", (_name, raw) => {
        expect(parseWireConfigurationUpdate(raw)).toBeNull();
    });
});
