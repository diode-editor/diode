import * as path from "node:path";

import { PROFILE_ID_PATTERN, RESERVED_PROFILE_ID } from "../../userDataProfile/common/userDataProfile.ts";
import type { WorkspaceId } from "../../workspace/common/iWorkspaceContextService.ts";

/**
 * Резолв путей user data в стиле VS Code. Полностью pure — никакого I/O.
 *
 * Раскладка (см. docs/arch/Configuration.md, docs/arch/State.md):
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
 * Default-профиль использует файлы прямо в `User/`. Именованный кладёт их в
 * `User/profiles/<id>/`: сюда приходит **id** (имя каталога) из реестра
 * профилей — соответствие имени профиля и каталога знает `IUserDataProfilesService`,
 * а не резолвер путей.
 */
export interface IUserDataPaths {
    /** Корень — `<userDataDir>` (то, что было передано через `--user-data-dir` или дефолт `~/.diode`). */
    readonly root: string;
    /** Каталог внешних расширений: `<root>/extensions` либо override `--extensions-dir`. */
    readonly extensionsDir: string;
    /** `<root>/user-data`. */
    readonly userDataDir: string;
    /** `<root>/user-data/User`. */
    readonly userDir: string;
    /** `<userDir>/profiles` — родитель каталогов именованных профилей (`profilesHome` эталона). */
    readonly profilesHome: string;
    /**
     * `<userDir>/globalStorage/storage.json` — состояние области `application`
     * (см. docs/arch/State.md): один файл на установку, вне профиля, — реестр
     * профилей и привязки к воркспейсам. Тот же путь, что у эталона.
     */
    readonly applicationStateFile: string;
    /** Id (каталог) активого профиля. `"default"` для Default-профиля. */
    readonly profileName: string;
    /** `true`, если активен Default-профиль. */
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
     * `<profileDir>/secrets.json` — секреты расширений
     * (`ExtensionContext.secrets`), по одному лотку на расширение. Per-profile,
     * как `globalStateFile`: токены рабочего профиля не должны быть видны из
     * личного. **Открытым текстом под правами `0600`** — связки ключей ОС у нас
     * нет, и замалчивать это нельзя (см. `extensionSecretsStore.ts`).
     */
    readonly secretsFile: string;
    /**
     * `<profileDir>/workspaceStorage` — корень per-project состояния. Конкретный
     * файл проекта резолвится {@link resolveWorkspaceStatePath}. Под `profileDir`
     * (а не `userDir`), чтобы именованные профили были изолированы так же, как
     * `globalStateFile`.
     */
    readonly workspaceStorageDir: string;
    /**
     * `<profileDir>/globalStorage` — родитель приватных каталогов расширений в
     * области `global` (`ExtensionContext.globalStorageUri` = `<этот>/<extId>`).
     * Под `profileDir` — как `globalStateFile`, и как `User/globalStorage` в
     * VS Code (там он тоже переезжает вместе с профилем).
     */
    readonly globalStorageDir: string;
    /**
     * `<userDataDir>/logs` — родитель каталогов логов расширений
     * (`ExtensionContext.logUri` = `<этот>/<extId>`). Вне профиля — как `logs/`
     * рядом с `User/` в VS Code. Отличие от эталона: у нас без подкаталога
     * сессии (`logs/<timestamp>/`) — ротации логов по запускам у нас нет.
     */
    readonly logsDir: string;
}

/** Id Default-профиля для путей; реестр профилей его именованным не выдаёт. */
export const DEFAULT_PROFILE_NAME = RESERVED_PROFILE_ID;

/** Имя корневого каталога user data в `homedir()`. */
export const DEFAULT_USER_DATA_ROOT_NAME = ".diode";

export interface IResolveUserDataPathsOptions {
    /** Абсолютный путь — если задан, замещает дефолт `~/.diode`. */
    readonly userDataDir?: string;
    /**
     * Id активного профиля — имя его каталога в `User/profiles/`. По умолчанию
     * `"default"` (файлы прямо в `User/`). Имя пользователя в id превращает
     * реестр профилей (`profileIdFromName`), сюда приходит уже готовый.
     */
    readonly profile?: string;
    /**
     * Каталог внешних расширений (`--extensions-dir`). Замещает дефолт
     * `<root>/extensions`, не трогая остальную раскладку: расширения можно
     * держать отдельно от настроек и состояния, как в VS Code.
     */
    readonly extensionsDir?: string;
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
 * Резолвит каталог конкретного проекта внутри `workspaceStorageDir`. Ключ
 * каталога — {@link WorkspaceId}, идентичность воркспейса (её считает
 * `computeWorkspaceId`, `platform/workspace/common/workspaceId.ts`; формат на
 * диске — `workspaceStorage/<id>/`, как в VS Code). Pure, без I/O.
 *
 * Функция принимает именно **id**, а не путь папки: адресация per-workspace
 * сторов не должна знать, из чего идентичность выведена — иначе подмена «набор
 * папок / `.code-workspace` = один проект» превращается в раскопки по всем
 * вызывающим (см. `docs/TODO/MultiRoot.md`, M8).
 *
 * В каталоге лежит и наше `state.json` ({@link resolveWorkspaceStatePath}), и
 * приватные каталоги расширений (`<id>/<extId>` = `ExtensionContext.storageUri`) —
 * ровно как в VS Code, где рядом с `state.vscdb` живут те же `<extId>`.
 *
 * @param workspaceStorageDir корень хранилища (`IUserDataPaths.workspaceStorageDir`)
 * @param workspaceId идентичность воркспейса
 */
export function resolveWorkspaceStorageDir(workspaceStorageDir: string, workspaceId: WorkspaceId): string {
    return path.join(workspaceStorageDir, workspaceId);
}

/**
 * Резолвит путь к state.json конкретного проекта внутри `workspaceStorageDir`.
 * Pure, без I/O.
 *
 * @param workspaceStorageDir корень хранилища (`IUserDataPaths.workspaceStorageDir`)
 * @param workspaceId идентичность воркспейса
 */
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
