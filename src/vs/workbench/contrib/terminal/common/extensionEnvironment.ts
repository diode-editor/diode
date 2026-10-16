import { Uri } from "../../../../base/common/uri.ts";
import type {
    IEnvironmentVariableScope,
    MergedEnvironmentVariableCollection,
} from "../../../../platform/terminal/common/environmentVariable.ts";
import type { IWorkspaceContextService } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";

/**
 * Довесок к окружению процесса терминала — коллекции переменных окружения
 * расширений (`_resolveEnvironment` у `TerminalProcessManager` эталона).
 * Зовётся на каждый запуск процесса, в том числе перезапуск терминала задачи,
 * поверх унаследованного окружения и `env` терминала; терминал со
 * `strictEnv` его не получает (`shouldUseEnvironmentVariableCollection`).
 */
export interface ITerminalEnvironmentContributor {
    apply(env: Record<string, string | undefined>, cwd: string): void;
}

/**
 * Папка воркспейса терминала (`getWorkspaceForTerminal` эталона): та, в
 * которой лежит его cwd, иначе — корень воркспейса (у эталона «последний
 * активный корень»; у нас корень один, первый), без папок — без области.
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
