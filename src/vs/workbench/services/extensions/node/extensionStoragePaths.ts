import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { resolveWorkspaceStorageDir } from "../../../../platform/environment/node/userDataPaths.ts";

/**
 * Корни приватных каталогов расширений. Их даёт ХОСТ (владелец user-data), а не
 * субпроцесс: раскладка `<user-data-dir>/user-data/...` — знание уровня
 * приложения, и выдумывать её из env субпроцессу нельзя.
 *
 * Соответствие эталону vscode (`IEnvironment` в `extensionHostProtocol.ts`):
 * `globalStorageHome` ↔ `globalStorageHome`, `workspaceStorageHome` ↔
 * `workspaceStorageHome/<workspace.id>` (у нас id папки — sha256, см.
 * `resolveWorkspaceStorageDir`), `logsHome` ↔ `logsLocation`.
 */
export interface IExtensionStorageHomes {
    /** Родитель каталогов `globalStorageUri` (`<profileDir>/globalStorage`). */
    readonly globalStorageHome: string;
    /**
     * Родитель каталогов `storageUri` (`<workspaceStorageDir>/<hash(folder)>`).
     * `null` — папка/воркспейс не открыт: тогда `storageUri` у расширения
     * `undefined`, как и в vscode.
     */
    readonly workspaceStorageHome: string | null;
    /** Родитель каталогов `logUri` (`<userDataDir>/logs`). */
    readonly logsHome: string;
}

/** Пути одного расширения — то, что уезжает в `host.activateExtension`. */
export interface IExtensionStoragePaths {
    /** `ExtensionContext.globalStorageUri` / `globalStoragePath`. */
    readonly globalStoragePath: string;
    /** `ExtensionContext.storageUri` / `storagePath`; `null` — папка не открыта. */
    readonly storagePath: string | null;
    /** `ExtensionContext.logUri` / `logPath`. */
    readonly logPath: string;
}

/**
 * Резолвит каталоги одного расширения внутри корней. Pure, без I/O.
 *
 * Регистр id повторяет эталон дословно, включая его асимметрию:
 * `globalStorage` — по **lowercase** id (`ExtensionStoragePaths.globalValue`:
 * `identifier.value.toLowerCase()`), `workspaceStorage` и `logs` — по id как
 * есть (`workspaceValue`, `logUri`). Для нас это важно, потому что каталог с
 * уже скачанным движком AI-автодополнения ищется расширением по тому же
 * правилу, по которому мы его отдали.
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
 * Создаёт РОДИТЕЛЬСКИЕ каталоги. Контракт vscode.d.ts: сам каталог расширения
 * «might not exist and creation is up to the extension», но «the parent
 * directory is guaranteed to be existent» — за эту половину отвечаем мы.
 *
 * Best effort: недоступный на запись user-data не должен рубить активацию —
 * расширение упадёт (или не упадёт) на своём `mkdir`, а остальные будут жить.
 * `onError` получает каждую неудачу (хост пишет её в свой лог-канал).
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

/** Пути user-data, из которых собираются корни (подмножество `IUserDataPaths`). */
export interface IExtensionStorageUserDataPaths {
    readonly globalStorageDir: string;
    readonly workspaceStorageDir: string;
    readonly logsDir: string;
}

/**
 * Собирает корни из путей user-data и ТЕКУЩЕЙ папки воркспейса. Pure, без I/O.
 *
 * Папки нет (`null`) ⇒ воркспейсного корня нет ⇒ `storageUri` у расширения
 * `undefined` — семантика vscode: «The value is `undefined` when no workspace
 * nor folder has been opened». Два других корня от папки не зависят.
 */
export function extensionStorageHomes(
    paths: IExtensionStorageUserDataPaths,
    workspaceFolder: string | null,
): IExtensionStorageHomes {
    return {
        globalStorageHome: paths.globalStorageDir,
        workspaceStorageHome:
            workspaceFolder === null ? null : resolveWorkspaceStorageDir(paths.workspaceStorageDir, workspaceFolder),
        logsHome: paths.logsDir,
    };
}

/**
 * Корни для {@link ExtensionHost}, поднятого без user-data (юнит-тесты,
 * харнессы, встроенные прогоны). `globalStorageUri` по API необязательным быть
 * не может, поэтому «нет хранилища» — не вариант: отдаём каталог во временных
 * файлах ОС. Воркспейсного корня тут нет — у такого хоста и папки нет, так что
 * `storageUri` честно `undefined`.
 */
export function fallbackExtensionStorageHomes(): IExtensionStorageHomes {
    const root = path.join(os.tmpdir(), "diode-extension-storage");
    return {
        globalStorageHome: path.join(root, "globalStorage"),
        workspaceStorageHome: null,
        logsHome: path.join(root, "logs"),
    };
}
