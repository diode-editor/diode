import * as fs from "node:fs";
import * as path from "node:path";

import { isFileNotFound } from "../../../base/node/fsErrors.ts";
import { extensionKey } from "../../extensions/common/extensionDependencies.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import { NULL_LOGGER } from "../../log/common/nullLogService.ts";

import { type IInstalledExtension, listInstalledExtensions } from "./extensionInstaller.ts";
import { markObsolete, readObsolete, unmarkObsolete } from "./obsoleteExtensions.ts";

/**
 * Profile contents (upstream `extensionsProfileScannerService.ts`): extensions live in
 * the shared `extensions/`, possibly several versions of one id, and the profile's
 * `extensions.json` says which version it uses (`relativeLocation`). A version no profile
 * uses is marked in `.obsolete` and deleted on the next editor start (`obsoleteExtensions.ts`).
 *
 * Synchronous: the files are small and are read by bootstrap and the CLI before the TUI starts.
 */

export const PROFILE_EXTENSIONS_FILE = "extensions.json";

/** Subset of upstream `IStoredProfileExtension`; unknown entry fields are preserved on rewrite. */
export interface IStoredProfileExtension {
    readonly identifier: { readonly id: string };
    readonly version: string;
    readonly relativeLocation?: string;
    /** Upstream keeps more here than we know about: a rewrite keeps the other fields. */
    readonly metadata?: IStoredProfileExtensionMetadata;
}

export interface IStoredProfileExtensionMetadata {
    /** A version the user chose (upstream `installGivenVersion`): stage 2 `Update All` and stage 3 auto-update skip it. */
    readonly pinned?: boolean;
    readonly [key: string]: unknown;
}

/** What a profile lists: the version on disk plus the entry's pin. */
export interface IProfileExtension extends IInstalledExtension {
    readonly pinned: boolean;
}

export interface IProfileExtensionsAddOptions {
    /** For the extensions given, not their dependencies; unset keeps what the entry had. */
    readonly pinned?: boolean;
    /**
     * Installed together with them (upstream dependency tasks, `pinned: false`): the profile points to these
     * directories, never pins them, and a dependency the profile already has keeps its entry and its pin.
     */
    readonly dependencies?: readonly IExtensionLocation[];
}

/** What an install hands to the profile: the id and the directory of the version it installed. */
export interface IExtensionLocation {
    readonly id: string;
    readonly dir: string;
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
        relativeLocation: dirName(installed),
    };
}

/**
 * Upstream `pinned: installGivenVersion ? true : (options.pinned ?? existing.pinned)`; the rest of the previous
 * entry stays. No pin and no metadata before means no `metadata` at all.
 */
function rewriteEntry(
    installed: IInstalledExtension,
    previous: IStoredProfileExtension | undefined,
    pinned: boolean | undefined,
): IStoredProfileExtension {
    const metadata = pinned === undefined ? previous?.metadata : { ...previous?.metadata, pinned };
    // `metadata: undefined` is not written: JSON drops it.
    return { ...previous, ...toStoredExtension(installed), metadata };
}

function dirName(installed: IInstalledExtension): string {
    return path.basename(installed.dir);
}

/**
 * Loose semver order (`major.minor.patch`, a prerelease below its release) without the lazy
 * `semver` chunk: only the fallback for entries without a directory needs it, and that is synchronous.
 */
export function compareLooseVersions(a: string, b: string): number {
    const parse = (version: string): { parts: number[]; prerelease: string | undefined } => {
        const [core, ...prerelease] = version.split("+")[0].split("-");
        return {
            parts: core.split(".").map((part) => Number(part) || 0),
            prerelease: prerelease.length > 0 ? prerelease.join("-") : undefined,
        };
    };
    const left = parse(a);
    const right = parse(b);
    // Stryker disable next-line EqualityOperator: one index past both lengths compares 0 with 0
    for (let i = 0; i < Math.max(left.parts.length, right.parts.length); i++) {
        const diff = (left.parts[i] ?? 0) - (right.parts[i] ?? 0);
        if (diff !== 0) return diff;
    }
    if (left.prerelease === right.prerelease) return 0;
    if (left.prerelease === undefined) return 1;
    if (right.prerelease === undefined) return -1;
    return left.prerelease.localeCompare(right.prerelease, "en", { numeric: true });
}

interface IDiskState {
    readonly installed: readonly IInstalledExtension[];
    readonly obsolete: ReadonlySet<string>;
}

/** A broken `.obsolete` hides nothing: it is only a hint for the cleanup. */
function readDisk(extensionsDir: string): IDiskState {
    let obsolete: ReadonlySet<string>;
    try {
        obsolete = readObsolete(extensionsDir);
    } catch {
        obsolete = new Set();
    }
    return { installed: listInstalledExtensions(extensionsDir), obsolete };
}

/** Versions of the id on disk; marked ones only when there is nothing else and `orMarked` allows. */
function versionsOf(disk: IDiskState, key: string, orMarked: boolean): IInstalledExtension[] {
    const all = disk.installed.filter((e) => extensionKey(e.id) === key);
    const unmarked = all.filter((e) => !disk.obsolete.has(dirName(e)));
    return unmarked.length > 0 || !orMarked ? unmarked : all;
}

/** Not empty. */
function highest(candidates: readonly IInstalledExtension[]): IInstalledExtension {
    // Stryker disable next-line EqualityOperator: on equal versions either directory holds that version
    return candidates.reduce((best, e) => (compareLooseVersions(e.version, best.version) > 0 ? e : best));
}

/**
 * Like upstream, by `relativeLocation`; entries from older versions (US-0.9) by `<id>-<version>`,
 * then by the highest unmarked version of the id on disk. A directory of another id is never taken. The guess
 * is reported when the id has several versions on disk, marked ones included: the startup cleanup marks the
 * versions no profile uses before the window lists, and the user should still learn the entry is stale.
 */
function resolveEntry(
    entry: IStoredProfileExtension,
    disk: IDiskState,
    onGuess: (chosen: IInstalledExtension, onDisk: readonly IInstalledExtension[]) => void,
): IInstalledExtension | undefined {
    const key = extensionKey(entry.identifier.id);
    const own = disk.installed.filter((e) => extensionKey(e.id) === key);
    const exact =
        own.find((e) => dirName(e) === entry.relativeLocation) ?? own.find((e) => e.version === entry.version);
    if (exact !== undefined) return exact;
    const candidates = versionsOf(disk, key, false);
    if (candidates.length === 0) return undefined;
    const chosen = highest(candidates);
    if (own.length > 1) onGuess(chosen, own);
    return chosen;
}

/** Directory names the profiles point to. An unreadable profile file is an error: it may hold anything. */
export function referencedExtensionDirs(extensionsDir: string, profileFiles: readonly string[]): Set<string> {
    const disk = readDisk(extensionsDir);
    const referenced = new Set<string>();
    for (const file of profileFiles) {
        for (const entry of readProfileExtensions(file) ?? []) {
            const installed = resolveEntry(entry, disk, () => undefined);
            if (installed !== undefined) referenced.add(dirName(installed));
        }
    }
    return referenced;
}

/**
 * A profile without `extensions.json` gets **all** installed extensions, one version per id: before
 * per-profile contents they were visible in every profile. New profiles get an empty
 * file right away (`createNamedProfile`), so only profiles from older versions land here.
 */
export function migrateProfileExtensions(extensionsDir: string, profileFiles: readonly string[]): string[] {
    const missing = profileFiles.filter((file) => !fs.existsSync(file));
    // Stryker disable next-line ConditionalExpression: saves scanning the extensions directory on every start; without it the result is the same (empty list, nothing written)
    if (missing.length === 0) return [];
    const disk = readDisk(extensionsDir);
    const keys = new Set(disk.installed.map((e) => extensionKey(e.id)));
    const all = [...keys].map((key) => toStoredExtension(highest(versionsOf(disk, key, true))));
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

/**
 * Like upstream `deleteExtensionsNotInProfiles`, but by directory (`id@version`) and only marking:
 * a version no profile uses goes to `.obsolete`, one a profile uses again leaves it. With
 * `candidates`, only versions of those ids. An unreadable profile file means nothing is marked.
 * Returns the newly marked versions.
 */
export function markUnusedExtensions(
    extensionsDir: string,
    profileFiles: readonly string[],
    candidates?: readonly string[],
    logger: ILogger = NULL_LOGGER,
): IInstalledExtension[] {
    let referenced: Set<string>;
    try {
        referenced = referencedExtensionDirs(extensionsDir, profileFiles);
    } catch (err) {
        logger.warn("Failed to read profile extensions; no extension is marked for removal", err);
        return [];
    }
    const disk = readDisk(extensionsDir);
    const only = candidates === undefined ? undefined : new Set(candidates.map(extensionKey));
    const considered = disk.installed.filter((e) => only === undefined || only.has(extensionKey(e.id)));
    const unused = considered.filter((e) => !referenced.has(dirName(e)));
    markObsolete(extensionsDir, unused.map(dirName));
    unmarkObsolete(extensionsDir, considered.filter((e) => referenced.has(dirName(e))).map(dirName));
    return unused.filter((e) => !disk.obsolete.has(dirName(e)));
}

export interface IProfileExtensionsOptions {
    readonly extensionsDir: string;
    readonly profileFile: string;
    /** Includes this one. */
    readonly allProfileFiles: () => readonly string[];
    readonly logger?: ILogger;
}

export interface IProfileExtensionsChange {
    /** Versions no profile uses anymore: marked for removal on the next editor start. */
    readonly obsolete: readonly IInstalledExtension[];
}

export interface IProfileExtensionRemoval extends IProfileExtensionsChange {
    readonly removed: boolean;
}

export class ProfileExtensions {
    private readonly logger: ILogger;

    public constructor(private readonly options: IProfileExtensionsOptions) {
        this.logger = options.logger ?? NULL_LOGGER;
    }

    public get extensionsDir(): string {
        return this.options.extensionsDir;
    }

    /**
     * The version each entry points to (US-0.3), even one marked for removal: the profile wins over the mark,
     * the same as the startup cleanup decides, so the CLI and the window agree. An unreadable
     * file yields an empty list and a logged error: the window starts and the file stays untouched.
     */
    public list(): IProfileExtension[] {
        const file = this.options.profileFile;
        let entries: IStoredProfileExtension[];
        try {
            entries = readProfileExtensions(file) ?? [];
        } catch (err) {
            this.logger.error(`Failed to read profile extensions ${file}`, err);
            return [];
        }
        const disk = readDisk(this.options.extensionsDir);
        const byKey = new Map<string, IProfileExtension>();
        for (const entry of entries) {
            const id = entry.identifier.id;
            const key = extensionKey(id);
            if (byKey.has(key)) continue;
            const installed = resolveEntry(entry, disk, (chosen, onDisk) => {
                const versions = onDisk.map((e) => e.version).sort(compareLooseVersions);
                this.logger.warn(
                    `Extension ${id}@${entry.version} in ${file} has no directory; using ${chosen.version} (on disk: ${versions.join(", ")})`,
                );
            });
            if (installed !== undefined) byKey.set(key, { ...installed, pinned: entry.metadata?.pinned === true });
        }
        return [...byKey.values()].sort((a, b) => a.id.localeCompare(b.id));
    }

    /**
     * The entries point to the given installed versions; `extensionDependencies` come too,
     * transitively: a dependency installed earlier for another profile is needed in this one.
     * A dependency the profile already has keeps its entry. An unreadable file is an error, not a rewrite.
     */
    public add(
        installed: readonly IExtensionLocation[],
        options: IProfileExtensionsAddOptions = {},
    ): IProfileExtensionsChange {
        const entries = readProfileExtensions(this.options.profileFile) ?? [];
        const disk = readDisk(this.options.extensionsDir);
        const adding = new Map<string, IInstalledExtension>();
        const queue: IInstalledExtension[] = [];
        for (const one of installed) {
            const found = disk.installed.find((e) => dirName(e) === path.basename(one.dir));
            if (found === undefined || adding.has(extensionKey(found.id))) continue;
            adding.set(extensionKey(found.id), found);
            queue.push(found);
        }
        const roots = new Set(adding.keys());
        const visited = new Set(roots);
        const keep = (key: string): IInstalledExtension | undefined => {
            const existing = entries.find((e) => extensionKey(e.identifier.id) === key);
            return existing === undefined ? undefined : resolveEntry(existing, disk, () => undefined);
        };
        for (const one of options.dependencies ?? []) {
            const found = disk.installed.find((e) => dirName(e) === path.basename(one.dir));
            if (found === undefined || visited.has(extensionKey(found.id))) continue;
            const key = extensionKey(found.id);
            visited.add(key);
            const kept = keep(key);
            if (kept !== undefined) {
                queue.push(kept);
                continue;
            }
            adding.set(key, found);
            queue.push(found);
        }
        for (let one = queue.shift(); one !== undefined; one = queue.shift()) {
            for (const dependency of one.dependencies) {
                const key = extensionKey(dependency);
                if (visited.has(key)) continue;
                visited.add(key);
                const kept = keep(key);
                if (kept !== undefined) {
                    queue.push(kept);
                    continue;
                }
                const versions = versionsOf(disk, key, true);
                if (versions.length === 0) continue;
                const picked = highest(versions);
                adding.set(key, picked);
                queue.push(picked);
            }
        }
        const kept = entries.filter((e) => !adding.has(extensionKey(e.identifier.id)));
        const written = [...adding].map(([key, one]) => {
            const previous = entries.find((e) => extensionKey(e.identifier.id) === key);
            // A dependency new to the profile is written without a pin (upstream dependency tasks: `pinned: false`).
            return rewriteEntry(one, previous, roots.has(key) ? options.pinned : undefined);
        });
        writeProfileExtensions(this.options.profileFile, [...kept, ...written]);
        return { obsolete: this.markUnused([...adding.keys()]) };
    }

    /** No longer used by any profile, its versions are marked for removal (upstream `onDidRemoveExtensions`). */
    public remove(id: string): IProfileExtensionRemoval {
        const key = extensionKey(id);
        const entries = readProfileExtensions(this.options.profileFile) ?? [];
        const kept = entries.filter((e) => extensionKey(e.identifier.id) !== key);
        if (kept.length === entries.length) return { removed: false, obsolete: [] };
        writeProfileExtensions(this.options.profileFile, kept);
        const obsolete = this.markUnused([id]);
        if (obsolete.length === 0) this.logger.info(`Extension ${id} is kept on disk: another profile uses it`);
        return { removed: true, obsolete };
    }

    private markUnused(ids: readonly string[]): IInstalledExtension[] {
        return markUnusedExtensions(this.options.extensionsDir, this.options.allProfileFiles(), ids, this.logger);
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
