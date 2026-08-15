import * as crypto from "node:crypto";
import * as path from "node:path";

/**
 * Резолв путей user data в стиле VS Code. Полностью pure — никакого I/O.
 *
 * Раскладка (см. docs/arch/Configuration.md, docs/arch/State.md):
 *
 *     <root>/
 *       extensions/                      ← внешние расширения, плоско
 *       user-data/
 *         User/                          ← default-профиль
 *           settings.json
 *           keybindings.json
 *           globalState.json             ← машинное состояние (global scope)
 *           workspaceStorage/            ← машинное состояние по проектам
 *             <sha256(folder)>/state.json
 *           profiles/
 *             <profileName>/             ← именованные профили
 *               settings.json
 *               keybindings.json
 *               globalState.json
 *
 * Активный профиль `default` использует файлы прямо в `User/`. Любое другое
 * имя кладёт файлы в `User/profiles/<name>/`.
 */
export interface IUserDataPaths {
    /** Корень — `<userDataDir>` (то, что было передано через `--user-data-dir` или дефолт `~/.diode`). */
    readonly root: string;
    /** Каталог внешних расширений: `<root>/extensions`. */
    readonly extensionsDir: string;
    /** `<root>/user-data`. */
    readonly userDataDir: string;
    /** `<root>/user-data/User`. */
    readonly userDir: string;
    /** Имя активного профиля. `"default"` для default-профиля. */
    readonly profileName: string;
    /** `true`, если активен default-профиль. */
    readonly isDefaultProfile: boolean;
    /** Каталог настроек активного профиля: `userDir` (default) или `userDir/profiles/<name>`. */
    readonly profileDir: string;
    /** `<profileDir>/settings.json` — основной settings.json активного профиля. */
    readonly settingsFile: string;
    /** `<profileDir>/keybindings.json`. */
    readonly keybindingsFile: string;
    /**
     * `<profileDir>/globalState.json` — машинное состояние UI/сессии в области
     * `global` (см. docs/arch/State.md). Per-profile: смена `--profile` даёт
     * отдельный global-state. Отдельно от человекочитаемого `settings.json`.
     */
    readonly globalStateFile: string;
    /**
     * `<profileDir>/workspaceStorage` — корень per-project состояния. Конкретный
     * файл проекта резолвится {@link resolveWorkspaceStatePath}. Под `profileDir`
     * (а не `userDir`), чтобы именованные профили были изолированы так же, как
     * `globalStateFile`.
     */
    readonly workspaceStorageDir: string;
}

export const DEFAULT_PROFILE_NAME = "default";

/** Имя корневого каталога user data в `homedir()`. */
export const DEFAULT_USER_DATA_ROOT_NAME = ".diode";

export interface IResolveUserDataPathsOptions {
    /** Абсолютный путь — если задан, замещает дефолт `~/.diode`. */
    readonly userDataDir?: string;
    /** Имя профиля. По умолчанию `"default"`. */
    readonly profile?: string;
    /** Хоум-каталог пользователя. Передаётся явно ради тестируемости. */
    readonly homedir: string;
}

/**
 * Резолвит набор путей user data. Не создаёт каталоги, не читает FS.
 * Все возвращаемые пути — абсолютные (через `path.resolve`).
 */
export function resolveUserDataPaths(options: IResolveUserDataPathsOptions): IUserDataPaths {
    const profileName = normalizeProfileName(options.profile);
    const root =
        options.userDataDir !== undefined && options.userDataDir.length > 0
            ? path.resolve(options.userDataDir)
            : path.resolve(options.homedir, DEFAULT_USER_DATA_ROOT_NAME);

    const extensionsDir = path.join(root, "extensions");
    const userDataDir = path.join(root, "user-data");
    const userDir = path.join(userDataDir, "User");
    const isDefaultProfile = profileName === DEFAULT_PROFILE_NAME;
    const profileDir = isDefaultProfile ? userDir : path.join(userDir, "profiles", profileName);

    return {
        root,
        extensionsDir,
        userDataDir,
        userDir,
        profileName,
        isDefaultProfile,
        profileDir,
        settingsFile: path.join(profileDir, "settings.json"),
        keybindingsFile: path.join(profileDir, "keybindings.json"),
        globalStateFile: path.join(profileDir, "globalState.json"),
        workspaceStorageDir: path.join(profileDir, "workspaceStorage"),
    };
}

/**
 * Резолвит путь к state.json конкретного проекта внутри `workspaceStorageDir`.
 * Ключ каталога — sha256 от абсолютного (нормализованного) пути папки, как в
 * VS Code (`workspaceStorage/<hash>/`). Pure, без I/O.
 *
 * @param workspaceStorageDir корень хранилища (`IUserDataPaths.workspaceStorageDir`)
 * @param folderPath путь к папке-воркспейсу (резолвится в абсолютный)
 */
export function resolveWorkspaceStatePath(workspaceStorageDir: string, folderPath: string): string {
    const resolved = path.resolve(folderPath);
    const hash = crypto.createHash("sha256").update(resolved).digest("hex");
    return path.join(workspaceStorageDir, hash, "state.json");
}

function normalizeProfileName(raw: string | undefined): string {
    if (raw === undefined) return DEFAULT_PROFILE_NAME;
    const trimmed = raw.trim();
    if (trimmed.length === 0) return DEFAULT_PROFILE_NAME;
    if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
        throw new Error(`Invalid profile name "${raw}": only letters, digits, ".", "_" and "-" are allowed`);
    }
    return trimmed;
}
