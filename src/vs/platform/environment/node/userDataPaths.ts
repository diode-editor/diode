import * as path from "node:path";

import { PROFILE_ID_PATTERN, RESERVED_PROFILE_ID } from "../../userDataProfile/common/userDataProfile.ts";
import type { WorkspaceId } from "../../workspace/common/iWorkspaceContextService.ts";

/**
 * Раскладка (docs/arch/Configuration.md, docs/arch/State.md):
 *
 *     <root>/
 *       extensions/                      ← внешние расширения, плоско (переносится `--extensions-dir`)
 *       user-data/
 *         logs/                          ← логи; `<extId>` внутри = ExtensionContext.logUri
 *         User/                          ← Default-профиль
 *           settings.json
 *           keybindings.json
 *           globalState.json             ← машинное состояние (global scope)
 *           secrets.json                 ← ExtensionContext.secrets (0600, без шифрования)
 *           globalStorage/               ← приватные каталоги расширений (global)
 *             storage.json               ← состояние application scope: реестр профилей
 *                                          и привязки к воркспейсам (один на установку)
 *             <extId>/                   ← ExtensionContext.globalStorageUri
 *           workspaceStorage/            ← машинное состояние по проектам
 *             <sha256(folder)>/state.json
 *             <sha256(folder)>/<extId>/  ← ExtensionContext.storageUri
 *           profiles/
 *             <profileId>/               ← именованные профили (id — slug имени,
 *               settings.json              реестр — в storage.json, см.
 *               keybindings.json           platform/userDataProfile/)
 *               globalState.json
 *               secrets.json
 *               globalStorage/
 *               workspaceStorage/
 *
 * Сюда приходит **id** профиля (имя каталога), а не имя: соответствие знает
 * `IUserDataProfilesService`.
 */
export interface IUserDataPaths {
    readonly root: string;
    readonly extensionsDir: string;
    readonly userDataDir: string;
    readonly userDir: string;
    readonly profilesHome: string;
    /** Один на установку, вне профиля: реестр профилей и привязки к воркспейсам. */
    readonly applicationStateFile: string;
    /** Id (каталог) активного профиля. */
    readonly profileName: string;
    readonly isDefaultProfile: boolean;
    readonly profileDir: string;
    readonly settingsFile: string;
    readonly keybindingsFile: string;
    readonly globalStateFile: string;
    /**
     * Per-profile: токены рабочего профиля не должны быть видны из личного.
     * **Открытым текстом под `0600`** — связки ключей ОС у нас нет (`extensionSecretsStore.ts`).
     */
    readonly secretsFile: string;
    /** Под `profileDir`, а не `userDir`: именованные профили изолированы. */
    readonly workspaceStorageDir: string;
    readonly globalStorageDir: string;
    /** Вне профиля. Отличие от эталона: без подкаталога сессии `logs/<timestamp>/` — ротации по запускам нет. */
    readonly logsDir: string;
}

/** Реестр профилей этот id именованным не выдаёт. */
export const DEFAULT_PROFILE_NAME = RESERVED_PROFILE_ID;

export const DEFAULT_USER_DATA_ROOT_NAME = ".diode";

export interface IResolveUserDataPathsOptions {
    readonly userDataDir?: string;
    /** Id, не имя: имя в id превращает реестр профилей (`profileIdFromName`). */
    readonly profile?: string;
    readonly extensionsDir?: string;
    readonly homedir: string;
}

export function resolveUserDataPaths(options: IResolveUserDataPathsOptions): IUserDataPaths {
    const profileName = normalizeProfileName(options.profile);
    const root =
        options.userDataDir !== undefined && options.userDataDir.length > 0
            ? path.resolve(options.userDataDir)
            : path.resolve(options.homedir, DEFAULT_USER_DATA_ROOT_NAME);

    const extensionsDir =
        options.extensionsDir !== undefined && options.extensionsDir.length > 0
            ? path.resolve(options.extensionsDir)
            : path.join(root, "extensions");
    const userDataDir = path.join(root, "user-data");
    const userDir = path.join(userDataDir, "User");
    const isDefaultProfile = profileName === DEFAULT_PROFILE_NAME;
    const profileDir = isDefaultProfile ? userDir : path.join(userDir, "profiles", profileName);

    return {
        root,
        extensionsDir,
        userDataDir,
        userDir,
        profilesHome: path.join(userDir, "profiles"),
        applicationStateFile: path.join(userDir, "globalStorage", "storage.json"),
        profileName,
        isDefaultProfile,
        profileDir,
        settingsFile: path.join(profileDir, "settings.json"),
        keybindingsFile: path.join(profileDir, "keybindings.json"),
        globalStateFile: path.join(profileDir, "globalState.json"),
        secretsFile: path.join(profileDir, "secrets.json"),
        workspaceStorageDir: path.join(profileDir, "workspaceStorage"),
        globalStorageDir: path.join(profileDir, "globalStorage"),
        logsDir: path.join(userDataDir, "logs"),
    };
}

/**
 * Принимает **id**, а не путь папки: адресация сторов не должна знать, из чего
 * идентичность выведена (`docs/TODO/MultiRoot.md`, M8).
 */
export function resolveWorkspaceStorageDir(workspaceStorageDir: string, workspaceId: WorkspaceId): string {
    return path.join(workspaceStorageDir, workspaceId);
}

export function resolveWorkspaceStatePath(workspaceStorageDir: string, workspaceId: WorkspaceId): string {
    return path.join(resolveWorkspaceStorageDir(workspaceStorageDir, workspaceId), "state.json");
}

function normalizeProfileName(raw: string | undefined): string {
    if (raw === undefined) return DEFAULT_PROFILE_NAME;
    const trimmed = raw.trim();
    if (trimmed.length === 0) return DEFAULT_PROFILE_NAME;
    if (!PROFILE_ID_PATTERN.test(trimmed)) {
        throw new Error(`Invalid profile id "${raw}": only letters, digits, ".", "_" and "-" are allowed`);
    }
    return trimmed;
}
