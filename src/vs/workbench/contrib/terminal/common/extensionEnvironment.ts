import { Uri } from "../../../../base/common/uri.ts";
import type {
    IEnvironmentVariableScope,
    MergedEnvironmentVariableCollection,
} from "../../../../platform/terminal/common/environmentVariable.ts";
import type { IWorkspaceContextService } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";

/**
 * `_resolveEnvironment` у `TerminalProcessManager` эталона: зовётся на каждый запуск процесса, в том
 * числе перезапуск терминала задачи; терминал со `strictEnv` его не получает.
 */
export interface ITerminalEnvironmentContributor {
    apply(env: Record<string, string | undefined>, cwd: string): void;
}

/** `getWorkspaceForTerminal` эталона: папка с cwd терминала, иначе первый корень (у эталона — последний активный). */
export function terminalEnvironmentScope(
    cwd: string,
    workspace: Pick<IWorkspaceContextService, "getWorkspace" | "getWorkspaceFolder">,
): IEnvironmentVariableScope {
    const folder = workspace.getWorkspaceFolder(Uri.file(cwd)) ?? workspace.getWorkspace().folders.at(0);
    return folder === undefined
        ? {}
        : { workspaceFolder: { uri: folder.uri.toString(), name: folder.name, index: folder.index } };
}

/** Довесок из слияния коллекций расширений, текущего на момент запуска процесса. */
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
