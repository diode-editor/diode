import * as path from "node:path";

import { PROFILE_ID_PATTERN, RESERVED_PROFILE_ID } from "../../userDataProfile/common/userDataProfile.ts";
import type { WorkspaceId } from "../../workspace/common/iWorkspaceContextService.ts";

/**
 * Layout (docs/arch/Configuration.md, docs/arch/State.md):
 *
 *     <root>/
 *       extensions/                      ← external extensions, flat (relocated by `--extensions-dir`)
 *       user-data/
 *         logs/                          ← logs; `<extId>` inside = ExtensionContext.logUri
 *         User/                          ← Default profile
 *           settings.json
 *           keybindings.json
 *           globalState.json             ← machine state (global scope)
 *           secrets.json                 ← ExtensionContext.secrets (0600, unencrypted)
 *           globalStorage/               ← private extension directories (global)
 *             storage.json               ← application scope state: profile registry
 *                                          and workspace bindings (one per installation)
 *             <extId>/                   ← ExtensionContext.globalStorageUri
 *           workspaceStorage/            ← per-project machine state
 *             <sha256(folder)>/state.json
 *             <sha256(folder)>/<extId>/  ← ExtensionContext.storageUri
 *           profiles/
 *             <profileId>/               ← named profiles (id is the name's slug,
 *               settings.json              registry in storage.json, see
 *               keybindings.json           platform/userDataProfile/)
 *               globalState.json
 *               secrets.json
 *               globalStorage/
 *               workspaceStorage/
 *
 * Receives the profile **id** (directory name), not its name: the mapping is known to
 * `IUserDataProfilesService`.
 */
export interface IUserDataPaths {
    readonly root: string;
    readonly extensionsDir: string;
    readonly userDataDir: string;
    readonly userDir: string;
    readonly profilesHome: string;
    /** One per installation, outside the profile: profile registry and workspace bindings. */
    readonly applicationStateFile: string;
    /** Id (directory) of the active profile. */
    readonly profileName: string;
    readonly isDefaultProfile: boolean;
    readonly profileDir: string;
    readonly settingsFile: string;
    readonly keybindingsFile: string;
    readonly globalStateFile: string;
    /**
     * Per-profile: work profile tokens must not be visible from a personal one.
     * **Plain text under `0600`**: there is no OS keychain integration (`extensionSecretsStore.ts`).
     */
    readonly secretsFile: string;
    /** Under `profileDir`, not `userDir`: named profiles are isolated. */
    readonly workspaceStorageDir: string;
    readonly globalStorageDir: string;
    /** Outside the profile. Unlike upstream, no `logs/<timestamp>/` session subdirectory: no per-launch rotation. */
    readonly logsDir: string;
}

/** The profile registry never hands this id to a named profile. */
export const DEFAULT_PROFILE_NAME = RESERVED_PROFILE_ID;

export const DEFAULT_USER_DATA_ROOT_NAME = ".diode";

export interface IResolveUserDataPathsOptions {
    readonly userDataDir?: string;
    /** An id, not a name: the profile registry turns names into ids (`profileIdFromName`). */
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
 * Takes an **id**, not a folder path: store addressing must not know what the
 * identity is derived from (`docs/TODO/MultiRoot.md`, M8).
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
