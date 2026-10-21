import * as os from "node:os";

import type { IEnvironmentService } from "../common/environment.ts";

import type { IUserDataPaths } from "./userDataPaths.ts";

export interface IEnvironmentCliArgs {
    readonly registry: string | undefined;
}

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
