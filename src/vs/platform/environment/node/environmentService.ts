import * as os from "node:os";

import type { IEnvironmentService } from "../common/environment.ts";

import type { IUserDataPaths } from "./userDataPaths.ts";

/** Флаги командной строки, которые попадают в окружение. */
export interface IEnvironmentCliArgs {
    /** `--registry`. */
    readonly registry: string | undefined;
}

/**
 * Окружение процесса из резолва user data и флагов CLI. Тонкий адаптер над
 * {@link IUserDataPaths}: раскладку знает резолвер, здесь — только выбор того,
 * что видно сервисам.
 */
export function createEnvironmentService(
    paths: IUserDataPaths,
    cli: IEnvironmentCliArgs,
    userHome: string = os.homedir(),
): IEnvironmentService {
    return {
        userDataRoot: paths.root,
        extensionsDir: paths.extensionsDir,
        logsDir: paths.logsDir,
        registry: cli.registry,
        userHome,
        settingsResource: paths.settingsFile,
        keybindingsResource: paths.keybindingsFile,
        globalStorageDir: paths.globalStorageDir,
        workspaceStorageDir: paths.workspaceStorageDir,
        secretsFile: paths.secretsFile,
    };
}
