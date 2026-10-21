import * as fs from "node:fs";
import * as path from "node:path";

import { Emitter } from "../../../base/common/event.ts";
import { Disposable } from "../../../base/common/lifecycle.ts";
import { isFileNotFound } from "../../../base/node/fsErrors.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import { NULL_LOGGER } from "../../log/common/nullLogService.ts";
import type { IStateStore } from "../../state/common/iStateService.ts";
import {
    createDefaultProfile,
    type DidChangeProfilesEvent,
    isValidProfileId,
    type IUserDataProfile,
    type IUserDataProfilesService,
    type IUserDataProfileUpdateOptions,
    PROFILE_ASSOCIATIONS_STATE,
    profileIdFromName,
    type ProfileWorkspaceKey,
    type StoredProfileAssociations,
    type StoredUserDataProfile,
    toUserDataProfile,
    USER_DATA_PROFILES_STATE,
} from "../common/userDataProfile.ts";

/**
 * The profile directory is removed immediately on removal, not on the next start as upstream:
 * {@link migrateProfileDirectories} registers directories without an entry, so a leftover directory
 * would come back as a profile.
 */
export class UserDataProfilesService extends Disposable implements IUserDataProfilesService {
    public readonly profilesHome: string;
    private readonly defaultProfileHome: string;
    private readonly defaultProfileExtensionsResource: string | undefined;
    private readonly state: IStateStore;
    private readonly logger: ILogger;
    private cache: IUserDataProfile[] | undefined;
    private readonly onDidChangeProfilesEmitter = this.register(new Emitter<DidChangeProfilesEvent>());
    public readonly onDidChangeProfiles = this.onDidChangeProfilesEmitter.event;

    public constructor(input: {
        readonly profilesHome: string;
        readonly defaultProfileHome: string;
        /** Defaults to `User/extensions.json`. */
        readonly defaultProfileExtensionsResource?: string;
        readonly state: IStateStore;
        readonly logger?: ILogger;
    }) {
        super();
        this.profilesHome = input.profilesHome;
        this.defaultProfileHome = input.defaultProfileHome;
        this.defaultProfileExtensionsResource = input.defaultProfileExtensionsResource;
        this.state = input.state;
        this.logger = input.logger ?? NULL_LOGGER;
    }

    public get defaultProfile(): IUserDataProfile {
        // Stryker disable next-line OptionalChaining,ConditionalExpression: the first element is always Default (load builds it so), `?? ` is only for the type
        return this.profiles[0] ?? createDefaultProfile(this.defaultProfileHome, this.defaultProfileExtensionsResource);
    }

    public get profiles(): readonly IUserDataProfile[] {
        this.cache ??= this.load();
        return this.cache;
    }

    public getProfileForWorkspace(workspace: ProfileWorkspaceKey): IUserDataProfile | undefined {
        const id = this.state.get(PROFILE_ASSOCIATIONS_STATE).workspaces?.[workspace];
        // No entry gives `undefined`; an entry for a removed profile counts as none.
        return this.profiles.find((p) => p.id === id);
    }

    public async createNamedProfile(name: string, workspace?: ProfileWorkspaceKey): Promise<IUserDataProfile> {
        const trimmed = name.trim();
        if (trimmed.length === 0) throw new Error("Name of the profile is mandatory and must be of type `string`");
        if (this.profiles.some((p) => p.name === trimmed)) {
            throw new Error(`Profile with ${trimmed} name already exists`);
        }
        const id = profileIdFromName(
            trimmed,
            this.profiles.map((p) => p.id),
        );
        const profile = toUserDataProfile(id, trimmed, path.join(this.profilesHome, id));
        await fs.promises.mkdir(profile.location, { recursive: true });
        // A new profile has no extensions, as upstream. The empty set is written
        // explicitly: a profile without `extensions.json` is one from a previous version,
        // and the migration (`migrateProfileExtensions`) would give it all installed ones.
        await fs.promises.writeFile(profile.extensionsResource, "[]");
        this.saveProfiles([...this.namedProfiles(), profile]);
        if (workspace !== undefined) this.saveAssociation(workspace, profile);
        this.fire({ added: [profile], removed: [], updated: [] });
        return profile;
    }

    public async updateProfile(
        profile: IUserDataProfile,
        options: IUserDataProfileUpdateOptions,
    ): Promise<IUserDataProfile> {
        if (profile.isDefault) throw new Error("Cannot update default profile");
        const existing = this.find(profile);
        const name = options.name?.trim() ?? existing.name;
        if (name.length === 0) throw new Error("Name of the profile is mandatory and must be of type `string`");
        if (this.profiles.some((p) => p.id !== existing.id && p.name === name)) {
            throw new Error(`Profile with ${name} name already exists`);
        }
        const updated = toUserDataProfile(existing.id, name, existing.location);
        this.saveProfiles(this.namedProfiles().map((p) => (p.id === updated.id ? updated : p)));
        this.fire({ added: [], removed: [], updated: [updated] });
        return Promise.resolve(updated);
    }

    public async removeProfile(profile: IUserDataProfile): Promise<void> {
        if (profile.isDefault) throw new Error("Cannot remove default profile");
        const existing = this.find(profile);
        this.saveProfiles(this.namedProfiles().filter((p) => p.id !== existing.id));
        // Associations with the removed profile go away with it.
        const associations = this.state.get(PROFILE_ASSOCIATIONS_STATE);
        const workspaces = Object.fromEntries(
            Object.entries(associations.workspaces ?? {}).filter(([, id]) => id !== existing.id),
        );
        this.saveAssociations({ ...associations, workspaces });
        // Only our own directory, a direct child of `profiles/`, is removed. An entry with
        // a foreign path (absolute, hand-written) leaves the registry but the directory stays.
        if (path.dirname(existing.location) === this.profilesHome) {
            try {
                await fs.promises.rm(existing.location, { recursive: true, force: true });
            } catch (err) {
                this.logger.error(`Failed to delete profile folder ${existing.location}`, err);
            }
        } else {
            this.logger.warn(`Keeping profile folder outside ${this.profilesHome}: ${existing.location}`);
        }
        this.fire({ added: [], removed: [existing], updated: [] });
    }

    public async setProfileForWorkspace(workspace: ProfileWorkspaceKey, profile: IUserDataProfile): Promise<void> {
        const existing = this.find(profile);
        this.saveAssociation(workspace, existing);
        return Promise.resolve();
    }

    /**
     * Registers `User/profiles/<name>/` directories missing from the registry as
     * profiles named after the directory, so old `--profile <name>` profiles (pre-registry)
     * show up in the picker. Idempotent: called on every start.
     * Returns the added profiles.
     */
    public migrateProfileDirectories(): readonly IUserDataProfile[] {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(this.profilesHome, { withFileTypes: true });
        } catch (err) {
            if (!isFileNotFound(err)) this.logger.error(`Failed to scan ${this.profilesHome}`, err);
            return [];
        }
        const known = new Set(this.namedProfiles().map((p) => path.basename(p.location)));
        const added: IUserDataProfile[] = [];
        for (const entry of entries) {
            if (!entry.isDirectory() || known.has(entry.name)) continue;
            // A directory whose name is outside the id alphabet isn't a profile (neither
            // `--profile` nor the registry created it); it stays put and isn't listed.
            // Same for `default`: user data paths use that id for the Default profile.
            if (!isValidProfileId(entry.name)) {
                this.logger.warn(`Skipping profile folder with an invalid name: ${entry.name}`);
                continue;
            }
            const taken = [...this.profiles, ...added].map((p) => p.name);
            const name = taken.includes(entry.name) ? `${entry.name} (${entry.name})` : entry.name;
            added.push(toUserDataProfile(entry.name, name, path.join(this.profilesHome, entry.name)));
        }
        if (added.length === 0) return [];
        this.saveProfiles([...this.namedProfiles(), ...added]);
        this.logger.info(`Registered ${String(added.length)} existing profile folder(s)`, {
            profiles: added.map((p) => p.name),
        });
        this.fire({ added, removed: [], updated: [] });
        return added;
    }

    private load(): IUserDataProfile[] {
        const profiles: IUserDataProfile[] = [
            createDefaultProfile(this.defaultProfileHome, this.defaultProfileExtensionsResource),
        ];
        for (const stored of this.state.get(USER_DATA_PROFILES_STATE)) {
            if (!isValidStoredProfile(stored)) {
                // Stryker disable next-line StringLiteral: log text
                this.logger.warn("Skipping the invalid stored profile", stored);
                continue;
            }
            // `location` is relative (as we and upstream write it); an absolute one,
            // from old or foreign entries, is taken as is. A relative one must
            // be an id (a directory right in `profiles/`): a hand-written `..` would move the profile into `User/`.
            if (!path.isAbsolute(stored.location) && !isValidProfileId(stored.location)) {
                // Stryker disable next-line StringLiteral: log text
                this.logger.warn("Skipping the stored profile with an invalid location", stored);
                continue;
            }
            const location = path.isAbsolute(stored.location)
                ? stored.location
                : path.join(this.profilesHome, stored.location);
            profiles.push(toUserDataProfile(path.basename(location), stored.name, location));
        }
        return profiles;
    }

    private namedProfiles(): IUserDataProfile[] {
        return this.profiles.filter((p) => !p.isDefault);
    }

    private find(profile: IUserDataProfile): IUserDataProfile {
        const existing = this.profiles.find((p) => p.id === profile.id);
        if (existing === undefined) throw new Error(`Profile '${profile.name}' does not exist`);
        return existing;
    }

    private saveProfiles(named: readonly IUserDataProfile[]): void {
        if (named.length === 0) {
            this.state.remove(USER_DATA_PROFILES_STATE);
        } else {
            const stored: StoredUserDataProfile[] = named.map((p) => ({
                name: p.name,
                location: path.relative(this.profilesHome, p.location),
            }));
            this.state.store(USER_DATA_PROFILES_STATE, stored);
        }
        this.cache = undefined;
    }

    private saveAssociation(workspace: ProfileWorkspaceKey, profile: IUserDataProfile): void {
        const associations = this.state.get(PROFILE_ASSOCIATIONS_STATE);
        const workspaces = { ...associations.workspaces };
        // An association with Default is the absence of an entry (upstream writes Default's id;
        // resolution is the same and the file is shorter, see docs/arch/Configuration.md, profile deviations).
        if (profile.isDefault) Reflect.deleteProperty(workspaces, workspace);
        else workspaces[workspace] = profile.id;
        this.saveAssociations({ ...associations, workspaces });
    }

    private saveAssociations(associations: StoredProfileAssociations): void {
        const workspaces = associations.workspaces ?? {};
        if (Object.keys(workspaces).length === 0) {
            this.state.remove(PROFILE_ASSOCIATIONS_STATE);
        } else {
            this.state.store(PROFILE_ASSOCIATIONS_STATE, { workspaces });
        }
    }

    private fire(change: Omit<DidChangeProfilesEvent, "all">): void {
        this.onDidChangeProfilesEmitter.fire({ ...change, all: this.profiles });
    }
}

function isValidStoredProfile(stored: unknown): stored is StoredUserDataProfile {
    if (typeof stored !== "object" || stored === null) return false;
    const { name, location } = stored as Partial<StoredUserDataProfile>;
    // `load` filters out an empty `location`: it's neither absolute nor an id.
    return typeof name === "string" && name.length > 0 && typeof location === "string";
}
