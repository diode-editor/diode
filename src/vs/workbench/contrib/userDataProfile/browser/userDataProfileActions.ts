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

/** A picker row carrying its profile (the widget returns the same object). */
interface IProfilePickItem extends QuickPickItem {
    readonly profile: IUserDataProfile;
}

/** Upstream profile editor's refusal text for a taken name. */
export function profileNameExistsMessage(name: string): string {
    return `Profile with name ${name} already exists.`;
}

export const NEW_PROFILE_EMPTY_LABEL = "Empty";
export const NEW_PROFILE_COPY_LABEL = "Copy from current";

/** As a toast, like upstream's `notificationService.error`: otherwise the user sees "nothing happened". */
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
 * The profile is fixed per process, so switching means reloading the window, like upstream's remote window, not
 * restarting the extension host (docs/TODO/Profiles.md). An empty window has no binding.
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
            // Upstream markup is `$(check) name`; we substitute the glyph ourselves — the widget
            // carries the label as is (substitution lives at the extension boundary).
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

/** Two quick input steps instead of upstream's profile editor form (docs/TODO/Profiles.md, iteration 4). */
async function createProfile(accessor: ServiceAccessor): Promise<void> {
    const quickInput = accessor.get(QuickInputServiceDIToken);
    const profiles = accessor.get(IUserDataProfilesServiceDIToken);
    const current = accessor.get(IUserDataProfileServiceDIToken).currentProfile;
    const name = await quickInput.input({
        title: "New Profile",
        placeholder: "Profile name",
        // An empty name is not a refusal (the input just isn't accepted), and profiles never have empty names.
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
 * `application` keys are stripped from settings: they don't apply in a named profile and would warn
 * on every start. Extensions themselves live in a shared directory — copying the set means copying the list.
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

/** JSONC without the listed top-level keys; comments and formatting of the rest stay in place. */
export function withoutKeys(content: string, keys: readonly string[]): string {
    // Stryker disable next-line ArrayDeclaration,ObjectLiteral,BooleanLiteral: parse errors aren't read here, and the parser tolerates a trailing comma even without the option
    const parsed: unknown = parseJsonc(content, [], { allowTrailingComma: true });
    if (typeof parsed !== "object" || parsed === null) return content;
    let next = content;
    for (const key of keys) {
        if (!Object.hasOwn(parsed, key)) continue;
        next = applyEdits(next, modify(next, [key], undefined, { formattingOptions: formattingOptionsOf(next) }));
    }
    return next;
}

/** With a foreign indent `modify` reformats the removed key's neighbor. Without indents (one line) — 4 spaces. */
export function formattingOptionsOf(content: string): FormattingOptions {
    const indent = /^[ \t]+(?=\S)/m.exec(content)?.[0];
    if (indent === undefined) return { insertSpaces: true, tabSize: 4 };
    // Any tab in the indent means tabs; the width then doesn't reach the output, only the indent kind.
    return indent.includes("\t") ? { insertSpaces: false, tabSize: 4 } : { insertSpaces: true, tabSize: indent.length };
}

/** Deleting the current profile reloads the window into the workspace profile (upstream offers a reload via a message). */
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
