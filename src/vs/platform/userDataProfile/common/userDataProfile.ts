import * as path from "node:path";

import type { Event } from "../../../base/common/event.ts";
import { Uri } from "../../../base/common/uri.ts";
import { token } from "../../instantiation/common/diContainer.ts";
import type { IStateDescriptor } from "../../state/common/iStateService.ts";
import type { IWorkspace } from "../../workspace/common/iWorkspaceContextService.ts";

/**
 * Подмножество `IUserDataProfile` эталона (без snippets/tasks/prompts/mcp — docs/TODO/Profiles.md).
 * Отступление (решение человека): `id` — не случайный hex, а slug имени ({@link profileIdFromName})
 * и имя каталога в `User/profiles/`; переименование каталог не двигает, и id перестаёт
 * совпадать с именем.
 */
export interface IUserDataProfile {
    readonly id: string;
    readonly name: string;
    readonly isDefault: boolean;
    /** Каталог профиля: `User/` у Default, `User/profiles/<id>/` у именованного. */
    readonly location: string;
    readonly settingsResource: string;
    readonly keybindingsResource: string;
    /** `<location>/globalStorage` — родитель приватных каталогов расширений профиля. */
    readonly globalStorageHome: string;
    /** У именованного — `<location>/extensions.json`, у Default — в каталоге расширений (`getDefaultProfileExtensionsLocation` эталона). */
    readonly extensionsResource: string;
}

/** `.` и `..` запрещены: профиль с таким id делил бы файлы с Default, а его удаление сносило бы `User/`. */
export const PROFILE_ID_PATTERN = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;

/** `default` в `resolveUserDataPaths` значит Default-профиль: именованный с таким id писал бы в чужие файлы. */
export const RESERVED_PROFILE_ID = "default";

/** Предел длины id из имени: имя каталога ограничено ФС (255 байт), запас — под суффикс коллизии. */
export const MAX_PROFILE_ID_LENGTH = 64;

/** Каталог с таким именем (и любым расширением) Windows не создаёт; префикс — на любой ОС. */
const WINDOWS_DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

export function isValidProfileId(id: string): boolean {
    return PROFILE_ID_PATTERN.test(id) && id !== RESERVED_PROFILE_ID;
}

/** Как у эталона; в реестре не хранится. */
export const DEFAULT_PROFILE_ID = "__default__profile__";
export const DEFAULT_PROFILE_NAME = "Default";

export interface DidChangeProfilesEvent {
    readonly added: readonly IUserDataProfile[];
    readonly removed: readonly IUserDataProfile[];
    readonly updated: readonly IUserDataProfile[];
    readonly all: readonly IUserDataProfile[];
}

export interface IUserDataProfileUpdateOptions {
    readonly name?: string;
}

/**
 * Путь `.code-workspace`, иначе папки (как `getWorkspaceUri` эталона). Хранится путём, а не
 * хэшем, чтобы файл читался глазами.
 */
export type ProfileWorkspaceKey = string;

/** Один на установку, в application-состоянии; активный профиль процесса — в `IUserDataProfileService` workbench'а. */
export interface IUserDataProfilesService {
    readonly profilesHome: string;
    readonly defaultProfile: IUserDataProfile;
    /** Первый — Default. */
    readonly profiles: readonly IUserDataProfile[];
    readonly onDidChangeProfiles: Event<DidChangeProfilesEvent>;

    /** Пустой состав расширений (`extensions.json` = `[]`); с `workspace` — сразу привязывает. */
    createNamedProfile(name: string, workspace?: ProfileWorkspaceKey): Promise<IUserDataProfile>;
    /** Default не правится; каталог не переезжает. */
    updateProfile(profile: IUserDataProfile, options: IUserDataProfileUpdateOptions): Promise<IUserDataProfile>;
    /** Вместе с привязками и каталогом; Default не удаляется. */
    removeProfile(profile: IUserDataProfile): Promise<void>;

    /** Привязывает воркспейс к профилю; привязка к Default — снятие записи. */
    setProfileForWorkspace(workspace: ProfileWorkspaceKey, profile: IUserDataProfile): Promise<void>;
    /** Привязка на удалённый профиль — как её отсутствие. */
    getProfileForWorkspace(workspace: ProfileWorkspaceKey): IUserDataProfile | undefined;
}

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const IUserDataProfilesServiceDIToken = token<IUserDataProfilesService>("UserDataProfilesService");

/** `location` — относительно `profilesHome`, как у эталона. */
export interface StoredUserDataProfile {
    readonly name: string;
    readonly location: string;
}

/** Путь воркспейса → id профиля. */
export interface StoredProfileAssociations {
    readonly workspaces?: Readonly<Record<string, string>>;
}

/** Пустой список — ключ снимается. */
export const USER_DATA_PROFILES_STATE: IStateDescriptor<readonly StoredUserDataProfile[]> = {
    key: "userDataProfiles",
    scope: "application",
    default: [],
};

/** Без привязок — ключ снимается. */
export const PROFILE_ASSOCIATIONS_STATE: IStateDescriptor<StoredProfileAssociations> = {
    key: "profileAssociations",
    scope: "application",
    default: {},
};

export function toUserDataProfile(id: string, name: string, location: string): IUserDataProfile {
    return {
        id,
        name,
        isDefault: false,
        location,
        settingsResource: path.join(location, "settings.json"),
        keybindingsResource: path.join(location, "keybindings.json"),
        globalStorageHome: path.join(location, "globalStorage"),
        extensionsResource: path.join(location, "extensions.json"),
    };
}

/** `extensionsResource` не задан — `User/extensions.json`. */
export function createDefaultProfile(defaultProfileHome: string, extensionsResource?: string): IUserDataProfile {
    const profile = toUserDataProfile(DEFAULT_PROFILE_ID, DEFAULT_PROFILE_NAME, defaultProfileHome);
    return { ...profile, isDefault: true, extensionsResource: extensionsResource ?? profile.extensionsResource };
}

/**
 * Пустой остаток или одни точки — `profile`, имя устройства Windows — с префиксом `profile-`,
 * коллизия — суффикс `-2`, `-3`, … Регистр сохраняется, но занятость сравнивается без него:
 * на macOS и Windows `Work` и `work` — один каталог.
 */
export function profileIdFromName(name: string, taken: readonly string[]): string {
    // Пробелы по краям схлопываются в `-` и срезаются вместе с ним — отдельный trim не нужен.
    const slug = name
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .slice(0, MAX_PROFILE_ID_LENGTH)
        .replace(/^-+|-+$/g, "");
    const base = /^\.*$/.test(slug) ? "profile" : WINDOWS_DEVICE_NAMES.test(slug) ? `profile-${slug}` : slug;
    // Stryker disable next-line all: страховка инварианта — slug по построению всегда проходит шаблон
    if (!PROFILE_ID_PATTERN.test(base)) throw new Error(`Cannot derive a profile id from "${name}"`);
    const occupied = new Set([...taken, RESERVED_PROFILE_ID].map((id) => id.toLowerCase()));
    if (!occupied.has(base.toLowerCase())) return base;
    for (let i = 2; ; i += 1) {
        const candidate = `${base}-${String(i)}`;
        if (!occupied.has(candidate.toLowerCase())) return candidate;
    }
}

/**
 * Ключ привязки по пути папки или файла `.code-workspace`: абсолютный путь в
 * форме `fsPath` (на Windows — с буквой диска в нижнем регистре), чтобы
 * бутстрап (строка из argv) и окно (`IWorkspace` с `Uri`) считали одно и то же.
 */
export function profileWorkspaceKeyOf(workspacePath: string): ProfileWorkspaceKey {
    return Uri.file(path.resolve(workspacePath)).fsPath;
}

/** Ключ привязки открытого воркспейса; `undefined` у пустого окна. */
export function profileWorkspaceKey(workspace: IWorkspace): ProfileWorkspaceKey | undefined {
    const target = workspace.configuration ?? workspace.folders.at(0)?.uri;
    return target === undefined ? undefined : profileWorkspaceKeyOf(target.fsPath);
}

/**
 * Активный профиль окна на старте — в порядке эталона
 * (`resolveProfileForBrowserWindow` в `windowsMainService.ts`):
 * `--profile <name>` → привязка воркспейса → Default. Неизвестное имя во флаге
 * создаёт пустой профиль; с открытым воркспейсом флаг ещё и привязывает его
 * (описание флага в `platform/environment/node/argv.ts` эталона). Привязка на
 * удалённый профиль — как её отсутствие.
 */
export async function resolveActiveProfile(
    profiles: IUserDataProfilesService,
    input: { readonly forceProfile?: string | undefined; readonly workspace?: ProfileWorkspaceKey | undefined },
): Promise<IUserDataProfile> {
    const forced = input.forceProfile?.trim();
    if (forced !== undefined && forced.length > 0) {
        const profile = profiles.profiles.find((p) => p.name === forced) ?? (await profiles.createNamedProfile(forced));
        if (input.workspace !== undefined) await profiles.setProfileForWorkspace(input.workspace, profile);
        return profile;
    }
    return profileForWorkspace(profiles, input.workspace);
}

/**
 * Профиль воркспейса: его привязка, иначе Default. У пустого окна (ключа нет)
 * привязки не бывает — Default.
 */
export function profileForWorkspace(
    profiles: IUserDataProfilesService,
    workspace: ProfileWorkspaceKey | undefined,
): IUserDataProfile {
    const associated = workspace === undefined ? undefined : profiles.getProfileForWorkspace(workspace);
    return associated ?? profiles.defaultProfile;
}
