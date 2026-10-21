import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { resolveWorkspaceStorageDir } from "../../../../platform/environment/node/userDataPaths.ts";
import type { WorkspaceId } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";

/**
 * Supplied by the host, which owns the user-data layout, not by the subprocess. Upstream: `IEnvironment`
 * (`extensionHostProtocol.ts`); `workspaceStorageHome` here already includes `/<workspace.id>`.
 */
export interface IExtensionStorageHomes {
    readonly globalStorageHome: string;
    /** `null` when no folder is open: the extension's `storageUri` is `undefined`, as in vscode. */
    readonly workspaceStorageHome: string | null;
    readonly logsHome: string;
}

export interface IExtensionStoragePaths {
    readonly globalStoragePath: string;
    readonly storagePath: string | null;
    readonly logPath: string;
}

/**
 * Id casing follows upstream, asymmetrically: `globalStorage` uses the lowercase id, the rest uses it
 * as is. Extensions look up already downloaded data (an AI completion engine) by the same rule.
 */
export function resolveExtensionStoragePaths(
    homes: IExtensionStorageHomes,
    extensionId: string,
): IExtensionStoragePaths {
    return {
        globalStoragePath: path.join(homes.globalStorageHome, extensionId.toLowerCase()),
        storagePath: homes.workspaceStorageHome === null ? null : path.join(homes.workspaceStorageHome, extensionId),
        logPath: path.join(homes.logsHome, extensionId),
    };
}

/**
 * vscode.d.ts guarantees the parent, the extension creates the directory itself. Best effort: inaccessible
 * user-data doesn't kill activation.
 */
export function ensureExtensionStorageParents(
    homes: IExtensionStorageHomes,
    onError?: (dir: string, err: unknown) => void,
): void {
    const dirs = [homes.globalStorageHome, homes.workspaceStorageHome, homes.logsHome];
    for (const dir of dirs) {
        if (dir === null) continue;
        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch (err) {
            onError?.(dir, err);
        }
    }
}

export interface IExtensionStorageUserDataPaths {
    readonly globalStorageDir: string;
    readonly workspaceStorageDir: string;
    readonly logsDir: string;
}

export function extensionStorageHomes(
    paths: IExtensionStorageUserDataPaths,
    workspaceId: WorkspaceId | null,
): IExtensionStorageHomes {
    return {
        globalStorageHome: paths.globalStorageDir,
        workspaceStorageHome:
            workspaceId === null ? null : resolveWorkspaceStorageDir(paths.workspaceStorageDir, workspaceId),
        logsHome: paths.logsDir,
    };
}

/** The API requires `globalStorageUri`, so without user-data we hand out a directory under the OS temp dir. */
export function fallbackExtensionStorageHomes(): IExtensionStorageHomes {
    const root = path.join(os.tmpdir(), "diode-extension-storage");
    return {
        globalStorageHome: path.join(root, "globalStorage"),
        workspaceStorageHome: null,
        logsHome: path.join(root, "logs"),
    };
}
