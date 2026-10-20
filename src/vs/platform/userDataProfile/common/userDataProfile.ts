import * as path from "node:path";

import type { Event } from "../../../base/common/event.ts";
import { Uri } from "../../../base/common/uri.ts";
import { token } from "../../instantiation/common/diContainer.ts";
import type { IStateDescriptor } from "../../state/common/iStateService.ts";
import type { IWorkspace } from "../../workspace/common/iWorkspaceContextService.ts";

/**
 * Профиль пользователя — набор настроек/кейбиндов/состояния, который можно
 * переключать (аналог `IUserDataProfile` эталона,
 * `platform/userDataProfile/common/userDataProfile.ts`). Подмножество: без
 * snippets/tasks/prompts/mcp и `useDefaultFlags` (docs/TODO/Profiles.md,
 * итерация 3). Пути — абсолютные строки, как везде в `IEnvironmentService`.
 *
 * Отступление от эталона: `id` — не случайный hex, а slug имени
 * ({@link profileIdFromName}), и он же — имя каталога в `User/profiles/`.
 * Переименование каталог не двигает, поэтому после него id перестаёт совпадать
 * с именем (решение человека, отступления — docs/arch/Configuration.md, «Профили»).
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
    /**
     * Какие из установленных расширений включены в профиле
     * (`platform/extensionManagement/node/profileExtensions.ts`): у именованного —
     * `<location>/extensions.json`, у Default — `extensions.json` в самом каталоге
     * расширений (`getDefaultProfileExtensionsLocation` эталона).
     */
    readonly extensionsResource: string;
}

/**
 * Допустимый id профиля (имя каталога в `User/profiles/`): символы
 * `[A-Za-z0-9._-]`, остальное slug заменяет на `-`. `.` и `..` — не каталог, а
 * ссылка на сам `profiles/` и на `User/`: профиль с таким id делил бы файлы с
 * Default, а его удаление сносило бы `User/` целиком.
 */
export const PROFILE_ID_PATTERN = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;

/**
 * Id, который именованному профилю не достаётся: `default` в
 * `resolveUserDataPaths` значит Default-профиль (файлы прямо в `User/`), и
 * профиль с таким id молча читал и писал бы чужие файлы.
 */
export const RESERVED_PROFILE_ID = "default";

/** Предел длины id из имени: имя каталога ограничено ФС (255 байт), запас — под суффикс коллизии. */
export const MAX_PROFILE_ID_LENGTH = 64;

/**
 * Имена устройств Windows (`CON`, `NUL`, `COM1`, …): каталог с таким именем —
 * и с любым расширением после точки — там не создаётся. Реестр общий для
 * всех ОС, поэтому такой slug получает префикс на любой из них.
 */
const WINDOWS_DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/** Годится ли строка в id именованного профиля (каталог в `User/profiles/`, см. {@link PROFILE_ID_PATTERN}). */
export function isValidProfileId(id: string): boolean {
    return PROFILE_ID_PATTERN.test(id) && id !== RESERVED_PROFILE_ID;
}

/** Id Default-профиля — как у эталона. В реестре он не хранится. */
export const DEFAULT_PROFILE_ID = "__default__profile__";
/** Имя Default-профиля в пикерах и в `--profile` (эталон: `localize('defaultProfile', "Default")`). */
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
 * Ключ привязки профиля к воркспейсу: абсолютный путь файла `.code-workspace`,
 * если окно открыто им, иначе — путь папки (`workspace.configuration ??
 * folders[0]`, как `getWorkspaceUri` в `userDataProfileManagement.ts` эталона).
 * Хранится в `profileAssociations.workspaces` как есть — путь, а не хэш, чтобы
 * файл читался глазами. У пустого окна ключа нет.
 */
export type ProfileWorkspaceKey = string;

/**
 * Реестр профилей и их привязок к воркспейсам (аналог `IUserDataProfilesService`
 * эталона). Реестр живёт в состоянии области `application`
 * (`User/globalStorage/storage.json`, ключи `userDataProfiles` и
 * `profileAssociations`), один на установку. Активный профиль процесса —
 * отдельно, в `IUserDataProfileService` workbench'а: он фиксирован на процесс.
 */
export interface IUserDataProfilesService {
    /** `User/profiles` — родитель каталогов именованных профилей. */
    readonly profilesHome: string;
    readonly defaultProfile: IUserDataProfile;
    /** Все профили; первый — Default. */
    readonly profiles: readonly IUserDataProfile[];
    readonly onDidChangeProfiles: Event<DidChangeProfilesEvent>;

    /**
     * Создаёт именованный профиль: каталог с пустым составом расширений
     * (`extensions.json` = `[]`), без настроек и кейбиндов. Имя обязано быть
     * непустым и уникальным. С `workspace` — сразу привязывает его к профилю.
     */
    createNamedProfile(name: string, workspace?: ProfileWorkspaceKey): Promise<IUserDataProfile>;
    /** Переименование; Default не правится. Каталог остаётся прежним. */
    updateProfile(profile: IUserDataProfile, options: IUserDataProfileUpdateOptions): Promise<IUserDataProfile>;
    /** Снимает профиль с реестра, его привязки и каталог. Default не удаляется. */
    removeProfile(profile: IUserDataProfile): Promise<void>;

    /** Привязывает воркспейс к профилю; привязка к Default — снятие записи. */
    setProfileForWorkspace(workspace: ProfileWorkspaceKey, profile: IUserDataProfile): Promise<void>;
    /** Профиль, привязанный к воркспейсу; `undefined` — привязки нет (или она ведёт на удалённый профиль). */
    getProfileForWorkspace(workspace: ProfileWorkspaceKey): IUserDataProfile | undefined;
}

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const IUserDataProfilesServiceDIToken = token<IUserDataProfilesService>("UserDataProfilesService");

/** Запись реестра (ключ `userDataProfiles`): `location` — относительно `profilesHome`, как у эталона. */
export interface StoredUserDataProfile {
    readonly name: string;
    readonly location: string;
}

/** Привязки (ключ `profileAssociations`): путь воркспейса → id профиля. */
export interface StoredProfileAssociations {
    readonly workspaces?: Readonly<Record<string, string>>;
}

/** Реестр профилей в application-состоянии; пустой список — ключ снимается. */
export const USER_DATA_PROFILES_STATE: IStateDescriptor<readonly StoredUserDataProfile[]> = {
    key: "userDataProfiles",
    scope: "application",
    default: [],
};

/** Привязки профилей к воркспейсам в application-состоянии; без привязок — ключ снимается. */
export const PROFILE_ASSOCIATIONS_STATE: IStateDescriptor<StoredProfileAssociations> = {
    key: "profileAssociations",
    scope: "application",
    default: {},
};

/** Ресурсы профиля по его каталогу (зеркало `toUserDataProfile` эталона без флагов). */
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

/**
 * Default-профиль: файлы прямо в `User/` (`defaultProfileHome`); состав
 * расширений — `extensionsResource`, если задан (у эталона — в каталоге
 * расширений, `getDefaultProfileExtensionsLocation`), иначе `User/extensions.json`.
 */
export function createDefaultProfile(defaultProfileHome: string, extensionsResource?: string): IUserDataProfile {
    const profile = toUserDataProfile(DEFAULT_PROFILE_ID, DEFAULT_PROFILE_NAME, defaultProfileHome);
    return { ...profile, isDefault: true, extensionsResource: extensionsResource ?? profile.extensionsResource };
}

/**
 * Id профиля из имени: slug в алфавите каталога (`PROFILE_ID_PATTERN`), прочие
 * символы и пробелы схлопываются в `-`, длина — не больше
 * {@link MAX_PROFILE_ID_LENGTH}; пустой остаток или одни точки — `profile`,
 * имя устройства Windows (`con`, `nul.txt`) — с префиксом `profile-`.
 * Коллизия с занятым id или с {@link RESERVED_PROFILE_ID} — числовой суффикс
 * `-2`, `-3`, … Регистр сохраняется, но занятость сравнивается без него: на
 * macOS и Windows `Work` и `work` — один каталог.
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
