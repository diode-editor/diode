import { applyEdits, type FormattingOptions, modify, parse as parseJsonc } from "jsonc-parser";

import { renderCodicons } from "../../../../base/common/codicons.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import type { ConfigurationScope } from "../../../../platform/configuration/common/configurationRegistry.ts";
import { ConfigurationRegistryDIToken } from "../../../../platform/configuration/common/configurationRegistryDIToken.ts";
import { APPLICATION_SCOPES } from "../../../../platform/configuration/common/workspaceSettings.ts";
import { type IFileService, IFileServiceDIToken } from "../../../../platform/files/common/files.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type IUserDataProfile,
    IUserDataProfilesServiceDIToken,
    profileForWorkspace,
    profileWorkspaceKey,
} from "../../../../platform/userDataProfile/common/userDataProfile.ts";
import { IWorkspaceContextServiceDIToken } from "../../../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import { reloadWindow } from "../../../browser/actions/appActions.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";
import {
    IUserDataProfileServiceDIToken,
    PROFILES_CATEGORY,
} from "../../../services/userDataProfile/common/userDataProfile.ts";

/** Строка пикера, несущая свой профиль (виджет возвращает тот же объект). */
interface IProfilePickItem extends QuickPickItem {
    readonly profile: IUserDataProfile;
}

/** Текст отказа редактора профилей эталона на занятое имя. */
export function profileNameExistsMessage(name: string): string {
    return `Profile with name ${name} already exists.`;
}

export const NEW_PROFILE_EMPTY_LABEL = "Empty";
export const NEW_PROFILE_COPY_LABEL = "Copy from current";

/** Тостом, как `notificationService.error` эталона: иначе человек видит «ничего не произошло». */
function notifyError(accessor: ServiceAccessor, err: unknown): void {
    accessor.get(NotificationServiceDIToken).show({
        severity: "error",
        message: err instanceof Error ? err.message : String(err),
        modal: false,
        items: [],
    });
}

async function notifyingErrors(accessor: ServiceAccessor, run: () => Promise<void>): Promise<void> {
    try {
        await run();
    } catch (err) {
        notifyError(accessor, err);
        throw err;
    }
}

/**
 * Профиль фиксирован на процесс, поэтому вход — перезагрузка окна, как у remote-окна эталона, а не
 * перезапуск extension host (docs/TODO/Profiles.md). Пустое окно привязки не имеет.
 */
async function enterProfile(accessor: ServiceAccessor, profile: IUserDataProfile): Promise<void> {
    const workspace = profileWorkspaceKey(accessor.get(IWorkspaceContextServiceDIToken).getWorkspace());
    if (workspace !== undefined) {
        await accessor.get(IUserDataProfilesServiceDIToken).setProfileForWorkspace(workspace, profile);
    }
    await reloadWindow(accessor, { profile: profile.name });
}

async function switchProfile(accessor: ServiceAccessor): Promise<void> {
    const profiles = accessor.get(IUserDataProfilesServiceDIToken);
    const current = accessor.get(IUserDataProfileServiceDIToken).currentProfile;
    const items: IProfilePickItem[] = [...profiles.profiles]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((profile) => ({
            // Разметка эталона `$(check) name`; глиф подставляем сами — виджет
            // носит метку как есть (подмена живёт на границе с расширениями).
            label: profile.id === current.id ? renderCodicons(`$(check) ${profile.name}`) : profile.name,
            profile,
        }));
    const picked = (await accessor.get(QuickInputServiceDIToken).quickPick({
        placeholder: "Select Profile",
        items,
    })) as IProfilePickItem | undefined;
    if (picked === undefined || picked.profile.id === current.id) return;
    await enterProfile(accessor, picked.profile);
}

/** Два шага quick input вместо формы редактора профилей эталона (docs/TODO/Profiles.md, итерация 4). */
async function createProfile(accessor: ServiceAccessor): Promise<void> {
    const quickInput = accessor.get(QuickInputServiceDIToken);
    const profiles = accessor.get(IUserDataProfilesServiceDIToken);
    const current = accessor.get(IUserDataProfileServiceDIToken).currentProfile;
    const name = await quickInput.input({
        title: "New Profile",
        placeholder: "Profile name",
        // Пустое имя не отказ (ввод просто не примется), а у профилей пустых имён не бывает.
        validateInput: (value) => {
            const trimmed = value.trim();
            return profiles.profiles.some((p) => p.name === trimmed) ? profileNameExistsMessage(trimmed) : null;
        },
    });
    const trimmed = name?.trim();
    if (trimmed === undefined || trimmed.length === 0) return;
    const source = await quickInput.quickPick({
        title: "New Profile",
        placeholder: "Select the contents of the new profile",
        items: [
            { label: NEW_PROFILE_EMPTY_LABEL, description: "Start with no settings, keybindings and extensions" },
            { label: NEW_PROFILE_COPY_LABEL, description: current.name },
        ],
    });
    if (source === undefined) return;
    const profile = await profiles.createNamedProfile(trimmed);
    if (source.label === NEW_PROFILE_COPY_LABEL) {
        const applicationKeys = [...accessor.get(ConfigurationRegistryDIToken).getConfigurationScopes()]
            .filter(([, scope]) => APPLICATION_SCOPES.includes(scope))
            .map(([key]) => key);
        await copyProfileContents(accessor.get(IFileServiceDIToken), current, profile, applicationKeys);
    }
    await enterProfile(accessor, profile);
}

/**
 * Из настроек вырезаются `application`-ключи: в именованном профиле они не действуют и давали бы warn
 * на каждом старте. Сами расширения лежат в общем каталоге — копия состава есть копия списка.
 */
export async function copyProfileContents(
    files: IFileService,
    from: IUserDataProfile,
    to: IUserDataProfile,
    applicationKeys: readonly string[],
): Promise<void> {
    const settings = await readTextIfExists(files, from.settingsResource);
    if (settings !== undefined) {
        await files.writeFile(
            Uri.file(to.settingsResource),
            new TextEncoder().encode(withoutKeys(settings, applicationKeys)),
        );
    }
    const keybindings = await readTextIfExists(files, from.keybindingsResource);
    if (keybindings !== undefined) {
        await files.writeFile(Uri.file(to.keybindingsResource), new TextEncoder().encode(keybindings));
    }
    const extensions = await readTextIfExists(files, from.extensionsResource);
    if (extensions !== undefined) {
        await files.writeFile(Uri.file(to.extensionsResource), new TextEncoder().encode(extensions));
    }
}

async function readTextIfExists(files: IFileService, filePath: string): Promise<string | undefined> {
    const resource = Uri.file(filePath);
    if (!(await files.exists(resource))) return undefined;
    return new TextDecoder().decode((await files.readFile(resource)).value);
}

/** JSONC без перечисленных ключей верхнего уровня; комментарии и формат остальных — на месте. */
export function withoutKeys(content: string, keys: readonly string[]): string {
    // Stryker disable next-line ArrayDeclaration,ObjectLiteral,BooleanLiteral: ошибки разбора здесь не читаются, а парсер терпим к висячей запятой и без опции
    const parsed: unknown = parseJsonc(content, [], { allowTrailingComma: true });
    if (typeof parsed !== "object" || parsed === null) return content;
    let next = content;
    for (const key of keys) {
        if (!Object.hasOwn(parsed, key)) continue;
        next = applyEdits(next, modify(next, [key], undefined, { formattingOptions: formattingOptionsOf(next) }));
    }
    return next;
}

/** С чужим отступом `modify` переформатирует соседа снятого ключа. Без отступов (одна строка) — 4 пробела. */
export function formattingOptionsOf(content: string): FormattingOptions {
    const indent = /^[ \t]+(?=\S)/m.exec(content)?.[0];
    if (indent === undefined) return { insertSpaces: true, tabSize: 4 };
    // Любой таб в отступе — табуляция; ширина тогда в вывод не попадает, только форма отступа.
    return indent.includes("\t") ? { insertSpaces: false, tabSize: 4 } : { insertSpaces: true, tabSize: indent.length };
}

/** Удалён текущий — окно перезагружается в профиль воркспейса (эталон предлагает reload сообщением). */
async function deleteProfile(accessor: ServiceAccessor): Promise<void> {
    const profiles = accessor.get(IUserDataProfilesServiceDIToken);
    const current = accessor.get(IUserDataProfileServiceDIToken).currentProfile;
    const candidates: IProfilePickItem[] = profiles.profiles
        .filter((p) => !p.isDefault)
        .map((profile) => ({
            label: profile.name,
            ...(profile.id === current.id ? { description: "Current" } : {}),
            profile,
        }));
    if (candidates.length === 0) return;
    const picks = (await accessor.get(QuickInputServiceDIToken).quickPickMany({
        title: "Delete Profile...",
        placeholder: "Select Profiles to Delete",
        items: candidates,
    })) as readonly IProfilePickItem[] | undefined;
    if (picks === undefined) return;
    try {
        await Promise.all(picks.map((pick) => profiles.removeProfile(pick.profile)));
    } catch (err) {
        notifyError(accessor, err);
    }
    if (!picks.some((pick) => pick.profile.id === current.id)) return;
    const workspace = profileWorkspaceKey(accessor.get(IWorkspaceContextServiceDIToken).getWorkspace());
    const target = profileForWorkspace(profiles, workspace);
    await reloadWindow(accessor, { profile: target.name });
}

export const switchProfileAction: CommandAction = {
    id: "workbench.profiles.actions.switchProfile",
    title: `${PROFILES_CATEGORY}: Switch Profile...`,
    shortTitle: "Switch Profile...",
    run(accessor) {
        return notifyingErrors(accessor, () => switchProfile(accessor));
    },
};

export const createProfileAction: CommandAction = {
    id: "workbench.profiles.actions.createProfile",
    title: `${PROFILES_CATEGORY}: New Profile...`,
    shortTitle: "New Profile...",
    run(accessor) {
        return notifyingErrors(accessor, () => createProfile(accessor));
    },
};

export const deleteProfileAction: CommandAction = {
    id: "workbench.profiles.actions.deleteProfile",
    title: `${PROFILES_CATEGORY}: Delete Profile...`,
    shortTitle: "Delete Profile...",
    run(accessor) {
        return deleteProfile(accessor);
    },
};

export const USER_DATA_PROFILE_ACTIONS: readonly CommandAction[] = [
    switchProfileAction,
    createProfileAction,
    deleteProfileAction,
];

export type ConfigurationScopes = ReadonlyMap<string, ConfigurationScope>;
