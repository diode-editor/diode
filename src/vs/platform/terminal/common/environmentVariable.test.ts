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
    it("Replace / Append / Prepend поверх окружения; отсутствующая переменная — как пустая", () => {
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

    it("мутаторы разных расширений одной переменной — в обратном порядке заведения", () => {
        const env: Record<string, string | undefined> = { PATH: "/usr/bin" };
        merged({
            "first.ext": collection(["PATH", mutator("PATH", "/first:", Prepend)]),
            "second.ext": collection(["PATH", mutator("PATH", "/second:", Prepend)]),
        }).applyToProcessEnvironment(env, undefined, false);
        expect(env.PATH).toBe("/first:/second:/usr/bin");
    });

    it("Replace первого расширения отсекает мутаторы следующих", () => {
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

    it("Replace второго расширения применяется последним", () => {
        const env: Record<string, string | undefined> = { V: "orig" };
        merged({
            "first.ext": collection(["V", mutator("V", "+", Append)]),
            "second.ext": collection(["V", mutator("V", "r", Replace)]),
        }).applyToProcessEnvironment(env, undefined, false);
        expect(env.V).toBe("r+");
    });

    it("applyAtProcessCreation: false — к процессу не применяется; без опций и с true — применяется", () => {
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

    it("переменные активации Python трогает только ms-python.vscode-python-envs", () => {
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

    it("область: глобальные — везде, папки — только в терминале той же папки, область без папки — нигде", () => {
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

    it("Windows: имя переменной сверяется без учёта регистра, пишется в существующее", () => {
        const env: Record<string, string | undefined> = { Path: "C:\\bin" };
        merged({ "x.y": collection(["PATH", mutator("PATH", ";D:\\x", Append)]) }).applyToProcessEnvironment(
            env,
            undefined,
            true,
        );
        expect(env).toEqual({ Path: "C:\\bin;D:\\x" });
    });

    it("не Windows: регистр различается", () => {
        const env: Record<string, string | undefined> = { Path: "p" };
        merged({ "x.y": collection(["PATH", mutator("PATH", "q", Append)]) }).applyToProcessEnvironment(
            env,
            undefined,
            false,
        );
        expect(env).toEqual({ Path: "p", PATH: "q" });
    });

    it("пустое слияние ничего не трогает", () => {
        const env: Record<string, string | undefined> = { A: "1" };
        merged({}).applyToProcessEnvironment(env, undefined, false);
        expect(env).toEqual({ A: "1" });
        expect(merged({}).getVariableMap(undefined).size).toBe(0);
    });
});
