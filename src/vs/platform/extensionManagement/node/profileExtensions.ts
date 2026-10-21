import * as fs from "node:fs";
import * as path from "node:path";

import { isFileNotFound } from "../../../base/node/fsErrors.ts";
import { extensionKey } from "../../extensions/common/extensionDependencies.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import { NULL_LOGGER } from "../../log/common/nullLogService.ts";

import { type IInstalledExtension, listInstalledExtensions, uninstallExtension } from "./extensionInstaller.ts";

/**
 * Profile contents (upstream `extensionsProfileScannerService.ts`): extensions live in
 * the shared `extensions/`, and the profile's `extensions.json` lists the enabled ones.
 *
 * Deviation from upstream: one version serves all profiles, since `installVsix` removes
 * other versions of the id, so entries match the disk by id, and `version` and
 * `relativeLocation` in the file are informational.
 *
 * Synchronous: the files are small and are read by bootstrap and the CLI before the TUI starts.
 */

export const PROFILE_EXTENSIONS_FILE = "extensions.json";

/** Subset of upstream `IStoredProfileExtension`; unknown entry fields are preserved on rewrite. */
export interface IStoredProfileExtension {
    readonly identifier: { readonly id: string };
    readonly version: string;
    readonly relativeLocation?: string;
}

/** `undefined` means no file. A non-JSON-array is an error: rewriting would silently wipe someone else's contents. */
export function readProfileExtensions(file: string): IStoredProfileExtension[] | undefined {
    let text: string;
    try {
        // Explicit decoding: a wrong encoding throws instead of being smoothed over by `JSON.parse`.
        text = fs.readFileSync(file).toString("utf8");
    } catch (err) {
        if (isFileNotFound(err)) return undefined;
        throw err;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        // same error as "not an array" below
    }
    if (!Array.isArray(parsed)) throw new Error(`Invalid extensions profile content in ${file}`);
    return parsed.filter(isStoredProfileExtension);
}

/** Via a temp file and `rename`: an interruption mid-write can't leave truncated JSON. */
export function writeProfileExtensions(file: string, entries: readonly IStoredProfileExtension[]): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${String(process.pid)}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(entries));
    fs.renameSync(temp, file);
}

function toStoredExtension(installed: IInstalledExtension): IStoredProfileExtension {
    return {
        identifier: { id: installed.id },
        version: installed.version,
        relativeLocation: path.basename(installed.dir),
    };
}

function profileKeys(file: string): Set<string> {
    return new Set((readProfileExtensions(file) ?? []).map((e) => extensionKey(e.identifier.id)));
}

/**
 * A profile without `extensions.json` gets **all** installed extensions: before
 * per-profile contents they were visible in every profile. New profiles get an empty
 * file right away (`createNamedProfile`), so only profiles from older versions land here.
 */
export function migrateProfileExtensions(extensionsDir: string, profileFiles: readonly string[]): string[] {
    const missing = profileFiles.filter((file) => !fs.existsSync(file));
    // Stryker disable next-line ConditionalExpression: saves scanning the extensions directory on every start; without it the result is the same (empty list, nothing written)
    if (missing.length === 0) return [];
    const all = listInstalledExtensions(extensionsDir).map(toStoredExtension);
    for (const file of missing) writeProfileExtensions(file, all);
    return missing;
}

/** Plus the disk: the process's registry may not know a profile created by another window (`storage.json` is a snapshot). */
export function profileExtensionsFiles(known: readonly string[], profilesHome: string): string[] {
    const files = new Set(known);
    let entries: fs.Dirent[] = [];
    try {
        entries = fs.readdirSync(profilesHome, { withFileTypes: true });
    } catch {
        // no named profiles on disk
    }
    for (const entry of entries) {
        if (entry.isDirectory()) files.add(path.join(profilesHome, entry.name, PROFILE_EXTENSIONS_FILE));
    }
    return [...files];
}

/** Like `deleteExtensionsNotInProfiles`. An unreadable profile file counts as holding everything. */
export function deleteUnusedExtensions(
    extensionsDir: string,
    profileFiles: readonly string[],
    candidates?: readonly string[],
): string[] {
    const used = new Set<string>();
    for (const file of profileFiles) {
        let keys: Set<string>;
        try {
            keys = profileKeys(file);
        } catch {
            return [];
        }
        for (const key of keys) used.add(key);
    }
    const only = candidates === undefined ? undefined : new Set(candidates.map(extensionKey));
    const deleted: string[] = [];
    for (const installed of listInstalledExtensions(extensionsDir)) {
        const key = extensionKey(installed.id);
        if (used.has(key) || (only !== undefined && !only.has(key))) continue;
        uninstallExtension(installed.id, extensionsDir);
        deleted.push(installed.id);
    }
    return deleted;
}

export interface IProfileExtensionsOptions {
    readonly extensionsDir: string;
    readonly profileFile: string;
    /** Includes this one. */
    readonly allProfileFiles: () => readonly string[];
    readonly logger?: ILogger;
}

export interface IProfileExtensionRemoval {
    readonly removed: boolean;
    /** Removed from disk: no profile needs them anymore. */
    readonly deleted: readonly string[];
}

export class ProfileExtensions {
    private readonly logger: ILogger;

    public constructor(private readonly options: IProfileExtensionsOptions) {
        this.logger = options.logger ?? NULL_LOGGER;
    }

    public get extensionsDir(): string {
        return this.options.extensionsDir;
    }

    /** An unreadable file yields an empty list and a logged error: the window starts and the file stays untouched. */
    public list(): IInstalledExtension[] {
        let keys: Set<string>;
        try {
            keys = profileKeys(this.options.profileFile);
        } catch (err) {
            this.logger.error(`Failed to read profile extensions ${this.options.profileFile}`, err);
            return [];
        }
        return listInstalledExtensions(this.options.extensionsDir).filter((e) => keys.has(extensionKey(e.id)));
    }

    /**
     * Together with `extensionDependencies`, transitively: a dependency installed earlier
     * for another profile is needed in this one too. An unreadable file is an error, not a rewrite.
     */
    public add(ids: readonly string[]): void {
        const installed = new Map(
            listInstalledExtensions(this.options.extensionsDir).map((e) => [extensionKey(e.id), e]),
        );
        const adding = new Map<string, IInstalledExtension>();
        const queue = ids.map(extensionKey);
        for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
            const one = installed.get(key);
            if (one === undefined || adding.has(key)) continue;
            adding.set(key, one);
            queue.push(...one.dependencies.map(extensionKey));
        }
        const entries = (readProfileExtensions(this.options.profileFile) ?? []).filter(
            (e) => !adding.has(extensionKey(e.identifier.id)),
        );
        writeProfileExtensions(this.options.profileFile, [...entries, ...[...adding.values()].map(toStoredExtension)]);
    }

    /** When no profile needs it anymore, also removes the directory (upstream `onDidRemoveExtensions`). */
    public remove(id: string): IProfileExtensionRemoval {
        const key = extensionKey(id);
        const entries = readProfileExtensions(this.options.profileFile) ?? [];
        const kept = entries.filter((e) => extensionKey(e.identifier.id) !== key);
        if (kept.length === entries.length) return { removed: false, deleted: [] };
        writeProfileExtensions(this.options.profileFile, kept);
        const deleted = deleteUnusedExtensions(this.options.extensionsDir, this.options.allProfileFiles(), [id]);
        if (deleted.length === 0) this.logger.info(`Extension ${id} is kept on disk: another profile uses it`);
        return { removed: true, deleted };
    }
}

function isStoredProfileExtension(value: unknown): value is IStoredProfileExtension {
    const identifier = (value as { identifier?: unknown } | null | undefined)?.identifier;
    const id = (identifier as { id?: unknown } | null | undefined)?.id;
    return typeof id === "string" && id.length > 0;
}

/** Structural types: extension installation has no need to know the profile model from `platform/userDataProfile`. */
export function createProfileExtensions(input: {
    readonly extensionsDir: string;
    readonly profile: { readonly extensionsResource: string };
    readonly profiles: {
        readonly profilesHome: string;
        readonly profiles: readonly { readonly extensionsResource: string }[];
    };
    readonly logger?: ILogger;
}): ProfileExtensions {
    const { extensionsDir, profile, profiles, logger } = input;
    return new ProfileExtensions({
        extensionsDir,
        profileFile: profile.extensionsResource,
        allProfileFiles: () =>
            profileExtensionsFiles(
                profiles.profiles.map((p) => p.extensionsResource),
                profiles.profilesHome,
            ),
        logger: logger ?? NULL_LOGGER,
    });
}
