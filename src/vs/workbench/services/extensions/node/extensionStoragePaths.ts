import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { resolveWorkspaceStorageDir } from "../../../../platform/environment/node/userDataPaths.ts";
import type { WorkspaceId } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";

/**
 * Даёт хост — владелец раскладки user-data, а не субпроцесс. Эталон — `IEnvironment`
 * (`extensionHostProtocol.ts`); `workspaceStorageHome` здесь уже с `/<workspace.id>`.
 */
export interface IExtensionStorageHomes {
    readonly globalStorageHome: string;
    /** `null` — папка не открыта: `storageUri` у расширения `undefined`, как в vscode. */
    readonly workspaceStorageHome: string | null;
    readonly logsHome: string;
}

export interface IExtensionStoragePaths {
    readonly globalStoragePath: string;
    readonly storagePath: string | null;
    readonly logPath: string;
}

/**
 * Регистр id — как в эталоне, с асимметрией: `globalStorage` по lowercase id, остальное как
 * есть. Расширение ищет уже скачанное (движок AI-автодополнения) по тому же правилу.
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

/** Родителя гарантирует vscode.d.ts, сам каталог создаёт расширение. Best effort: недоступный user-data не рубит активацию. */
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

/** `globalStorageUri` по API обязателен — без user-data отдаём каталог во временных файлах ОС. */
export function fallbackExtensionStorageHomes(): IExtensionStorageHomes {
    const root = path.join(os.tmpdir(), "diode-extension-storage");
    return {
        globalStorageHome: path.join(root, "globalStorage"),
        workspaceStorageHome: null,
        logsHome: path.join(root, "logs"),
    };
}
