import { Uri } from "../../../../base/common/uri.ts";
import type {
    IEnvironmentVariableScope,
    MergedEnvironmentVariableCollection,
} from "../../../../platform/terminal/common/environmentVariable.ts";
import type { IWorkspaceContextService } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";

/**
 * Upstream `TerminalProcessManager._resolveEnvironment`: called on every process launch, including a task
 * terminal relaunch; a terminal with `strictEnv` doesn't get it.
 */
export interface ITerminalEnvironmentContributor {
    apply(env: Record<string, string | undefined>, cwd: string): void;
}

/**
 * Upstream `getWorkspaceForTerminal`: the folder containing the terminal cwd, else the first root
 * (upstream: the last active one).
 */
export function terminalEnvironmentScope(
    cwd: string,
    workspace: Pick<IWorkspaceContextService, "getWorkspace" | "getWorkspaceFolder">,
): IEnvironmentVariableScope {
    const folder = workspace.getWorkspaceFolder(Uri.file(cwd)) ?? workspace.getWorkspace().folders.at(0);
    return folder === undefined
        ? {}
        : { workspaceFolder: { uri: folder.uri.toString(), name: folder.name, index: folder.index } };
}

/** Additions from the merged extension collections as of the process launch. */
export function createExtensionEnvironmentContributor(
    merged: () => MergedEnvironmentVariableCollection,
    workspace: Pick<IWorkspaceContextService, "getWorkspace" | "getWorkspaceFolder">,
    isWindows: boolean,
): ITerminalEnvironmentContributor {
    return {
        apply: (env, cwd) => {
            merged().applyToProcessEnvironment(env, terminalEnvironmentScope(cwd, workspace), isWindows);
        },
    };
}
