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
    it("the folder containing cwd", () => {
        expect(terminalEnvironmentScope("/w/b/src", workspace(["/w/a", "/w/b"]))).toEqual({
            workspaceFolder: { uri: "file:///w/b", name: "b", index: 1 },
        });
    });

    it("cwd outside folders — the first root", () => {
        expect(terminalEnvironmentScope("/tmp", workspace(["/w/a", "/w/b"]))).toEqual({
            workspaceFolder: { uri: "file:///w/a", name: "a", index: 0 },
        });
    });

    it("no folders — no scope", () => {
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

    it("merge uses the cwd folder scope and the merge current at launch time", () => {
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

    it("the Windows platform reaches the merge (name case)", () => {
        const env: Record<string, string | undefined> = { Path: "p" };
        createExtensionEnvironmentContributor(() => merged, workspace([]), true).apply(env, "/tmp");
        expect(env.Path).toBe("p;x");
        expect(env.PATH).toBeUndefined();
    });
});
