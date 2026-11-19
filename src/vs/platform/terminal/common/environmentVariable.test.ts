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
        expect(env).toEqual({ YES: "y", DEF: "d", VSCODE_ENV_REPLACE: "SKIP=s" });
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

const AT_SHELL = { options: { applyAtProcessCreation: false, applyAtShellIntegration: true } };
const AT_BOTH = { options: { applyAtProcessCreation: true, applyAtShellIntegration: true } };

describe("MergedEnvironmentVariableCollection — applyAtShellIntegration (VSCODE_ENV_*)", () => {
    it("each type goes to its own variable as `<variable>=<value>`; `:` in the value is `\\x3a`, unicode and spaces as is", () => {
        const env: Record<string, string | undefined> = { PATH: "/usr/bin" };
        merged({
            "x.y": collection(
                ["PATH", mutator("PATH", "/opt/x/bin:", Prepend, AT_SHELL)],
                ["LIST", mutator("LIST", ":a:b", Append, AT_SHELL)],
                ["NAME", mutator("NAME", "Привет мир", Replace, AT_SHELL)],
            ),
        }).applyToProcessEnvironment(env, undefined, false);
        expect(env).toEqual({
            PATH: "/usr/bin",
            VSCODE_ENV_PREPEND: "PATH=/opt/x/bin\\x3a",
            VSCODE_ENV_APPEND: "LIST=\\x3aa\\x3ab",
            VSCODE_ENV_REPLACE: "NAME=Привет мир",
        });
    });

    it("both flags — the process gets the value and the script gets it again", () => {
        const env: Record<string, string | undefined> = { PATH: "/usr/bin" };
        merged({ "x.y": collection(["PATH", mutator("PATH", "/a:", Prepend, AT_BOTH)]) }).applyToProcessEnvironment(
            env,
            undefined,
            false,
        );
        expect(env).toEqual({ PATH: "/a:/usr/bin", VSCODE_ENV_PREPEND: "PATH=/a\\x3a" });
    });

    it("entries of several variables and extensions join with `:` in the order the mutators apply", () => {
        const env: Record<string, string | undefined> = {};
        merged({
            first: collection(
                ["PATH", mutator("PATH", "/first:", Prepend, AT_SHELL)],
                ["OTHER", mutator("OTHER", "o", Prepend, AT_SHELL)],
            ),
            second: collection(["PATH", mutator("PATH", "/second:", Prepend, AT_SHELL)]),
        }).applyToProcessEnvironment(env, undefined, false);
        expect(env).toEqual({ VSCODE_ENV_PREPEND: "PATH=/second\\x3a:PATH=/first\\x3a:OTHER=o" });
    });

    it("an inherited empty VSCODE_ENV_* gets no leading `:`; an inherited value is extended", () => {
        const empty: Record<string, string | undefined> = { VSCODE_ENV_APPEND: "" };
        const inherited: Record<string, string | undefined> = { VSCODE_ENV_APPEND: "A=1" };
        const m = merged({ "x.y": collection(["B", mutator("B", "2", Append, AT_SHELL)]) });
        m.applyToProcessEnvironment(empty, undefined, false);
        m.applyToProcessEnvironment(inherited, undefined, false);
        expect(empty).toEqual({ VSCODE_ENV_APPEND: "B=2" });
        expect(inherited).toEqual({ VSCODE_ENV_APPEND: "A=1:B=2" });
    });

    it("Windows: the entry carries the name the extension used, not the environment's spelling", () => {
        const env: Record<string, string | undefined> = { Path: "p" };
        merged({ "x.y": collection(["PATH", mutator("PATH", "q", Append, AT_SHELL)]) }).applyToProcessEnvironment(
            env,
            undefined,
            true,
        );
        expect(env).toEqual({ Path: "p", VSCODE_ENV_APPEND: "PATH=q" });
    });

    it("Python activation from another extension never reaches VSCODE_ENV_* either", () => {
        const env: Record<string, string | undefined> = {};
        merged({
            "other.ext": collection([
                "VSCODE_PYTHON_BASH_ACTIVATE",
                mutator("VSCODE_PYTHON_BASH_ACTIVATE", "evil", Replace, AT_SHELL),
            ]),
        }).applyToProcessEnvironment(env, undefined, false);
        expect(env).toEqual({});
    });
});

describe("MergedEnvironmentVariableCollection — getPathPrefix", () => {
    it("joins the Prepends to PATH in effect for the scope, in the order they apply; other types and variables are ignored", () => {
        const m = merged({
            first: collection(
                ["PATH", mutator("PATH", "/first:", Prepend, AT_SHELL)],
                ["MANPATH", mutator("MANPATH", "/man:", Prepend)],
            ),
            second: collection(["PATH", mutator("PATH", "/second:", Prepend)]),
        });
        expect(m.getPathPrefix(undefined)).toBe("/second:/first:");
    });

    it("a folder-scoped Prepend counts only in a terminal of that folder", () => {
        const m = merged({
            "x.y": collection(["PATH:::file:///b", mutator("PATH", "/b:", Prepend, { scope: FOLDER_1 })]),
        });
        expect(m.getPathPrefix(FOLDER_1)).toBe("/b:");
        expect(m.getPathPrefix(FOLDER_0)).toBeUndefined();
    });

    it("no Prepend to PATH — no prefix", () => {
        expect(merged({}).getPathPrefix(undefined)).toBeUndefined();
        expect(
            merged({ "x.y": collection(["PATH", mutator("PATH", ":/tail", Append)]) }).getPathPrefix(undefined),
        ).toBeUndefined();
    });
});
