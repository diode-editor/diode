import { describe, expect, it } from "vitest";

import {
    parseWireEnvironmentDescriptions,
    parseWireEnvironmentVariableCollections,
    parseWireEnvironmentVariableEntries,
    parseWireEnvironmentVariableMutator,
} from "./wireTypes.ts";

const SCOPE = { workspaceFolder: { uri: "file:///a", name: "a", index: 0 } };

describe("parseWireEnvironmentVariableMutator", () => {
    it("полный мутатор — как есть", () => {
        expect(
            parseWireEnvironmentVariableMutator({
                variable: "P",
                value: "v",
                type: 2,
                options: { applyAtProcessCreation: false, applyAtShellIntegration: true },
                scope: SCOPE,
            }),
        ).toStrictEqual({
            variable: "P",
            value: "v",
            type: 2,
            options: { applyAtProcessCreation: false, applyAtShellIntegration: true },
            scope: SCOPE,
        });
    });

    it("без опций и области — пустые опции, области нет; не-булевы опции отброшены", () => {
        expect(parseWireEnvironmentVariableMutator({ variable: "P", value: "v", type: 1 })).toStrictEqual({
            variable: "P",
            value: "v",
            type: 1,
            options: {},
        });
        expect(
            parseWireEnvironmentVariableMutator({
                variable: "P",
                value: "v",
                type: 3,
                options: { applyAtProcessCreation: "yes", applyAtShellIntegration: 1 },
            }),
        ).toStrictEqual({ variable: "P", value: "v", type: 3, options: {} });
        expect(
            parseWireEnvironmentVariableMutator({ variable: "P", value: "v", type: 1, options: null }),
        ).toStrictEqual({
            variable: "P",
            value: "v",
            type: 1,
            options: {},
        });
    });

    it("область без папки — `{}`", () => {
        expect(
            parseWireEnvironmentVariableMutator({ variable: "P", value: "v", type: 1, scope: {} })?.scope,
        ).toStrictEqual({});
    });

    it.each([
        null,
        "x",
        { value: "v", type: 1 },
        { variable: "P", type: 1 },
        { variable: "P", value: "v" },
        { variable: "P", value: "v", type: 0 },
        { variable: "P", value: "v", type: 4 },
        { variable: "P", value: "v", type: 1, scope: null },
        { variable: "P", value: "v", type: 1, scope: "folder" },
        { variable: "P", value: "v", type: "1" },
        { variable: "P", value: "v", type: 1, scope: { workspaceFolder: null } },
        { variable: "P", value: "v", type: 1, scope: { workspaceFolder: { uri: 1, name: "a", index: 0 } } },
        { variable: "P", value: "v", type: 1, scope: { workspaceFolder: { uri: "u", name: 1, index: 0 } } },
        { variable: "P", value: "v", type: 1, scope: { workspaceFolder: { uri: "u", name: "a", index: "0" } } },
    ])("структурно чужой — null (%j)", (raw) => {
        expect(parseWireEnvironmentVariableMutator(raw)).toBeNull();
    });
});

describe("parseWireEnvironmentVariableEntries", () => {
    it("чужие записи отброшены, остальные — по порядку", () => {
        const good = { variable: "A", value: "1", type: 1 };
        expect(
            parseWireEnvironmentVariableEntries([
                ["A", good],
                ["B", { variable: "B" }],
                [1, good],
                "junk",
                ["C", { variable: "C", value: "3", type: 3 }],
            ]),
        ).toStrictEqual([
            ["A", { ...good, options: {} }],
            ["C", { variable: "C", value: "3", type: 3, options: {} }],
        ]);
    });

    it("не массив — пусто", () => {
        expect(parseWireEnvironmentVariableEntries(undefined)).toStrictEqual([]);
        expect(parseWireEnvironmentVariableEntries({})).toStrictEqual([]);
    });
});

describe("parseWireEnvironmentVariableCollections", () => {
    it("коллекции по расширениям; чужие записи и не-список — пропуск", () => {
        expect(
            parseWireEnvironmentVariableCollections({
                collections: [
                    ["a.b", [["A", { variable: "A", value: "1", type: 1 }]]],
                    [1, []],
                    "junk",
                    ["c.d", "not-entries"],
                ],
            }),
        ).toStrictEqual([
            ["a.b", [["A", { variable: "A", value: "1", type: 1, options: {} }]]],
            ["c.d", []],
        ]);
    });

    it("без списка — пусто", () => {
        expect(parseWireEnvironmentVariableCollections(null)).toStrictEqual([]);
        expect(parseWireEnvironmentVariableCollections({ collections: {} })).toStrictEqual([]);
    });
});

describe("parseWireEnvironmentDescriptions", () => {
    it("описание строкой или undefined, область — разобрана; чужие записи отброшены", () => {
        expect(
            parseWireEnvironmentDescriptions([
                ["", { description: "d" }],
                ["file:///a", { description: 5, scope: SCOPE }],
                ["bad", { description: "x", scope: null }],
                ["nonobj", 5],
                [1, { description: "x" }],
                "junk",
            ]),
        ).toStrictEqual([
            ["", { description: "d", scope: undefined }],
            ["file:///a", { description: undefined, scope: SCOPE }],
            ["nonobj", { description: undefined, scope: undefined }],
        ]);
    });

    it("не массив — пусто", () => {
        expect(parseWireEnvironmentDescriptions(undefined)).toStrictEqual([]);
    });
});
