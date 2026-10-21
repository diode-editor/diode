import { describe, expect, it } from "vitest";

import {
    EnvironmentVariableMutatorType,
    type IEnvironmentVariableCollection,
    type IEnvironmentVariableMutator,
    MergedEnvironmentVariableCollection,
} from "./environmentVariable.ts";

const { Replace, Append, Prepend } = EnvironmentVariableMutatorType;

function mutator(
    variable: string,
    value: string,
    type: EnvironmentVariableMutatorType,
    extra: Partial<IEnvironmentVariableMutator> = {},
): IEnvironmentVariableMutator {
    return { variable, value, type, ...extra };
}

function collection(...mutators: [string, IEnvironmentVariableMutator][]): IEnvironmentVariableCollection {
    return { map: new Map(mutators) };
}

function merged(collections: Record<string, IEnvironmentVariableCollection>): MergedEnvironmentVariableCollection {
    return new MergedEnvironmentVariableCollection(new Map(Object.entries(collections)));
}

const FOLDER_0 = { workspaceFolder: { uri: "file:///a", name: "a", index: 0 } };
const FOLDER_1 = { workspaceFolder: { uri: "file:///b", name: "b", index: 1 } };

describe("MergedEnvironmentVariableCollection", () => {
    it("Replace / Append / Prepend over the environment; a missing variable counts as empty", () => {
        const env: Record<string, string | undefined> = { A: "a", B: "b" };
        merged({
            "x.y": collection(
                ["A", mutator("A", "1", Replace)],
                ["B", mutator("B", ":2", Append)],
                ["C", mutator("C", "3", Prepend)],
                ["D", mutator("D", "4", Append)],
            ),
        }).applyToProcessEnvironment(env, undefined, false);
        expect(env).toEqual({ A: "1", B: "b:2", C: "3", D: "4" });
    });

    it("mutators of one variable from different extensions apply in reverse registration order", () => {
        const env: Record<string, string | undefined> = { PATH: "/usr/bin" };
        merged({
            "first.ext": collection(["PATH", mutator("PATH", "/first:", Prepend)]),
            "second.ext": collection(["PATH", mutator("PATH", "/second:", Prepend)]),
        }).applyToProcessEnvironment(env, undefined, false);
        expect(env.PATH).toBe("/first:/second:/usr/bin");
    });

    it("Replace from the first extension cuts off the mutators of the next ones", () => {
        const m = merged({
            "first.ext": collection(["V", mutator("V", "r", Replace)]),
            "second.ext": collection(["V", mutator("V", "+", Append)]),
        });
        expect(m.getVariableMap(undefined).get("V")).toEqual([
            { ...mutator("V", "r", Replace), extensionIdentifier: "first.ext" },
        ]);
        const env: Record<string, string | undefined> = { V: "orig" };
        m.applyToProcessEnvironment(env, undefined, false);
        expect(env.V).toBe("r");
    });

    it("Replace from the second extension applies last", () => {
        const env: Record<string, string | undefined> = { V: "orig" };
        merged({
            "first.ext": collection(["V", mutator("V", "+", Append)]),
            "second.ext": collection(["V", mutator("V", "r", Replace)]),
        }).applyToProcessEnvironment(env, undefined, false);
        expect(env.V).toBe("r+");
    });

    it("applyAtProcessCreation: false is not applied to the process; no options or true is applied", () => {
        const env: Record<string, string | undefined> = {};
        merged({
            "x.y": collection(
                [
                    "SKIP",
                    mutator("SKIP", "s", Replace, {
                        options: { applyAtProcessCreation: false, applyAtShellIntegration: true },
                    }),
                ],
                ["YES", mutator("YES", "y", Replace, { options: { applyAtProcessCreation: true } })],
                ["DEF", mutator("DEF", "d", Replace, { options: {} })],
            ),
        }).applyToProcessEnvironment(env, undefined, false);
        expect(env).toEqual({ YES: "y", DEF: "d" });
    });

    it("only ms-python.vscode-python-envs touches Python activation variables", () => {
        const env: Record<string, string | undefined> = {};
        merged({
            "other.ext": collection([
                "VSCODE_PYTHON_BASH_ACTIVATE",
                mutator("VSCODE_PYTHON_BASH_ACTIVATE", "x", Replace),
            ]),
            "ms-python.vscode-python-envs": collection([
                "VSCODE_PYTHON_ZSH_ACTIVATE",
                mutator("VSCODE_PYTHON_ZSH_ACTIVATE", "z", Replace),
            ]),
        }).applyToProcessEnvironment(env, undefined, false);
        expect(env).toEqual({ VSCODE_PYTHON_ZSH_ACTIVATE: "z" });
    });

    it("scope: global applies everywhere, folder only in a terminal of the same folder, scope without a folder nowhere", () => {
        const m = merged({
            "x.y": collection(
                ["G", mutator("G", "g", Replace)],
                ["F:::file:///a", mutator("F", "a", Replace, { scope: FOLDER_0 })],
                ["E", mutator("E", "e", Replace, { scope: {} })],
            ),
        });
        const inA: Record<string, string | undefined> = {};
        m.applyToProcessEnvironment(inA, FOLDER_0, false);
        expect(inA).toEqual({ G: "g", F: "a" });
        const inB: Record<string, string | undefined> = {};
        m.applyToProcessEnvironment(inB, FOLDER_1, false);
        expect(inB).toEqual({ G: "g" });
        const nowhere: Record<string, string | undefined> = {};
        m.applyToProcessEnvironment(nowhere, undefined, false);
        expect(nowhere).toEqual({ G: "g" });
        m.applyToProcessEnvironment(nowhere, {}, false);
        expect(nowhere).toEqual({ G: "g" });
    });

    it("Windows: the variable name is matched case-insensitively and written to the existing one", () => {
        const env: Record<string, string | undefined> = { Path: "C:\\bin" };
        merged({ "x.y": collection(["PATH", mutator("PATH", ";D:\\x", Append)]) }).applyToProcessEnvironment(
            env,
            undefined,
            true,
        );
        expect(env).toEqual({ Path: "C:\\bin;D:\\x" });
    });

    it("non-Windows: case is significant", () => {
        const env: Record<string, string | undefined> = { Path: "p" };
        merged({ "x.y": collection(["PATH", mutator("PATH", "q", Append)]) }).applyToProcessEnvironment(
            env,
            undefined,
            false,
        );
        expect(env).toEqual({ Path: "p", PATH: "q" });
    });

    it("an empty merge touches nothing", () => {
        const env: Record<string, string | undefined> = { A: "1" };
        merged({}).applyToProcessEnvironment(env, undefined, false);
        expect(env).toEqual({ A: "1" });
        expect(merged({}).getVariableMap(undefined).size).toBe(0);
    });
});
