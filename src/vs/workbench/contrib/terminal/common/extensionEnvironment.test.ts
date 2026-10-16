import { describe, expect, it } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import {
    EnvironmentVariableMutatorType,
    MergedEnvironmentVariableCollection,
} from "../../../../platform/terminal/common/environmentVariable.ts";
import type { IWorkspaceFolder } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";

import { createExtensionEnvironmentContributor, terminalEnvironmentScope } from "./extensionEnvironment.ts";

function workspace(paths: string[]) {
    const folders: IWorkspaceFolder[] = paths.map((p, index) => ({
        uri: Uri.file(p),
        name: p.split("/").at(-1) ?? p,
        index,
    })) as IWorkspaceFolder[];
    return {
        getWorkspace: () => ({ folders }) as never,
        getWorkspaceFolder: (resource: Uri) =>
            folders.find((f) => resource.fsPath === f.uri.fsPath || resource.fsPath.startsWith(`${f.uri.fsPath}/`)) ??
            null,
    };
}

describe("terminalEnvironmentScope", () => {
    it("папка, в которой лежит cwd", () => {
        expect(terminalEnvironmentScope("/w/b/src", workspace(["/w/a", "/w/b"]))).toEqual({
            workspaceFolder: { uri: "file:///w/b", name: "b", index: 1 },
        });
    });

    it("cwd вне папок — первый корень", () => {
        expect(terminalEnvironmentScope("/tmp", workspace(["/w/a", "/w/b"]))).toEqual({
            workspaceFolder: { uri: "file:///w/a", name: "a", index: 0 },
        });
    });

    it("без папок — без области", () => {
        expect(terminalEnvironmentScope("/tmp", workspace([]))).toEqual({});
    });
});

describe("createExtensionEnvironmentContributor", () => {
    const merged = new MergedEnvironmentVariableCollection(
        new Map([
            [
                "x.y",
                {
                    map: new Map([
                        ["G", { variable: "G", value: "g", type: EnvironmentVariableMutatorType.Replace }],
                        [
                            "F:::file:///w/b",
                            {
                                variable: "F",
                                value: "b",
                                type: EnvironmentVariableMutatorType.Replace,
                                scope: { workspaceFolder: { uri: "file:///w/b", name: "b", index: 1 } },
                            },
                        ],
                        ["PATH", { variable: "PATH", value: ";x", type: EnvironmentVariableMutatorType.Append }],
                    ]),
                },
            ],
        ]),
    );

    it("слияние — с областью папки cwd, на текущем на момент запуска слиянии", () => {
        let current = new MergedEnvironmentVariableCollection(new Map());
        const contributor = createExtensionEnvironmentContributor(() => current, workspace(["/w/a", "/w/b"]), false);
        const before: Record<string, string | undefined> = {};
        contributor.apply(before, "/w/b");
        expect(before).toEqual({});
        current = merged;
        const inB: Record<string, string | undefined> = {};
        contributor.apply(inB, "/w/b/sub");
        expect(inB).toEqual({ G: "g", F: "b", PATH: ";x" });
        const inA: Record<string, string | undefined> = {};
        contributor.apply(inA, "/w/a");
        expect(inA).toEqual({ G: "g", PATH: ";x" });
    });

    it("платформа Windows доезжает до слияния (регистр имён)", () => {
        const env: Record<string, string | undefined> = { Path: "p" };
        createExtensionEnvironmentContributor(() => merged, workspace([]), true).apply(env, "/tmp");
        expect(env.Path).toBe("p;x");
        expect(env.PATH).toBeUndefined();
    });
});
