import * as path from "node:path";

import type { Event } from "../../../base/common/event.ts";
import { Uri } from "../../../base/common/uri.ts";
import { token } from "../../instantiation/common/diContainer.ts";
import type { IStateDescriptor } from "../../state/common/iStateService.ts";
import type { IWorkspace } from "../../workspace/common/iWorkspaceContextService.ts";

/**
 * Subset of upstream `IUserDataProfile` (no snippets/tasks/prompts/mcp, see docs/TODO/Profiles.md).
 * Deviation (owner's decision): `id` is not a random hex but a slug of the name ({@link profileIdFromName})
 * and the directory name under `User/profiles/`; renaming doesn't move the directory, so the id stops
 * matching the name.
 */
export interface IUserDataProfile {
    readonly id: string;
    readonly name: string;
    readonly isDefault: boolean;
    /** Profile directory: `User/` for Default, `User/profiles/<id>/` for a named one. */
    readonly location: string;
    readonly settingsResource: string;
    readonly keybindingsResource: string;
    /** `<location>/globalStorage`: parent of the profile's private extension directories. */
    readonly globalStorageHome: string;
    /** Named: `<location>/extensions.json`; Default: in the extensions directory (upstream `getDefaultProfileExtensionsLocation`). */
    readonly extensionsResource: string;
}

/** `.` and `..` are forbidden: such a profile would share files with Default, and removing it would wipe `User/`. */
export const PROFILE_ID_PATTERN = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;

/** `default` in `resolveUserDataPaths` means the Default profile: a named one with this id would write to its files. */
export const RESERVED_PROFILE_ID = "default";

/** Max length of an id derived from a name: directory names are FS-limited (255 bytes), the rest is room for a collision suffix. */
export const MAX_PROFILE_ID_LENGTH = 64;

/** Windows can't create a directory with such a name (with any extension); the prefix applies on every OS. */
const WINDOWS_DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

export function isValidProfileId(id: string): boolean {
    return PROFILE_ID_PATTERN.test(id) && id !== RESERVED_PROFILE_ID;
}

/** Same as upstream; not stored in the registry. */
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
 * Path of the `.code-workspace`, otherwise of the folder (like upstream `getWorkspaceUri`). Stored as a path
 * rather than a hash so the file stays human-readable.
 */
export type ProfileWorkspaceKey = string;

/** One per installation, in application state; the process's active profile lives in the workbench `IUserDataProfileService`. */
export interface IUserDataProfilesService {
    readonly profilesHome: string;
    readonly defaultProfile: IUserDataProfile;
    /** Default comes first. */
    readonly profiles: readonly IUserDataProfile[];
    readonly onDidChangeProfiles: Event<DidChangeProfilesEvent>;

    /** Empty extension set (`extensions.json` = `[]`); with `workspace`, associates it right away. */
    createNamedProfile(name: string, workspace?: ProfileWorkspaceKey): Promise<IUserDataProfile>;
    /** Default can't be updated; the directory doesn't move. */
    updateProfile(profile: IUserDataProfile, options: IUserDataProfileUpdateOptions): Promise<IUserDataProfile>;
    /** Along with its associations and directory; Default can't be removed. */
    removeProfile(profile: IUserDataProfile): Promise<void>;

    /** Associates a workspace with a profile; associating with Default removes the entry. */
    setProfileForWorkspace(workspace: ProfileWorkspaceKey, profile: IUserDataProfile): Promise<void>;
    /** An association with a removed profile counts as none. */
    getProfileForWorkspace(workspace: ProfileWorkspaceKey): IUserDataProfile | undefined;
}

// Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by reference to it; the string is only a debug label
export const IUserDataProfilesServiceDIToken = token<IUserDataProfilesService>("UserDataProfilesService");

/** `location` is relative to `profilesHome`, as upstream. */
export interface StoredUserDataProfile {
    readonly name: string;
    readonly location: string;
}

/** Workspace path → profile id. */
export interface StoredProfileAssociations {
    readonly workspaces?: Readonly<Record<string, string>>;
}

/** An empty list removes the key. */
export const USER_DATA_PROFILES_STATE: IStateDescriptor<readonly StoredUserDataProfile[]> = {
    key: "userDataProfiles",
    scope: "application",
    default: [],
};

/** No associations removes the key. */
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

/** Without `extensionsResource`, uses `User/extensions.json`. */
export function createDefaultProfile(defaultProfileHome: string, extensionsResource?: string): IUserDataProfile {
    const profile = toUserDataProfile(DEFAULT_PROFILE_ID, DEFAULT_PROFILE_NAME, defaultProfileHome);
    return { ...profile, isDefault: true, extensionsResource: extensionsResource ?? profile.extensionsResource };
}

/**
 * An empty remainder or only dots becomes `profile`, a Windows device name gets a `profile-` prefix,
 * a collision gets a `-2`, `-3`, … suffix. Case is preserved but compared case-insensitively for
 * collisions: on macOS and Windows `Work` and `work` are the same directory.
 */
export function profileIdFromName(name: string, taken: readonly string[]): string {
    // Leading/trailing spaces collapse into `-` and get stripped with it, so no separate trim is needed.
    const slug = name
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .slice(0, MAX_PROFILE_ID_LENGTH)
        .replace(/^-+|-+$/g, "");
    const base = /^\.*$/.test(slug) ? "profile" : WINDOWS_DEVICE_NAMES.test(slug) ? `profile-${slug}` : slug;
    // Stryker disable next-line all: invariant guard; by construction the slug always matches the pattern
    if (!PROFILE_ID_PATTERN.test(base)) throw new Error(`Cannot derive a profile id from "${name}"`);
    const occupied = new Set([...taken, RESERVED_PROFILE_ID].map((id) => id.toLowerCase()));
    if (!occupied.has(base.toLowerCase())) return base;
    for (let i = 2; ; i += 1) {
        const candidate = `${base}-${String(i)}`;
        if (!occupied.has(candidate.toLowerCase())) return candidate;
    }
}

/**
 * Association key from a folder or `.code-workspace` file path: an absolute path in
 * `fsPath` form (lowercase drive letter on Windows), so that bootstrap (a string from argv)
 * and the window (`IWorkspace` with `Uri`) compute the same key.
 */
export function profileWorkspaceKeyOf(workspacePath: string): ProfileWorkspaceKey {
    return Uri.file(path.resolve(workspacePath)).fsPath;
}

/** Association key of the open workspace; `undefined` for an empty window. */
export function profileWorkspaceKey(workspace: IWorkspace): ProfileWorkspaceKey | undefined {
    const target = workspace.configuration ?? workspace.folders.at(0)?.uri;
    return target === undefined ? undefined : profileWorkspaceKeyOf(target.fsPath);
}

/**
 * The window's active profile at startup, in upstream order
 * (`resolveProfileForBrowserWindow` in `windowsMainService.ts`):
 * `--profile <name>` → workspace association → Default. An unknown name in the flag
 * creates an empty profile; with a workspace open, the flag also associates it
 * (flag description in upstream `platform/environment/node/argv.ts`). An association
 * with a removed profile counts as none.
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
 * The workspace's profile: its association, otherwise Default. An empty window (no key)
 * has no association, so it gets Default.
 */
export function profileForWorkspace(
    profiles: IUserDataProfilesService,
    workspace: ProfileWorkspaceKey | undefined,
): IUserDataProfile {
    const associated = workspace === undefined ? undefined : profiles.getProfileForWorkspace(workspace);
    return associated ?? profiles.defaultProfile;
}
