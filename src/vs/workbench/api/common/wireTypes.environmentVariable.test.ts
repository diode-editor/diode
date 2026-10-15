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
        ).toEqual({
            variable: "P",
            value: "v",
            type: 2,
            options: { applyAtProcessCreation: false, applyAtShellIntegration: true },
            scope: SCOPE,
        });
    });

    it("без опций и области — пустые опции, области нет; не-булевы опции отброшены", () => {
        expect(parseWireEnvironmentVariableMutator({ variable: "P", value: "v", type: 1 })).toEqual({
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
        ).toEqual({ variable: "P", value: "v", type: 3, options: {} });
        expect(parseWireEnvironmentVariableMutator({ variable: "P", value: "v", type: 1, options: null })).toEqual({
            variable: "P",
            value: "v",
            type: 1,
            options: {},
        });
    });

    it("область без папки — `{}`", () => {
        expect(parseWireEnvironmentVariableMutator({ variable: "P", value: "v", type: 1, scope: {} })?.scope).toEqual(
            {},
        );
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
        ).toEqual([
            ["A", { ...good, options: {} }],
            ["C", { variable: "C", value: "3", type: 3, options: {} }],
        ]);
    });

    it("не массив — пусто", () => {
        expect(parseWireEnvironmentVariableEntries(undefined)).toEqual([]);
        expect(parseWireEnvironmentVariableEntries({})).toEqual([]);
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
        ).toEqual([
            ["a.b", [["A", { variable: "A", value: "1", type: 1, options: {} }]]],
            ["c.d", []],
        ]);
    });

    it("без списка — пусто", () => {
        expect(parseWireEnvironmentVariableCollections(null)).toEqual([]);
        expect(parseWireEnvironmentVariableCollections({ collections: {} })).toEqual([]);
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
        ).toEqual([
            ["", { description: "d", scope: undefined }],
            ["file:///a", { description: undefined, scope: SCOPE }],
            ["nonobj", { description: undefined, scope: undefined }],
        ]);
    });

    it("не массив — пусто", () => {
        expect(parseWireEnvironmentDescriptions(undefined)).toEqual([]);
    });
});
