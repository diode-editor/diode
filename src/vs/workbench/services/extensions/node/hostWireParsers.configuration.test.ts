import { describe, expect, it } from "vitest";

import { parseWireConfigurationUpdate } from "./hostWireParsers.ts";

describe("hostWireParsers — configuration.update", () => {
    it("принимает ключ, значение, цель и ресурс; лишнего не добавляет", () => {
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
        // Ложные значения — значения, а не снятие ключа.
        expect(parseWireConfigurationUpdate({ key: "a.b", value: null })).toStrictEqual({ key: "a.b", value: null });
        expect(parseWireConfigurationUpdate({ key: "a.b", value: 0 })).toStrictEqual({ key: "a.b", value: 0 });
    });

    it.each([
        ["не объект", "x"],
        ["null", null],
        ["нет ключа", { value: 1 }],
        ["пустой ключ", { key: "", value: 1 }],
        ["ключ не строка", { key: 1, value: 1 }],
        ["чужая цель", { key: "a", target: "memory" }],
        ["цель числом", { key: "a", target: 1 }],
        ["ресурс не строка", { key: "a", resource: {} }],
    ])("отвергает чужую форму: %s", (_name, raw) => {
        expect(parseWireConfigurationUpdate(raw)).toBeNull();
    });
});
